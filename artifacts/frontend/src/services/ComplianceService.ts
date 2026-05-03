export interface StructuredNotes {
  activitiesPerformed: string;
  outcomes: string;
  participantResponse: string;
  progressTowardGoals: string;
}

export interface ComplianceResult {
  score: number;
  issues: string[];
  blocking: boolean;
}

export function checkStructuredCompliance(
  notes: StructuredNotes,
  hasParticipant: boolean,
  durationMinutes: number,
  activitiesCount: number,
  imageCount: number,
  voiceNoteCount: number,
): ComplianceResult {
  const issues: string[] = [];
  let score = 0;

  // +20 participant linked
  if (hasParticipant) {
    score += 20;
  } else {
    issues.push("Session must be linked to a participant");
  }

  // +20 duration > 0
  if (durationMinutes > 0) {
    score += 20;
  } else {
    issues.push("Session duration must be recorded — start the timer before ending the session");
  }

  // +20 at least one activity logged
  if (activitiesCount > 0) {
    score += 20;
  } else {
    issues.push("No activities were logged — tap activity buttons during the session to build evidence");
  }

  // +20 structured note filled (at least one field with meaningful content)
  const anyNoteFilled = [
    notes.activitiesPerformed,
    notes.outcomes,
    notes.participantResponse,
    notes.progressTowardGoals,
  ].some((f) => f.trim().length >= 20);

  if (anyNoteFilled) {
    score += 20;
  } else {
    issues.push("At least one clinical note field must be completed with meaningful content (20+ characters)");
  }

  // +20 evidence captured (photos or voice notes)
  if (imageCount > 0 || voiceNoteCount > 0) {
    score += 20;
  } else {
    issues.push(
      "No evidence captured — add photos or voice dictation notes to support this claim",
    );
  }

  return {
    score: Math.min(score, 100),
    issues,
    blocking: score < 50,
  };
}

export function combineStructuredNotes(notes: StructuredNotes): string {
  const sections = [
    notes.activitiesPerformed.trim() &&
      `ACTIVITIES PERFORMED:\n${notes.activitiesPerformed.trim()}`,
    notes.outcomes.trim() && `OUTCOMES:\n${notes.outcomes.trim()}`,
    notes.participantResponse.trim() &&
      `PARTICIPANT RESPONSE:\n${notes.participantResponse.trim()}`,
    notes.progressTowardGoals.trim() &&
      `PROGRESS TOWARD GOALS:\n${notes.progressTowardGoals.trim()}`,
  ].filter(Boolean);
  return sections.join("\n\n");
}
