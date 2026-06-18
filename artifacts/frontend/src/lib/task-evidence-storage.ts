export type TaskEvidenceType = "photo" | "voice" | "text" | "file";

export type EvidenceUploadStatus = "pending" | "uploading" | "uploaded" | "failed";

export type TaskEvidenceRecord = {
  evidence_id: string;
  task_id: string;
  goal_id?: string | null;
  session_id: string;
  type: TaskEvidenceType;
  content: string;
  duration_seconds?: number | null;
  file_size_bytes?: number | null;
  file_name?: string | null;
  file_url?: string | null;
  storage_path?: string | null;
  attachment_id?: string | null;
  mime_type?: string | null;
  created_at: string;
  synced: boolean;
  upload_status?: EvidenceUploadStatus;
  retry_count?: number;
};

const DB_NAME = "carecliq_task_evidence";
const DB_VERSION = 1;
const STORE = "evidence";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "evidence_id" });
        store.createIndex("task_id", "task_id", { unique: false });
        store.createIndex("session_id", "session_id", { unique: false });
        store.createIndex("synced", "synced", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveTaskEvidence(record: TaskEvidenceRecord): Promise<void> {
  await withStore("readwrite", (store) => store.put(record));
}

export async function deleteTaskEvidence(evidenceId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(evidenceId));
}

export async function deleteAllTaskEvidenceForTask(sessionId: string, taskId: string): Promise<void> {
  const records = await listTaskEvidence(sessionId, taskId);
  if (!records.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    records.forEach((record) => store.delete(record.evidence_id));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function listTaskEvidence(sessionId: string, taskId: string): Promise<TaskEvidenceRecord[]> {
  const rows = await listSessionEvidence(sessionId);
  return rows.filter((r) => r.task_id === taskId);
}

export async function listSessionEvidence(sessionId: string): Promise<TaskEvidenceRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const index = store.index("session_id");
    const request = index.getAll(sessionId);
    request.onsuccess = () => {
      const rows = request.result as TaskEvidenceRecord[];
      resolve(rows.sort((a, b) => a.created_at.localeCompare(b.created_at)));
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listUnsyncedEvidence(sessionId: string): Promise<TaskEvidenceRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const request = store.index("session_id").getAll(sessionId);
    request.onsuccess = () => {
      resolve(
        (request.result as TaskEvidenceRecord[]).filter(
          (r) =>
            !r.synced ||
            r.upload_status === "pending" ||
            r.upload_status === "uploading" ||
            r.upload_status === "failed",
        ),
      );
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function markEvidenceSynced(evidenceIds: string[]): Promise<void> {
  if (!evidenceIds.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let pending = evidenceIds.length;
    evidenceIds.forEach((id) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result as TaskEvidenceRecord | undefined;
        if (row) store.put({ ...row, synced: true });
        pending -= 1;
        if (pending === 0) resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => db.close();
  });
}

export function newEvidenceId() {
  return `evid_${crypto.randomUUID().slice(0, 12)}`;
}

export async function compressImageFile(file: File, maxBytes = 2 * 1024 * 1024): Promise<{ dataUrl: string; bytes: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  let { width, height } = bitmap;
  const maxW = 1920;
  const maxH = 1080;
  if (width > maxW || height > maxH) {
    const scale = Math.min(maxW / width, maxH / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > maxBytes * 1.37 && quality > 0.35) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  const bytes = Math.round((dataUrl.length * 3) / 4);
  bitmap.close();
  return { dataUrl, bytes };
}
