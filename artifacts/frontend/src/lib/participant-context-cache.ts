import type { ParticipantContext, ParticipantPreferences, ParticipantProfile } from "@/services/shiftService";

export type CachedParticipantContext = {
  participantId: string;
  profile?: ParticipantProfile;
  preferences?: ParticipantPreferences;
  context?: ParticipantContext;
  syncedAt: string;
};

const DB_NAME = "carecliq_participant_context";
const DB_VERSION = 1;
const STORE = "context";

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

export async function cacheParticipantContext(entry: CachedParticipantContext): Promise<void> {
  await withStore("readwrite", (store) => store.put(entry));
}

export async function loadCachedParticipantContext(
  participantId: string,
): Promise<CachedParticipantContext | null> {
  if (!participantId) return null;
  const row = await withStore<CachedParticipantContext | undefined>("readonly", (store) =>
    store.get(participantId),
  );
  return row ?? null;
}

export function isContextStale(syncedAt?: string | null, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  if (!syncedAt) return false;
  const ts = Date.parse(syncedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > maxAgeMs;
}
