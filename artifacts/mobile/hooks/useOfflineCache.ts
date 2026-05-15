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
