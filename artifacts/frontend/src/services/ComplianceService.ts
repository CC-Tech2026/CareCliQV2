export interface StructuredNotes {
  activitiesPerformed: string;
  outcomes: string;
  participantResponse: string;
  progressTowardGoals: string;
}

export interface ComplianceIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export interface ComplianceResult {
  score: number;
  issues: ComplianceIssue[];
  blocking: boolean;
}

const OUTCOME_KEYWORDS = [
  "achieved", "improved", "able to", "completed", "progressed",
  "demonstrated", "engaged", "participated", "outcome", "result",
  "progress", "responded", "showed", "increased", "reduced",
];

export function checkStructuredCompliance(
  notes: StructuredNotes,
  hasParticipant: boolean,
  durationMinutes: number,
  activitiesCount: number,
): ComplianceResult {
  const issues: ComplianceIssue[] = [];
  let score = 0;

  if (hasParticipant) {
    score += 20;
  } else {
    issues.push({
      field: "participant",
      severity: "error",
      message: "Session must be linked to a participant",
    });
  }

  if (durationMinutes > 0) {
    score += 20;
  } else {
    issues.push({
      field: "duration",
      severity: "error",
      message: "Session duration must be recorded",
    });
  }

  if (activitiesCount > 0) {
    score += 20;
  } else {
    issues.push({
      field: "activities",
      severity: "warning",
      message: "No activities were logged during the session",
    });
  }

  const filled = [
    notes.activitiesPerformed.trim().length >= 10,
    notes.outcomes.trim().length >= 10,
    notes.participantResponse.trim().length >= 10,
    notes.progressTowardGoals.trim().length >= 10,
  ].filter(Boolean).length;

  if (filled >= 3) {
    score += 20;
  } else if (filled === 0) {
    issues.push({
      field: "notes",
      severity: "error",
      message: "Clinical note fields are required — complete at least 3 of 4 sections",
    });
  } else {
    issues.push({
      field: "notes",
      severity: "warning",
      message: `${filled} of 4 note sections completed — aim for at least 3`,
    });
  }

  const evidenceText =
    `${notes.outcomes} ${notes.participantResponse}`.toLowerCase();
  const hasEvidence = OUTCOME_KEYWORDS.some((kw) => evidenceText.includes(kw));

  if (hasEvidence) {
    score += 20;
  } else if (
    notes.outcomes.trim().length > 0 ||
    notes.participantResponse.trim().length > 0
  ) {
    issues.push({
      field: "outcomes",
      severity: "warning",
      message:
        "Include measurable outcomes (e.g. 'participant achieved...', 'demonstrated...')",
    });
  } else {
    issues.push({
      field: "outcomes",
      severity: "error",
      message:
        "Outcomes and participant response are required for NDIS compliance",
    });
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
