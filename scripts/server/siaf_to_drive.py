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
    → modo DIARIO: procesa días pendientes y sobreescribe los CSV de
      `diario/` con SOLO esos días (típicamente ayer, 1 fila por archivo).

  python siaf_to_drive.py --date 2026-04-20
    → modo DIARIO (backfill): sobreescribe los CSV de `diario/` con esa
      fecha. NO actualiza control.json.

  python siaf_to_drive.py --full-reset
    → modo HISTÓRICO: borra control.json y reprocesa todo el historial.
      Escribe los CSV acumulativos completos en `historico/`. Pide
      confirmación interactiva antes.

Arquitectura de carpetas:
  \\\\192.168.0.250\\TKL_sync_IA\\TKL-SIAF-CSV\\
    ├── historico/  → CSV acumulativos completos (carga inicial vía
    │                 load-sales-history.ts; se escribe en --full-reset
    │                 y la primera vez sin control.json).
    └── diario/     → CSV con solo los días procesados en este run
                      (sobreescribe; lo descarga el sync de Vercel cada
                      mañana sin riesgo de timeout).

Salida por sucursal (3 archivos):
  {Sucursal}_ventas.csv       — una fila por día (total_ventas = SUM TOTBRUTO)
  {Sucursal}_vendedores.csv   — una fila por vendedor por día
  {Sucursal}_ossocial.csv     — una fila por obra social por día

Requiere:
  - pip install dbfread
  - Acceso de escritura a las dos subcarpetas:
      \\\\192.168.0.250\\TKL_sync_IA\\TKL-SIAF-CSV\\historico\\
      \\\\192.168.0.250\\TKL_sync_IA\\TKL-SIAF-CSV\\diario\\
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from dbfread import DBF

# Lazy import de libs Google Drive: el script sigue funcionando si no estan
# instaladas (fallback a solo escribir en disco con warning).
try:
    from googleapiclient.discovery import build as _drive_build
    from googleapiclient.http import MediaFileUpload
    from google.oauth2 import service_account
    _DRIVE_LIBS_AVAILABLE = True
except ImportError:
    _DRIVE_LIBS_AVAILABLE = False

# =============================================================================
# CONFIGURACIÓN — editar solo si cambian rutas del servidor
# =============================================================================

BASE_PATH    = Path(r"C:\_Datos\_administracion\temporal_sucursales")
# Dos carpetas separadas: el sync diario de Vercel descarga solo `diario/`
# (33 archivos chicos con ayer), evitando el timeout. `historico/` se usa una
# sola vez para la carga inicial vía load-sales-history.ts.
DESTINO_HISTORICO = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\historico")
DESTINO_DIARIO    = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\diario")
CONTROL_FILE      = Path(r"C:\TKL\siaf_sync\tkl_sync_control.json")
LOG_PATH          = Path(r"C:\TKL\siaf_sync\tkl_sync.log")

# IDs de carpetas Google Drive — destino del upload directo (sin cliente
# Drive de escritorio). El script elige una u otra segun is_historical_run.
DRIVE_FOLDER_ID_HISTORICO = "1_g-SthP24Nb3JfCKWQvQqmnjWwg-akeQ"
DRIVE_FOLDER_ID_DIARIO    = "12ar34mlgGJlFaOks-7tEgifby4HrAhvC"
# Scope full drive: necesario para poder pisar archivos creados por humanos
# en historico/. Con drive.file solo veriamos los que cree esta SA.
DRIVE_SCOPES              = ["https://www.googleapis.com/auth/drive"]

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

# Códigos que NUNCA son ventas.
# NOTA: NCR (notas de crédito) NO se excluyen — tienen TOTBRUTO negativo y deben
# descontar del total de ventas automáticamente.
CODIGOS_EXCLUIR: set[str] = {
    "NDB", "REM", "MCC", "MOS", "REC",
    "BAJ", "ALT", "PRE", "PED", "COM", "REA",
    "OP",  "OI",  "OTR", "IMD", "IME",
}

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
# DETECCIÓN DE CÓDIGOS DE VENTA
# =============================================================================

def es_codigo_venta(codigo: str) -> bool:
    """True si el código identifica un comprobante de venta."""
    c = codigo.strip().upper()
    # Códigos fijos conocidos (WHA = comprobantes de WhatsApp)
    if c in {"DET", "TKT", "FAC", "MOV", "NOV", "WHA"}:
        return True
    # Punto de venta numérico: 001-999
    if len(c) == 3 and c.isdigit():
        return True
    # Punto de venta 2 dígitos: 01-99
    if len(c) == 2 and c.isdigit():
        return True
    # Factura tipo A, B o C: A01-C99
    if len(c) == 3 and c[0] in ("A", "B", "C") and c[1:].isdigit():
        return True
    return False


def incluir_registro(codigo: str) -> bool:
    """True si el registro se incluye como venta. NCR cuenta porque su TOTBRUTO
    es negativo y debe descontar del total de ventas (notas de crédito)."""
    c = codigo.strip().upper()
    if c in CODIGOS_EXCLUIR:
        return False
    if c == "NCR":
        return True
    return es_codigo_venta(c)

# =============================================================================
# HELPERS de parseo robusto (bytes nulos, bytes crudos, etc.)
# =============================================================================

def safe_float(value: Any) -> float:
    """Convierte a float tolerando bytes nulos. Devuelve 0.0 si no parsea."""
    try:
        if isinstance(value, bytes):
            stripped = value.strip(b"\x00").strip()
            return float(stripped) if stripped else 0.0
        s = str(value).strip() if value is not None else ""
        return float(s) if s else 0.0
    except (ValueError, TypeError):
        return 0.0


def safe_str(value: Any) -> str:
    """Convierte a string tolerando bytes nulos."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.strip(b"\x00").decode(DBF_ENCODING, errors="replace").strip()
    return str(value).strip()

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
    """Devuelve YYYYMMDD o None. Soporta D-type (date) o string."""
    if val is None:
        return None
    if isinstance(val, date):
        return val.strftime("%Y%m%d")
    s = safe_str(val).replace("-", "")
    if len(s) == 8 and s.isdigit():
        return s
    return None


def read_dbf_safely(path: Path, name: str) -> list[dict] | None:
    """Lee un DBF. Reintenta 1 vez a los 30s si falla. None si el archivo no existe."""
    if not path.exists():
        log.warning(f"[{name}] DBF no existe: {path.name}")
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


def leer_usr_dbf(path: Path, name: str) -> dict[str, str]:
    """USR.DBF — lee por índice (nombres de campo tienen caracteres especiales).
    Índice 0: código (3 chars). Índice 1: nombre (hasta 30 chars)."""
    if not path.exists():
        log.warning(f"[{name}] USR.DBF no existe — se usarán códigos como nombres")
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
            codigo = safe_str(values[0])[:3]
            nombre = safe_str(values[1])[:30]
            if codigo:
                result[codigo] = nombre or codigo
        return result
    except Exception as e:
        log.warning(f"[{name}] No se pudo leer USR.DBF: {e}")
        return {}


def leer_os_dbf(path: Path, name: str) -> dict[str, str]:
    """OS.DBF — intenta por nombre de campo (CODIGO/NOMBRE) primero, luego por índice."""
    if not path.exists():
        log.warning(f"[{name}] OS.DBF no existe — se usarán códigos como nombres")
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
            codigo: str | None = None
            nombre: str | None = None
            # Intentar por nombre limpio (primeros 6 chars upper)
            for k, v in record.items():
                k_clean = k.strip()[:6].upper()
                if k_clean == "CODIGO":
                    codigo = safe_str(v)
                elif k_clean == "NOMBRE":
                    nombre = safe_str(v)
            # Fallback por índice
            if not codigo:
                values = list(record.values())
                if len(values) >= 2:
                    codigo = safe_str(values[0])
                    nombre = safe_str(values[1])
            if codigo:
                result[codigo] = (nombre or codigo).strip()
        return result
    except Exception as e:
        log.warning(f"[{name}] No se pudo leer OS.DBF: {e}")
        return {}

# =============================================================================
# CLASIFICACIÓN DE FORMA DE PAGO
# =============================================================================

def classify_payment(tarjeta: str, os_code: str) -> str:
    """Devuelve 'efectivo' | 'tarjeta' | 'obra_social' según los campos TARJETA y OS."""
    t = (tarjeta or "").strip()
    o = (os_code or "").strip()
    if t:
        return "tarjeta"
    if o:
        return "obra_social"
    return "efectivo"

# =============================================================================
# DETERMINACIÓN DE FECHAS A PROCESAR
# =============================================================================

def determine_dates_to_process(
    control_last: str | None,
    yesterday: date,
    force_date: date | None,
) -> tuple[set[str] | None, str]:
    """Devuelve (set de YYYYMMDD | None si full-history, label del modo)."""
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

# =============================================================================
# PROCESAMIENTO POR SUCURSAL
# =============================================================================

def process_branch(
    folder_code: str,
    sucursal: str,
    date_filter: set[str] | None,
    yesterday: date,
) -> tuple[list[dict], list[dict], list[dict], set[str]]:
    """Devuelve (ventas_rows, vendedores_rows, ossocial_rows, processed_dates)."""
    folder = BASE_PATH / folder_code

    # Referencias por sucursal
    vendor_map = leer_usr_dbf(folder / "USR.DBF", sucursal)
    os_map     = leer_os_dbf(folder / "OS.DBF",  sucursal)

    # Fuente principal
    cpbtemi = read_dbf_safely(folder / "CPBTEMI.DBF", sucursal)
    if cpbtemi is None:
        return ([], [], [], set())

    yesterday_str = yesterday.strftime("%Y%m%d")
    records_by_date: dict[str, list[dict]] = defaultdict(list)
    for r in cpbtemi:
        codigo = safe_str(r.get("CODIGO"))
        if not incluir_registro(codigo):
            continue
        fecha_str = normalize_fecha(r.get("FECHA"))
        if fecha_str is None:
            continue
        if fecha_str > yesterday_str:
            continue  # nunca procesar hoy o futuro
        if date_filter is not None and fecha_str not in date_filter:
            continue
        records_by_date[fecha_str].append(r)

    if not records_by_date:
        return ([], [], [], set())

    # cpbt_meta: fuente de verdad para resolver cada línea de DETMOV. Construido
    # desde los CPBTEMI ya filtrados, indexa por (NUMERO, fecha_yyyymmdd) y por
    # NUMERO solo (fallback). Cada entry trae vendedor, os, sign (-1 si NCR o
    # TOTBRUTO < 0), y la fecha original del comprobante.
    #
    # Por qué dos índices: a veces DETMOV.FECHA difiere de CPBTEMI.FECHA para el
    # mismo NUMERO (cierres tardíos, líneas registradas al día siguiente). El
    # match exacto cubre el 99% de los casos; el fallback by_numero rescata el
    # resto. Si hay colisión de NUMERO entre fechas, la última fecha gana —
    # aceptable para nuestro uso.
    cpbt_meta:           dict[tuple[str, str], dict] = {}
    cpbt_meta_by_numero: dict[str, dict] = {}
    for date_str, recs in records_by_date.items():
        for r in recs:
            numero = safe_str(r.get("NUMERO"))
            if not numero:
                continue
            codigo   = safe_str(r.get("CODIGO")).upper()
            totbruto = safe_float(r.get("TOTBRUTO"))
            entry = {
                "vendedor": safe_str(r.get("VENDEDOR")),
                "os":       safe_str(r.get("OS")),
                "sign":     -1 if (codigo == "NCR" or totbruto < 0) else 1,
                "fecha":    date_str,
            }
            cpbt_meta[(numero, date_str)] = entry
            cpbt_meta_by_numero[numero]   = entry

    # Unidades desde DETMOV.DBF (opcional)
    detmov_units         = read_detmov_units       (folder, sucursal, set(records_by_date.keys()), cpbt_meta, cpbt_meta_by_numero)
    vendor_units_by_date = read_detmov_vendor_units(folder, sucursal, set(records_by_date.keys()), cpbt_meta, cpbt_meta_by_numero)
    os_units_by_date     = read_detmov_os_units    (folder, sucursal, set(records_by_date.keys()), cpbt_meta, cpbt_meta_by_numero)

    ventas_rows:     list[dict] = []
    vendedores_rows: list[dict] = []
    ossocial_rows:   list[dict] = []
    processed:       set[str]   = set()

    for date_str in sorted(records_by_date.keys()):
        recs = records_by_date[date_str]
        fecha_iso = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

        total_bruto = 0.0
        total_desc  = 0.0
        tickets: set[Any] = set()
        ventas_efectivo = 0.0
        ventas_tarjeta  = 0.0
        ventas_os       = 0.0

        vendor_agg: dict[str, dict] = defaultdict(lambda: {"ventas": 0.0, "tickets": set(), "descuentos": 0.0, "unidades": 0})
        os_agg:     dict[str, dict] = defaultdict(lambda: {"ventas_bruto": 0.0, "descuentos": 0.0, "tickets": set(), "unidades": 0})

        for r in recs:
            bruto  = safe_float(r.get("TOTBRUTO"))
            desc   = safe_float(r.get("TOTDESCTO"))
            numero = r.get("NUMERO")
            vcode  = safe_str(r.get("VENDEDOR"))
            ocode  = safe_str(r.get("OS"))
            tcode  = safe_str(r.get("TARJETA"))

            total_bruto += bruto
            total_desc  += desc
            if numero is not None:
                tickets.add(numero)

            # Ventas brutas por forma de pago (SUM TOTBRUTO, no neto)
            payment = classify_payment(tcode, ocode)
            if payment == "efectivo":
                ventas_efectivo += bruto
            elif payment == "tarjeta":
                ventas_tarjeta += bruto
            else:
                ventas_os += bruto

            # Por vendedor (ventas = TOTBRUTO; descuentos = TOTDESCTO)
            if vcode:
                v = vendor_agg[vcode]
                v["ventas"] += bruto
                if numero is not None:
                    v["tickets"].add(numero)
                v["descuentos"] += desc

            # Por obra social (vacío → "PAR" para consistencia con merge DETMOV)
            o = os_agg[ocode or "PAR"]
            o["ventas_bruto"] += bruto
            o["descuentos"]   += desc
            if numero is not None:
                o["tickets"].add(numero)

        # Mergear unidades por vendedor (DETMOV) en vendor_agg para que cada
        # vendedor tenga su contador. Si un vendedor aparece en DETMOV pero no
        # en CPBTEMI del día, se crea la entrada igual (no debería pasar — el
        # cruce por NUMERO viene de los CPBTEMI filtrados — pero defensivo).
        for vcode_du, units in vendor_units_by_date.get(date_str, {}).items():
            vendor_agg[vcode_du]["unidades"] = units

        # Mergear unidades por OS — guard explícito: solo si la OS ya está en
        # os_agg (es decir, tiene venta CPBTEMI ese día). Evita filas con
        # ventas_bruto=0/tickets=0/unidades>0 que serían visualmente confusas
        # en el dashboard ejecutivo.
        for os_code_du, units in os_units_by_date.get(date_str, {}).items():
            if os_code_du in os_agg:
                os_agg[os_code_du]["unidades"] = units

        total_tickets   = len(tickets)
        ticket_promedio = total_bruto / total_tickets if total_tickets > 0 else 0.0
        total_unidades  = detmov_units.get(date_str, 0)

        ventas_rows.append({
            "sucursal":           sucursal,
            "fecha":              fecha_iso,
            "total_ventas":       round(total_bruto, 2),
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
                "unidades":         agg["unidades"],
            })

        for code, agg in os_agg.items():
            codigo_out = code
            nombre_out = "PARTICULAR" if code == "PAR" else os_map.get(code, code)
            neto_os = agg["ventas_bruto"] - agg["descuentos"]
            ossocial_rows.append({
                "sucursal":     sucursal,
                "fecha":        fecha_iso,
                "codigo_os":    codigo_out,
                "nombre_os":    nombre_out,
                "ventas_bruto": round(agg["ventas_bruto"], 2),
                "descuentos":   round(agg["descuentos"], 2),
                "ventas_neto":  round(neto_os, 2),
                "tickets":      len(agg["tickets"]),
                "unidades":     agg["unidades"],
            })

        processed.add(date_str)

    return (ventas_rows, vendedores_rows, ossocial_rows, processed)


def _resolve_meta(
    nrocpbt: str,
    fecha_str: str,
    cpbt_meta: dict[tuple[str, str], dict],
    cpbt_meta_by_numero: dict[str, dict],
) -> tuple[dict | None, bool]:
    """Lookup doble. Devuelve (meta | None, fue_fallback_con_fecha_distinta)."""
    meta = cpbt_meta.get((nrocpbt, fecha_str))
    if meta is not None:
        return meta, False
    meta = cpbt_meta_by_numero.get(nrocpbt)
    if meta is None:
        return None, False
    return meta, meta["fecha"] != fecha_str


def read_detmov_units(
    folder: Path,
    sucursal: str,
    date_filter: set[str] | None,
    cpbt_meta: dict[tuple[str, str], dict],
    cpbt_meta_by_numero: dict[str, dict],
) -> dict[str, int]:
    """Suma CANTIDAD de DETMOV.DBF por fecha, cruzando con cpbt_meta.

    No filtramos por DETMOV.CPBT — el sistema TKL tiene líneas de detalle
    asociadas a comprobantes NOV, TKT, FAC, 001-999, PV1-PV25, etc. Filtrar
    por ('DET','NCR') perdía esas unidades. El sign del movimiento se toma
    desde CPBTEMI (codigo == NCR o TOTBRUTO < 0 → -1, sino 1)."""
    path = folder / "DETMOV.DBF"
    if not path.exists():
        return {}
    records = read_dbf_safely(path, sucursal)
    if records is None:
        return {}

    result: dict[str, int] = defaultdict(int)
    total = matched = ignored = date_mismatches = 0

    for r in records:
        fecha_str = normalize_fecha(r.get("FECHA"))
        if fecha_str is None:
            continue
        if date_filter is not None and fecha_str not in date_filter:
            continue
        total += 1

        nrocpbt = safe_str(r.get("NROCPBT"))
        meta, mismatch = _resolve_meta(nrocpbt, fecha_str, cpbt_meta, cpbt_meta_by_numero)
        if meta is None:
            ignored += 1
            continue
        if mismatch:
            date_mismatches += 1

        cantidad_raw = safe_float(r.get("CANTIDAD")) or 0
        cantidad = int(abs(cantidad_raw)) * meta["sign"]
        result[fecha_str] += cantidad
        matched += 1

    sum_units = sum(result.values())
    log.info(
        f"[{sucursal}] DETMOV total: leidas={total} matcheadas={matched} "
        f"ignoradas={ignored} unidades={sum_units} date_mismatch={date_mismatches}"
    )
    return dict(result)


def read_detmov_vendor_units(
    folder: Path,
    sucursal: str,
    date_filter: set[str] | None,
    cpbt_meta: dict[tuple[str, str], dict],
    cpbt_meta_by_numero: dict[str, dict],
) -> dict[str, dict[str, int]]:
    """Suma CANTIDAD por (fecha, código_vendedor). Misma lógica que
    read_detmov_units pero usa meta["vendedor"]; ignora líneas sin vendedor."""
    path = folder / "DETMOV.DBF"
    if not path.exists():
        return {}
    records = read_dbf_safely(path, sucursal)
    if records is None:
        return {}

    result: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    total = matched = ignored = date_mismatches = 0

    for r in records:
        fecha_str = normalize_fecha(r.get("FECHA"))
        if fecha_str is None:
            continue
        if date_filter is not None and fecha_str not in date_filter:
            continue
        total += 1

        nrocpbt = safe_str(r.get("NROCPBT"))
        meta, mismatch = _resolve_meta(nrocpbt, fecha_str, cpbt_meta, cpbt_meta_by_numero)
        if meta is None:
            ignored += 1
            continue
        if mismatch:
            date_mismatches += 1

        vendor = meta["vendedor"]
        if not vendor:
            ignored += 1
            continue

        cantidad_raw = safe_float(r.get("CANTIDAD")) or 0
        cantidad = int(abs(cantidad_raw)) * meta["sign"]
        result[fecha_str][vendor] += cantidad
        matched += 1

    sum_units = sum(sum(v.values()) for v in result.values())
    log.info(
        f"[{sucursal}] DETMOV vendor: leidas={total} matcheadas={matched} "
        f"ignoradas={ignored} unidades={sum_units} date_mismatch={date_mismatches}"
    )
    return {k: dict(v) for k, v in result.items()}


def read_detmov_os_units(
    folder: Path,
    sucursal: str,
    date_filter: set[str] | None,
    cpbt_meta: dict[tuple[str, str], dict],
    cpbt_meta_by_numero: dict[str, dict],
) -> dict[str, dict[str, int]]:
    """Suma CANTIDAD por (fecha, código_obra_social). Misma lógica que
    read_detmov_units pero usa meta["os"]; ventas particulares
    (meta["os"] vacío) se agrupan bajo "PAR"."""
    path = folder / "DETMOV.DBF"
    if not path.exists():
        return {}
    records = read_dbf_safely(path, sucursal)
    if records is None:
        return {}

    result: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    total = matched = ignored = date_mismatches = 0

    for r in records:
        fecha_str = normalize_fecha(r.get("FECHA"))
        if fecha_str is None:
            continue
        if date_filter is not None and fecha_str not in date_filter:
            continue
        total += 1

        nrocpbt = safe_str(r.get("NROCPBT"))
        meta, mismatch = _resolve_meta(nrocpbt, fecha_str, cpbt_meta, cpbt_meta_by_numero)
        if meta is None:
            ignored += 1
            continue
        if mismatch:
            date_mismatches += 1

        os_code = meta["os"] or "PAR"

        cantidad_raw = safe_float(r.get("CANTIDAD")) or 0
        cantidad = int(abs(cantidad_raw)) * meta["sign"]
        result[fecha_str][os_code] += cantidad
        matched += 1

    sum_units = sum(sum(v.values()) for v in result.values())
    log.info(
        f"[{sucursal}] DETMOV os: leidas={total} matcheadas={matched} "
        f"ignoradas={ignored} unidades={sum_units} date_mismatch={date_mismatches}"
    )
    return {k: dict(v) for k, v in result.items()}

# =============================================================================
# CSV MERGE WRITER
# =============================================================================

def merge_and_write_csv(
    path: Path,
    new_rows: list[dict],
    fieldnames: list[str],
    key_fields: list[str],
) -> int:
    """Lee CSV existente + merge por key_fields + escribe todo sorted. Devuelve total de filas."""
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

def write_csv_simple(path: Path, rows: list[dict], fieldnames: list[str]) -> int:
    """Sobreescribe el CSV con solo las rows pasadas (sin merge). Usado en modo
    diario: cada run reemplaza el contenido por los días procesados en ese run."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({fn: ("" if r.get(fn) is None else str(r[fn])) for fn in fieldnames})
    return len(rows)

# =============================================================================
# UPLOAD DIRECTO A GOOGLE DRIVE
# =============================================================================
# Reemplaza la dependencia del cliente Drive de escritorio en el servidor.
# Si no hay credenciales o las libs google no estan instaladas, el script
# sigue funcionando en modo solo-disco (con warning).

def load_drive_credentials():
    """Lee SA desde env GOOGLE_SERVICE_ACCOUNT_JSON o credentials.json junto
    al script. Devuelve None si no hay credenciales validas — el caller
    interpreta None como "Drive deshabilitado" y sigue solo a disco."""
    if not _DRIVE_LIBS_AVAILABLE:
        return None

    env_value = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if env_value:
        try:
            info = json.loads(env_value)
            return service_account.Credentials.from_service_account_info(info, scopes=DRIVE_SCOPES)
        except Exception as e:
            log.warning(f"GOOGLE_SERVICE_ACCOUNT_JSON invalido: {e}")

    cred_file = Path(__file__).parent / "credentials.json"
    if cred_file.exists():
        try:
            return service_account.Credentials.from_service_account_file(str(cred_file), scopes=DRIVE_SCOPES)
        except Exception as e:
            log.warning(f"credentials.json no parseable: {e}")

    return None


def build_drive_service():
    """Construye el cliente Drive v3. Devuelve None si no hay creds o las
    libs no estan instaladas — modo solo-disco se activa transparente."""
    creds = load_drive_credentials()
    if creds is None:
        return None
    try:
        return _drive_build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        log.warning(f"No se pudo construir cliente Drive: {e}")
        return None


def upload_csv_to_drive(service, local_path: Path, folder_id: str) -> bool:
    """Sube o actualiza un CSV en Drive (match por nombre + parent). Devuelve
    True si OK, False si falla. Errores no abortan el sync — solo log."""
    if service is None:
        return False
    name = local_path.name
    try:
        q = f"name = '{name}' and '{folder_id}' in parents and trashed = false"
        resp = service.files().list(
            q=q, fields="files(id, name)", spaces="drive", pageSize=1,
        ).execute()
        items = resp.get("files", [])
        media = MediaFileUpload(str(local_path), mimetype="text/csv", resumable=False)
        if items:
            fid = items[0]["id"]
            service.files().update(fileId=fid, media_body=media).execute()
            log.info(f"  Drive UPDATE {name} -> {fid}")
        else:
            created = service.files().create(
                body={"name": name, "parents": [folder_id]},
                media_body=media, fields="id",
            ).execute()
            log.info(f"  Drive CREATE {name} -> {created.get('id')}")
        return True
    except Exception as e:
        log.warning(f"  Drive upload fallo para {name}: {e}")
        return False

VENTAS_FIELDS = [
    "sucursal", "fecha", "total_ventas", "total_tickets", "ticket_promedio",
    "total_unidades", "ventas_efectivo", "ventas_tarjeta", "ventas_obra_social",
]
VENDEDORES_FIELDS = [
    "sucursal", "fecha", "codigo_vendedor", "nombre_vendedor",
    "ventas", "tickets", "descuentos", "unidades",
]
OSSOCIAL_FIELDS = [
    "sucursal", "fecha", "codigo_os", "nombre_os",
    "ventas_bruto", "descuentos", "ventas_neto", "tickets", "unidades",
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

    # Determinar destino antes de tocar control.json:
    # - HISTÓRICO (acumulativo, merge): --full-reset, o primera vez sin control.json.
    # - DIARIO (sobreescribe, sin merge): modo normal y backfill --date.
    is_historical_run = (args.full_reset or not CONTROL_FILE.exists()) and not args.date
    output_dir = DESTINO_HISTORICO if is_historical_run else DESTINO_DIARIO
    log.info(f"Modo: {'HISTÓRICO (acumulativo)' if is_historical_run else 'DIARIO (sobreescribe)'}")
    log.info(f"Destino: {output_dir}")

    # Drive upload: inicializar una vez. None = modo solo-disco (sin libs o
    # sin credenciales). Cada CSV se sube despues de escribirlo.
    drive_folder_id = DRIVE_FOLDER_ID_HISTORICO if is_historical_run else DRIVE_FOLDER_ID_DIARIO
    drive_service = build_drive_service()
    if drive_service is None:
        log.warning("Drive upload DESHABILITADO (libs no instaladas o sin credenciales); CSV solo a disco.")
    else:
        log.info(f"Drive upload activo (folder_id={drive_folder_id})")

    # Validar carpeta destino accesible
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        log.error(f"Carpeta destino no disponible: {output_dir}")
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

            ventas_path     = output_dir / f"{sucursal}_ventas.csv"
            vendedores_path = output_dir / f"{sucursal}_vendedores.csv"
            ossocial_path   = output_dir / f"{sucursal}_ossocial.csv"

            if is_historical_run:
                n_ventas     = merge_and_write_csv(ventas_path,     ventas_rows,     VENTAS_FIELDS,     ["fecha"])
                n_vendedores = merge_and_write_csv(vendedores_path, vendedores_rows, VENDEDORES_FIELDS, ["fecha", "codigo_vendedor"])
                n_ossocial   = merge_and_write_csv(ossocial_path,   ossocial_rows,   OSSOCIAL_FIELDS,   ["fecha", "codigo_os"])
            else:
                n_ventas     = write_csv_simple(ventas_path,     ventas_rows,     VENTAS_FIELDS)
                n_vendedores = write_csv_simple(vendedores_path, vendedores_rows, VENDEDORES_FIELDS)
                n_ossocial   = write_csv_simple(ossocial_path,   ossocial_rows,   OSSOCIAL_FIELDS)

            log.info(f"[{sucursal}] ✓ {len(processed)} día(s) procesados | "
                     f"ventas.csv={n_ventas}, vendedores.csv={n_vendedores}, ossocial.csv={n_ossocial}")

            # Subir los 3 CSV a Drive (no aborta si falla — solo logea por archivo)
            if drive_service is not None:
                for p in (ventas_path, vendedores_path, ossocial_path):
                    upload_csv_to_drive(drive_service, p, drive_folder_id)

            if force_date is None:
                max_yyyymmdd = max(processed)
                max_iso = f"{max_yyyymmdd[:4]}-{max_yyyymmdd[4:6]}-{max_yyyymmdd[6:8]}"
                control[sucursal] = max_iso

            ok_count += 1
        except Exception as e:
            log.exception(f"[{sucursal}] ERROR inesperado: {e}")
            error_count += 1

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
