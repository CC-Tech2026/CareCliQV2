export interface StructuredNotes {
  activitiesPerformed: string;
  outcomes: string;
  participantResponse: string;
  progressTowardGoals: string;
}

export interface ComplianceCheck {
  label: string;
  pass: boolean;
  note?: string;
}

export interface ComplianceResult {
  score: number;
  issues: string[];
  blocking: boolean;
  checks: ComplianceCheck[];
}

export function checkStructuredCompliance(
  notes: StructuredNotes,
  hasParticipant: boolean,
  durationMinutes: number,
  activitiesCount: number,
  imageCount: number,
  goalsAddressedCount: number = 0,
): ComplianceResult {
  const issues: string[] = [];
  let score = 0;

  // +20 participant linked
  const participantPass = hasParticipant;
  if (participantPass) {
    score += 20;
  } else {
    issues.push("Session must be linked to a participant");
  }

  // +20 duration > 0
  const durationPass = durationMinutes > 0;
  if (durationPass) {
    score += 20;
  } else {
    issues.push("Session duration must be recorded — start the timer before ending the session");
  }

  // +20 at least one activity logged
  const activityPass = activitiesCount > 0;
  if (activityPass) {
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

  // +10 photo evidence captured (photos only — voice transcription is supporting, not primary evidence)
  const photoPass = imageCount > 0;
  if (photoPass) {
    score += 10;
  } else {
    issues.push("No photo evidence captured — add photos to support this NDIS claim");
  }

  // +10 goals linked (NDIS requires every session to be linked to funded support goals)
  const goalsPass = goalsAddressedCount > 0;
  if (goalsPass) {
    score += 10;
  } else {
    issues.push("Non-compliant: No goals linked to this session.");
  }

  // Explicit content gate (separate from score): duration AND (activities OR notes) must both be present
  const meetsContentGate = durationMinutes > 0 && (activitiesCount > 0 || anyNoteFilled);

  // Goals gate: no linked goals is always blocking regardless of score — NDIS compliance requirement
  const meetsGoalsGate = goalsAddressedCount > 0;

  const checks: ComplianceCheck[] = [
    {
      label: "Participant linked",
      pass: participantPass,
    },
    {
      label: "Duration recorded",
      pass: durationPass,
      note: durationPass ? `${durationMinutes} min` : undefined,
    },
    {
      label: "Activity logged",
      pass: activityPass,
      note: activityPass ? `${activitiesCount} logged` : undefined,
    },
    {
      label: "Clinical notes completed",
      pass: anyNoteFilled,
    },
    {
      label: "Photo evidence captured",
      pass: photoPass,
      note: photoPass ? `${imageCount} photo${imageCount !== 1 ? "s" : ""}` : undefined,
    },
    {
      label: "Goals linked",
      pass: goalsPass,
      note: goalsPass ? `${goalsAddressedCount} goal${goalsAddressedCount !== 1 ? "s" : ""}` : undefined,
    },
  ];

  return {
    score: Math.min(score, 100),
    issues,
    // Block if score too low, content gate not met, OR no goals linked (all are hard NDIS requirements)
    blocking: score < 50 || !meetsContentGate || !meetsGoalsGate,
    checks,
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
