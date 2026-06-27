import { formatBytes } from "@/lib/format-bytes";
import { getMobileUploadConsent, isLikelyMobileData } from "@/lib/mobile-data-guard";
import {
  estimateNoteBytes,
  listAllPendingSessionNotes,
  loadPendingSessionNotes,
  removePendingSessionNote,
} from "@/lib/session-notes-storage";
import {
  listPendingActions,
  type PendingAction,
  type PendingClockInAction,
  type PendingStartSessionAction,
} from "@/lib/shift-offline-queue";
import { syncAllQueuedShiftActions, type SyncItemResult } from "@/lib/sync-pending-shift-actions";
import { listAllUnsyncedEvidence, type TaskEvidenceRecord } from "@/lib/task-evidence-storage";
import { syncEvidenceUploadQueue } from "@/lib/evidence-upload-queue";
import { syncSessionNotes } from "@/services/sessionNotesService";

export type SyncQueueCategory =
  | "clock_in"
  | "start_session"
  | "task_evidence"
  | "session_note";

export type SyncQueueItem = {
  id: string;
  category: SyncQueueCategory;
  label: string;
  detail: string;
  sizeBytes: number;
  queuedAt: string;
  shiftId?: string;
  sessionId?: string;
  complianceLocked: true;
  lastError?: string;
};

export type SyncAllResult = {
  results: SyncItemResult[];
  synced: number;
  failed: number;
};

const TASK_LABELS = new Map<string, string>();

export function setSyncTaskLabel(taskId: string, label: string) {
  TASK_LABELS.set(taskId, label);
}

function evidenceBytes(record: TaskEvidenceRecord): number {
  if (record.file_size_bytes) return record.file_size_bytes;
  if (record.content?.startsWith("data:")) {
    return Math.round((record.content.length * 3) / 4);
  }
  return new Blob([record.content ?? ""]).size;
}

function labelForShiftAction(action: PendingAction): string {
  if (action.type === "clock_in") return "Clock-in";
  return "Start session";
}

function detailForShiftAction(action: PendingAction): string {
  if (action.type === "clock_in") {
    const row = action as PendingClockInAction;
    return row.method === "gps" ? "GPS check-in" : "QR check-in";
  }
  const row = action as PendingStartSessionAction;
  return row.sessionId ? "Resume session" : "New session";
}

function groupEvidenceItems(rows: TaskEvidenceRecord[]): SyncQueueItem[] {
  const groups = new Map<string, TaskEvidenceRecord[]>();
  for (const row of rows) {
    const key = `${row.session_id}:${row.task_id}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const items: SyncQueueItem[] = [];
  for (const [, group] of groups) {
    const first = group[0];
    const photos = group.filter((r) => r.type === "photo").length;
    const voices = group.filter((r) => r.type === "voice").length;
    const texts = group.filter((r) => r.type === "text").length;
    const sizeBytes = group.reduce((sum, r) => sum + evidenceBytes(r), 0);
    const queuedAt = group.reduce(
      (min, r) => (r.created_at < min ? r.created_at : min),
      group[0].created_at,
    );

    const taskLabel = TASK_LABELS.get(first.task_id) ?? "Task";
    const parts: string[] = [];
    if (photos) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
    if (voices) parts.push(`${voices} voice`);
    if (texts) parts.push(`${texts} note${texts === 1 ? "" : "s"}`);
    const media = parts.length ? parts.join(", ") : "evidence";

    items.push({
      id: `evidence:${first.session_id}:${first.task_id}`,
      category: "task_evidence",
      label: `Task completion — ${taskLabel}`,
      detail: `${media} (${formatBytes(sizeBytes)})`,
      sizeBytes,
      queuedAt,
      sessionId: first.session_id,
      complianceLocked: true,
      lastError: group.find((r) => r.upload_status === "failed") ? "Upload failed" : undefined,
    });
  }
  return items;
}

export async function listSyncQueueItems(): Promise<SyncQueueItem[]> {
  const items: SyncQueueItem[] = [];

  for (const action of await listPendingActions()) {
    items.push({
      id: `shift:${action.id}`,
      category: action.type,
      label: labelForShiftAction(action),
      detail: detailForShiftAction(action),
      sizeBytes: 0,
      queuedAt: action.createdAt,
      shiftId: action.shiftId,
      complianceLocked: true,
    });
  }

  const evidenceRows = await listAllUnsyncedEvidence();
  const pendingEvidence = evidenceRows.filter(
    (r) =>
      !r.synced ||
      r.upload_status === "pending" ||
      r.upload_status === "uploading" ||
      r.upload_status === "failed",
  );
  items.push(...groupEvidenceItems(pendingEvidence));

  for (const { sessionId, note } of listAllPendingSessionNotes()) {
    const sizeBytes = estimateNoteBytes(note);
    items.push({
      id: `note:${sessionId}:${note.note_id}`,
      category: "session_note",
      label: "Session note",
      detail: note.note_type === "voice" ? "Voice note" : formatBytes(sizeBytes),
      sizeBytes,
      queuedAt: note.created_at ?? note.auto_saved_at ?? new Date().toISOString(),
      sessionId,
      complianceLocked: true,
    });
  }

  return items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function countPendingSyncItems(): Promise<number> {
  const items = await listSyncQueueItems();
  return items.length;
}

export function pendingUploadBytesForSession(sessionId: string, rows: TaskEvidenceRecord[]): number {
  return rows
    .filter((r) => r.session_id === sessionId)
    .reduce((sum, r) => sum + evidenceBytes(r), 0);
}

export async function shouldDeferUploadForMobileData(totalBytes: number): Promise<boolean> {
  if (totalBytes < 10 * 1024 * 1024) return false;
  if (!isLikelyMobileData()) return false;
  return getMobileUploadConsent() === "wifi_only";
}

export async function syncPendingSessionNotes(): Promise<SyncItemResult[]> {
  const results: SyncItemResult[] = [];
  const bySession = new Map<string, ReturnType<typeof loadPendingSessionNotes>>();

  for (const { sessionId, note } of listAllPendingSessionNotes()) {
    const bucket = bySession.get(sessionId) ?? [];
    bucket.push(note);
    bySession.set(sessionId, bucket);
  }

  for (const [sessionId, notes] of bySession) {
    const itemId = `note:${sessionId}:${notes.map((n) => n.note_id).join(",")}`;
    try {
      const result = await syncSessionNotes(sessionId, notes);
      for (const row of result.notes ?? []) {
        removePendingSessionNote(sessionId, row.note_id);
      }
      results.push({ id: itemId, ok: true });
    } catch (err) {
      results.push({
        id: itemId,
        ok: false,
        error: (err as Error).message || "Note sync failed",
      });
    }
  }

  return results;
}

export async function syncAllPendingItems(options?: {
  sessionIds?: string[];
  skipMobileGuard?: boolean;
}): Promise<SyncAllResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { results: [], synced: 0, failed: 0 };
  }

  const results: SyncItemResult[] = [];

  const shiftResults = await syncAllQueuedShiftActions();
  results.push(...shiftResults.results);

  const noteResults = await syncPendingSessionNotes();
  results.push(...noteResults);

  const evidenceRows = await listAllUnsyncedEvidence();
  const sessionIds = options?.sessionIds?.length
    ? options.sessionIds
    : [...new Set(evidenceRows.map((r) => r.session_id).filter(Boolean))];

  for (const sessionId of sessionIds) {
    const bytes = pendingUploadBytesForSession(sessionId, evidenceRows);
    if (!options?.skipMobileGuard && (await shouldDeferUploadForMobileData(bytes))) {
      results.push({
        id: `evidence:${sessionId}`,
        ok: false,
        error: "Waiting for Wi-Fi",
      });
      continue;
    }
    try {
      const snap = await syncEvidenceUploadQueue(sessionId, { force: true });
      if (snap.lastError && snap.pending > 0) {
        results.push({
          id: `evidence:${sessionId}`,
          ok: false,
          error: snap.lastError,
        });
      } else {
        results.push({ id: `evidence:${sessionId}`, ok: true });
      }
    } catch (err) {
      results.push({
        id: `evidence:${sessionId}`,
        ok: false,
        error: (err as Error).message || "Evidence sync failed",
      });
    }
  }

  const synced = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  window.dispatchEvent(new CustomEvent("offline-sync-updated"));
  return { results, synced, failed };
}
