# Instalación — siaf_to_drive.py (Servidor TKL)

Guía paso a paso para instalar y programar la extracción diaria de datos de ventas
desde el sistema SIAF y subida a Google Drive.

## 1. Requisitos

- Windows Server 2016+ o Windows 10+
- Permisos de administrador para instalar Python y crear tareas programadas
- Acceso a internet desde el servidor (para contactar Google Drive)
- Carpeta `C:\_Datos\_administracion\temporal_sucursales\` con los datos de SIAF

---

## 2. Instalar Python 3.11

1. Abrí un navegador en el servidor y andá a https://www.python.org/downloads/
2. Descargá **Python 3.11.x** (el instalador de 64-bit para Windows)
3. Ejecutá el instalador
4. **IMPORTANTE**: en la primera pantalla marcá la casilla **"Add python.exe to PATH"**
   antes de clickear "Install Now"
5. Esperá que termine. Te va a decir "Setup was successful".

**Verificá la instalación:** Abrí `cmd` (Símbolo del sistema) y escribí:

```
python --version
```

Deberías ver algo como `Python 3.11.8`. Si dice "no se reconoce el comando", re-instalá
Python asegurándote de marcar la casilla PATH.

---

## 3. Instalar las dependencias

1. Copiá toda la carpeta `scripts\server\` a una ruta estable del servidor. Por ejemplo:
   ```
   C:\TKL\siaf_sync\
   ```
   Debería contener estos archivos:
   - `siaf_to_drive.py`
   - `requirements.txt`
   - `INSTALACION.md` (este archivo)

2. Abrí `cmd` **como administrador**
3. Navegá a la carpeta:
   ```
   cd C:\TKL\siaf_sync
   ```
4. Instalá las dependencias:
   ```
   pip install -r requirements.txt
   ```

La primera vez tarda unos minutos (descarga Google API libraries).

---

## 4. Configurar el Service Account de Google

Para que el script pueda subir archivos a Drive necesita un "Service Account".
Este archivo lo provee Daniel (administrador del sistema).

1. Pedile a Daniel el archivo `credentials.json`
2. Copialo a la misma carpeta del script:
   ```
   C:\TKL\siaf_sync\credentials.json
   ```
3. Verificá que quedó ahí. El archivo es un JSON que empieza con `{"type": "service_account", ...`

**⚠️ Este archivo es un secreto.** No lo subas a internet ni lo mandes por mail sin cifrar.

---

## 5. Configurar el ID de la carpeta de Drive

Daniel también te va a pasar un **ID de carpeta de Google Drive**. Es un string largo,
algo como: `1A2bCdE3FgHiJk4LmNoPqRsTuVwXyZ`.

1. Abrí el archivo `siaf_to_drive.py` con el Bloc de notas o Notepad++
2. Buscá la línea que dice:
   ```
   DRIVE_FOLDER_ID = "REEMPLAZAR_CON_ID_DE_CARPETA_DRIVE"
   ```
3. Reemplazá `REEMPLAZAR_CON_ID_DE_CARPETA_DRIVE` con el ID real que te pasó Daniel.
   Ejemplo:
   ```
   DRIVE_FOLDER_ID = "1A2bCdE3FgHiJk4LmNoPqRsTuVwXyZ"
   ```
4. Guardá el archivo.

---

## 6. Test manual del script

Antes de programar la tarea, probalo manualmente para confirmar que funciona.

1. Abrí `cmd` **como administrador**
2. Navegá a la carpeta:
   ```
   cd C:\TKL\siaf_sync
   ```
3. Ejecutá:
   ```
   python siaf_to_drive.py
   ```

**Qué deberías ver:**
```
2026-04-22 23:00:01 [INFO] ============================================================
2026-04-22 23:00:01 [INFO] 🚀 Iniciando sync — fecha objetivo: 2026-04-21
2026-04-22 23:00:02 [INFO] [America] procesando…
2026-04-22 23:00:02 [INFO] [America] CSV generado: America_20260421.csv (ventas=..., tickets=..., unidades=...)
2026-04-22 23:00:03 [INFO] [America] ✓ subido a Drive (file_id=...)
...
2026-04-22 23:00:45 [INFO] Resumen: ✓ 11 OK   ✗ 0 errores   de 11 sucursales
```

4. Verificá en Google Drive que aparecieron los CSVs en la carpeta.
5. Si hay errores, mirá la sección **Troubleshooting** al final.

---

## 7. Programar la tarea diaria (Windows Task Scheduler)

1. Presioná **Win + R**, escribí `taskschd.msc` y Enter. Se abre el "Programador de tareas".
2. En el panel derecho clickeá **"Crear tarea..."** (NO "Crear tarea básica" — necesitamos
   opciones avanzadas).

### Pestaña **General**

- **Nombre:** `TKL - Sync SIAF a Drive`
- **Descripción:** `Extrae ventas del día y las sube a Google Drive. Corre diariamente a las 23:00.`
- Marcar ☑ **"Ejecutar tanto si el usuario inició sesión como si no"**
- Marcar ☑ **"Ejecutar con los privilegios más altos"**
- **Configurar para:** Windows Server 2019 (o la versión que corresponda)

### Pestaña **Desencadenadores (Triggers)**

1. Clickeá **"Nuevo..."**
2. **Iniciar la tarea:** "Según una programación"
3. **Diariamente**, comenzando hoy a las **23:00:00**
4. Marcar ☑ **"Habilitado"**
5. OK

### Pestaña **Acciones**

1. Clickeá **"Nueva..."**
2. **Acción:** "Iniciar un programa"
3. **Programa o script:** (clickear "Examinar…" y buscar `python.exe`, típicamente en
   `C:\Users\[Usuario]\AppData\Local\Programs\Python\Python311\python.exe`, o bien
   escribir directamente `python`)
4. **Agregar argumentos (opcional):** `siaf_to_drive.py`
5. **Iniciar en (opcional):** `C:\TKL\siaf_sync`
6. OK

### Pestaña **Condiciones**

- Desmarcá ☐ "Iniciar la tarea solo si el equipo está inactivo"
- Desmarcá ☐ "Iniciar la tarea solo si está disponible una conexión a Internet"
  (el script lo maneja con retries)
- Dejar **marcado** ☑ "Reactivar el equipo para ejecutar esta tarea" (opcional,
  si querés que despierte el server si está dormido)

### Pestaña **Configuración**

- Marcar ☑ "Permitir ejecutar la tarea a petición"
- Marcar ☑ "Si la tarea no se ejecuta cuando está programada, iniciar lo antes posible"
- **Detener la tarea si se ejecuta durante más de:** 1 hora

Clickeá **Aceptar**. Si te pide contraseña, ingresá la de administrador.

---

## 8. Verificar que la tarea corre

**Al día siguiente** (después de las 23:00):

1. Abrí el log:
   ```
   C:\_Datos\_administracion\tkl_sync.log
   ```
2. Verificá que aparecen entradas del día. Deberías ver el resumen `✓ 11 OK`.

**También en Drive:** Los CSVs con la fecha del día anterior (ej: `America_20260421.csv`)
deberían estar en la carpeta.

---

## 9. Troubleshooting

### Caracteres raros en el CSV (ñ, acentos, ç)
El DBF usa un encoding distinto al default. Editá `siaf_to_drive.py` y cambiá:
```
DBF_ENCODING = "cp1252"
```
por `"cp437"` o `"latin-1"`. Probá con `python siaf_to_drive.py` hasta que los
nombres se vean correctos.

### "DBF falló tras retry"
El archivo DBF está siendo usado por SIAF en ese momento. El script reintentó a los
30 segundos y seguía bloqueado. Soluciones:
- Correr el script en un horario donde SIAF no esté activo (23:00 suele estar libre)
- Si el error persiste siempre, revisar que SIAF cierre los archivos al terminar la jornada

### "credentials.json no encontrado"
El archivo no está en la carpeta del script. Revisá el paso 4.

### "DRIVE_FOLDER_ID no configurado"
Olvidaste el paso 5. Editá el script y reemplazá el placeholder.

### "Se produjo un error inesperado al autenticar en Drive"
Probables causas:
- El `credentials.json` está corrupto o incompleto
- El Service Account NO tiene permiso sobre la carpeta de Drive (tiene que estar
  compartida con el email del service account, visible dentro del `credentials.json`
  en el campo `client_email`)
- El servidor no tiene internet

### Test de conectividad a Drive
Si nada funciona, intentá correr este mini-script de prueba:
```
python -c "from google.oauth2 import service_account; c = service_account.Credentials.from_service_account_file('credentials.json'); print('OK:', c.service_account_email)"
```
Debería imprimir el email del service account. Si falla, el problema está en
las credenciales.

### Backfill manual (reprocesar un día pasado)
Si un día la tarea no corrió y necesitás generar los CSVs retroactivamente:
```
python siaf_to_drive.py --date 2026-04-15
```

### Ver el log en vivo durante un test
```
python siaf_to_drive.py
```
El log aparece en la consola y en el archivo `tkl_sync.log` simultáneamente.

---

## Contacto

Problemas o dudas: **Daniel** (administrador del sistema).
