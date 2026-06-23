import {
  backoffDelayMs,
  incrementRetryCount,
  listPendingActions,
  removePendingAction,
  type PendingAction,
} from "@/lib/shift-offline-queue";
import { clockInShift, startSessionById, startShiftSession } from "@/services/shiftService";

function isClientRejection(err: unknown): boolean {
  const apiErr = err as Error & { status?: number };
  return (
    apiErr.status === 422 ||
    (apiErr.status !== undefined && apiErr.status >= 400 && apiErr.status < 500)
  );
}

async function processPendingAction(action: PendingAction): Promise<void> {
  if (action.type === "clock_in") {
    await clockInShift(action.shiftId, {
      method: action.method,
      location: action.location ?? undefined,
      qr_token: action.qrToken ?? undefined,
      client_timestamp: action.clientTimestamp,
    });
    return;
  }

  if (action.sessionId) {
    await startSessionById(action.sessionId, { startedAt: action.startedAt });
    return;
  }
  await startShiftSession(action.shiftId);
}

export type SyncQueuedShiftActionsResult = {
  synced: number;
  failed: number;
  cleared: number;
};

/** Flush IndexedDB pending clock-in / start-session actions when online. */
export async function syncAllQueuedShiftActions(): Promise<SyncQueuedShiftActionsResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0, cleared: 0 };
  }

  const actions = await listPendingActions();
  let synced = 0;
  let failed = 0;
  let cleared = 0;

  for (const action of actions) {
    if (action.retryCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(action.retryCount)));
    }
    try {
      await processPendingAction(action);
      await removePendingAction(action.id);
      synced += 1;
    } catch (err) {
      if (isClientRejection(err)) {
        await removePendingAction(action.id);
        cleared += 1;
      } else {
        await incrementRetryCount(action.id);
        failed += 1;
      }
    }
  }

  return { synced, failed, cleared };
}
