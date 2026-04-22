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
