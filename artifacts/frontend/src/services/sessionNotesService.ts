import { jsonFetch } from "@/services/http";

export type SessionNoteType = "text" | "voice" | "photo" | "file";

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
};

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
