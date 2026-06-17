export type PendingStartSessionAction = {
  id: string;
  type: "start_session";
  shiftId: string;
  sessionId?: string | null;
  startedAt: string;
  workerLocation?: { lat: number; lng: number } | null;
  retryCount: number;
  createdAt: string;
};

export type PendingAction = PendingStartSessionAction;

const DB_NAME = "carecliq_shift_offline";
const DB_VERSION = 1;
const STORE = "pending_actions";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("shiftId", "shiftId", { unique: false });
        store.createIndex("type", "type", { unique: false });
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

function newActionId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueStartSession(input: {
  shiftId: string;
  startedAt: string;
  sessionId?: string | null;
  workerLocation?: { lat: number; lng: number } | null;
}): Promise<PendingStartSessionAction> {
  const action: PendingStartSessionAction = {
    id: newActionId(),
    type: "start_session",
    shiftId: input.shiftId,
    sessionId: input.sessionId ?? null,
    startedAt: input.startedAt,
    workerLocation: input.workerLocation ?? null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(action));
  return action;
}

export async function listPendingActions(): Promise<PendingAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as PendingAction[]) ?? []);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingStartSession(shiftId: string): Promise<PendingStartSessionAction | null> {
  const actions = await listPendingActions();
  return actions.find((a) => a.type === "start_session" && a.shiftId === shiftId) ?? null;
}

export async function removePendingAction(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function incrementRetryCount(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result as PendingAction | undefined;
      if (row) {
        row.retryCount += 1;
        store.put(row);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function backoffDelayMs(retryCount: number) {
  return Math.min(30_000, 1000 * 2 ** retryCount);
}

export async function syncPendingActions(
  processor: (action: PendingAction) => Promise<void>,
): Promise<{ synced: number; failed: number }> {
  const actions = await listPendingActions();
  let synced = 0;
  let failed = 0;

  for (const action of actions) {
    if (action.retryCount > 0) {
      await new Promise((r) => setTimeout(r, backoffDelayMs(action.retryCount)));
    }
    try {
      await processor(action);
      await removePendingAction(action.id);
      synced += 1;
    } catch {
      await incrementRetryCount(action.id);
      failed += 1;
    }
  }

  return { synced, failed };
}

/** Migrate legacy localStorage pending start entries into IndexedDB. */
export async function migrateLegacyPendingStartSession(shiftId: string) {
  const key = `ccq_pending_start_session_${shiftId}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { shiftId: string; startedAt: string };
    const existing = await getPendingStartSession(shiftId);
    if (!existing) {
      await enqueueStartSession({ shiftId, startedAt: parsed.startedAt });
    }
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
