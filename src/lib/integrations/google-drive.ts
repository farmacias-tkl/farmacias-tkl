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
    q: `'${folderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed=false`,
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
// SALES CSVs — archivos generados por el script Python del servidor SIAF
// ============================================================================

export interface SalesCSVFile {
  sucursalName:  string;   // ej: "America"
  csvContent:    string;   // contenido del CSV como texto
  fileDate:      string;   // YYYY-MM-DD derivado del filename
  driveFileId:   string;
  driveFileName: string;
}

function yyyymmdd(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Descarga los CSVs de ventas de los últimos 2 días calendario. Tolera defases de timing. */
export async function downloadSalesCSVs(folderId: string): Promise<SalesCSVFile[]> {
  const drive = getDriveClient();

  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday  = new Date(today);    yesterday.setDate(yesterday.getDate() - 1);
  const dayBefore  = new Date(today);    dayBefore.setDate(dayBefore.getDate() - 2);
  const targetDates = [yyyymmdd(yesterday), yyyymmdd(dayBefore)];

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
  });

  const files = (response.data.files ?? []).filter((f) => {
    const name = f.name ?? "";
    if (!name.toLowerCase().endsWith(".csv")) return false;
    return targetDates.some((d) => name.includes(`_${d}.csv`));
  });

  const results: SalesCSVFile[] = [];
  for (const file of files) {
    if (!file.id || !file.name) continue;
    const match = file.name.match(/^(.+?)_(\d{4})(\d{2})(\d{2})\.csv$/i);
    if (!match) continue;

    const downloadResp = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "text" },
    );
    // googleapis devuelve el body como `any`; lo forzamos a string
    const csvContent = typeof downloadResp.data === "string"
      ? downloadResp.data
      : String(downloadResp.data ?? "");

    results.push({
      sucursalName:  match[1],
      csvContent,
      fileDate:      `${match[2]}-${match[3]}-${match[4]}`,
      driveFileId:   file.id,
      driveFileName: file.name,
    });
  }

  return results;
}
