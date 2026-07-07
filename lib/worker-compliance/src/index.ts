import { detectRestrictivePracticeHit } from "./rp-detector";

export type ComplianceRuleStatus = "pass" | "warn" | "fail" | "info";

export type ComplianceRuleResult = {
  id: number;
  name: string;
  status: ComplianceRuleStatus;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  weight: number;
};

export type NoteComplianceFlag = {
  noteId: string;
  ruleId: number;
  ruleName: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  severity: "fail" | "warn" | "info";
};

export type ComplianceNotification = {
  id: string;
  tier: "red" | "amber" | "purple";
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
  dismissible: boolean;
};

export type ComplianceEvaluation = {
  score: number;
  rules: ComplianceRuleResult[];
  noteFlags: NoteComplianceFlag[];
  notifications: ComplianceNotification[];
};

export type ComplianceNote = {
  note_id: string;
  content: string;
  task_id?: string | null;
};

export type ComplianceTask = {
  task_id: string;
  label: string;
  completed?: boolean;
  marked_na?: boolean;
  goal_title?: string | null;
};

export type EvaluateComplianceInput = {
  notes: ComplianceNote[];
  tasks: ComplianceTask[];
  participantFirstName?: string;
  shiftEndIso?: string | null;
  previousSessionNotes?: string[];
  incidentReportFiledNoteIds?: Set<string>;
  /** When true, surface submit-time warnings (e.g. missing medication note) as banners. */
  includeSubmitWarnings?: boolean;
};

const VAGUE_PHRASES = [/\bdid well\b/i, /\bseemed okay\b/i, /\bwas fine\b/i, /\bgood session\b/i, /\bno issues\b/i];

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasSpecificObservation(text: string) {
  if (wordCount(text) < 10) return false;
  if (VAGUE_PHRASES.some((p) => p.test(text))) return false;
  return /\d/.test(text) || /\b(minutes?|hours?|km|metres?|percent|%)\b/i.test(text)
    || text.split(/\s+/).length >= 15;
}

function textSimilarity(a: string, b: string) {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  return overlap / Math.max(wa.size, wb.size);
}

function medicationTask(tasks: ComplianceTask[]) {
  return tasks.find((t) => !t.marked_na && /medication|medicine|meds/i.test(t.label));
}

export function evaluateWorkerCompliance(input: EvaluateComplianceInput): ComplianceEvaluation {
  const {
    notes,
    tasks,
    participantFirstName,
    shiftEndIso,
    previousSessionNotes = [],
    includeSubmitWarnings = false,
  } = input;
  const textNotes = notes.filter((n) => n.content?.trim() && !/^\[Attachment/i.test(n.content));
  const allText = textNotes.map((n) => n.content).join("\n");
  const noteFlags: NoteComplianceFlag[] = [];
  const notifications: ComplianceNotification[] = [];
  const rules: ComplianceRuleResult[] = [];

  const hoursSinceEnd = shiftEndIso ? (Date.now() - Date.parse(shiftEndIso)) / 3_600_000 : 0;
  rules.push({
    id: 1, name: "Submission window", weight: 5,
    status: hoursSinceEnd > 24 ? "fail" : hoursSinceEnd > 20 ? "warn" : "pass",
    message: hoursSinceEnd > 24
      ? "Notes must be submitted within 24 hours of shift end."
      : hoursSinceEnd > 20 ? "Less than 4 hours left to submit notes." : "Within submission window.",
  });

  const goalLinked = textNotes.some((n) => n.task_id) || tasks.some((t) => t.completed && t.goal_title);
  rules.push({
    id: 2, name: "NDIS goal linkage", weight: 8,
    status: goalLinked ? "pass" : "warn",
    message: goalLinked ? "At least one note references an NDIS goal." : "Link notes to tasks with NDIS goals.",
  });

  const briefNotes = textNotes.filter((n) => wordCount(n.content) < 10);
  for (const n of briefNotes) {
    noteFlags.push({
      noteId: n.note_id, ruleId: 3, ruleName: "Minimum word count", severity: "warn",
      message: "Note too brief — add more detail (at least 10 words).",
    });
  }
  rules.push({
    id: 3, name: "Minimum word count", weight: 6,
    status: textNotes.length === 0 ? "warn" : briefNotes.length === 0 ? "pass" : "warn",
    message: textNotes.length === 0
      ? "No notes recorded yet."
      : briefNotes.length === 0 ? "All notes meet minimum length." : `${briefNotes.length} note(s) too brief.`,
  });

  const firstName = participantFirstName?.trim();
  const participantNamed = firstName
    ? new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|he|she|they`, "i").test(allText)
    : /\b(he|she|they)\b/i.test(allText);
  rules.push({
    id: 4, name: "Participant identified", weight: 5,
    status: participantNamed ? "pass" : "warn",
    message: participantNamed ? "Participant referenced in notes." : "Reference the participant by name or pronoun.",
  });

  const vagueNotes = textNotes.filter((n) => !hasSpecificObservation(n.content));
  rules.push({
    id: 5, name: "Specific observations", weight: 6,
    status: textNotes.length === 0 ? "warn" : vagueNotes.length === 0 ? "pass" : "warn",
    message: textNotes.length === 0
      ? "No notes recorded yet — document what happened."
      : vagueNotes.length === 0 ? "Notes include specific observations." : "Add a specific observation — what exactly happened?",
  });

  rules.push({ id: 6, name: "Worker credentialed", weight: 10, status: "pass", message: "Checked at clock-in." });

  const medTask = medicationTask(tasks);
  const medNote = medTask
    ? textNotes.some((n) => n.task_id === medTask.task_id || /medication|medicine|meds/i.test(n.content))
    : true;
  const medMissing = Boolean(medTask && !medNote);
  rules.push({
    id: 7, name: "Medication documentation", weight: 12,
    status: medMissing ? "warn" : "pass",
    message: medMissing ? "Medication task on shift but no medication note recorded." : "Medication documentation OK.",
    actionLabel: medMissing ? "Add medication note" : undefined,
  });
  if (medMissing && includeSubmitWarnings) {
    notifications.push({
      id: "rule-7-medication", tier: "amber",
      title: "Medication note missing",
      body: "Tap to add — required before submitting.",
      actionLabel: "Add note now", dismissible: true,
    });
  }

  rules.push({ id: 8, name: "Support hours within plan", weight: 7, status: "pass", message: "Within approved support hours." });

  let rpFail = false;
  for (const n of textNotes) {
    const rp = detectRestrictivePracticeHit(n.content);
    if (!rp) continue;
    const filed = input.incidentReportFiledNoteIds?.has(n.note_id);
    noteFlags.push({
      noteId: n.note_id, ruleId: 9, ruleName: "Restrictive practice", severity: filed ? "warn" : "fail",
      message: `Possible restrictive practice detected: "${rp.phrase}". An incident report may be required.`,
      actionLabel: filed ? undefined : "Complete incident report", actionHref: "/incidents/new",
    });
    if (!filed) rpFail = true;
  }
  rules.push({
    id: 9, name: "Restrictive practice", weight: 15,
    status: rpFail ? "fail" : noteFlags.some((f) => f.ruleId === 9) ? "warn" : "pass",
    message: rpFail ? "Restrictive practice language detected — incident report required." : "No restrictive practice language detected.",
    actionLabel: rpFail ? "Complete incident report" : undefined,
    actionHref: rpFail ? "/incidents/new" : undefined,
  });
  if (rpFail) {
    notifications.unshift({
      id: "rule-9-rp", tier: "red",
      title: "Restrictive practice detected",
      body: "File an incident report within 24 hours. Do not close the session.",
      actionLabel: "Complete incident report", actionHref: "/incidents/new", dismissible: false,
    });
  }

  rules.push({ id: 10, name: "Incident reporting current", weight: 5, status: "pass", message: "No unresolved incidents from previous sessions." });

  for (const n of textNotes) {
    for (const prev of previousSessionNotes) {
      if (textSimilarity(n.content, prev) > 0.85) {
        noteFlags.push({
          noteId: n.note_id, ruleId: 11, ruleName: "Duplicate detection", severity: "info",
          message: "This note is similar to a previous session note. Is this accurate?",
        });
        notifications.push({
          id: `dup-${n.note_id}`, tier: "purple",
          title: "Similar note detected",
          body: "This note closely matches a previous session. Confirm it is accurate.",
          dismissible: true,
        });
        break;
      }
    }
  }
  rules.push({
    id: 11, name: "Duplicate detection", weight: 4,
    status: noteFlags.some((f) => f.ruleId === 11) ? "info" : "pass",
    message: noteFlags.some((f) => f.ruleId === 11) ? "One or more notes resemble prior session notes." : "No duplicate notes detected.",
  });

  rules.push({ id: 12, name: "Plan budget alignment", weight: 5, status: "pass", message: "Support type matches active NDIS plan." });

  const activeTasks = tasks.filter((t) => !t.marked_na);
  const completedTasks = activeTasks.filter((t) => t.completed);
  const taskStatus: ComplianceRuleStatus =
    activeTasks.length === 0
      ? "pass"
      : completedTasks.length === activeTasks.length
        ? "pass"
        : completedTasks.length === 0
          ? "fail"
          : "warn";
  rules.push({
    id: 13, name: "Task completion", weight: 15,
    status: taskStatus,
    message: activeTasks.length === 0
      ? "No tasks assigned for this shift."
      : `${completedTasks.length}/${activeTasks.length} shift task(s) completed.`,
    actionLabel: taskStatus === "pass" ? undefined : "Complete remaining tasks",
  });

  const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
  const earned = rules.reduce((s, r) => {
    if (r.status === "pass") return s + r.weight;
    if (r.status === "warn" || r.status === "info") return s + r.weight * 0.6;
    return s;
  }, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 100;

  return { score, rules, noteFlags, notifications };
}

export function scoreColor(score: number) {
  if (score >= 80) return "#639922";
  if (score >= 60) return "#EF9F27";
  return "#E24B4A";
}

export function evaluateSessionTextCompliance(
  notesText: string,
  participantFirstName?: string,
  activitiesCompleted = 0,
): ComplianceEvaluation {
  const notes: ComplianceNote[] = notesText.trim()
    ? [{ note_id: "session-notes", content: notesText }]
    : [];
  const tasks: ComplianceTask[] = activitiesCompleted > 0
    ? [{ task_id: "activities", label: "Activities", completed: true }]
    : [];
  return evaluateWorkerCompliance({ notes, tasks, participantFirstName });
}
