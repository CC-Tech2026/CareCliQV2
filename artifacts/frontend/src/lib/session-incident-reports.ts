const KEY_PREFIX = "cc-rp-incident-filed:";

export function loadFiledNoteIds(sessionId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${sessionId}`);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export function markNoteIncidentFiled(sessionId: string, noteId: string): void {
  const set = loadFiledNoteIds(sessionId);
  set.add(noteId);
  localStorage.setItem(`${KEY_PREFIX}${sessionId}`, JSON.stringify([...set]));
}

export function markNotesIncidentFiled(sessionId: string, noteIds: string[]): void {
  const set = loadFiledNoteIds(sessionId);
  for (const id of noteIds) set.add(id);
  localStorage.setItem(`${KEY_PREFIX}${sessionId}`, JSON.stringify([...set]));
}
