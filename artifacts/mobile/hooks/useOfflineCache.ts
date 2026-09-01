import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSIONS_CACHE_KEY = "offline_sessions_cache";
const PARTICIPANTS_CACHE_KEY = "offline_participants_cache";

export interface OfflineQueueItem {
  sessionId: string;
  notes: string;
  activities: string[];
  durationMinutes: number;
  completed: boolean;
  timestamp: number;
}

const QUEUE_KEY = "offline_notes_queue";
const WORKER_QUEUE_KEY = "offline_worker_queue";

export type WorkerOfflineQueueItem =
  | {
      type: "sync_notes";
      id: string;
      sessionId: string;
      notes: import("@/lib/worker-api").SessionNoteRecord[];
      timestamp: number;
    }
  | {
      type: "update_tasks";
      id: string;
      shiftId: string;
      tasks: import("@/lib/worker-api").ShiftTask[];
      timestamp: number;
    }
  | {
      type: "clock_in";
      id: string;
      shiftId: string;
      method: "gps" | "qr";
      location: { lat: number; lng: number; accuracy?: number } | null;
      qrToken?: string | null;
      clientTimestamp: string;
      startSession: boolean;
      timestamp: number;
    };

export async function cacheSessions(sessions: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(sessions));
  } catch {}
}

export async function getCachedSessions<T>(): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as T[];
  } catch {
    return null;
  }
}

export async function cacheParticipants(participants: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PARTICIPANTS_CACHE_KEY,
      JSON.stringify(participants)
    );
  } catch {}
}

export async function getCachedParticipants<T>(): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PARTICIPANTS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as T[];
  } catch {
    return null;
  }
}

export async function enqueueOfflineUpdate(
  item: OfflineQueueItem
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: OfflineQueueItem[] = raw ? JSON.parse(raw) : [];
    const idx = queue.findIndex((q) => q.sessionId === item.sessionId);
    if (idx >= 0) {
      queue[idx] = item;
    } else {
      queue.push(item);
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function removeFromQueue(sessionId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: OfflineQueueItem[] = raw ? JSON.parse(raw) : [];
    const updated = queue.filter((q) => q.sessionId !== sessionId);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
  } catch {}
}

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {}
}

export async function enqueueWorkerUpdate(item: WorkerOfflineQueueItem): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(WORKER_QUEUE_KEY);
    const queue: WorkerOfflineQueueItem[] = raw ? JSON.parse(raw) : [];
    if (item.type === "clock_in") {
      const idx = queue.findIndex((q) => q.type === "clock_in" && q.shiftId === item.shiftId);
      if (idx >= 0) {
        queue[idx] = item;
      } else {
        queue.push(item);
      }
    } else {
      queue.push(item);
    }
    await AsyncStorage.setItem(WORKER_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export async function getWorkerOfflineQueue(): Promise<WorkerOfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(WORKER_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function removeWorkerQueueItem(id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(WORKER_QUEUE_KEY);
    const queue: WorkerOfflineQueueItem[] = raw ? JSON.parse(raw) : [];
    const updated = queue.filter((q) => q.id !== id);
    await AsyncStorage.setItem(WORKER_QUEUE_KEY, JSON.stringify(updated));
  } catch {}
}

/** Called on logout (see AuthContext.tsx) - AsyncStorage isn't partitioned
 * per user on a shared device, so without this a second worker logging in
 * on the same phone could have the first worker's still-unsynced clock-ins/
 * notes/task updates silently replayed under their own session. Mirrors
 * deleteShiftOfflineDb's logout-wipe on the web app for the same reason. */
export async function clearWorkerQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WORKER_QUEUE_KEY);
  } catch {}
}

const SHIFTS_CACHE_KEY = "offline_worker_shifts_cache";

export async function cacheWorkerShifts(shifts: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SHIFTS_CACHE_KEY, JSON.stringify(shifts));
  } catch {}
}

export async function getCachedWorkerShifts<T>(): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(SHIFTS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as T[];
  } catch {
    return null;
  }
}

const SHIFT_CACHE_PREFIX = "offline_worker_shift_";
const SESSION_NOTES_CACHE_PREFIX = "offline_session_notes_";

export async function cacheWorkerShift(id: string, shift: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(`${SHIFT_CACHE_PREFIX}${id}`, JSON.stringify(shift));
  } catch {}
}

export async function getCachedWorkerShift<T>(id: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SHIFT_CACHE_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSessionNotes(sessionId: string, notes: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${SESSION_NOTES_CACHE_PREFIX}${sessionId}`, JSON.stringify(notes));
  } catch {}
}

export async function getCachedSessionNotes<T>(sessionId: string): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SESSION_NOTES_CACHE_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as T[];
  } catch {
    return null;
  }
}
