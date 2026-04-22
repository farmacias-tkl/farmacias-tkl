"""
siaf_to_drive.py — Extrae datos de ventas diarios desde DBFs de SIAF y los sube a Google Drive.

Ejecución programada: Windows Task Scheduler, diaria 23:00.
Procesa los datos de AYER (fecha = hoy - 1 día).

Uso:
  python siaf_to_drive.py                     # procesa ayer
  python siaf_to_drive.py --date 2026-04-20   # backfill manual de un día específico

Salida:
  - Un CSV por sucursal en _uploads/  (staging local)
  - Sube cada CSV a Google Drive carpeta DRIVE_FOLDER_ID
  - Log en LOG_PATH con timestamp, sucursal, status

Requiere:
  - pip install dbfread google-api-python-client google-auth google-auth-httplib2
  - credentials.json (Service Account de Google) junto a este script
  - Variable DRIVE_FOLDER_ID configurada abajo
"""
from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, TypeVar

from dbfread import DBF
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

# =============================================================================
# CONFIGURACIÓN — editar según el servidor
# =============================================================================

BASE_PATH       = Path(r"C:\_Datos\_administracion\temporal_sucursales")
OUTPUT_DIR      = BASE_PATH / "_uploads"
LOG_PATH        = Path(r"C:\_Datos\_administracion\tkl_sync.log")
SCRIPT_DIR      = Path(__file__).resolve().parent
CREDENTIALS     = SCRIPT_DIR / "credentials.json"

# ⚠️ REEMPLAZAR con el ID real de la carpeta de Drive antes de poner en producción
DRIVE_FOLDER_ID = "REEMPLAZAR_CON_ID_DE_CARPETA_DRIVE"

# Encoding de los DBF. SIAF argentino usa típicamente cp1252.
# Si aparecen caracteres raros (ñ, acentos, ç) cambiar a: 'cp437', 'latin-1', 'utf-8'
DBF_ENCODING = "cp1252"

# Mapeo: código de carpeta → nombre de sucursal
FOLDER_MAPPING = {
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

# Clasificación de formas de pago
TARJETA_KEYWORDS = ("VISA", "MASTER", "AMEX", "NARANJA", "CABAL", "TARJETA")

# =============================================================================
# LOGGING
# =============================================================================

LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(str(LOG_PATH), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("tkl-sync")

T = TypeVar("T")

# =============================================================================
# HELPERS
# =============================================================================

def parse_cli_date(arg: str | None) -> date:
    """Devuelve la fecha a procesar. Sin arg → ayer. Con --date YYYY-MM-DD → esa fecha."""
    if arg is None:
        return date.today() - timedelta(days=1)
    try:
        return datetime.strptime(arg, "%Y-%m-%d").date()
    except ValueError as e:
        raise SystemExit(f"Fecha inválida '{arg}'. Formato esperado: YYYY-MM-DD") from e


def classify_payment(nombre: Any) -> str:
    """Clasifica una forma de pago en efectivo | tarjeta | obra_social."""
    if nombre is None:
        return "obra_social"
    nom = str(nombre).strip().upper()
    if nom == "EFECTIVO":
        return "efectivo"
    if any(kw in nom for kw in TARJETA_KEYWORDS):
        return "tarjeta"
    return "obra_social"


def fecha_matches(record_fecha: Any, target_yyyymmdd: str) -> bool:
    """Compara el campo FECHA del DBF contra YYYYMMDD."""
    if record_fecha is None:
        return False
    s = str(record_fecha).strip().replace("-", "")
    return s == target_yyyymmdd


def read_dbf_filtered(
    path: Path,
    predicate: Callable[[dict], bool],
    name: str,
) -> list[dict] | None:
    """Lee un DBF y filtra por predicate. Reintenta 1 vez a los 30s si falla.
    Devuelve None si el archivo no existe o falla definitivamente."""
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
            return [dict(r) for r in dbf if predicate(r)]
        except Exception as e:
            if attempt == 0:
                log.warning(f"[{name}] Error leyendo {path.name}: {e}. Reintentando en 30s...")
                time.sleep(30)
            else:
                log.error(f"[{name}] DBF {path.name} falló tras retry: {e}")
                return None
    return None


def with_retry(fn: Callable[[], T], retries: int = 3, backoff: int = 2, op_name: str = "op") -> T:
    """Ejecuta fn con reintentos exponenciales. Útil para Drive API."""
    for attempt in range(retries):
        try:
            return fn()
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = backoff ** attempt
            log.warning(f"{op_name} falló (intento {attempt + 1}/{retries}): {e}. Esperando {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"{op_name} agotó reintentos")

# =============================================================================
# PROCESAMIENTO POR SUCURSAL
# =============================================================================

def process_branch(folder_code: str, sucursal_name: str, target_date: date) -> dict[str, Any] | None:
    """Procesa una sucursal. Devuelve dict con los totales o None si no hay datos."""
    folder = BASE_PATH / folder_code
    target_str = target_date.strftime("%Y%m%d")

    if not folder.exists():
        log.warning(f"[{sucursal_name}] Carpeta no existe: {folder}")
        return None

    # CPBTPAGO.DBF — pagos (importes por forma de pago)
    cpbtpago_path = folder / "CPBTPAGO.DBF"
    pagos = read_dbf_filtered(
        cpbtpago_path,
        predicate=lambda r: (
            fecha_matches(r.get("FECHA"), target_str)
            and str(r.get("CPBT", "")).strip().upper() == "DET"
        ),
        name=sucursal_name,
    )
    if pagos is None:
        return None
    if len(pagos) == 0:
        log.warning(f"[{sucursal_name}] CPBTPAGO.DBF sin registros para {target_str}")
        return None

    total_ventas = 0.0
    ventas_efectivo = 0.0
    ventas_tarjeta = 0.0
    ventas_obra_social = 0.0
    nrocpbts: set[str] = set()

    for p in pagos:
        importe = float(p.get("IMPORTE") or 0)
        total_ventas += importe
        categoria = classify_payment(p.get("NOMBRE"))
        if categoria == "efectivo":
            ventas_efectivo += importe
        elif categoria == "tarjeta":
            ventas_tarjeta += importe
        else:
            ventas_obra_social += importe
        nrocpbt = p.get("NROCPBT")
        if nrocpbt is not None:
            nrocpbts.add(str(nrocpbt).strip())

    total_tickets = len(nrocpbts)
    ticket_promedio = total_ventas / total_tickets if total_tickets > 0 else 0.0

    # DETMOV.DBF — detalle de productos (cantidades)
    detmov_path = folder / "DETMOV.DBF"
    movs = read_dbf_filtered(
        detmov_path,
        predicate=lambda r: (
            fecha_matches(r.get("FECHA"), target_str)
            and str(r.get("CPBT", "")).strip().upper() == "DET"
        ),
        name=sucursal_name,
    )
    total_unidades = 0
    if movs is None:
        log.warning(f"[{sucursal_name}] DETMOV.DBF no disponible — total_unidades = 0")
    else:
        for m in movs:
            cantidad = m.get("CANTIDAD")
            if cantidad is not None:
                try:
                    total_unidades += int(float(cantidad))
                except (ValueError, TypeError):
                    pass

    return {
        "sucursal":           sucursal_name,
        "fecha":              target_date.strftime("%Y-%m-%d"),
        "total_ventas":       round(total_ventas, 2),
        "total_tickets":      total_tickets,
        "ticket_promedio":    round(ticket_promedio, 2),
        "total_unidades":     total_unidades,
        "ventas_efectivo":    round(ventas_efectivo, 2),
        "ventas_tarjeta":     round(ventas_tarjeta, 2),
        "ventas_obra_social": round(ventas_obra_social, 2),
    }


def write_csv(data: dict[str, Any], target_date: date) -> Path:
    """Escribe un CSV de una fila con los totales de la sucursal."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{data['sucursal']}_{target_date.strftime('%Y%m%d')}.csv"
    path = OUTPUT_DIR / filename

    fieldnames = [
        "sucursal", "fecha", "total_ventas", "total_tickets", "ticket_promedio",
        "total_unidades", "ventas_efectivo", "ventas_tarjeta", "ventas_obra_social",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerow({k: data[k] for k in fieldnames})

    return path

# =============================================================================
# GOOGLE DRIVE
# =============================================================================

def get_drive_service():
    if not CREDENTIALS.exists():
        raise SystemExit(f"credentials.json no encontrado en: {CREDENTIALS}")
    creds = service_account.Credentials.from_service_account_file(
        str(CREDENTIALS),
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def upload_or_update_csv(service, local_path: Path, folder_id: str) -> str:
    """Sube (o actualiza si ya existe) el CSV a la carpeta de Drive. Devuelve file ID."""
    filename = local_path.name

    def _find_existing():
        resp = service.files().list(
            q=f"name='{filename}' and '{folder_id}' in parents and trashed=false",
            fields="files(id, name)",
            pageSize=1,
        ).execute()
        return resp.get("files", [])

    existing = with_retry(_find_existing, op_name=f"drive.list({filename})")
    media = MediaFileUpload(str(local_path), mimetype="text/csv", resumable=False)

    if existing:
        file_id = existing[0]["id"]
        def _update():
            return service.files().update(
                fileId=file_id, media_body=media, fields="id",
            ).execute()
        with_retry(_update, op_name=f"drive.update({filename})")
        return file_id
    else:
        def _create():
            return service.files().create(
                body={"name": filename, "parents": [folder_id]},
                media_body=media,
                fields="id",
            ).execute()
        result = with_retry(_create, op_name=f"drive.create({filename})")
        return result["id"]

# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Extrae ventas de SIAF y sube a Google Drive")
    parser.add_argument("--date", help="Fecha a procesar (YYYY-MM-DD). Default: ayer")
    args = parser.parse_args()

    target_date = parse_cli_date(args.date)
    log.info("=" * 60)
    log.info(f"🚀 Iniciando sync — fecha objetivo: {target_date.strftime('%Y-%m-%d')}")

    if DRIVE_FOLDER_ID == "REEMPLAZAR_CON_ID_DE_CARPETA_DRIVE":
        log.error("DRIVE_FOLDER_ID no configurado. Editar el script antes de correr.")
        sys.exit(1)

    try:
        drive = get_drive_service()
    except Exception as e:
        log.error(f"No se pudo autenticar en Drive: {e}")
        sys.exit(1)

    ok, errors = 0, 0
    for folder_code, sucursal_name in FOLDER_MAPPING.items():
        try:
            log.info(f"[{sucursal_name}] procesando…")
            data = process_branch(folder_code, sucursal_name, target_date)
            if data is None:
                log.warning(f"[{sucursal_name}] sin datos — skip")
                errors += 1
                continue

            csv_path = write_csv(data, target_date)
            log.info(f"[{sucursal_name}] CSV generado: {csv_path.name} "
                     f"(ventas={data['total_ventas']}, tickets={data['total_tickets']}, "
                     f"unidades={data['total_unidades']})")

            file_id = upload_or_update_csv(drive, csv_path, DRIVE_FOLDER_ID)
            log.info(f"[{sucursal_name}] ✓ subido a Drive (file_id={file_id})")
            ok += 1
        except Exception as e:
            log.exception(f"[{sucursal_name}] ERROR inesperado: {e}")
            errors += 1

    log.info("=" * 60)
    log.info(f"Resumen: ✓ {ok} OK   ✗ {errors} errores   de {len(FOLDER_MAPPING)} sucursales")
    log.info("=" * 60)

    sys.exit(0 if errors == 0 else 1)


if __name__ == "__main__":
    main()
