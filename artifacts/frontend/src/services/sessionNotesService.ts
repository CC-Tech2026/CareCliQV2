import { jsonFetch } from "@/services/http";

export type SessionNoteType = "text" | "voice" | "photo" | "file" | "check-in";

/** Real-time relevance/appropriateness check result — advisory only, never
 * blocks a save. warning_message is null when nothing was flagged. */
export type NoteValidationResult = {
  relevant_to_participant: boolean;
  fits_task_category: boolean;
  inappropriate_content: boolean;
  warning_message: string | null;
} | null;

export type SessionNoteRecord = {
  note_id: string;
  id?: string;
  session_id?: string | null;
  task_id?: string | null;
  goal_id?: string | null;
  content: string;
  created_at?: string;
  auto_saved_at?: string;
  synced?: boolean;
  note_type?: SessionNoteType;
  file_name?: string | null;
  attachment_urls?: string[];
  validation_result?: NoteValidationResult;
};

export type SessionNoteVersion = SessionNoteRecord & { is_current: boolean };

export type SyncSessionNotesResponse = {
  session_id: string;
  notes: SessionNoteRecord[];
};

export function listSessionNotes(sessionId: string) {
  return jsonFetch<SessionNoteRecord[]>(`/api/worker/sessions/${sessionId}/notes`);
}

export function syncSessionNotes(sessionId: string, notes: SessionNoteRecord[]) {
  return jsonFetch<SyncSessionNotesResponse>(`/api/worker/sessions/${sessionId}/notes`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export function deleteSessionNote(sessionId: string, noteId: string) {
  return jsonFetch<void>(`/api/worker/sessions/${sessionId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

/** Edits a note without overwriting it — the previous version is kept and
 * marked superseded server-side, never deleted. noteId must be the note's
 * server id (SessionNoteRecord.id), not the client_note_id. */
export function editSessionNote(sessionId: string, noteId: string, content: string) {
  return jsonFetch<SessionNoteRecord>(`/api/worker/sessions/${sessionId}/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export function getSessionNoteVersions(sessionId: string, noteId: string) {
  return jsonFetch<{ versions: SessionNoteVersion[] }>(
    `/api/worker/sessions/${sessionId}/notes/${noteId}/versions`
  );
}
