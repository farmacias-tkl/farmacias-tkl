"""upload_saldos.py — Sube el Excel de saldos bancarios a Google Drive.

Reemplaza la dependencia del cliente Drive de escritorio en el servidor.
Pensado para correr en Windows Task Scheduler antes de los crons del
dashboard (sync de saldos a 08:50 ART y 09:30 ART).

Uso:
    python upload_saldos.py

Lee el Excel mas reciente de:
    \\\\192.168.0.250\\TKL_sync_IA\\TKL-Saldos\\

Ignora archivos temporales ~$*.xlsx (locks de Excel abierto).
Sube a la carpeta Drive 1PVGy9Q09qoPcfbnB6-l2shAiL4XUqigu (UPDATE si
existe por nombre, CREATE si no).

Credenciales: env GOOGLE_SERVICE_ACCOUNT_JSON o credentials.json en la
misma carpeta del script.

Exit codes:
    0 — OK
    2 — sin .xlsx en la carpeta de red (excluyendo ~$)
    3 — sin credenciales Drive validas o libs no instaladas
    4 — falla durante upload (red, permisos, quota)

Requiere:
    pip install google-api-python-client google-auth
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

# Lazy import: si las libs no estan instaladas, fallamos en main() con
# exit 3 (no abortamos al importar).
try:
    from googleapiclient.discovery import build as _drive_build
    from googleapiclient.http import MediaFileUpload
    from google.oauth2 import service_account
    _DRIVE_LIBS_AVAILABLE = True
except ImportError:
    _DRIVE_LIBS_AVAILABLE = False

# =============================================================================
# CONFIGURACION
# =============================================================================

SALDOS_FOLDER   = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-Saldos")
DRIVE_FOLDER_ID = "1PVGy9Q09qoPcfbnB6-l2shAiL4XUqigu"
DRIVE_SCOPES    = ["https://www.googleapis.com/auth/drive"]
LOG_PATH        = Path(r"C:\TKL\siaf_sync\upload_saldos.log")

XLSX_MIMETYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

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
log = logging.getLogger("upload-saldos")

# =============================================================================
# BUSQUEDA DEL EXCEL EN LA CARPETA DE RED
# =============================================================================

def find_excel_file() -> Path | None:
    """Busca *.xlsx en SALDOS_FOLDER ignorando temporales ~$*.

    Si hay varios, devuelve el mas reciente por mtime y logea warning con
    los nombres. Si hay 0, devuelve None."""
    if not SALDOS_FOLDER.exists():
        log.error(f"Carpeta no accesible: {SALDOS_FOLDER}")
        return None

    candidates = [
        p for p in SALDOS_FOLDER.glob("*.xlsx")
        if not p.name.startswith("~$")
    ]
    if not candidates:
        return None

    if len(candidates) > 1:
        names = ", ".join(sorted(p.name for p in candidates))
        log.warning(f"Multiples .xlsx encontrados ({len(candidates)}): {names} — uso el mas reciente.")

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]

# =============================================================================
# CREDENCIALES Y CLIENTE DRIVE
# =============================================================================

def load_drive_credentials():
    """Lee SA desde env GOOGLE_SERVICE_ACCOUNT_JSON o credentials.json
    junto al script. None si no hay credenciales validas."""
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
    """Construye cliente Drive v3. None si no hay creds o libs."""
    creds = load_drive_credentials()
    if creds is None:
        return None
    try:
        return _drive_build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        log.error(f"No se pudo construir cliente Drive: {e}")
        return None

# =============================================================================
# UPLOAD
# =============================================================================

def upload_to_drive(service, local_path: Path, folder_id: str) -> bool:
    """Sube/actualiza el Excel en Drive (match por nombre + parent).
    True si OK, False si falla."""
    name = local_path.name
    try:
        q = f"name = '{name}' and '{folder_id}' in parents and trashed = false"
        resp = service.files().list(
            q=q, fields="files(id, name)", spaces="drive", pageSize=1,
        ).execute()
        items = resp.get("files", [])
        media = MediaFileUpload(str(local_path), mimetype=XLSX_MIMETYPE, resumable=False)
        if items:
            fid = items[0]["id"]
            service.files().update(fileId=fid, media_body=media).execute()
            log.info(f"Drive UPDATE {name} -> {fid}")
        else:
            created = service.files().create(
                body={"name": name, "parents": [folder_id]},
                media_body=media, fields="id",
            ).execute()
            log.info(f"Drive CREATE {name} -> {created.get('id')}")
        return True
    except Exception as e:
        log.error(f"Drive upload fallo para {name}: {e}")
        return False

# =============================================================================
# MAIN
# =============================================================================

def main() -> None:
    log.info("=" * 60)
    log.info("=== Inicio upload_saldos ===")
    log.info(f"Carpeta origen: {SALDOS_FOLDER}")
    log.info(f"Folder Drive:   {DRIVE_FOLDER_ID}")
    log.info("=" * 60)

    excel = find_excel_file()
    if excel is None:
        log.error(f"[upload_saldos] ERROR: ningun .xlsx encontrado en {SALDOS_FOLDER} (excluyendo ~$*)")
        sys.exit(2)
    log.info(f"Archivo a subir: {excel.name} ({excel.stat().st_size} bytes)")

    if not _DRIVE_LIBS_AVAILABLE:
        log.error("[upload_saldos] ERROR: libs google-api-python-client / google-auth no instaladas")
        sys.exit(3)

    service = build_drive_service()
    if service is None:
        log.error("[upload_saldos] ERROR: sin credenciales Drive validas (env GOOGLE_SERVICE_ACCOUNT_JSON o credentials.json)")
        sys.exit(3)

    ok = upload_to_drive(service, excel, DRIVE_FOLDER_ID)
    if not ok:
        log.error(f"[upload_saldos] ERROR: upload fallo para {excel.name}")
        sys.exit(4)

    log.info(f"[upload_saldos] OK: {excel.name} subido")
    sys.exit(0)


if __name__ == "__main__":
    main()
