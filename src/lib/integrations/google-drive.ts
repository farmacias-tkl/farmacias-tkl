import { google, type Auth } from "googleapis";

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

function getDriveClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

export async function listExcelFiles(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed=false`,
    fields: "files(id, name, modifiedTime, size)",
    orderBy: "modifiedTime desc",
    pageSize: 10,
  });
  // Filtrado client-side de locks de Excel (~$*.xlsx). No se hace en la query
  // Drive porque el operador `contains` tokeniza el name y descarta `~` y `$`,
  // dejando la clausula efectivamente como no-op.
  const files = (response.data.files ?? []) as DriveFile[];
  return files.filter((f) => !f.name.startsWith("~$"));
}

export async function getLatestExcelFile(folderId: string) {
  const files = await listExcelFiles(folderId);
  if (files.length === 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayFile = files.find((f) => {
    const modified = new Date(f.modifiedTime);
    modified.setHours(0, 0, 0, 0);
    return modified.getTime() === today.getTime();
  });
  if (todayFile) return { file: todayFile, isStale: false, isToday: true };
  return { file: files[0], isStale: true, isToday: false };
}

export async function downloadFileAsBuffer(fileId: string): Promise<ArrayBuffer> {
  const drive = getDriveClient();
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return response.data as ArrayBuffer;
}

export async function getBalancesFileBuffer(folderId: string) {
  const result = await getLatestExcelFile(folderId);
  if (!result) return null;
  const buffer = await downloadFileAsBuffer(result.file.id);
  return { buffer, file: result.file, isStale: result.isStale, isToday: result.isToday };
}

// ============================================================================
// SALES CSVs — archivos generados por scripts/server/siaf_to_drive.py
//
// El script Python escribe 4 archivos fijos por sucursal (11 × 4 = 44):
//   {Sucursal}_ventas.csv       — agregados diarios
//   {Sucursal}_vendedores.csv   — breakdown por vendedor
//   {Sucursal}_ossocial.csv     — breakdown por obra social
//   {Sucursal}_coseguros.csv    — coseguros por día y código (downloadSalesCSVs
//                                 no lo lee: CSV_FILENAME_RE no lo matchea;
//                                 lo leen listCosegurosFiles y
//                                 downloadDriveFileText, más abajo)
//
// Los nombres son fijos. En diario/ (la carpeta configurada en
// GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID) cada run reemplaza el contenido con los
// días procesados en ese run; solo historico/ acumula. El script sube los CSV
// directo por Drive API con su Service Account (sin Drive Desktop).
// ============================================================================

export type SalesCSVKind = "ventas" | "vendedores" | "ossocial";

export interface SalesCSVEntry {
  csvContent:    string;
  driveFileId:   string;
  driveFileName: string;
  modifiedTime:  string;
}

export interface BranchCSVSet {
  sucursalName: string;
  ventas?:      SalesCSVEntry;
  vendedores?:  SalesCSVEntry;
  ossocial?:    SalesCSVEntry;
}

const CSV_FILENAME_RE = /^(.+?)_(ventas|vendedores|ossocial)\.csv$/i;

/** Descarga los 3 CSVs que consume el sync (ventas, vendedores, ossocial) por
 *  sucursal y los agrupa. Cualquier otro archivo de la carpeta, como
 *  {Sucursal}_coseguros.csv, se ignora sin descargarlo.
 *  Si un archivo falta para una sucursal, su campo queda undefined. */
export async function downloadSalesCSVs(folderId: string): Promise<BranchCSVSet[]> {
  const drive = getDriveClient();

  // 1. Listar todos los archivos de la carpeta en una sola llamada
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id, name, modifiedTime)",
    orderBy: "name",
    pageSize: 500,
  });

  // 2. Matchear por patrón y agrupar por sucursal
  const bySucursal = new Map<string, BranchCSVSet>();
  for (const f of response.data.files ?? []) {
    const name = f.name ?? "";
    const match = name.match(CSV_FILENAME_RE);
    if (!match || !f.id) continue;

    const sucursalName = match[1];
    const kind         = match[2].toLowerCase() as SalesCSVKind;

    if (!bySucursal.has(sucursalName)) {
      bySucursal.set(sucursalName, { sucursalName });
    }
    const set = bySucursal.get(sucursalName)!;
    set[kind] = {
      csvContent:    "",
      driveFileId:   f.id,
      driveFileName: name,
      modifiedTime:  f.modifiedTime ?? "",
    };
  }

  // 3. Descargar contenido de cada archivo identificado
  for (const set of bySucursal.values()) {
    for (const kind of ["ventas", "vendedores", "ossocial"] as SalesCSVKind[]) {
      const entry = set[kind];
      if (!entry) continue;
      const dl = await drive.files.get(
        { fileId: entry.driveFileId, alt: "media" },
        { responseType: "text" },
      );
      entry.csvContent = typeof dl.data === "string" ? dl.data : String(dl.data ?? "");
    }
  }

  return Array.from(bySucursal.values())
    .sort((a, b) => a.sucursalName.localeCompare(b.sucursalName));
}

// ============================================================================
// COSEGUROS CSV — {Sucursal}_coseguros.csv, misma carpeta que los de ventas.
// Funciones aparte: downloadSalesCSVs no cambia. Las usa solo sync-coseguros.ts.
// Cada llamada lleva límite de tiempo (`timeoutMs`) y cancelación (`signal`), y
// los dos cubren TODA la llamada, autenticación incluida: el pedido del token de la
// cuenta de servicio sale con la misma señal que la llamada a Drive. (Con el
// cliente de getDriveClient la señal solo llega a la llamada a Drive, y la espera
// del token sigue después de cancelar.) Al vencer se cortan las conexiones y la
// promesa rechaza.
// ============================================================================

export interface CoseguroFileRef {
  sucursalName:  string;
  driveFileId:   string;
  driveFileName: string;
  modifiedTime:  string;
}

export interface DriveCallLimits {
  signal:    AbortSignal;
  timeoutMs: number;
}

export const COSEGUROS_FILENAME_RE = /^(.+?)_coseguros\.csv$/i;

// Un cliente de autenticación por corrida (por `limits.signal`), para pedir el
// token una sola vez. Sus pedidos salen con la señal de la llamada en curso.
interface RunAuth { jwt: Auth.JWT; callSignal: AbortSignal }
const authByRun = new WeakMap<AbortSignal, RunAuth>();

function runAuth(limits: DriveCallLimits): RunAuth {
  const cached = authByRun.get(limits.signal);
  if (cached) return cached;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(serviceAccountJson);
  const jwt = new google.auth.JWT({
    email:  credentials.client_email,
    key:    credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const ra: RunAuth = { jwt, callSignal: limits.signal };
  // El token lo pide gtoken con este mismo transporter: así sale con la señal.
  const transporter = jwt.transporter;
  const baseRequest = transporter.request.bind(transporter);
  transporter.request = ((opts: Parameters<typeof baseRequest>[0]) =>
    baseRequest({ ...opts, signal: ra.callSignal })) as typeof transporter.request;
  authByRun.set(limits.signal, ra);
  return ra;
}

/**
 * Corre `fn` con una señal que se dispara al cancelarse la corrida o al vencer
 * `timeoutMs`, lo primero que pase. La promesa rechaza en ese momento aunque algo
 * de la librería no respetara la señal.
 */
async function withinCall<T>(
  limits: DriveCallLimits, what: string, fn: (auth: Auth.JWT, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (limits.signal.aborted) throw new Error(`${what}: cancelada antes de empezar`);
  const call = new AbortController();
  let reason = "";
  const stop = (why: string) => { if (!call.signal.aborted) { reason = why; call.abort(); } };
  const onRunAbort = () => stop(`${what}: cancelada (límite de la corrida)`);
  const timer = setTimeout(() => stop(`${what}: sin respuesta en ${limits.timeoutMs} ms`), Math.max(limits.timeoutMs, 1));
  limits.signal.addEventListener("abort", onRunAbort, { once: true });
  try {
    const ra = runAuth(limits);
    ra.callSignal = call.signal;
    return await Promise.race([
      fn(ra.jwt, call.signal),
      new Promise<never>((_, rej) => call.signal.addEventListener("abort", () => rej(new Error(reason)), { once: true })),
    ]);
  } finally {
    clearTimeout(timer);
    limits.signal.removeEventListener("abort", onRunAbort);
  }
}

/** Lista los {Sucursal}_coseguros.csv de la carpeta (sin descargarlos). */
export async function listCosegurosFiles(folderId: string, limits: DriveCallLimits): Promise<CoseguroFileRef[]> {
  const response = await withinCall(limits, "Drive (listar coseguros)", (auth, signal) =>
    google.drive({ version: "v3", auth }).files.list(
      {
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id, name, modifiedTime)",
        orderBy: "name",
        pageSize: 500,
      },
      { signal, timeout: limits.timeoutMs },
    ));
  const refs: CoseguroFileRef[] = [];
  for (const f of response.data.files ?? []) {
    const name = f.name ?? "";
    const match = name.match(COSEGUROS_FILENAME_RE);
    if (!match || !f.id) continue;
    refs.push({ sucursalName: match[1], driveFileId: f.id, driveFileName: name, modifiedTime: f.modifiedTime ?? "" });
  }
  return refs;
}

/** Descarga el contenido de un archivo de texto de Drive. */
export async function downloadDriveFileText(fileId: string, limits: DriveCallLimits): Promise<string> {
  const dl = await withinCall(limits, "Drive (descargar coseguros)", (auth, signal) =>
    google.drive({ version: "v3", auth }).files.get(
      { fileId, alt: "media" },
      { responseType: "text", signal, timeout: limits.timeoutMs },
    ));
  return typeof dl.data === "string" ? dl.data : String(dl.data ?? "");
}
