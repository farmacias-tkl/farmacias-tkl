# Instalación — siaf_to_drive.py

Guía paso a paso para instalar y programar la extracción diaria de ventas
del sistema SIAF hacia la carpeta de red de Farmacias TKL.

---

## 1. Requisitos previos

- Windows Server 2016+ o Windows 10+
- Permisos de administrador en el servidor
- **Python 3.11.15** instalado con la casilla "Add Python to PATH" marcada
- **Acceso de escritura** a la carpeta de red:
  ```
  \\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\
  ```
- Carpeta `C:\_Datos\_administracion\temporal_sucursales\` con los DBF
  de SIAF (debe existir y actualizarse diariamente)

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
BASE_PATH    = Path(r"C:\_Datos\_administracion\temporal_sucursales")
OUTPUT_DIR   = Path(r"\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV")
CONTROL_FILE = Path(r"C:\TKL\siaf_sync\tkl_sync_control.json")
LOG_PATH     = Path(r"C:\_Datos\_administracion\tkl_sync.log")
```

Si alguna ruta cambió, editá y guardá el archivo.

---

## 5. Primera ejecución (manual)

La primera vez que corra, el script procesa **todo el historial disponible**
de cada sucursal. Esto puede tardar varios minutos.

```
cd C:\TKL\siaf_sync
python siaf_to_drive.py
```

**Qué deberías ver en pantalla:**
```
[2026-04-22 03:00:01] [INFO] ============================================================
[2026-04-22 03:00:01] [INFO] === Inicio sync TKL SIAF ===
[2026-04-22 03:00:01] [INFO] ============================================================
[2026-04-22 03:00:02] [INFO] [America] procesando — full-history (primera vez)
[2026-04-22 03:00:45] [INFO] [America] ✓ 547 día(s) procesados | ventas.csv=547, vendedores.csv=8234, ossocial.csv=6102
[2026-04-22 03:00:45] [INFO] [Facultad] procesando — full-history (primera vez)
...
[2026-04-22 03:08:22] [INFO] === Fin sync: ✓ 11 OK   ✗ 0 con errores   de 11 sucursales ===
```

**Verificá** que en `\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\` aparecieron
33 archivos CSV (3 por sucursal × 11 sucursales).

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
- Cada noche, el script lee este archivo, procesa solo los días nuevos
  (desde la última fecha + 1 hasta ayer), y lo actualiza.
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
notepad C:\_Datos\_administracion\tkl_sync.log
```

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

### Revisar los CSVs en la carpeta de red

Abrí `\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\` en el Explorador de Windows.
Deberían aparecer 33 archivos:

```
America_ventas.csv
America_vendedores.csv
America_ossocial.csv
Facultad_ventas.csv
Facultad_vendedores.csv
Facultad_ossocial.csv
... (11 sucursales × 3 archivos = 33 archivos)
```

Abrí uno con Excel o Notepad — debe tener encabezado + al menos 1 fila.

---

## 9. Troubleshooting

### "Carpeta destino no disponible"
El script no pudo acceder a `\\192.168.0.250\TKL_sync_IA\TKL-SIAF-CSV\`.

**Soluciones:**
- Verificar que el servidor `192.168.0.250` está prendido y accesible por red
- Verificar que la carpeta compartida existe y el usuario del servidor tiene
  permiso de **escritura**
- Probar abrir la ruta manualmente en el Explorador de Windows
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
