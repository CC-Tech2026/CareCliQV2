const filedBySession = new Map<string, Set<string>>();

export function loadFiledNoteIds(sessionId: string): Set<string> {
  return new Set(filedBySession.get(sessionId) ?? []);
}

export function markNoteIncidentFiled(sessionId: string, noteId: string): void {
  const set = filedBySession.get(sessionId) ?? new Set<string>();
  set.add(noteId);
  filedBySession.set(sessionId, set);
}

export function markNotesIncidentFiled(sessionId: string, noteIds: string[]): void {
  const set = filedBySession.get(sessionId) ?? new Set<string>();
  for (const id of noteIds) set.add(id);
  filedBySession.set(sessionId, set);
}
