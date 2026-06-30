import type { SessionNoteRecord } from "@/services/sessionNotesService";

const DRAFT_PREFIX = "ccq_session_note_draft_";
const PENDING_PREFIX = "ccq_pending_session_notes_";

export type SessionNoteDraft = {
  noteId: string;
  content: string;
  updatedAt: string;
};

function draftKey(sessionId: string) {
  return `${DRAFT_PREFIX}${sessionId}`;
}

function pendingKey(sessionId: string) {
  return `${PENDING_PREFIX}${sessionId}`;
}

export function newClientNoteId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadSessionNoteDraft(sessionId: string): SessionNoteDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionNoteDraft;
  } catch {
    return null;
  }
}

export function saveSessionNoteDraft(sessionId: string, draft: SessionNoteDraft) {
  try {
    localStorage.setItem(draftKey(sessionId), JSON.stringify(draft));
  } catch {
    /* noop */
  }
}

export function clearSessionNoteDraft(sessionId: string) {
  try {
    localStorage.removeItem(draftKey(sessionId));
  } catch {
    /* noop */
  }
}

export function loadPendingSessionNotes(sessionId: string): SessionNoteRecord[] {
  try {
    const raw = localStorage.getItem(pendingKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionNoteRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePendingSessionNotes(sessionId: string, notes: SessionNoteRecord[]) {
  try {
    if (!notes.length) {
      localStorage.removeItem(pendingKey(sessionId));
      return;
    }
    localStorage.setItem(pendingKey(sessionId), JSON.stringify(notes));
  } catch {
    /* noop */
  }
}

export function enqueuePendingSessionNote(sessionId: string, note: SessionNoteRecord) {
  const pending = loadPendingSessionNotes(sessionId).filter((row) => row.note_id !== note.note_id);
  pending.push({ ...note, synced: false });
  savePendingSessionNotes(sessionId, pending);
}

export function removePendingSessionNote(sessionId: string, noteId: string) {
  const pending = loadPendingSessionNotes(sessionId).filter((row) => row.note_id !== noteId);
  savePendingSessionNotes(sessionId, pending);
}

export function listAllPendingSessionNotes(): Array<{ sessionId: string; note: SessionNoteRecord }> {
  if (typeof localStorage === "undefined") return [];
  const rows: Array<{ sessionId: string; note: SessionNoteRecord }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const storageKey = localStorage.key(i);
    if (!storageKey?.startsWith(PENDING_PREFIX)) continue;
    const sessionId = storageKey.slice(PENDING_PREFIX.length);
    for (const note of loadPendingSessionNotes(sessionId)) {
      rows.push({ sessionId, note });
    }
  }
  return rows;
}

export function estimateNoteBytes(note: SessionNoteRecord): number {
  let bytes = new Blob([note.content ?? ""]).size;
  for (const url of note.attachment_urls ?? []) {
    if (url.startsWith("data:")) {
      bytes += Math.round((url.length * 3) / 4);
    }
  }
  return bytes;
}
