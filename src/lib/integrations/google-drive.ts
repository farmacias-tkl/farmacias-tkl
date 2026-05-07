import { google } from "googleapis";

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
    q: `'${folderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and not name contains '~$' and trashed=false`,
    fields: "files(id, name, modifiedTime, size)",
    orderBy: "modifiedTime desc",
    pageSize: 10,
  });
  return (response.data.files ?? []) as DriveFile[];
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
// El script Python escribe 33 archivos fijos (11 sucursales × 3 tipos):
//   {Sucursal}_ventas.csv       — agregados diarios
//   {Sucursal}_vendedores.csv   — breakdown por vendedor
//   {Sucursal}_ossocial.csv     — breakdown por obra social
//
// Los nombres son fijos y los archivos acumulan historial entre runs.
// Google Drive Desktop sincroniza la carpeta de red del server → folder Drive
// configurada en GOOGLE_DRIVE_SIAF_CSV_FOLDER_ID.
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

/** Descarga los 3 CSVs por sucursal y los agrupa.
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
