"""
comparar_versiones_siaf.py — Corre dos versiones de siaf_to_drive.py sobre la misma copia de
los datos SIAF de una sucursal y compara sus CSV.

No es parte del pipeline: no lo usa ninguna tarea programada.

Uso:
  python comparar_versiones_siaf.py --anterior <siaf_to_drive.py de producción, copiado>
                                    --nueva    <siaf_to_drive.py de la rama>
                                    --sucursal Tekiel --desde 2026-01-01 --hasta 2026-10-12
                                    --datos    <copia de la carpeta SIAF de la sucursal>
                                    --salida   <carpeta nueva>
                                    [--buscar-os TEXTO ...]

Cómo corre cada versión (las dos de la misma forma, sin editar sus archivos):
  - Se importa como módulo y se llama a su main() en modo diario (sin argumentos).
  - Antes de importarla, logging.FileHandler se redirige al log de la carpeta de salida y
    Path.mkdir no crea nada fuera de --salida (la versión de producción configura el log al
    importarse, en C:\\TKL\\siaf_sync).
  - Después de importarla se reemplazan en memoria:
      BASE_PATH y FOLDER_MAP   → solo la sucursal pedida, leyendo de --datos;
      DESTINO_DIARIO/HISTORICO → --salida\\<versión>;
      LOG_PATH                 → --salida\\<versión>\\siaf_to_drive.log;
      CONTROL_FILE             → --salida\\<versión>\\control_simulado.json (lo escribe el comparador);
      load_control/save_control → control simulado en memoria (no se lee ni se escribe ningún archivo);
      determine_dates_to_process → período --desde a --hasta;
      build_drive_service      → None (Drive deshabilitado);
      upload_csv_to_drive y el resto de Drive → lanzan una excepción si se llaman.
  - Red de seguridad para todo el proceso (audit hook): cualquier escritura, borrado o carpeta
    fuera de --salida, cualquier lectura fuera de --datos, --salida y los archivos de Python,
    cualquier conexión de red y cualquier proceso nuevo fallan con PermissionError y quedan
    registrados. Si hubo un solo intento bloqueado, la comparación no vale.

Salida:
  --salida\\anterior\\ y --salida\\nueva\\   CSV, log y control simulado de cada versión.
  --salida\\comparacion.txt                 hashes, resultado por archivo y resumen de coseguros.

Código de salida: 0 = los tres CSV idénticos · 1 = alguno distinto · 2 = la comparación no vale o se rechazó.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import logging
import os
import pathlib
import re
import sys
import traceback
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

# Carpetas de producción. --salida no puede caer dentro de ninguna; --datos tampoco.
PROHIBIDAS = [
    r"C:\TKL\siaf_sync",
    r"C:\_Datos",
    r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV",
]
TRES = ("ventas", "vendedores", "ossocial")
REQUERIDOS = ("BASE_PATH", "FOLDER_MAP", "DESTINO_HISTORICO", "DESTINO_DIARIO", "CONTROL_FILE", "LOG_PATH",
              "load_control", "save_control", "determine_dates_to_process", "build_drive_service",
              "upload_csv_to_drive", "main")
DRIVE_OPCIONALES = ("load_drive_credentials", "_drive_build", "MediaFileUpload", "confirm_full_reset")
MAX_FILAS = 20


class Bloqueado(PermissionError):
    pass


# =============================================================================
# RUTAS
# =============================================================================

def norm(p) -> str:
    return os.path.normcase(os.path.abspath(os.fsdecode(p)))


def dentro(p, base) -> bool:
    p, base = norm(p), norm(base)
    return p == base or p.startswith(base.rstrip("\\/") + os.sep)


def se_cruzan(a, b) -> bool:
    return dentro(a, b) or dentro(b, a)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def hashes_carpeta(carpeta: Path) -> dict[str, str]:
    res = {}
    for raiz, dirs, archivos in os.walk(carpeta):
        dirs.sort()
        for a in sorted(archivos):
            p = Path(raiz) / a
            res[str(p.relative_to(carpeta))] = sha256(p)
    return res


def hash_conjunto(h: dict[str, str]) -> str:
    return hashlib.sha256("\n".join(f"{k}\t{v}" for k, v in sorted(h.items())).encode("utf-8")).hexdigest()


# =============================================================================
# RED DE SEGURIDAD (audit hook)
# =============================================================================

ESCRITURA = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
EVENTOS_RUTA = {          # evento → posiciones de los argumentos que son rutas
    "os.mkdir": (0,), "os.rmdir": (0,), "os.remove": (0,), "os.rename": (0, 1), "os.replace": (0, 1),
    "os.truncate": (0,), "os.chmod": (0,), "os.chown": (0,), "os.utime": (0,), "os.link": (0, 1),
    "os.symlink": (0, 1), "shutil.copyfile": (0, 1), "shutil.copymode": (1,), "shutil.copystat": (1,),
    "shutil.copytree": (1,), "shutil.move": (0, 1), "shutil.rmtree": (0,), "shutil.make_archive": (0,),
}
EVENTOS_PROHIBIDOS = (
    "socket.connect", "socket.bind", "socket.sendto", "socket.sendmsg", "socket.getaddrinfo",
    "socket.gethostbyname", "socket.gethostbyaddr", "socket.getnameinfo", "http.client.connect",
    "urllib.Request", "ftplib.connect", "smtplib.connect", "webbrowser.open",
    "subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.startfile", "os.kill",
    "winreg.CreateKey", "winreg.DeleteKey", "winreg.DeleteValue", "winreg.SetValue", "winreg.SaveKey",
    "winreg.LoadKey",
)


class Guardia:
    def __init__(self, salida: Path, datos: Path, lectura_extra: list[Path]):
        self.salida = salida
        self.datos = datos
        self.lectura = [salida, datos] + lectura_extra
        self.bloqueos: list[str] = []
        self.version = "comparador"
        self.leidos_datos: dict[str, set[str]] = {}
        self.activa = False

    def hook(self, evento, args):
        if not self.activa:
            return
        if evento == "open":
            ruta = args[0]
            if isinstance(ruta, int):
                return
            modo = args[1] if len(args) > 1 else None
            flags = args[2] if len(args) > 2 else 0
            escribe = (isinstance(modo, str) and any(c in modo for c in "wax+")) or \
                      (isinstance(flags, int) and flags & ESCRITURA)
            if escribe:
                if not dentro(ruta, self.salida):
                    self._bloquear(evento, f"escritura {os.fsdecode(ruta)} (modo {modo})")
            elif not any(dentro(ruta, b) for b in self.lectura):
                self._bloquear(evento, f"lectura {os.fsdecode(ruta)}")
            elif dentro(ruta, self.datos):
                self.leidos_datos.setdefault(self.version, set()).add(
                    os.path.relpath(os.path.abspath(os.fsdecode(ruta)), self.datos))
            return
        if evento in EVENTOS_RUTA:
            for i in EVENTOS_RUTA[evento]:
                if i < len(args) and isinstance(args[i], (str, bytes, os.PathLike)) \
                        and not dentro(args[i], self.salida):
                    self._bloquear(evento, os.fsdecode(args[i]))
            return
        if evento.startswith(EVENTOS_PROHIBIDOS):
            self._bloquear(evento, repr(args)[:200])

    def _bloquear(self, evento, detalle):
        msg = f"[{self.version}] {evento}: {detalle}"
        self.bloqueos.append(msg)
        raise Bloqueado(f"bloqueado por el comparador: {msg}")


def raices_python(excluir: list[Path]) -> list[Path]:
    """Carpetas de Python y de sys.path de donde se pueden leer módulos. Se descartan las que
    se cruzan con una carpeta prohibida, con --datos o con la carpeta del comparador."""
    cands = [sys.prefix, sys.base_prefix, sys.exec_prefix] + [p for p in sys.path[1:] if p]
    res = []
    for c in cands:
        p = Path(c)
        if any(se_cruzan(p, x) for x in excluir):
            continue
        if not p.parent or norm(p) == norm(p.anchor):
            continue
        res.append(p)
    return res


# =============================================================================
# CARGA AISLADA DE UNA VERSIÓN
# =============================================================================

class Abortar(Exception):
    pass


def cargar_version(nombre: str, script: Path, carpeta: Path, guardia: Guardia, neutralizados: list[str]):
    """Importa el script sin ejecutar su main(). Durante la importación el FileHandler va a
    carpeta/siaf_to_drive.log y Path.mkdir fuera de --salida no hace nada (queda anotado)."""
    raiz = logging.getLogger()
    for h in list(raiz.handlers):
        raiz.removeHandler(h)
        h.close()
    _RedirFileHandler.destino = carpeta / "siaf_to_drive.log"

    mkdir_original = pathlib.Path.mkdir

    def mkdir_al_importar(self, *a, **kw):
        if dentro(self, guardia.salida):
            return mkdir_original(self, *a, **kw)
        neutralizados.append(f"[{nombre}] al importar, Path.mkdir({self}) no se ejecutó")

    # Se compila el fuente directamente (sin el cargador de archivos), así no se busca ni se
    # escribe ningún .pyc junto al script.
    nombre_mod = f"siaf_version_{nombre}"
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader(nombre_mod, loader=None))
    mod.__file__ = str(script)
    codigo = compile(script.read_bytes(), str(script), "exec")
    sys.modules[nombre_mod] = mod
    pathlib.Path.mkdir = mkdir_al_importar
    try:
        exec(codigo, mod.__dict__)
    finally:
        pathlib.Path.mkdir = mkdir_original
    faltan = [a for a in REQUERIDOS if not hasattr(mod, a)]
    if faltan:
        raise Abortar(f"La versión {nombre} no tiene {', '.join(faltan)}: no se puede garantizar el aislamiento.")
    return mod


class _RedirFileHandler(logging.FileHandler):
    destino: Path | None = None

    def __init__(self, filename, mode="a", encoding=None, delay=False, errors=None):
        super().__init__(str(type(self).destino), mode, encoding, delay, errors)


class _Drive:
    def __init__(self, nombre: str):
        self.nombre = nombre
        self.build = 0
        self.intentos: list[str] = []

    def build_drive_service(self):
        self.build += 1
        return None

    def prohibida(self, cual: str):
        def f(*a, **kw):
            self.intentos.append(cual)
            raise Bloqueado(f"bloqueado por el comparador: [{self.nombre}] Drive {cual}")
        return f


def aislar(mod, nombre: str, carpeta: Path, datos: Path, sucursal: str, desde: date, hasta: date) -> dict:
    """Reemplaza en memoria rutas, control y Drive. Devuelve el estado para el reporte."""
    estado = {"drive": _Drive(nombre), "control_guardado": [], "codigo_original": None}
    codigos = [c for c, s in mod.FOLDER_MAP.items() if s == sucursal]
    if len(codigos) != 1:
        raise Abortar(f"La sucursal '{sucursal}' no está (o está repetida) en FOLDER_MAP de la versión {nombre}.")
    estado["codigo_original"] = codigos[0]
    for const in ("BASE_PATH", "DESTINO_HISTORICO", "DESTINO_DIARIO", "CONTROL_FILE", "LOG_PATH"):
        v = getattr(mod, const)
        if se_cruzan(v, carpeta.parent) or se_cruzan(v, datos):
            raise Abortar(f"{const} de la versión {nombre} ({v}) se cruza con --salida o --datos.")

    control = {sucursal: (desde - timedelta(days=1)).isoformat()}
    control_path = carpeta / "control_simulado.json"
    control_path.write_text(json.dumps(control, ensure_ascii=False, indent=2), encoding="utf-8")

    mod.BASE_PATH = datos.parent
    mod.FOLDER_MAP = {datos.name: sucursal}
    mod.DESTINO_HISTORICO = carpeta
    mod.DESTINO_DIARIO = carpeta
    mod.CONTROL_FILE = control_path
    mod.LOG_PATH = carpeta / "siaf_to_drive.log"
    mod.load_control = lambda: dict(control)
    mod.save_control = lambda c: estado["control_guardado"].append(dict(c))
    orig_fechas = mod.determine_dates_to_process
    mod.determine_dates_to_process = lambda last, _ayer, force: orig_fechas(last, hasta, force)
    d = estado["drive"]
    mod.build_drive_service = d.build_drive_service
    mod.upload_csv_to_drive = d.prohibida("upload_csv_to_drive")
    for a in DRIVE_OPCIONALES:
        if hasattr(mod, a):
            setattr(mod, a, d.prohibida(a))
    return estado


def correr_version(mod, nombre: str, script: Path, guardia: Guardia) -> tuple[int | None, str]:
    guardia.version = nombre
    argv = sys.argv
    sys.argv = [str(script)]
    codigo, error = None, ""
    try:
        mod.main()
        codigo = 0
    except SystemExit as e:
        codigo = e.code if isinstance(e.code, int) else (0 if e.code is None else 2)
        if not isinstance(e.code, int) and e.code is not None:
            error = str(e.code)
    except Bloqueado as e:
        error = str(e)
    except Exception:
        error = traceback.format_exc()
    finally:
        sys.argv = argv
        guardia.version = "comparador"
        for h in list(logging.getLogger().handlers):
            h.flush()
    return codigo, error


# =============================================================================
# COMPARACIÓN
# =============================================================================

def leer_lineas(p: Path) -> list[str]:
    return p.read_text(encoding="utf-8").splitlines()


def comparar_csv(a: Path, n: Path) -> list[str]:
    out = []
    if not a.exists() or not n.exists():
        out.append(f"  anterior: {'existe' if a.exists() else 'NO EXISTE'} · nueva: {'existe' if n.exists() else 'NO EXISTE'}")
        out.append("  resultado: DISTINTO")
        return out
    ha, hn = sha256(a), sha256(n)
    out.append(f"  SHA-256 anterior: {ha}")
    out.append(f"  SHA-256 nueva:    {hn}")
    if ha == hn:
        out.append("  resultado: IDÉNTICO")
        return out
    out.append("  resultado: DISTINTO")
    la, ln = leer_lineas(a), leer_lineas(n)
    out.append(f"  filas (sin encabezado): anterior {max(len(la) - 1, 0)} · nueva {max(len(ln) - 1, 0)}")
    if la[:1] != ln[:1]:
        out.append(f"  encabezado anterior: {la[:1]}")
        out.append(f"  encabezado nueva:    {ln[:1]}")
    ca, cn = Counter(la[1:]), Counter(ln[1:])
    solo_a = list((ca - cn).elements())
    solo_n = list((cn - ca).elements())
    out.append(f"  filas solo en la anterior: {len(solo_a)} · filas solo en la nueva: {len(solo_n)}")
    if not solo_a and not solo_n:
        out.append("  (mismas filas en distinto orden, o diferencia de fin de línea)")
    distintas = [(i, x, y) for i, (x, y) in enumerate(zip(la, ln)) if x != y]
    for i in range(min(len(la), len(ln)), max(len(la), len(ln))):
        distintas.append((i, la[i] if i < len(la) else "(no hay)", ln[i] if i < len(ln) else "(no hay)"))
    out.append(f"  primeras {min(MAX_FILAS, len(distintas))} filas distintas (línea del archivo, encabezado = 1):")
    for i, x, y in distintas[:MAX_FILAS]:
        out.append(f"    línea {i + 1}")
        out.append(f"      anterior: {x}")
        out.append(f"      nueva:    {y}")
    for titulo, lista in (("solo en la anterior", solo_a), ("solo en la nueva", solo_n)):
        if lista:
            out.append(f"  primeras {min(MAX_FILAS, len(lista))} filas {titulo}:")
            out.extend(f"    {x}" for x in lista[:MAX_FILAS])
    return out


def resumen_coseguros(p: Path, log_nueva: Path, os_map: dict[str, str] | None, buscar: list[str]) -> list[str]:
    out = []
    if not p.exists():
        return [f"  {p.name}: NO EXISTE"]
    with p.open(newline="", encoding="utf-8") as f:
        filas = list(csv.DictReader(f))
    por_cod: dict[str, list] = {}
    total = Decimal("0")
    ilegibles = 0
    for r in filas:
        try:
            imp = Decimal(r["importe_coseguro"])
        except (InvalidOperation, KeyError, TypeError):
            ilegibles += 1
            continue
        c = por_cod.setdefault(r["codigo_coseguro"], [set(), 0, 0, Decimal("0")])
        c[0].add(r["nombre_coseguro"])
        c[1] += int(r["comprobantes"])
        c[2] += int(r["notas_credito"])
        c[3] += imp
        total += imp
    out.append(f"  SHA-256: {sha256(p)}")
    out.append(f"  filas: {len(filas)} · códigos: {len(por_cod)} · "
               f"comprobantes: {sum(c[1] for c in por_cod.values()):,} · "
               f"NCR: {sum(c[2] for c in por_cod.values()):,} · importe total: {total:,.2f}")
    if ilegibles:
        out.append(f"  filas con importe ilegible: {ilegibles}")
    linea = None
    if log_nueva.exists():
        for ln in log_nueva.read_text(encoding="utf-8", errors="replace").splitlines():
            if "] coseguros: comprobantes=" in ln:
                linea = ln
    if linea:
        m = re.search(r"positivo con TOTBRUTO negativo=(\d+)", linea)
        out.append(f"  devoluciones con importe positivo (restadas una vez): {m.group(1) if m else '¿?'}")
        out.append(f"  línea del log: {linea.split('] ', 2)[-1]}")
    else:
        out.append("  devoluciones con importe positivo: no se encontró la línea de resumen en el log")
    out.append("  por código (código · nombre en el CSV · nombre en OS.DBF de --datos · comprobantes · NCR · importe):")
    distintos = 0
    for cod in sorted(por_cod):
        s, n, ncr, imp = por_cod[cod]
        nombre = " / ".join(sorted(s))
        if os_map is None:
            en_os = "(OS.DBF no leído)"
        elif cod in os_map:
            en_os = os_map[cod]
            if {os_map[cod]} != s:
                distintos += 1
                en_os += "  ← DISTINTO"
        else:
            en_os = "(no está en OS.DBF)"
        out.append(f"    {cod:<6} · {nombre} · {en_os} · {n:,} · {ncr:,} · {imp:,.2f}")
    if os_map is not None:
        out.append(f"  nombres que no coinciden con OS.DBF de --datos: {distintos}")
        for texto in buscar:
            hallados = [f"{c} = {v}" for c, v in sorted(os_map.items()) if texto.upper() in v.upper()]
            out.append(f"  OS.DBF de --datos, nombres que contienen '{texto}': "
                       f"{'; '.join(hallados) if hallados else 'ninguno'}")
    return out


# =============================================================================
# MAIN
# =============================================================================

def rechazar(msg: str) -> None:
    print(f"RECHAZADO: {msg}", file=sys.stderr)
    sys.exit(2)


def parse_fecha(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        rechazar(f"Fecha inválida '{s}'. Formato esperado: YYYY-MM-DD")
        raise


def validar(args) -> tuple[Path, Path, Path, Path, date, date]:
    anterior, nueva, datos, salida = (Path(os.path.abspath(x)) for x in
                                      (args.anterior, args.nueva, args.datos, args.salida))
    # Primero solo con el texto de las rutas, sin tocar el disco ni la red.
    for x in PROHIBIDAS:
        for nom, p in (("--anterior", anterior), ("--nueva", nueva)):
            if dentro(p, x):
                rechazar(f"{nom}: usar una copia, no el archivo de {x}")
        if se_cruzan(salida, x):
            rechazar(f"--salida no puede estar en {x}")
        if se_cruzan(datos, x):
            rechazar(f"--datos apunta a {x}: tiene que ser una copia de la carpeta SIAF")
    desde, hasta = parse_fecha(args.desde), parse_fecha(args.hasta)
    ayer = date.today() - timedelta(days=1)
    if desde > hasta:
        rechazar("--desde es posterior a --hasta")
    if hasta > ayer:
        rechazar(f"--hasta tiene que ser como mucho ayer ({ayer}), el último día completo")
    # Después, con el disco (rutas reales, por si hay unidades mapeadas o enlaces).
    anterior, nueva = anterior.resolve(), nueva.resolve()
    datos_real = Path(os.path.realpath(datos))
    salida_real = Path(os.path.realpath(salida.parent)) / salida.name
    for x in PROHIBIDAS:
        for nom, p in (("--anterior", anterior), ("--nueva", nueva)):
            if dentro(p, x):
                rechazar(f"{nom}: usar una copia, no el archivo de {x}")
        if se_cruzan(salida_real, x):
            rechazar(f"--salida no puede estar en {x}")
        if se_cruzan(datos_real, x):
            rechazar(f"--datos apunta a {x}: tiene que ser una copia de la carpeta SIAF")
    for nom, p in (("--anterior", anterior), ("--nueva", nueva)):
        if not p.is_file():
            rechazar(f"{nom}: no existe el archivo {p}")
    if salida.exists():
        rechazar(f"--salida ya existe: {salida}. Usar una carpeta nueva.")
    if not salida.parent.is_dir():
        rechazar(f"--salida: no existe la carpeta {salida.parent}")
    if not datos.is_dir():
        rechazar(f"--datos: no existe la carpeta {datos}")
    if not (datos / "CPBTEMI.DBF").is_file():
        rechazar(f"--datos: no hay CPBTEMI.DBF en {datos}")
    if se_cruzan(salida, datos) or se_cruzan(salida_real, datos_real):
        rechazar("--salida y --datos no pueden estar una dentro de la otra")
    for nom, p in (("--anterior", anterior), ("--nueva", nueva)):
        if dentro(p, datos_real) or dentro(p, salida_real):
            rechazar(f"{nom} no puede estar dentro de --datos ni de --salida")
    return anterior, nueva, datos, salida, desde, hasta


def main() -> None:
    ap = argparse.ArgumentParser(description="Compara dos versiones de siaf_to_drive.py sobre la misma copia de datos")
    ap.add_argument("--anterior", required=True, help="siaf_to_drive.py de producción (una copia)")
    ap.add_argument("--nueva", required=True, help="siaf_to_drive.py de la rama")
    ap.add_argument("--sucursal", required=True, help="Nombre de la sucursal, p. ej. Tekiel o \"La Perla\"")
    ap.add_argument("--desde", required=True, help="Primer día, YYYY-MM-DD")
    ap.add_argument("--hasta", required=True, help="Último día, YYYY-MM-DD (como mucho ayer)")
    ap.add_argument("--datos", required=True, help="Copia de la carpeta SIAF de la sucursal")
    ap.add_argument("--salida", required=True, help="Carpeta nueva donde se escribe todo")
    ap.add_argument("--buscar-os", action="append", default=[], metavar="TEXTO",
                    help="Lista los códigos de OS.DBF de --datos cuyo nombre contiene TEXTO")
    args = ap.parse_args()
    anterior, nueva, datos, salida, desde, hasta = validar(args)
    suc = args.sucursal
    inicio = datetime.now()

    print("Calculando SHA-256 de --datos (antes)...", flush=True)
    sha_ant, sha_nue, sha_comp = sha256(anterior), sha256(nueva), sha256(Path(__file__).resolve())
    datos_antes = hashes_carpeta(datos)

    salida.mkdir()
    carpetas = {"anterior": salida / "anterior", "nueva": salida / "nueva"}
    for c in carpetas.values():
        c.mkdir()

    sys.dont_write_bytecode = True
    excluir = [Path(x) for x in PROHIBIDAS] + [datos, salida, Path(__file__).resolve().parent, anterior.parent, nueva.parent]
    guardia = Guardia(salida, datos, raices_python(excluir) + [anterior, nueva])
    sys.addaudithook(guardia.hook)
    logging.FileHandler = _RedirFileHandler
    guardia.activa = True

    neutralizados: list[str] = []
    resultados: dict[str, dict] = {}
    abortado = ""
    try:
        for nombre, script in (("anterior", anterior), ("nueva", nueva)):
            guardia.version = nombre
            try:
                mod = cargar_version(nombre, script, carpetas[nombre], guardia, neutralizados)
            finally:
                guardia.version = "comparador"
            estado = aislar(mod, nombre, carpetas[nombre], datos, suc, desde, hasta)
            print(f"Corriendo la versión {nombre}...", flush=True)
            codigo, error = correr_version(mod, nombre, script, guardia)
            estado.update(codigo=codigo, error=error, modulo=mod)
            resultados[nombre] = estado
    except Abortar as e:
        abortado = str(e)
    except Bloqueado as e:
        abortado = f"Intento bloqueado al cargar una versión: {e}"
    finally:
        raiz = logging.getLogger()
        for h in list(raiz.handlers):
            raiz.removeHandler(h)
            h.close()

    os_map = None
    if "nueva" in resultados and hasattr(resultados["nueva"]["modulo"], "leer_os_dbf"):
        try:
            os_map = resultados["nueva"]["modulo"].leer_os_dbf(datos / "OS.DBF", suc)
        except Exception as e:
            neutralizados.append(f"no se pudo leer OS.DBF de --datos para el resumen: {e}")

    print("Calculando SHA-256 de --datos (después)...", flush=True)
    datos_despues = hashes_carpeta(datos)
    cambiaron = sorted(k for k in set(datos_antes) | set(datos_despues) if datos_antes.get(k) != datos_despues.get(k))

    # ------------------------------------------------------------------ reporte
    r: list[str] = []
    r.append("COMPARACIÓN DE VERSIONES DE siaf_to_drive.py")
    r.append(f"Sucursal: {suc} · período: {desde} a {hasta} · inicio {inicio:%Y-%m-%d %H:%M:%S} · "
             f"fin {datetime.now():%Y-%m-%d %H:%M:%S}")
    r.append(f"Python {sys.version.split()[0]}")
    r.append("")
    r.append("1. ARCHIVOS")
    r.append(f"  anterior:    {anterior}\n    SHA-256 {sha_ant}")
    r.append(f"  nueva:       {nueva}\n    SHA-256 {sha_nue}")
    r.append(f"  comparador:  {Path(__file__).resolve()}\n    SHA-256 {sha_comp}")
    r.append(f"  datos:       {datos} ({len(datos_antes)} archivos)")
    r.append(f"    SHA-256 del conjunto, antes:   {hash_conjunto(datos_antes)}")
    r.append(f"    SHA-256 del conjunto, después: {hash_conjunto(datos_despues)}")
    r.append(f"    resultado: {'SIN CAMBIOS' if not cambiaron else 'CAMBIARON ' + str(len(cambiaron)) + ' archivo(s)'}")
    for k in cambiaron[:MAX_FILAS]:
        r.append(f"      {k}: {datos_antes.get(k, '(no estaba)')} → {datos_despues.get(k, '(ya no está)')}")
    r.append("")
    r.append("2. AISLAMIENTO")
    invalida: list[str] = []
    if abortado:
        invalida.append(abortado)
    if cambiaron:
        invalida.append("los datos de --datos cambiaron durante la corrida")
    if guardia.bloqueos:
        invalida.append(f"{len(guardia.bloqueos)} intento(s) bloqueado(s)")
    for x in neutralizados:
        r.append(f"  neutralizado: {x}")
    for nombre in ("anterior", "nueva"):
        if nombre not in resultados:
            r.append(f"  {nombre}: no corrió")
            continue
        e = resultados[nombre]
        d = e["drive"]
        leidos = sorted(guardia.leidos_datos.get(nombre, set()))
        r.append(f"  {nombre}: código de salida de main() = {e['codigo']} · FOLDER_MAP original: "
                 f"{e['codigo_original']} = {suc}")
        r.append(f"    archivos leídos de --datos: {', '.join(leidos) if leidos else 'ninguno'}")
        r.append(f"    librerías de Google Drive importadas: "
                 f"{ {True: 'sí', False: 'no'}.get(getattr(e['modulo'], '_DRIVE_LIBS_AVAILABLE', None), '¿?') }")
        r.append(f"    Drive: build_drive_service llamado {d.build} vez/veces (devolvió None) · "
                 f"intentos de subida u otras funciones de Drive: {len(d.intentos)}")
        r.append(f"    control.json: no se leyó ni se escribió; lo que se habría guardado: "
                 f"{e['control_guardado'][-1] if e['control_guardado'] else '(nada)'}")
        archivos = sorted(p.name for p in carpetas[nombre].iterdir())
        r.append(f"    archivos en {carpetas[nombre].name}\\: {', '.join(archivos)}")
        if e["codigo"] != 0:
            invalida.append(f"la versión {nombre} terminó con código {e['codigo']} (ver su log)")
        if e["error"]:
            invalida.append(f"la versión {nombre} falló: {e['error'].strip().splitlines()[-1]}")
            r.append("    error:")
            r.extend(f"      {x}" for x in e["error"].strip().splitlines()[-MAX_FILAS:])
        if d.intentos:
            invalida.append(f"la versión {nombre} intentó usar Drive")
    r.append(f"  intentos bloqueados (escritura, lectura fuera de lugar, red o procesos): {len(guardia.bloqueos)}")
    r.extend(f"    {x}" for x in guardia.bloqueos[:MAX_FILAS])
    r.append("")
    r.append("3. CSV")
    distintos = 0
    for t in TRES:
        a = carpetas["anterior"] / f"{suc}_{t}.csv"
        n = carpetas["nueva"] / f"{suc}_{t}.csv"
        r.append(f"  {suc}_{t}.csv")
        bloque = comparar_csv(a, n)
        if any("resultado: DISTINTO" in x for x in bloque):
            distintos += 1
        if not a.exists() or not n.exists():
            invalida.append(f"falta {suc}_{t}.csv en alguna de las dos versiones")
        r.extend(bloque)
    r.append("")
    r.append(f"4. COSEGUROS (solo en la nueva): {suc}_coseguros.csv")
    r.extend(resumen_coseguros(carpetas["nueva"] / f"{suc}_coseguros.csv",
                               carpetas["nueva"] / "siaf_to_drive.log", os_map, args.buscar_os))
    r.append("")
    if invalida:
        veredicto = "LA COMPARACIÓN NO VALE: " + "; ".join(invalida)
        codigo = 2
    elif distintos:
        veredicto = f"DISTINTO: {distintos} de 3 archivos difieren"
        codigo = 1
    else:
        veredicto = "IDÉNTICO: los tres CSV son iguales byte a byte"
        codigo = 0
    r.append(f"RESULTADO: {veredicto}")
    texto = "\n".join(r) + "\n"
    (salida / "comparacion.txt").write_text(texto, encoding="utf-8")
    print()
    print(f"RESULTADO: {veredicto}")
    print(f"Detalle: {salida / 'comparacion.txt'}")
    sys.exit(codigo)


if __name__ == "__main__":
    main()
