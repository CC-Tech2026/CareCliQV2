/**
 * CARECLIQV2-230 — Evidence media upload queue with batching and exponential backoff.
 */

import type { TaskEvidenceRecord } from "@/lib/task-evidence-storage";
import {
  listSessionEvidence,
  listUnsyncedEvidence,
  saveTaskEvidence,
} from "@/lib/task-evidence-storage";
import { addShiftDataUsage } from "@/lib/shift-data-usage";
import { syncSessionEvidence, uploadSessionEvidenceMedia } from "@/services/taskEvidenceService";

export type EvidenceUploadStatus = "pending" | "uploading" | "uploaded" | "failed";

export const EVIDENCE_UPLOAD_BATCH_SIZE = 10;
export const EVIDENCE_UPLOAD_MAX_RETRIES = 5;

export type EvidenceSyncSnapshot = {
  pending: number;
  failed: number;
  syncing: boolean;
  lastSyncedCount: number;
  lastError: string | null;
};

type SyncListener = (snapshot: EvidenceSyncSnapshot) => void;

const listeners = new Map<string, Set<SyncListener>>();
const activeSync = new Map<string, Promise<EvidenceSyncSnapshot>>();

let snapshot: EvidenceSyncSnapshot = {
  pending: 0,
  failed: 0,
  syncing: false,
  lastSyncedCount: 0,
  lastError: null,
};

function isMediaRecord(record: TaskEvidenceRecord) {
  return record.type === "photo" || record.type === "voice";
}

function needsMediaUpload(record: TaskEvidenceRecord) {
  return isMediaRecord(record) && !record.file_url && record.upload_status !== "uploaded";
}

function needsTextSync(record: TaskEvidenceRecord) {
  return record.type === "text" && !record.synced;
}

export function backoffDelayMs(retryCount: number) {
  return Math.min(30_000, 1000 * 2 ** retryCount);
}

function stripDataUrlPrefix(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function notify(sessionId: string, next: EvidenceSyncSnapshot) {
  snapshot = next;
  const subs = listeners.get(sessionId);
  subs?.forEach((fn) => fn(next));
  window.dispatchEvent(
    new CustomEvent("evidence-sync-updated", { detail: { sessionId, snapshot: next } }),
  );
}

export function subscribeEvidenceSync(sessionId: string, listener: SyncListener) {
  if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
  listeners.get(sessionId)!.add(listener);
  listener(snapshot);
  return () => listeners.get(sessionId)?.delete(listener);
}

export async function countPendingEvidence(sessionId: string) {
  const rows = await listUnsyncedEvidence(sessionId);
  const pending = rows.filter((r) => needsMediaUpload(r) || needsTextSync(r));
  const failed = rows.filter((r) => r.upload_status === "failed");
  return { pending: pending.length, failed: failed.length };
}

async function applyUploadResponse(
  batch: TaskEvidenceRecord[],
  response: Awaited<ReturnType<typeof uploadSessionEvidenceMedia>>,
) {
  const uploadedById = new Map(
    (response.uploaded_evidence || []).map((row) => [row.evidence_id, row]),
  );
  const serverById = new Map(
    (response.task_evidence || []).map((row) => [row.evidence_id, row]),
  );

  for (const row of batch) {
    const server = serverById.get(row.evidence_id);
    const uploaded = uploadedById.get(row.evidence_id);
    await saveTaskEvidence({
      ...row,
      ...server,
      file_url: uploaded?.url ?? server?.file_url ?? row.file_url,
      storage_path: uploaded?.storage_path ?? server?.storage_path ?? row.storage_path,
      content:
        row.type === "photo" && row.content.startsWith("data:image")
          ? row.content
          : server?.content ?? row.content,
      synced: true,
      upload_status: "uploaded",
      retry_count: 0,
    });
  }
}

async function markBatchFailed(batch: TaskEvidenceRecord[]) {
  for (const row of batch) {
    const retry = (row.retry_count ?? 0) + 1;
    await saveTaskEvidence({
      ...row,
      upload_status: retry >= EVIDENCE_UPLOAD_MAX_RETRIES ? "failed" : "pending",
      retry_count: retry,
      synced: false,
    });
  }
}

export async function syncEvidenceUploadQueue(
  sessionId: string,
  options?: { force?: boolean },
): Promise<EvidenceSyncSnapshot> {
  if (!sessionId) {
    return snapshot;
  }

  const existing = activeSync.get(sessionId);
  if (existing && !options?.force) {
    return existing;
  }

  const run = (async () => {
    if (!navigator.onLine) {
      const counts = await countPendingEvidence(sessionId);
      const offlineSnap: EvidenceSyncSnapshot = {
        pending: counts.pending,
        failed: counts.failed,
        syncing: false,
        lastSyncedCount: 0,
        lastError: "Offline",
      };
      notify(sessionId, offlineSnap);
      return offlineSnap;
    }

    const counts = await countPendingEvidence(sessionId);
    notify(sessionId, {
      ...snapshot,
      pending: counts.pending,
      failed: counts.failed,
      syncing: true,
      lastError: null,
    });

    let syncedCount = 0;
    let lastError: string | null = null;

    try {
      const all = await listSessionEvidence(sessionId);
      const textPending = all.filter(needsTextSync);
      if (textPending.length) {
        await syncSessionEvidence(sessionId, textPending);
        for (const row of textPending) {
          await saveTaskEvidence({ ...row, synced: true, upload_status: "uploaded" });
        }
        syncedCount += textPending.length;
      }

      const mediaPending = all.filter(needsMediaUpload);
      for (let i = 0; i < mediaPending.length; i += EVIDENCE_UPLOAD_BATCH_SIZE) {
        const batch = mediaPending.slice(i, i + EVIDENCE_UPLOAD_BATCH_SIZE);
        const maxRetry = Math.max(0, ...batch.map((r) => r.retry_count ?? 0));
        if (maxRetry > 0) {
          await new Promise((r) => setTimeout(r, backoffDelayMs(maxRetry)));
        }

        for (const row of batch) {
          await saveTaskEvidence({ ...row, upload_status: "uploading" });
        }

        const files: Record<string, string> = {};
        for (const row of batch) {
          if (row.content.startsWith("data:")) {
            files[row.evidence_id] = stripDataUrlPrefix(row.content);
          } else {
            files[row.evidence_id] = row.content;
          }
        }

        try {
          const response = await uploadSessionEvidenceMedia(sessionId, batch, files);
          await applyUploadResponse(batch, response);
          const batchBytes = batch.reduce((sum, row) => {
            const content = row.content ?? "";
            if (content.startsWith("data:")) return sum + Math.round((content.length * 3) / 4);
            return sum + new Blob([content]).size;
          }, 0);
          try {
            const shiftKey = sessionStorage.getItem("ccq_active_shift_id");
            if (shiftKey) addShiftDataUsage(shiftKey, batchBytes);
          } catch {
            /* noop */
          }
          syncedCount += batch.length;
          notify(sessionId, {
            pending: Math.max(0, mediaPending.length - (i + batch.length)),
            failed: 0,
            syncing: true,
            lastSyncedCount: syncedCount,
            lastError: null,
          });
        } catch (err) {
          lastError = (err as Error).message || "Upload failed";
          await markBatchFailed(batch);
        }
      }
    } catch (err) {
      lastError = (err as Error).message || "Sync failed";
    }

    const finalCounts = await countPendingEvidence(sessionId);
    const done: EvidenceSyncSnapshot = {
      pending: finalCounts.pending,
      failed: finalCounts.failed,
      syncing: false,
      lastSyncedCount: syncedCount,
      lastError,
    };
    notify(sessionId, done);
    return done;
  })();

  activeSync.set(sessionId, run);
  try {
    return await run;
  } finally {
    activeSync.delete(sessionId);
  }
}

export function getEvidenceSyncSnapshot() {
  return snapshot;
}
