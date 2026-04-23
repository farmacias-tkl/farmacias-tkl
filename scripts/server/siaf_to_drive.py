"""
siaf_to_drive.py — Extrae ventas diarias del sistema SIAF a CSV en carpeta de red.

# ============================================================
# ARCHIVO CRÍTICO: tkl_sync_control.json
# Ubicación: C:\\TKL\\siaf_sync\\tkl_sync_control.json
# NO BORRAR - NO MOVER - NO EDITAR MANUALMENTE
# Registra hasta qué fecha se procesaron los datos
# de cada sucursal.
# Si se borra: el próximo sync reprocesa todo el historial
# (no se pierden datos, pero tarda más tiempo).
# ============================================================

Ejecución programada: Windows Task Scheduler, diaria a las 03:00 AM.
Procesa desde la última fecha registrada en control.json hasta AYER.

Uso:
  python siaf_to_drive.py
    → procesa desde última fecha registrada hasta ayer

  python siaf_to_drive.py --date 2026-04-20
    → backfill de una fecha específica (NO actualiza control.json)

  python siaf_to_drive.py --full-reset
    → borra control.json y reprocesa todo el historial
       (pide confirmación interactiva antes)

Salida (33 archivos fijos, acumulativos entre runs):
  {Sucursal}_ventas.csv       — una fila por día
  {Sucursal}_vendedores.csv   — una fila por vendedor por día
  {Sucursal}_ossocial.csv     — una fila por obra social por día

Requiere:
  - pip install dbfread
  - Acceso de escritura a: \\\\192.168.0.250\\TKL_sync_IA\\TKL-SIAF-CSV\\
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from dbfread import DBF

# =============================================================================
# CONFIGURACIÓN — editar solo si cambian rutas del servidor
# =============================================================================

BASE_PATH    = Path(r"C:\_Datos\_administracion\temporal_sucursales")
OUTPUT_DIR   = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV")
CONTROL_FILE = Path(r"C:\TKL\siaf_sync\tkl_sync_control.json")
LOG_PATH     = Path(r"C:\_Datos\_administracion\tkl_sync.log")

DBF_ENCODING = "cp1252"

FOLDER_MAP: dict[str, str] = {
    "AM": "America",
    "AY": "Facultad",
    "ET": "Etcheverry",
    "GL": "Galesa",
    "LA": "Larcade",
    "MU": "La Perla",
    "NV": "Naveira",
    "QN": "Quintana",
    "SA": "San Agustin",
    "SM": "San Miguel",
    "TK": "Tekiel",
}

# Códigos de tarjeta conocidos (case-insensitive) — clasifican como "tarjeta"
TARJETA_CODES = {"BAN", "VIS", "MAS", "AME", "NAR", "CAB", "TAR", "CRE", "DEB"}

# =============================================================================
# LOGGING
# =============================================================================

LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(str(LOG_PATH), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("tkl-sync")

# =============================================================================
# CONTROL FILE
# =============================================================================

def load_control() -> dict[str, str]:
    if not CONTROL_FILE.exists():
        return {}
    try:
        with CONTROL_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            log.warning("control.json tiene formato inválido, se ignora.")
            return {}
        return {k: str(v) for k, v in data.items()}
    except Exception as e:
        log.error(f"No se pudo leer control.json: {e}")
        return {}


def save_control(control: dict[str, str]) -> None:
    CONTROL_FILE.parent.mkdir(parents=True, exist_ok=True)
    with CONTROL_FILE.open("w", encoding="utf-8") as f:
        json.dump(control, f, ensure_ascii=False, indent=2, sort_keys=True)

# =============================================================================
# HELPERS DBF
# =============================================================================

def normalize_fecha(val: Any) -> str | None:
    """Devuelve YYYYMMDD o None. Soporta D-type (date) o string 'YYYYMMDD' / 'YYYY-MM-DD'."""
    if val is None:
        return None
    if isinstance(val, date):
        return val.strftime("%Y%m%d")
    s = str(val).strip().replace("-", "")
    if len(s) == 8 and s.isdigit():
        return s
    return None


def read_dbf_safely(path: Path, name: str) -> list[dict] | None:
    """Lee un DBF devolviendo lista de registros (dict).
    Reintenta 1 vez a los 30s si falla. Retorna None si el archivo no existe o falla definitivamente."""
    if not path.exists():
        log.warning(f"[{name}] DBF no existe: {path}")
        return None
    for attempt in range(2):
        try:
            dbf = DBF(
                str(path),
                encoding=DBF_ENCODING,
                ignore_missing_memofile=True,
                char_decode_errors="replace",
            )
            return [dict(r) for r in dbf]
        except Exception as e:
            if attempt == 0:
                log.warning(f"[{name}] Error leyendo {path.name}: {e}. Reintentando en 30s...")
                time.sleep(30)
            else:
                log.error(f"[{name}] DBF {path.name} falló tras retry: {e}")
                return None
    return None


def load_code_name_map(path: Path, name: str, label: str) -> dict[str, str]:
    """Carga un DBF donde field[0]=código y field[1]=nombre. Lee por índice, no por nombre de campo."""
    if not path.exists():
        log.warning(f"[{name}] {label} no existe: {path.name} — se usarán códigos como nombres")
        return {}
    try:
        dbf = DBF(
            str(path),
            encoding=DBF_ENCODING,
            ignore_missing_memofile=True,
            char_decode_errors="replace",
        )
        result: dict[str, str] = {}
        for record in dbf:
            values = list(record.values())
            if len(values) < 2:
                continue
            code = str(values[0] or "").strip()
            nom  = str(values[1] or "").strip()
            if code:
                result[code] = nom or code
        return result
    except Exception as e:
        log.warning(f"[{name}] No se pudo leer {label} {path.name}: {e}")
        return {}

# =============================================================================
# CLASIFICACIÓN DE PAGO
# =============================================================================

def classify_payment(tarjeta: str, os_code: str) -> str:
    """Devuelve 'efectivo' | 'tarjeta' | 'obra_social' según la regla del spec."""
    t = (tarjeta or "").strip().upper()
    o = (os_code or "").strip()
    if t:
        return "tarjeta"
    if o:
        return "obra_social"
    return "efectivo"

# =============================================================================
# PROCESAMIENTO POR SUCURSAL
# =============================================================================

def determine_dates_to_process(
    control_last: str | None,
    yesterday: date,
    force_date: date | None,
) -> tuple[set[str] | None, str]:
    """Devuelve (set de YYYYMMDD a procesar | None si es full-history, mode_label)."""
    if force_date is not None:
        return ({force_date.strftime("%Y%m%d")}, f"backfill {force_date}")
    if control_last:
        try:
            last_date = datetime.strptime(control_last, "%Y-%m-%d").date()
        except ValueError:
            log.warning(f"Fecha inválida en control.json: '{control_last}'. Tratando como full-history.")
            return (None, "full-history")
        start = last_date + timedelta(days=1)
        if start > yesterday:
            return (set(), f"ya actualizado hasta {control_last}")
        dates: set[str] = set()
        d = start
        while d <= yesterday:
            dates.add(d.strftime("%Y%m%d"))
            d += timedelta(days=1)
        return (dates, f"incremental {start} → {yesterday}")
    return (None, "full-history (primera vez)")


def read_detmov_units(folder: Path, sucursal: str, date_filter: set[str] | None) -> dict[str, int]:
    """Suma cantidades de DETMOV.DBF por fecha (CODIGO='DET'). Devuelve {YYYYMMDD: units}."""
    path = folder / "DETMOV.DBF"
    if not path.exists():
        return {}
    records = read_dbf_safely(path, sucursal)
    if records is None:
        return {}
    result: dict[str, int] = defaultdict(int)
    for r in records:
        fecha_str = normalize_fecha(r.get("FECHA"))
        if fecha_str is None:
            continue
        if date_filter is not None and fecha_str not in date_filter:
            continue
        codigo = str(r.get("CODIGO") or r.get("CPBT") or "").strip().upper()
        if codigo != "DET":
            continue
        cantidad = r.get("CANTIDAD")
        if cantidad is None:
            continue
        try:
            result[fecha_str] += int(float(cantidad))
        except (ValueError, TypeError):
            pass
    return dict(result)


def process_branch(
    folder_code: str,
    sucursal: str,
    date_filter: set[str] | None,
    yesterday: date,
) -> tuple[list[dict], list[dict], list[dict], set[str]]:
    """Procesa una sucursal. Devuelve (ventas_rows, vendedores_rows, ossocial_rows, processed_dates_yyyymmdd)."""
    folder = BASE_PATH / folder_code

    # Leer vendedores y obras sociales de ESA sucursal
    vendor_map = load_code_name_map(folder / "USR.DBF", sucursal, "USR.DBF")
    os_map     = load_code_name_map(folder / "OS.DBF",  sucursal, "OS.DBF")

    # Leer CPBTEMI.DBF — fuente principal
    cpbtemi = read_dbf_safely(folder / "CPBTEMI.DBF", sucursal)
    if cpbtemi is None:
        return ([], [], [], set())

    # Filtrar: CODIGO='DET', fecha en date_filter (o todas si es None), fecha ≤ ayer
    yesterday_str = yesterday.strftime("%Y%m%d")
    records_by_date: dict[str, list[dict]] = defaultdict(list)
    for r in cpbtemi:
        codigo = str(r.get("CODIGO") or "").strip().upper()
        if codigo != "DET":
            continue
        fecha_str = normalize_fecha(r.get("FECHA"))
        if fecha_str is None:
            continue
        if fecha_str > yesterday_str:
            continue  # nunca procesamos datos de hoy o futuro
        if date_filter is not None and fecha_str not in date_filter:
            continue
        records_by_date[fecha_str].append(r)

    if not records_by_date:
        return ([], [], [], set())

    # DETMOV para unidades
    detmov_units = read_detmov_units(folder, sucursal, set(records_by_date.keys()))

    ventas_rows: list[dict]     = []
    vendedores_rows: list[dict] = []
    ossocial_rows: list[dict]   = []
    processed: set[str]         = set()

    for date_str in sorted(records_by_date.keys()):
        recs = records_by_date[date_str]
        fecha_iso = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

        total_bruto = 0.0
        total_desc  = 0.0
        tickets: set[Any] = set()
        ventas_efectivo = 0.0
        ventas_tarjeta  = 0.0
        ventas_os       = 0.0

        vendor_agg: dict[str, dict] = defaultdict(lambda: {"ventas": 0.0, "tickets": set(), "descuentos": 0.0})
        os_agg:     dict[str, dict] = defaultdict(lambda: {"ventas_bruto": 0.0, "descuentos": 0.0})

        for r in recs:
            bruto   = float(r.get("TOTBRUTO")  or 0)
            desc    = float(r.get("TOTDESCTO") or 0)
            neto    = bruto - desc
            numero  = r.get("NUMERO")
            vcode   = str(r.get("VENDEDOR") or "").strip()
            ocode   = str(r.get("OS")       or "").strip()
            tcode   = str(r.get("TARJETA")  or "").strip()

            total_bruto += bruto
            total_desc  += desc
            if numero is not None:
                tickets.add(numero)

            payment = classify_payment(tcode, ocode)
            if payment == "efectivo":
                ventas_efectivo += neto
            elif payment == "tarjeta":
                ventas_tarjeta += neto
            else:
                ventas_os += neto

            if vcode:
                v = vendor_agg[vcode]
                v["ventas"] += neto
                if numero is not None:
                    v["tickets"].add(numero)
                v["descuentos"] += desc

            os_key = ocode  # vacío → PARTICULAR (clave "")
            o = os_agg[os_key]
            o["ventas_bruto"] += bruto
            o["descuentos"]   += desc

        total_neto      = total_bruto - total_desc
        total_tickets   = len(tickets)
        ticket_promedio = total_neto / total_tickets if total_tickets > 0 else 0.0
        total_unidades  = detmov_units.get(date_str, 0)

        ventas_rows.append({
            "sucursal":           sucursal,
            "fecha":              fecha_iso,
            "total_ventas":       round(total_neto, 2),
            "total_tickets":      total_tickets,
            "ticket_promedio":    round(ticket_promedio, 2),
            "total_unidades":     total_unidades,
            "ventas_efectivo":    round(ventas_efectivo, 2),
            "ventas_tarjeta":     round(ventas_tarjeta, 2),
            "ventas_obra_social": round(ventas_os, 2),
        })

        for code, agg in vendor_agg.items():
            vendedores_rows.append({
                "sucursal":         sucursal,
                "fecha":            fecha_iso,
                "codigo_vendedor":  code,
                "nombre_vendedor":  vendor_map.get(code, code),
                "ventas":           round(agg["ventas"], 2),
                "tickets":          len(agg["tickets"]),
                "descuentos":       round(agg["descuentos"], 2),
            })

        for code, agg in os_agg.items():
            if code:
                nombre = os_map.get(code, code)
            else:
                nombre = "PARTICULAR"
            neto_os = agg["ventas_bruto"] - agg["descuentos"]
            ossocial_rows.append({
                "sucursal":     sucursal,
                "fecha":        fecha_iso,
                "codigo_os":    code,
                "nombre_os":    nombre,
                "ventas_bruto": round(agg["ventas_bruto"], 2),
                "descuentos":   round(agg["descuentos"], 2),
                "ventas_neto":  round(neto_os, 2),
            })

        processed.add(date_str)

    return (ventas_rows, vendedores_rows, ossocial_rows, processed)

# =============================================================================
# CSV MERGE WRITER
# Lee CSV existente + merge con nuevas filas (dedupe por key_fields) + escribe todo.
# Esto garantiza CSVs acumulativos a través de runs.
# =============================================================================

def merge_and_write_csv(
    path: Path,
    new_rows: list[dict],
    fieldnames: list[str],
    key_fields: list[str],
) -> int:
    """Merge rows into CSV. Devuelve total de filas escritas."""
    existing: dict[tuple, dict] = {}
    if path.exists():
        try:
            with path.open("r", newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    key = tuple(row.get(k, "") for k in key_fields)
                    existing[key] = row
        except Exception as e:
            log.warning(f"No se pudo leer CSV existente {path.name}: {e} — se rescribe desde cero.")
            existing = {}

    for nr in new_rows:
        key = tuple(str(nr.get(k, "")) for k in key_fields)
        existing[key] = {fn: ("" if nr.get(fn) is None else str(nr[fn])) for fn in fieldnames}

    all_rows = sorted(existing.values(), key=lambda r: tuple(r.get(k, "") for k in key_fields))

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    return len(all_rows)

VENTAS_FIELDS = [
    "sucursal", "fecha", "total_ventas", "total_tickets", "ticket_promedio",
    "total_unidades", "ventas_efectivo", "ventas_tarjeta", "ventas_obra_social",
]
VENDEDORES_FIELDS = [
    "sucursal", "fecha", "codigo_vendedor", "nombre_vendedor",
    "ventas", "tickets", "descuentos",
]
OSSOCIAL_FIELDS = [
    "sucursal", "fecha", "codigo_os", "nombre_os",
    "ventas_bruto", "descuentos", "ventas_neto",
]

# =============================================================================
# CLI / MAIN
# =============================================================================

def parse_cli_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError as e:
        raise SystemExit(f"Fecha inválida '{s}'. Formato esperado: YYYY-MM-DD") from e


def confirm_full_reset() -> bool:
    print()
    print("=" * 60)
    print(f"⚠️  ATENCIÓN: Esta acción borrará el archivo de control:")
    print(f"   {CONTROL_FILE}")
    print()
    print("   El próximo run reprocesará TODO el historial de cada sucursal.")
    print("   (No se pierden datos, pero puede tardar varios minutos.)")
    print("=" * 60)
    resp = input("Escribí 'SI' (en mayúsculas) para confirmar: ")
    return resp.strip() == "SI"


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrae ventas de SIAF a CSV en carpeta de red")
    parser.add_argument("--date", help="Backfill de una fecha específica (YYYY-MM-DD)")
    parser.add_argument("--full-reset", action="store_true",
                        help="Borra control.json y reprocesa todo el historial (pide confirmación)")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("=== Inicio sync TKL SIAF ===")
    log.info("=" * 60)

    # Validar carpeta destino accesible
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        log.error(f"Carpeta destino no disponible: {OUTPUT_DIR}")
        log.error(f"Error: {e}")
        log.error("Verificar acceso de red y permisos de escritura.")
        sys.exit(2)

    # Full reset
    if args.full_reset:
        if CONTROL_FILE.exists():
            if not confirm_full_reset():
                print("Cancelado.")
                sys.exit(0)
            CONTROL_FILE.unlink()
            log.warning(f"Control file borrado por --full-reset: {CONTROL_FILE}")
        else:
            log.info("--full-reset: control.json no existía, nada que borrar.")

    # Backfill single-date
    force_date: date | None = None
    if args.date:
        force_date = parse_cli_date(args.date)
        log.info(f"Modo backfill: fecha forzada = {force_date}")

    # Load control
    control = load_control()

    today     = date.today()
    yesterday = today - timedelta(days=1)

    ok_count = 0
    error_count = 0

    for folder_code, sucursal in FOLDER_MAP.items():
        try:
            control_last = control.get(sucursal)
            date_filter, mode_label = determine_dates_to_process(control_last, yesterday, force_date)
            log.info(f"[{sucursal}] procesando — {mode_label}")

            if date_filter == set():
                # Ya actualizado, nada por procesar (caso incremental sin días pendientes)
                log.info(f"[{sucursal}] sin días pendientes, skip")
                ok_count += 1
                continue

            ventas_rows, vendedores_rows, ossocial_rows, processed = process_branch(
                folder_code, sucursal, date_filter, yesterday,
            )

            if not processed:
                log.warning(f"[{sucursal}] sin datos procesables")
                ok_count += 1
                continue

            # Merge + escribir 3 CSVs (acumulativos)
            n_ventas     = merge_and_write_csv(OUTPUT_DIR / f"{sucursal}_ventas.csv",
                                               ventas_rows, VENTAS_FIELDS, ["fecha"])
            n_vendedores = merge_and_write_csv(OUTPUT_DIR / f"{sucursal}_vendedores.csv",
                                               vendedores_rows, VENDEDORES_FIELDS,
                                               ["fecha", "codigo_vendedor"])
            n_ossocial   = merge_and_write_csv(OUTPUT_DIR / f"{sucursal}_ossocial.csv",
                                               ossocial_rows, OSSOCIAL_FIELDS,
                                               ["fecha", "codigo_os"])

            log.info(f"[{sucursal}] ✓ {len(processed)} día(s) procesados | "
                     f"ventas.csv={n_ventas}, vendedores.csv={n_vendedores}, ossocial.csv={n_ossocial}")

            # Actualizar control.json SOLO en modo incremental o full-history (NO en backfill --date)
            if force_date is None:
                max_yyyymmdd = max(processed)
                max_iso = f"{max_yyyymmdd[:4]}-{max_yyyymmdd[4:6]}-{max_yyyymmdd[6:8]}"
                control[sucursal] = max_iso

            ok_count += 1
        except Exception as e:
            log.exception(f"[{sucursal}] ERROR inesperado: {e}")
            error_count += 1

    # Persistir control actualizado
    if force_date is None:
        try:
            save_control(control)
            log.info(f"control.json actualizado: {CONTROL_FILE}")
        except Exception as e:
            log.error(f"No se pudo guardar control.json: {e}")
    else:
        log.info("Modo backfill: control.json NO actualizado.")

    log.info("=" * 60)
    log.info(f"=== Fin sync: ✓ {ok_count} OK   ✗ {error_count} con errores   de {len(FOLDER_MAP)} sucursales ===")
    log.info("=" * 60)

    sys.exit(0 if error_count == 0 else 1)


if __name__ == "__main__":
    main()
