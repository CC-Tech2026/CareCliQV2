import { detectRestrictivePracticeHit } from "./rp-detector";

export {
  MOOD_OPTIONS,
  buildLongShiftCheckinNote,
  isCheckinSessionNote,
  mapLongShiftCheckinStatus,
  moodEmoji,
  moodLabel,
  type LongShiftCheckInFormData,
  type LongShiftCheckinStatus,
  type ParticipantMood,
} from "./long-shift-checkin";

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

/**
 * Real-time, per-note advisory checks derivable purely from local state
 * (word count, goal linkage, participant naming, a medication-note reminder,
 * restrictive-practice phrase detection, duplicate-note detection, task
 * completion). Deliberately does NOT include worker credentials, support-
 * hours-within-plan, prior-incident status, or budget alignment - those were
 * previously hardcoded here as permanent "pass" entries (worth ~26% of the
 * total score from the moment the screen opened, regardless of anything the
 * worker had done), which is exactly why the score used to jump to 70-80%
 * immediately. Those facts require real backend data and now come from the
 * actual 12-rule engine (compliance_engine.run_compliance_check on the
 * backend, via GET /worker/shifts/{id}/documentation-compliance-check),
 * fetched periodically and shown as a separate, clearly-labeled score -
 * this function's score is a lighter, immediate-feedback signal only.
 */
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

export type DraftNoteHintSeverity = "info" | "fail";

/** The NDIS note rule a hint comes from (backend compliance_engine.py). */
export type NoteRuleCode = "R3" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";

export type DraftNoteHint = {
  id: string;
  /** The rule this hint is about, so callers (and the note rewrite) can name
   *  the real rule rather than a local hint id. */
  rule: NoteRuleCode;
  severity: DraftNoteHintSeverity;
  message: string;
  /** Raw detected phrase for "restrictive-practice", "person-first",
   * "subjective-language", "filler", "scope" and "incident" hints, so a
   * caller can localize the surrounding message while still interpolating
   * the actual phrase found in the note. */
  phrase?: string;
  /** Suggested wording, for "person-first" hints. */
  suggestion?: string;
  /** Values a translated message needs, e.g. { words, min } for word-count. */
  params?: Record<string, string | number>;
};

// Offline mirror of the server's note rules (backend/app/services/
// compliance_engine.py defaults), for when the app can't reach the live
// check (POST /api/worker/notes/check). The live check runs the real rules
// with each provider's own settings and is used whenever the app is online.
// Keep these lists identical to the engine's defaults: the shared fixture
// rule-parity.json is checked against both sides in tests.

/** R3: under MIN_WORDS_WARN words fails; MIN_WORDS_PASS passes. */
export const MIN_WORDS_WARN = 30;
export const MIN_WORDS_PASS = 80;

const FILLER_PHRASES: Array<[RegExp, string]> = [
  [/\bgood session\b/i, "good session"],
  [/\bdid\s+shopping\b/i, "did shopping"],
  [/\ball\s+went\s+well\b/i, "all went well"],
  [/\bwent\s+well\b/i, "went well"],
  [/\bnothing\s+to\s+report\b/i, "nothing to report"],
  [/\bno\s+issues\b/i, "no issues"],
  [/\bsame\s+as\s+usual\b/i, "same as usual"],
  [/\bas\s+per\s+usual\b/i, "as per usual"],
  [/\bas\s+usual\b/i, "as usual"],
  [/\bcompleted\s+tasks\b/i, "completed tasks"],
  [/\bdone\s+for\s+the\s+day\b/i, "done for the day"],
  [/\bno\s+concerns\b/i, "no concerns"],
  [/\bstandard\s+session\b/i, "standard session"],
  [/\bregular\s+session\b/i, "regular session"],
  [/\bthe\s+usual\b/i, "the usual"],
  [/\buneventful\b/i, "uneventful"],
  [/\bsame\s+as\s+last\s+(?:time|session|week)\b/i, "same as last time"],
];

const PERSON_FIRST_VIOLATIONS: Array<[RegExp, string]> = [
  [/\bautistic\s+(?:person|child|adult|individual|client|man|woman|boy|girl)\b/i, "person with autism"],
  [/\bwheelchair[- ]?bound\b/i, "person who uses a wheelchair"],
  [/\bconfined\s+to\s+(?:a\s+)?wheelchair\b/i, "person who uses a wheelchair"],
  [/\bsuffers?\s+from\b/i, "has a diagnosis of"],
  [/\bthe\s+disabled\b/i, "person with disability"],
  [/\bspecial\s+needs\b/i, "support needs"],
  [/\bmental(?:ly)?\s+retard\w*\b/i, "person with intellectual disability"],
  [/\bblind\s+(?:person|people|client)\b/i, "person who is blind"],
  [/\bdeaf\s+(?:person|people|client)\b/i, "person who is deaf"],
  [/\bepilept(?:ic|ics)\b/i, "person with epilepsy"],
];

const SUBJECTIVE_PHRASES: RegExp[] = [
  /\bI\s+think\b/i,
  /\bI\s+believe\b/i,
  /\bI\s+feel\b/i,
  /\bI\s+suspect\b/i,
  /\bI\s+reckon\b/i,
  /\bI\s+guess\b/i,
  /\bseems\s+like\b/i,
  /\bseems\s+to\s+be\b/i,
  /\bprobably\s+(?:has|have|is|are|was|were)\b/i,
  /\bmight\s+be\s+(?:due|caused|because)\b/i,
];

const SCOPE_VIOLATIONS: Array<[RegExp, string]> = [
  [/\bdiagnos(?:ed|es|ing|is)\b/i, "clinical diagnosis"],
  [/\bdiagnosis\s+of\b/i, "clinical diagnosis"],
  [/\badminister(?:ed|ing)?\s+(?:medication|meds|drug|tablet|dose|injection)\b/i, "medication administration"],
  [/\bgave\s+(?:the\s+)?(?:medication|meds|tablet|pill|injection|dose)\b/i, "medication administration"],
  [/\binjected\b/i, "injection administration"],
  [/\bgave\s+(?:a\s+)?PRN\b/i, "PRN medication administration"],
  [/\bclinical\s+assessment\b/i, "clinical assessment"],
  [/\bmental\s+health\s+assessment\b/i, "mental health assessment"],
  [/\bpsychiatric\s+(?:assessment|evaluation|review)\b/i, "psychiatric assessment"],
  [/\bmedical\s+(?:assessment|evaluation|examination)\b/i, "medical assessment"],
  [/\bwound\s+(?:care|dressing|management)\b/i, "wound care"],
  [/\bprescrib(?:ed|es|ing)\b/i, "prescribing medication"],
  [/\bnursing\s+assessment\b/i, "nursing assessment"],
];

const INCIDENT_TRIGGERS: Array<[RegExp, string]> = [
  [/\bfell\b|\bfall(?:ing)?\b|\btripped\b/i, "fall/injury"],
  [/\baggressive\b|\baggression\b|\bviolent\b|\battack(?:ed|ing)?\b|\bhit\s+(?:a\s+)?(?:staff|worker|carer|support)\b/i, "aggression/violence"],
  [/\bhospital(?:ised|ized)?\b|\bemergency\s+department\b|\bED\b(?!\w)/i, "hospital/ED"],
  [/\bambulance\b|\b000\b|\bparamedic\b/i, "ambulance/emergency services"],
  [/\bself[-\s]harm\b|\bself[-\s]injur\w+\b|\bsuicid\w+\b/i, "self-harm/suicidality"],
  [/\babuse\b|\bneglect\b|\bmistreat\w+\b|\bexploit\w+\b/i, "abuse/neglect"],
  [/\boverdose\b/i, "overdose"],
  [/\bseizure\b|\bconvuls\w+\b|\bepileptic\s+episode\b/i, "seizure/medical emergency"],
  [/\bunconscious\b|\bpassed\s+out\b|\bfainted\b|\bunresponsive\b/i, "loss of consciousness"],
  [/\bdeceased\b|\bpassed\s+away\b/i, "death"],
];

/** R12: the words the server accepts as the participant's response. */
const PARTICIPANT_RESPONSE =
  /\b(report(?:ed|s)?|demonstrat(?:ed|es|ing)?|engag(?:ed|es|ing)?|declin(?:ed|es|ing)?|express(?:ed|es|ing)?|stat(?:ed|es|ing)?|indicated|respond(?:ed|s)?|participat(?:ed|es|ing)?|communicat(?:ed|es|ing)?|verbalised|verbalized|appear(?:ed|s)?|observ(?:ed|es|ing)?|comment(?:ed|s)?)\b/i;

/** R5: the server's goal language. */
const GOAL_PROGRESS =
  /\b(goal|objective|aim(?:ed|s)?|target|milestone|worked\s+(?:on|toward)|progress|achiev\w+|independen\w+|skill|develop\w+|improve\w+|ndis\s+plan|plan\s+goal|focus\s+area)\b/i;

/** Saying how the participant was, or what was checked, answers the concern
 *  question. Bare "no concerns" or "nothing to report" doesn't: R3 marks
 *  those as vague filler. Mirrors note_guidance_service._CONCERN_ANSWERED. */
const CONCERN_ANSWERED =
  /\b(noticed|worr\w+|incident|unwell|pain|injur\w+|upset|distress\w*|anxious|agitated|calm|settled|relaxed|comfortable|safe|bruis\w+|mark|rash|tired|sleep\w*|report(?:ed|s)?\s+(?:no|feeling)|appeared\s+(?:well|content|happy|calm))\b/i;

/** When it happened or how long it took: "at 2:30", "3pm", "for 40 minutes",
 *  "from 12 to 1", "after lunch". A note that says when is stronger evidence. */
const WHEN_STATED =
  /\b(\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm)|\d+\s*(?:minutes?|mins?|hours?|hrs?)|half\s+an?\s+hour|an?\s+hour|morning|afternoon|evening|midday|noon|before|after|during|until|bedtime|on\s+arrival|when\s+I\s+arrived)\b/i;

export type NotePromptId = "did" | "when" | "response" | "goal" | "concern" | "detail";

/**
 * The next thing a task's notes don't cover yet, for the worker app's note
 * guide: what was supported (R3), when and for how long (R1 evidence),
 * how the participant responded (R12),
 * progress toward the task's goal (R5), anything of concern (R9, R10), and
 * then enough detail for R3. Reads the English record, so it works whatever
 * language the worker wrote in. Null once everything is covered or skipped.
 */
export function nextNotePrompt(
  notesText: string,
  options: { hasGoal?: boolean; skipped?: ReadonlyArray<NotePromptId> } = {},
): NotePromptId | null {
  const text = notesText.trim();
  const skipped = new Set(options.skipped ?? []);
  const incident = INCIDENT_TRIGGERS.some(([p]) => p.test(text)) || !!detectRestrictivePracticeHit(text);
  const order: Array<[NotePromptId, boolean]> = [
    ["did", text.length > 0],
    ["when", WHEN_STATED.test(text)],
    ["response", PARTICIPANT_RESPONSE.test(text)],
    ["goal", !options.hasGoal || GOAL_PROGRESS.test(text)],
    ["concern", incident || CONCERN_ANSWERED.test(text)],
    ["detail", wordCount(text) >= MIN_WORDS_PASS && !FILLER_PHRASES.some(([p]) => p.test(text))],
  ];
  for (const [id, covered] of order) {
    if (!covered && !skipped.has(id)) return id;
  }
  return null;
}

/**
 * Live hints for a note still being typed or recorded: the text rules
 * (R3, R6 to R10, R12) on the draft alone. The app uses the server check
 * when online (it also covers R5 goal links and R11 copying, and follows the
 * provider's own rule settings); this is the offline fallback. Advisory:
 * "fail" marks what the scored check will fail, but never blocks saving.
 */
export function checkDraftNoteHints(text: string, participantFirstName?: string): DraftNoteHint[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const hints: DraftNoteHint[] = [];
  const name = participantFirstName?.trim() || "the participant";

  const rp = detectRestrictivePracticeHit(trimmed);
  if (rp) {
    hints.push({
      id: "restrictive-practice",
      rule: "R10",
      severity: "fail",
      message: `This may describe a restrictive practice ("${rp.phrase}"). It needs an incident report before the note can be approved.`,
      phrase: rp.phrase,
    });
  }

  const incident = INCIDENT_TRIGGERS.find(([p]) => p.test(trimmed));
  if (incident) {
    hints.push({
      id: "incident",
      rule: "R9",
      severity: "fail",
      message: `This sounds like an incident (${incident[1]}). Write exactly what happened and complete an incident report.`,
      phrase: incident[1],
    });
  }

  const scope = SCOPE_VIOLATIONS.find(([p]) => p.test(trimmed));
  if (scope) {
    hints.push({
      id: "scope",
      rule: "R8",
      severity: "fail",
      message: `This mentions ${scope[1]}, which is outside a support worker's role. Describe what you saw and who you told, not a diagnosis or treatment.`,
      phrase: scope[1],
    });
  }

  for (const [pattern, suggestion] of PERSON_FIRST_VIOLATIONS) {
    const match = trimmed.match(pattern);
    if (match) {
      hints.push({
        id: "person-first",
        rule: "R7",
        severity: "fail",
        message: `Use person-first words: try "${suggestion}" instead of "${match[0]}".`,
        phrase: match[0],
        suggestion,
      });
      break;
    }
  }

  const subjective = SUBJECTIVE_PHRASES.map((p) => trimmed.match(p)).find(Boolean);
  if (subjective) {
    hints.push({
      id: "subjective-language",
      rule: "R6",
      severity: "fail",
      message: `Write what you saw or heard, not "${subjective[0]}". For example "${name} said" or "${name} was".`,
      phrase: subjective[0],
    });
  }

  // Length and the other "add more" nudges once there's something to judge.
  const words = wordCount(trimmed);
  if (words >= 4) {
    const filler = FILLER_PHRASES.find(([p]) => p.test(trimmed));
    if (words < MIN_WORDS_WARN) {
      hints.push({
        id: "word-count",
        rule: "R3",
        severity: "fail",
        params: { words, min: MIN_WORDS_PASS },
        message: `Add more detail: what you did, how ${name} responded and how it went. (${words} of ${MIN_WORDS_PASS} words)`,
      });
    } else if (filler) {
      hints.push({
        id: "filler",
        rule: "R3",
        severity: "fail",
        message: `"${filler[1]}" is too vague for an audit. Write what actually happened instead.`,
        phrase: filler[1],
      });
    } else if (words < MIN_WORDS_PASS) {
      hints.push({
        id: "word-count-brief",
        rule: "R3",
        severity: "info",
        params: { words, min: MIN_WORDS_PASS },
        message: `Good start. Add a little more detail, about ${MIN_WORDS_PASS} words in all. (${words} so far)`,
      });
    }

    if (words >= 10 && !PARTICIPANT_RESPONSE.test(trimmed)) {
      hints.push({
        id: "participant-response",
        rule: "R12",
        severity: "info",
        message: `Add how ${name} responded, for example "${name} engaged well", "reported feeling tired" or "declined the walk".`,
      });
    }
  }

  return hints;
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
