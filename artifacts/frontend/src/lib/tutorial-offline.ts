import { savePendingSessionNotes } from "@/lib/session-notes-storage";
import {
  deleteTaskEvidence,
  listSessionEvidence,
} from "@/lib/task-evidence-storage";

/** Synthetic session id used only during the worker walkthrough — never on the server. */
export const TUTORIAL_SESSION_ID = "tutorial-session";

export function isTutorialSessionId(sessionId: string | null | undefined): boolean {
  return sessionId === TUTORIAL_SESSION_ID;
}

/** Remove walkthrough-only evidence/notes that should not appear in the sync queue. */
export async function purgeTutorialOfflineArtifacts(): Promise<void> {
  const rows = await listSessionEvidence(TUTORIAL_SESSION_ID);
  await Promise.all(rows.map((row) => deleteTaskEvidence(row.evidence_id)));
  savePendingSessionNotes(TUTORIAL_SESSION_ID, []);
  try {
    localStorage.removeItem(`ccq_session_note_draft_${TUTORIAL_SESSION_ID}`);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent("offline-sync-updated"));
}
