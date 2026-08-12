import {
  listSessionEvidence,
  saveTaskEvidence,
  type TaskEvidenceRecord,
  type TaskEvidenceType,
} from "@/lib/task-evidence-storage";
import {
  listSessionNotes,
  syncSessionNotes,
  type SessionNoteRecord,
} from "@/services/sessionNotesService";

export const SESSION_NOTES_UPDATED_EVENT = "session-notes-updated";

export function notifySessionNotesUpdated() {
  window.dispatchEvent(new Event(SESSION_NOTES_UPDATED_EVENT));
}

function mapNoteType(noteType?: string): TaskEvidenceType {
  if (noteType === "check-in") return "text";
  if (noteType === "voice") return "voice";
  if (noteType === "photo") return "photo";
  if (noteType === "file") return "file";
  return "text";
}

export function sessionNoteToEvidence(
  note: SessionNoteRecord,
  sessionId: string,
): TaskEvidenceRecord | null {
  const content = note.content?.trim();
  if (!content) return null;

  return {
    evidence_id: note.note_id || String(note.id ?? `note-${Date.now()}`),
    task_id: note.task_id ?? "",
    goal_id: note.goal_id ?? null,
    session_id: sessionId,
    type: mapNoteType(note.note_type),
    content,
    file_name: note.file_name ?? null,
    created_at: note.created_at || note.auto_saved_at || new Date().toISOString(),
    synced: true,
    upload_status: "uploaded",
  };
}

function mergeEvidenceRows(
  local: TaskEvidenceRecord[],
  fromNotes: TaskEvidenceRecord[],
): TaskEvidenceRecord[] {
  const byId = new Map<string, TaskEvidenceRecord>();
  for (const row of local) byId.set(row.evidence_id, row);
  for (const row of fromNotes) {
    if (!byId.has(row.evidence_id)) byId.set(row.evidence_id, row);
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Local IndexedDB evidence + server session notes (mobile composer). */
export async function listMergedSessionEvidence(
  sessionId: string,
  taskId?: string,
): Promise<TaskEvidenceRecord[]> {
  const localAll = await listSessionEvidence(sessionId);
  const local = taskId ? localAll.filter((r) => r.task_id === taskId) : localAll;

  let fromNotes: TaskEvidenceRecord[] = [];
  try {
    const notes = await listSessionNotes(sessionId);
    fromNotes = notes
      .map((note) => sessionNoteToEvidence(note, sessionId))
      .filter((row): row is TaskEvidenceRecord => Boolean(row));
  } catch {
    /* offline or session ended */
  }

  const noteRows = taskId ? fromNotes.filter((r) => r.task_id === taskId) : fromNotes;
  const merged = mergeEvidenceRows(local, noteRows);

  for (const row of noteRows) {
    if (!localAll.some((existing) => existing.evidence_id === row.evidence_id)) {
      try {
        await saveTaskEvidence(row);
      } catch {
        /* noop */
      }
    }
  }

  return merged;
}

/** Mirror a saved session note into local evidence + server task_evidence JSON. */
export async function mirrorSessionNoteToTaskEvidence(
  sessionId: string,
  note: SessionNoteRecord,
): Promise<void> {
  const evidence = sessionNoteToEvidence(note, sessionId);
  if (!evidence?.task_id) return;

  await saveTaskEvidence(evidence);

  if (typeof navigator !== "undefined" && navigator.onLine && evidence.type === "text") {
    const { syncSessionEvidence } = await import("@/services/taskEvidenceService");
    try {
      await syncSessionEvidence(sessionId, [evidence]);
    } catch {
      /* session notes API is source of truth */
    }
  }

  notifySessionNotesUpdated();
  const { notifyTaskEvidenceUpdated } = await import("@/components/shifts/SessionTimeline");
  notifyTaskEvidenceUpdated();
}

export function evidenceToSessionNote(evidence: TaskEvidenceRecord): SessionNoteRecord {
  return {
    note_id: evidence.evidence_id,
    session_id: evidence.session_id,
    task_id: evidence.task_id,
    goal_id: evidence.goal_id ?? undefined,
    content: evidence.content,
    created_at: evidence.created_at,
    auto_saved_at: evidence.created_at,
    note_type:
      evidence.type === "voice"
        ? "voice"
        : evidence.type === "photo"
          ? "photo"
          : evidence.type === "file"
            ? "file"
            : "text",
    file_name: evidence.file_name,
    synced: true,
  };
}

/** Desktop task-thread text → session notes API (visible on mobile). */
export async function mirrorTaskEvidenceToSessionNotes(
  sessionId: string,
  evidence: TaskEvidenceRecord[],
): Promise<void> {
  const notes = evidence
    .filter((row) => row.type === "text" && row.task_id && row.content?.trim())
    .map(evidenceToSessionNote);
  if (!notes.length) return;

  try {
    await syncSessionNotes(sessionId, notes);
    notifySessionNotesUpdated();
  } catch {
    /* offline */
  }
}
