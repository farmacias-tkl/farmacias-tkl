# Instalación — siaf_to_drive.py

Guía paso a paso para instalar y programar la extracción diaria de ventas
del sistema SIAF hacia la carpeta de red de Farmacias TKL.

---

## 1. Requisitos previos

- Windows Server 2016+ o Windows 10+
- Permisos de administrador en el servidor
- **Python 3.11.15** instalado con la casilla "Add Python to PATH" marcada
- **Acceso de escritura** a las **dos** subcarpetas de red:
  ```
  \\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\historico\
  \\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\diario\
  ```
  Si no existen, crearlas antes de la primera corrida (Explorador de Windows →
  Nueva carpeta).
- Carpeta `C:\_Datos\_administracion\temporal_sucursales\` con los DBF
  de SIAF (debe existir y actualizarse diariamente)

**Para qué sirven las dos carpetas:**
- `historico/` se escribe **una sola vez** durante la carga inicial
  (`--full-reset` o primera corrida sin control.json). Contiene los CSV
  acumulativos completos de todo el historial. Lo lee `load-sales-history.ts`.
- `diario/` se reemplaza **todas las noches** con SOLO los días procesados
  en ese run (normalmente uno; ver sección 7). Lo descarga el sync diario en
  Vercel vía GitHub Actions, sin riesgo de timeout porque son archivos chicos.

**Archivos por sucursal:** el script genera **4** CSV por sucursal (44 en
total): `_ventas`, `_vendedores`, `_ossocial` y `_coseguros`. El dashboard
consume **3**; `_coseguros.csv` el sync de Vercel lo ignora.

**Subida a Google Drive:** el script sube cada CSV directo por Drive API con
el Service Account de `GOOGLE_SERVICE_ACCOUNT_JSON` (variable de entorno) o,
si no está, de `credentials.json` junto al script. Las carpetas `historico/` y
`diario/` de Drive tienen que estar compartidas con ese Service Account como
**Editor**. Un archivo que todavía no existe en Drive el script lo **crea**, y
eso puede fallar si la carpeta está en "Mi unidad" y la cuenta no tiene cuota
propia (ver sección 10). Vercel lee con `GOOGLE_SERVICE_ACCOUNT_JSON` (solo
lectura); la variable `GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID` en Vercel debe apuntar
a la carpeta `diario/` de Drive (no a `historico/` ni a la carpeta padre).

**NOTA sobre la carpeta de saldos:** La administración sube el Excel de saldos
bancarios a `\\192.168.0.250\TKL_sync_IA\TKL-Saldos\`. **Este script NO toca
esa carpeta** — solo escribe CSVs de ventas en `TKL-SIAF-CSV\`.

---

## 2. Instalar Python 3.11

1. Abrí un navegador en el servidor y descargá Python 3.11.x desde
   https://www.python.org/downloads/
2. Ejecutá el instalador.
3. **IMPORTANTE**: en la primera pantalla marcá **"Add python.exe to PATH"**
   antes de clickear "Install Now".
4. Esperá que termine.

**Verificá** abriendo `cmd` y escribiendo:
```
python --version
```
Debe mostrar `Python 3.11.15` (o similar 3.11.x).

---

## 3. Instalar dependencias (modo offline)

⚠️ **El servidor TKL no tiene acceso a internet directo** (proxy corporativo).
Por eso NO se puede usar `pip install -r requirements.txt` — hay que hacer
instalación **offline** con el archivo `.whl`.

### 3a. Desde una PC CON internet (tu notebook / otra máquina)

1. Abrí https://pypi.org/project/dbfread/#files
2. Descargá: **`dbfread-2.0.7-py2.py3-none-any.whl`**
3. Copiá ese archivo al servidor (USB, red compartida, etc.)
4. Guardalo junto al script en `C:\TKL\siaf_sync\`

### 3b. En el servidor TKL

1. Copiá toda la carpeta `TKL-SIAF/` al servidor en una ubicación estable:
   ```
   C:\TKL\siaf_sync\
   ```
   Debe contener:
   - `siaf_to_drive.py`
   - `requirements.txt`
   - `INSTALACION.md` (este archivo)
   - `dbfread-2.0.7-py2.py3-none-any.whl` ← copiado en el paso 3a

2. Abrí `cmd` **como administrador**:
   ```
   cd C:\TKL\siaf_sync
   pip install dbfread-2.0.7-py2.py3-none-any.whl
   ```

Tarda pocos segundos — instala `dbfread` desde el archivo local sin conectar
a pypi.org.

### Verificar instalación

```
python -c "import dbfread; print(dbfread.__version__)"
```
Debe mostrar `2.0.7`. Si falla, volver al paso 3a y repetir.

---

## 4. Verificar rutas en el script

Abrí `siaf_to_drive.py` con el Bloc de notas o Notepad++ y confirmá que las
constantes al inicio coinciden con el servidor real:

```python
BASE_PATH         = Path(r"C:\_Datos\_administracion\temporal_sucursales")
DESTINO_HISTORICO = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\historico")
DESTINO_DIARIO    = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\diario")
CONTROL_FILE      = Path(r"C:\TKL\siaf_sync\tkl_sync_control.json")
LOG_PATH          = Path(r"C:\TKL\siaf_sync\tkl_sync.log")
```

Si alguna ruta cambió, editá y guardá el archivo.

---

## 5. Primera ejecución (manual)

La primera vez que corra, el script procesa **todo el historial disponible**
de cada sucursal y escribe los CSV acumulativos en `historico/`. Esto puede
tardar varios minutos.

```
cd C:\TKL\siaf_sync
python siaf_to_drive.py
```

**Qué deberías ver en pantalla:**
```
[2026-04-22 03:00:01] [INFO] ============================================================
[2026-04-22 03:00:01] [INFO] === Inicio sync TKL SIAF ===
[2026-04-22 03:00:01] [INFO] ============================================================
[2026-04-22 03:00:01] [INFO] Modo: HISTÓRICO (acumulativo)
[2026-04-22 03:00:01] [INFO] Destino: \\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\historico
[2026-04-22 03:00:02] [INFO] [America] procesando — full-history (primera vez)
[2026-04-22 03:00:45] [INFO] [America] ✓ 547 día(s) procesados | ventas.csv=547, vendedores.csv=8234, ossocial.csv=6102, coseguros.csv=3150
[2026-04-22 03:00:45] [INFO] [Facultad] procesando — full-history (primera vez)
...
[2026-04-22 03:08:22] [INFO] === Fin sync: ✓ 11 OK   ✗ 0 con errores   de 11 sucursales ===
```

**Verificá** que en `\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\historico\`
aparecieron 44 archivos CSV (4 por sucursal × 11 sucursales).

A partir de la segunda corrida (cuando ya existe `control.json`), el script
pasa a **modo DIARIO** y reemplaza los archivos de `diario/` con solo los días
procesados (ver sección 7).

**Carga inicial a la base de datos**: una vez que `historico/` está poblado,
correr desde la PC de desarrollo `npx tsx scripts/load-sales-history.ts`
apuntando a la carpeta `historico/` (ver sección dedicada en el repo
`tkl-etapa3-v2`). Esto inserta todo el historial en Neon de una sola vez.

Si hay errores, mirá la sección **Troubleshooting** al final.

---

## 6. Programar tarea diaria en Windows

1. Abrí el **Programador de tareas** (escribí `taskschd.msc` en Inicio).
2. En el panel derecho: **"Crear tarea básica..."**

### Paso 1 — Nombre
- **Nombre:** `TKL Sync SIAF`
- **Descripción:** `Extrae ventas del día y las escribe en \\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\`

### Paso 2 — Desencadenador
- **Diariamente**
- **Iniciar:** hoy a las **03:00:00** AM
- **Repetir cada:** 1 día

### Paso 3 — Acción
- **Iniciar un programa**
- **Programa o script:** `python`
- **Agregar argumentos:** `C:\TKL\siaf_sync\siaf_to_drive.py`
- **Iniciar en (opcional):** `C:\TKL\siaf_sync\`

### Paso 4 — Finalizar
- Marcar ☑ **"Abrir el diálogo Propiedades de esta tarea cuando haga clic en Finalizar"**
- Clickear **Finalizar**

### Paso 5 — Propiedades (ventana que se abre)
Pestaña **General**:
- ☑ **"Ejecutar tanto si el usuario inició sesión como si no"**
- ☑ **"Ejecutar con los privilegios más altos"**

Pestaña **Condiciones**:
- ☐ Desmarcar "Iniciar la tarea solo si el equipo está con corriente alterna"
- ☑ **"Reactivar el equipo para ejecutar esta tarea"** (opcional)

Pestaña **Configuración**:
- ☑ **"Permitir ejecutar la tarea a petición"**
- ☑ **"Si la tarea no se ejecuta cuando está programada, iniciarla lo antes posible"**
- **Detener la tarea si se ejecuta durante más de:** `1 hora`

**Aceptar**. Windows te va a pedir la contraseña del administrador.

---

## 7. ⚠️ ARCHIVO CRÍTICO — tkl_sync_control.json

### 🔴 NO BORRAR — NO MOVER — NO EDITAR A MANO

**Ubicación:**
```
C:\TKL\siaf_sync\tkl_sync_control.json
```

**Para qué sirve:**
Registra hasta qué fecha se procesaron los datos de cada sucursal.
Por ejemplo:
```json
{
  "America":     "2026-04-22",
  "Facultad":    "2026-04-22",
  "Etcheverry":  "2026-04-22",
  ...
}
```

**Cómo funciona:**
- **Fechas pendientes.** Cada sucursal procesa desde la fecha guardada en
  `tkl_sync_control.json` más un día hasta ayer, y guarda el último día que
  efectivamente procesó, es decir, el último con datos. Si la tarea no corrió
  alguna noche, la siguiente procesa juntos todos los días pendientes.
- **Días sin ventas.** Si en ese rango la sucursal no tiene ningún día con
  datos, el log dice `sin datos procesables`, la fecha guardada no avanza, no
  se reescriben ni se suben sus archivos (en `diario/` y en Drive quedan los
  de su última corrida con datos) y esos días se vuelven a revisar la noche
  siguiente. Si los días sin ventas son los últimos del rango, la fecha
  guardada queda en el último día con datos y esos días también se vuelven a
  revisar.
- **`diario/` se reemplaza cada noche.** Para cada sucursal con datos, sus 4
  archivos de `diario/` se reescriben solo con los días procesados en esa
  corrida (no acumulan) y se suben a Drive. Lo de las noches anteriores no
  queda en `diario/`; solo `historico/` acumula.
- Sin este archivo, el script re-procesaría todo el historial cada vez
  (tarda mucho más).

**Qué pasa si se borra accidentalmente:**
- **No se pierden datos.** Los CSVs en la carpeta de red permanecen intactos.
- El próximo run tarda más (procesa todo el historial de nuevo).
- Los CSVs se regeneran con el mismo contenido (el script es idempotente).

**Si necesitás forzar un reset completo:**
```
python siaf_to_drive.py --full-reset
```
Te va a pedir confirmación escrita ("SI" en mayúsculas) antes de borrar.

---

## 8. Verificación post-instalación

### Revisar el log

```
notepad C:\TKL\siaf_sync\tkl_sync.log
```

El log acumula todas las corridas: lo último está al final.

Cada línea tiene el formato:
```
[YYYY-MM-DD HH:MM:SS] [NIVEL] [SUCURSAL] mensaje
```

**Niveles:**
- `INFO` — operación normal
- `WARNING` — algo faltó pero el script continuó (ej: un DBF no existe)
- `ERROR` — algo falló en esa sucursal, pero las demás se procesaron

**Qué buscar al día siguiente de la primera corrida:**

Éxito esperado:
```
=== Fin sync: ✓ 11 OK   ✗ 0 con errores   de 11 sucursales ===
```

Si alguna sucursal falló:
```
=== Fin sync: ✓ 9 OK   ✗ 2 con errores   de 11 sucursales ===
```
Buscar en el log las líneas `[ERROR]` para ver qué pasó.

### Revisar los CSVs en las carpetas de red

Hay dos carpetas a revisar:

**`historico/`** — solo se escribe en la primera corrida o con `--full-reset`.
Después de la carga inicial debería tener 44 archivos con TODO el historial
(si la carga inicial se hizo antes de que existiera `_coseguros.csv`, tiene
33 y los coseguros no están):

```
\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\historico\
  America_ventas.csv     ← ej: 547 filas (1 por día desde el inicio)
  America_vendedores.csv ← muchas filas (vendedores × días)
  ...
```

**`diario/`** — se reemplaza cada noche (sección 7). Contiene 44 archivos
chicos, 4 por sucursal, con los días procesados en su última corrida con
datos (normalmente uno):

```
\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\diario\
  America_ventas.csv     ← 1 fila por día procesado
  America_vendedores.csv ← N filas (vendedores de esos días)
  America_ossocial.csv   ← N filas (obras sociales de esos días)
  America_coseguros.csv  ← N filas (coseguros de esos días; puede tener solo encabezado)
  ...
```

Abrí uno con Excel o Notepad: `_ventas` debe tener encabezado + al menos 1
fila. Una sucursal sin ventas en los días pendientes conserva los archivos de
su última corrida con datos.

---

## 9. Troubleshooting

### "Carpeta destino no disponible"
El script no pudo acceder a `historico/` o `diario/` dentro de
`\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\`.

**Soluciones:**
- Verificar que el servidor `192.168.0.250` está prendido y accesible por red
- Verificar que **ambas** subcarpetas (`historico\` y `diario\`) existen y el
  usuario del servidor tiene permiso de **escritura** en las dos
- Probar abrir las rutas manualmente en el Explorador de Windows
- Si usás credenciales de red: usar `net use \\192.168.0.250\TKL_sync_IA /persistent:yes`
  para mapear el acceso

### "DBF no existe" (WARNING)
Alguna sucursal no tiene el archivo DBF esperado.
El script sigue con las demás. Revisar manualmente si es una situación
temporal (archivo siendo actualizado) o permanente (sucursal dada de baja).

### "DBF bloqueado" / "permission denied"
SIAF tiene el archivo abierto. El script reintenta 1 vez a los 30 segundos.
Si el error persiste en un horario fijo, considerar mover la tarea programada
a un horario donde SIAF no esté activo (las 03:00 AM debería estar libre).

### Caracteres raros en nombres de vendedores u obras sociales
El DBF usa un encoding distinto al default. Editar `siaf_to_drive.py` y cambiar:
```python
DBF_ENCODING = "cp1252"
```
Alternativas a probar: `"cp437"`, `"latin-1"`, `"utf-8"`.

### Backfill manual (reprocesar un día específico)
Si un día la tarea programada no corrió y necesitás generar los CSVs de ese día:
```
python siaf_to_drive.py --date 2026-04-15
```
**NO actualiza el control.json** — así que el próximo run incremental no
se salta ningún día entre medio.

### Cómo hacer un reset completo
Si por alguna razón querés reprocesar TODO el historial de cero:
```
python siaf_to_drive.py --full-reset
```
Va a pedir confirmación. Escribí `SI` en mayúsculas y Enter.
El script borra `control.json` y en la próxima ejecución (o inmediatamente
después si lo corrés sin parámetros) reprocesa desde cero.

### El log está vacío después de la primera corrida
El script no arrancó. Verificar:
1. Que Python está en el PATH: abrir `cmd` y escribir `python --version`
2. Que el script está en la ruta correcta
3. Que la tarea programada tiene el comando bien escrito
   (`python` como programa, `C:\TKL\siaf_sync\siaf_to_drive.py` como argumento)

### Contacto
Problemas o dudas no cubiertas acá: **Daniel** (administrador del sistema).

---

## 10. Actualizar el script: respaldo, instalación y vuelta atrás

Todo en una consola `cmd` en el servidor, fuera de 02:00–04:00 (tarea de las
03:00 y sync de ventas de las 04:00). Se necesita el SHA-256 de la versión
instalada y el de la nueva, que vienen con la entrega.

### 10.1 Antes de instalar

```
schtasks /query /tn "TKL Sync SIAF" /v /fo list
```

"Tarea a ejecutar" tiene que mostrar `C:\TKL\siaf_sync\siaf_to_drive.py` y el
estado no puede ser "En ejecución".

Si la versión nueva genera un archivo que todavía no existe en Drive, la
primera noche el Service Account lo tiene que **crear**. Antes de instalar,
comprobar que puede hacerlo en la carpeta de ventas (no en la de saldos), o
que el dueño de la carpeta suba antes esos archivos (lo indica la entrega).

### 10.2 Respaldo

Cambiar `AAAAMMDD` por la fecha del día:

```
set F=AAAAMMDD
mkdir C:\TKL\siaf_sync\respaldo
copy C:\TKL\siaf_sync\siaf_to_drive.py C:\TKL\siaf_sync\respaldo\siaf_to_drive_%F%.py
copy C:\TKL\siaf_sync\tkl_sync_control.json C:\TKL\siaf_sync\respaldo\tkl_sync_control_%F%.json
certutil -hashfile C:\TKL\siaf_sync\respaldo\siaf_to_drive_%F%.py SHA256
```

- El hash tiene que ser el de la versión instalada. Si no coincide, no seguir.
- Si `mkdir` dice que la carpeta ya existe, no hay problema.
- Si un `copy` pregunta si sobrescribir, responder **No** y usar otra fecha.
- `tkl_sync_control.json` solo se copia: el original no se toca.

### 10.3 Instalación

Con la versión nueva en una carpeta aparte (por ejemplo
`C:\TKL\nueva\siaf_to_drive.py`):

```
certutil -hashfile C:\TKL\nueva\siaf_to_drive.py SHA256
copy /Y C:\TKL\nueva\siaf_to_drive.py C:\TKL\siaf_sync\siaf_to_drive.py
certutil -hashfile C:\TKL\siaf_sync\siaf_to_drive.py SHA256
```

- Los dos hashes tienen que ser el de la versión nueva. Si el segundo no
  coincide, volver atrás enseguida (10.4).
- **No correr nada a mano**: ni "Ejecutar" en el Programador de tareas, ni
  `python siaf_to_drive.py`, `--date` o `--full-reset`. La primera ejecución
  es la tarea de las 03:00, que no se modifica.

### 10.4 Vuelta atrás (un minuto)

Con el mismo `F` del respaldo:

```
set F=AAAAMMDD
copy /Y C:\TKL\siaf_sync\respaldo\siaf_to_drive_%F%.py C:\TKL\siaf_sync\siaf_to_drive.py
certutil -hashfile C:\TKL\siaf_sync\siaf_to_drive.py SHA256
```

- El hash tiene que volver a ser el de la versión anterior. No hace falta
  correr nada: la próxima tarea de las 03:00 usa la versión restaurada.
- **`tkl_sync_control.json` no se restaura.** Restaurarlo hace reprocesar días
  y reescribir `diario/`. La copia se usa solo si el archivo quedara dañado.
- Los archivos nuevos que haya dejado la versión nueva en `diario/` y en Drive
  pueden quedar si el sync de Vercel los ignora.

### 10.5 Revisión de la mañana siguiente

Ver en `C:\TKL\siaf_sync\tkl_sync.log` la última corrida (empieza en la
última línea `=== Inicio sync TKL SIAF ===`):

- `Fin sync` con 0 errores, y sin `[ERROR]` ni `Traceback` nuevos.
- Cada sucursal con datos procesados (línea `día(s) procesados`) tiene que
  haber subido **todos** sus archivos a Drive: una línea `Drive UPDATE` o
  `Drive CREATE` por archivo, y ningún `Drive upload fallo`.
- Una sucursal con `sin datos procesables` queda pendiente: se comprueba en la
  próxima corrida en que tenga datos.
- "11 OK" en `Fin sync` no alcanza: una falla de subida a Drive no cuenta
  como error de la sucursal.
