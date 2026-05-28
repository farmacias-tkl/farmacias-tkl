"""reset_snapshot.py - Borra SalesSnapshot de una fecha en Neon para reprocesar.

NO se conecta a Neon directamente. Llama al endpoint
    POST {DASHBOARD_URL}/api/sync/reset-snapshot
en Vercel via curl.exe. El endpoint hace el DELETE y deja registro en SyncLog.

Uso tipico: cuando se cargaron mal las ventas de un dia (unidades en 0,
totales incorrectos, DETMOV.DBF desactualizado, etc.) y hay que reprocesar.

Despues de correr este script:
  1. (Opcional) python siaf_to_drive.py --date YYYY-MM-DD
     para regenerar los CSV en Drive.
  2. Disparar el curl de Vercel para reprocesar y volver a poblar la DB.

Uso:
  python reset_snapshot.py --date 2026-05-26

Credenciales (lee de .env junto al script):
  SYNC_WEBHOOK_SECRET="..."   (obligatorio)
  DASHBOARD_URL="https://farmacias-tkl.vercel.app"   (opcional)

Sin dependencias Python externas (no psycopg2, no requests).
curl.exe esperado en C:\\TKL\\siaf_sync\\curl\\curl.exe (overridable por env CURL_PATH).

Exit codes:
  0 - OK
  1 - cancelado por el usuario o sin registros para la fecha
  2 - error de configuracion (credenciales, fecha, curl no encontrado)
  3 - error de red o de respuesta del endpoint
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

# =============================================================================
# CONFIG / LOGGING
# =============================================================================

LOG_PATH        = Path(r"C:\TKL\siaf_sync\reset_snapshot.log")
DEFAULT_CURL    = Path(r"C:\TKL\siaf_sync\curl\curl.exe")
DEFAULT_URL     = "https://farmacias-tkl.vercel.app"
HTTP_TIMEOUT_S  = 60

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
log = logging.getLogger("reset-snapshot")

# =============================================================================
# CONFIG: lectura de .env
# =============================================================================

def load_env() -> dict[str, str]:
    """Lee variables del .env junto al script + complementa con os.environ.

    Las del env de proceso tienen prioridad sobre las del .env (para overrides
    puntuales sin tocar el archivo)."""
    env: dict[str, str] = {}
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        try:
            for raw in env_file.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                key, sep, val = line.partition("=")
                if not sep:
                    continue
                env[key.strip()] = val.strip().strip('"').strip("'")
        except Exception as e:
            log.warning(f"No se pudo parsear .env: {e}")
    for k in ("SYNC_WEBHOOK_SECRET", "DASHBOARD_URL", "CURL_PATH"):
        val = os.environ.get(k, "").strip()
        if val:
            env[k] = val
    return env

# =============================================================================
# UTILS
# =============================================================================

def parse_cli_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        log.error(f"Fecha invalida: '{s}'. Formato esperado: YYYY-MM-DD")
        sys.exit(2)


def post_json(url: str, secret: str, payload: dict, curl_path: Path) -> tuple[int, dict | None]:
    """POST via curl.exe. Devuelve (http_status, json_body).
    Sale con exit(3) si la red falla, exit(2) si curl.exe no esta."""
    if not curl_path.exists():
        log.error(f"curl.exe no encontrado en {curl_path}")
        sys.exit(2)

    body = json.dumps(payload, ensure_ascii=False)
    cmd = [
        str(curl_path),
        "-s",                       # silenciar progress
        "-w", "\n%{http_code}",     # appendea status code al final
        "-X", "POST",
        "-H", f"Authorization: Bearer {secret}",
        "-H", "Content-Type: application/json",
        "-d", body,
        "--max-time", str(HTTP_TIMEOUT_S),
        url,
    ]

    try:
        completed = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8",
            check=False, timeout=HTTP_TIMEOUT_S + 5,
        )
    except subprocess.TimeoutExpired:
        log.error(f"Timeout llamando a {url}")
        sys.exit(3)
    except Exception as e:
        log.error(f"Fallo al invocar curl: {e}")
        sys.exit(3)

    if completed.returncode != 0:
        log.error(f"curl returncode={completed.returncode}; stderr={completed.stderr.strip()}")
        sys.exit(3)

    raw = (completed.stdout or "").strip()
    if not raw:
        log.error("Respuesta vacia del endpoint")
        sys.exit(3)

    # La ultima linea es el HTTP status (formato del -w).
    lines    = raw.splitlines()
    status_s = lines[-1].strip()
    body_s   = "\n".join(lines[:-1]).strip()

    try:
        status = int(status_s)
    except ValueError:
        log.error(f"HTTP status no parseable: '{status_s}'")
        sys.exit(3)

    parsed: dict | None = None
    if body_s:
        try:
            parsed = json.loads(body_s)
        except json.JSONDecodeError:
            log.warning(f"Respuesta no es JSON: {body_s[:200]}")

    return status, parsed

# =============================================================================
# MAIN
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Borrar SalesSnapshot de una fecha via endpoint Vercel.",
    )
    parser.add_argument("--date", required=True, help="Fecha YYYY-MM-DD a borrar.")
    args = parser.parse_args()

    target = parse_cli_date(args.date)

    today = date.today()
    if target > today:
        log.error(f"Fecha futura no permitida: {target.isoformat()} > {today.isoformat()}")
        sys.exit(2)

    env = load_env()
    secret = env.get("SYNC_WEBHOOK_SECRET", "")
    if not secret:
        log.error("SYNC_WEBHOOK_SECRET no configurado (ni en env ni en .env junto al script)")
        sys.exit(2)

    base_url  = env.get("DASHBOARD_URL", DEFAULT_URL).rstrip("/")
    curl_path = Path(env.get("CURL_PATH", str(DEFAULT_CURL)))
    endpoint  = f"{base_url}/api/sync/reset-snapshot"

    # --- Paso 1: dry-run para contar ---
    log.info(f"Buscando registros para {target.isoformat()}...")
    status, body = post_json(
        endpoint, secret,
        {"date": target.isoformat(), "dryRun": True},
        curl_path,
    )
    if status == 401:
        log.error("Auth rechazada por el endpoint. Verificar SYNC_WEBHOOK_SECRET.")
        sys.exit(2)
    if status != 200 or not body or not body.get("ok"):
        log.error(f"Respuesta inesperada (status {status}): {body}")
        sys.exit(3)

    count = int(body.get("count", 0))
    if count == 0:
        log.info(
            f"No hay registros en SalesSnapshot para {target.isoformat()} - nada que borrar."
        )
        sys.exit(1)

    log.info(f"Encontradas {count} filas en SalesSnapshot.")

    # --- Confirmacion interactiva ---
    try:
        ans = input("Confirmar eliminacion? (s/n): ").strip().lower()
    except EOFError:
        ans = ""
    if ans not in ("s", "si", "sí", "y", "yes"):
        log.info("Cancelado por el usuario.")
        sys.exit(1)

    # --- Paso 2: DELETE real ---
    status, body = post_json(
        endpoint, secret,
        {"date": target.isoformat(), "dryRun": False},
        curl_path,
    )
    if status != 200 or not body or not body.get("ok"):
        log.error(f"Error en el DELETE (status {status}): {body}")
        sys.exit(3)

    deleted = int(body.get("deleted", 0))
    log.info(f"{deleted} filas eliminadas correctamente.")
    log.info("Proximos pasos:")
    log.info(
        f"  1. Si los CSVs necesitan regenerarse: python siaf_to_drive.py --date {target.isoformat()}"
    )
    log.info("  2. Disparar el curl para reprocesar en Vercel.")


if __name__ == "__main__":
    main()
