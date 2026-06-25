import type { SafetyProtocol } from "@/services/safetyProtocolService";

export type CachedSafetyProtocol = SafetyProtocol & {
  syncedAt: string;
};

const DB_NAME = "carecliq_participant_safety";
const DB_VERSION = 1;
const STORE = "safety";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "participantId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
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

export async function cacheSafetyProtocol(
  participantId: string,
  protocol: SafetyProtocol,
): Promise<void> {
  const entry = {
    participantId,
    ...protocol,
    syncedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(entry));
}

export async function loadCachedSafetyProtocol(
  participantId: string,
): Promise<CachedSafetyProtocol | null> {
  if (!participantId) return null;
  const row = await withStore<CachedSafetyProtocol | undefined>("readonly", (store) =>
    store.get(participantId),
  );
  return row ?? null;
}

export function isSafetyCacheStale(
  cached: CachedSafetyProtocol | null,
  serverVersion?: number,
): boolean {
  if (!cached) return true;
  if (serverVersion != null && cached.content_version !== serverVersion) return true;
  return false;
}
