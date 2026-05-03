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

  // +20 at least one structured note field filled (non-empty)
  const anyNoteFilled = [
    notes.activitiesPerformed,
    notes.outcomes,
    notes.participantResponse,
    notes.progressTowardGoals,
  ].some((f) => f.trim().length > 0);

  if (anyNoteFilled) {
    score += 20;
  } else {
    issues.push("At least one clinical note field must be completed before this session can be claimed");
  }

  // +20 photo evidence captured (photos only — voice transcription is supporting, not primary evidence)
  if (imageCount > 0) {
    score += 20;
  } else {
    issues.push("No photo evidence captured — add photos to support this NDIS claim");
  }

  // Explicit content gate (separate from score): duration AND (activities OR notes) must both be present
  const meetsContentGate =
    durationMinutes > 0 && (activitiesCount > 0 || anyNoteFilled);

  return {
    score: Math.min(score, 100),
    issues,
    // Block if score too low OR content gate not met (prevents participant+duration+photos alone = 60% approval)
    blocking: score < 50 || !meetsContentGate,
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
