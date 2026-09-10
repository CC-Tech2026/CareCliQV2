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
      /** Set once the clock-in call itself has succeeded on a prior sync
       * attempt but startSession then failed - prevents re-submitting the
       * clock-in (no idempotency key server-side) on the retry, since only
       * the session-start step still needs to happen. */
      clockedIn?: boolean;
      timestamp: number;
    }
  | {
      type: "delete_note";
      id: string;
      sessionId: string;
      noteId: string;
      timestamp: number;
    }
  | {
      type: "upload_attachment";
      id: string;
      sessionId: string;
      taskId?: string;
      taskLabel?: string;
      /** Local file uri from the picker/camera - must still exist on disk when replayed. */
      uri: string;
      name: string;
      mimeType: string;
      noteType: "photo" | "file";
      timestamp: number;
    }
  | {
      type: "submit_incident";
      id: string;
      payload: import("@/lib/resource-api").WorkerIncidentPayload;
      timestamp: number;
    }
  | {
      type: "end_shift";
      id: string;
      shiftId: string;
      signature: import("@/lib/worker-api").ShiftSignaturePayload;
      /** Set once the signature itself has synced on a prior attempt, so a
       * retry doesn't resubmit it - mirrors clock_in's clockedIn flag. */
      signatureSubmitted?: boolean;
      /** Worker ended with incomplete mandatory tasks and acknowledged the risk. */
      force?: boolean;
      reason?: string;
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

/**
 * Returns whether the item was actually persisted. Callers that tell the
 * worker "saved, will sync later" (haptic/toast) must check this first -
 * previously this swallowed AsyncStorage failures silently, so a worker
 * could be told something was queued when it never actually was.
 */
export async function enqueueWorkerUpdate(item: WorkerOfflineQueueItem): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(WORKER_QUEUE_KEY);
    const queue: WorkerOfflineQueueItem[] = raw ? JSON.parse(raw) : [];
    if (item.type === "clock_in" || item.type === "end_shift") {
      const idx = queue.findIndex((q) => q.type === item.type && q.shiftId === item.shiftId);
      if (idx >= 0) {
        queue[idx] = item;
      } else {
        queue.push(item);
      }
    } else {
      queue.push(item);
    }
    await AsyncStorage.setItem(WORKER_QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
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
