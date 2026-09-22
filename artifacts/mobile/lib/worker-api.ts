import { Platform } from "react-native";

import { workerFetch } from "@/lib/worker-fetch";

export type ShiftVisualState = "scheduled" | "clocked_in" | "session_active" | "completed";

export type ShiftHealthAlert = {
  type?: string;
  title: string;
  severity: "critical" | "important" | string;
  description?: string;
  instructions?: string;
  detail?: string;
};

export type ShiftTask = {
  task_id: string;
  type: "default" | "custom" | string;
  label: string;
  description?: string;
  completed: boolean;
  completed_at?: string | null;
  checked_at?: string | null;
  evidence_status?: "with_evidence" | "without_evidence" | null;
  has_photo?: boolean;
  has_voice?: boolean;
  has_text_notes?: boolean;
  note?: string;
  context_note?: string;
  order: number;
  mandatory?: boolean;
  goal_id?: string | null;
  goal_title?: string | null;
  /** From participant_tasks via shift_tasks (CARECLIQV2-330). */
  evidence_required?: string | null;
  marked_na?: boolean;
  na_reason?: string | null;
  /** "medication" identifies the structured medication-administration task
   * (WorkerMobileTaskList embeds the real dosing checklist for it). */
  category?: string | null;
};

export type ParticipantProfile = {
  preferred_name?: string;
  date_of_birth?: string;
  ndis_number?: string;
  phone?: string;
  email?: string;
  emergency_contact?: string | {
    name?: string | null;
    phone?: string | null;
    relationship?: string | null;
    display?: string;
  };
  case_manager?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  primary_disability?: string;
  medications?: string;
};

export type WorkerShift = {
  id: string;
  participant_id?: string;
  /** IANA zone of the participant's branch; label it when it differs from the worker's. */
  timezone?: string | null;
  participant_name?: string;
  participant_phone?: string;
  participant_address?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  duration_minutes?: number;
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
  clock_in_method?: "gps" | "qr" | "manual" | null;
  status: string;
  visual_state: ShiftVisualState;
  coordinator_notes?: string | null;
  entry_instructions?: string | null;
  access_instructions?: string | null;
  health_alerts?: ShiftHealthAlert[];
  has_risk_alerts?: boolean;
  allergies?: string | null;
  visit_notes?: string | null;
  health_flags?: string | null;
  risks_acknowledged?: boolean;
  requires_safety_ack?: boolean;
  profile?: ParticipantProfile;
  active_goals?: Array<string | { id?: string; title?: string; description?: string }>;
  tasks?: ShiftTask[];
  session_id?: string | null;
  session_status?: string | null;
  session_started_at?: string | null;
  office_contact_number?: string | null;
  /** Set when the shift was ended (worker override or system auto-end) with
   * incomplete mandatory tasks - documentation_due_at is 24h from clock-in to
   * finish them; clears itself once update_shift_tasks sees them complete. */
  documentation_pending?: boolean;
  documentation_due_at?: string | null;
  briefing_complete?: boolean;
  requires_briefing?: boolean;
  special_instructions?: string | null;
  completion_summary?: {
    tasks_completed: number;
    tasks_total: number;
    mandatory_completed: number;
    mandatory_total: number;
  };
  /** Embedded on shift detail — do not fetch separately for offline. */
  checkin_status?: CheckinWindowStatus;
  break_status?: ActiveBreakStatus;
};

export type ShiftFilter = "today" | "upcoming" | "completed" | "cancelled" | "past" | "all";

export type WorkerShiftsResponse = {
  shifts: WorkerShift[];
  filter: ShiftFilter;
  total?: number;
  offset?: number;
  limit?: number;
  has_more?: boolean;
};

export type ShiftBriefingAlert = {
  id: string;
  text: string;
  acknowledged: boolean;
};

export type ShiftBriefingPayload = {
  shift_id: string;
  participant_first_name: string;
  background_summary: {
    text: string;
    updated_at?: string | null;
    show_updated_badge: boolean;
  };
  previous_shift_note: {
    author_first_name: string;
    date: string;
    content: string;
  } | null;
  critical_alerts: ShiftBriefingAlert[];
  emergency_contacts: Array<{ name: string; role: string; phone: string }>;
  communication_preferences?: string | null;
  special_instructions?: string | null;
  briefing_complete: boolean;
  requires_rebrief: boolean;
  all_alerts_acknowledged: boolean;
};

export type SessionNoteType = "text" | "voice" | "photo" | "file" | "check-in";

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
  file_name?: string;
  attachment_urls?: string[];
};

export type GoalProgressNote = {
  goal_id: string;
  goal_title: string;
  evidence_provided?: string;
  outcome?: string;
  observation?: string;
};

export type CreateWorkerSessionInput = {
  session_date?: string;
  duration_minutes?: number;
  session_type?: string;
  notes?: string;
  goals_addressed?: string[];
  status?: string;
  outcomes?: string;
  participant_response?: string;
  progress_toward_goals?: string;
  goal_progress_notes?: GoalProgressNote[];
  participant_choice_control?: string;
};

export type GoalDetail = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  category?: string;
  priority?: number;
  why_it_matters?: string | null;
  worker_focus?: string[];
  progress_percentage?: number | null;
  target_date?: string | null;
};

export type ClientSessionRecord = {
  id: string;
  session_date?: string;
  session_type?: string;
  status?: string;
  duration_minutes?: number;
  notes?: string | null;
  legal_record_text?: string | null;
  compliance_score?: number | null;
  compliance_status?: string;
};

export type WorkerClient = {
  id: string;
  full_name: string;
  ndis_number?: string;
  compliance_status?: string;
  plan_status?: string;
  plan_management_type?: string;
  last_seen?: string | null;
  date_of_birth?: string;
  primary_disability?: string;
  allergies?: string | null;
  communication_preferences?: string | null;
  behaviour_support_plan?: string | null;
  restricted_behavioural_notes?: string | null;
  plan_start_date?: string;
  plan_end_date?: string;
  goals?: GoalDetail[];
};

export type WorkerClientDetail = {
  participant: WorkerClient;
  sessions: ClientSessionRecord[];
  notes: ClientSessionRecord[];
  compliance: ClientSessionRecord[];
};

export type WorkerNdisPlan = {
  participant_id: string;
  participant_name?: string;
  read_only: boolean;
  goals: GoalDetail[];
  plan: Record<string, unknown>;
};

export type WorkerComplianceSession = {
  id: string;
  session_date?: string;
  session_type?: string;
  compliance_score?: number | null;
  compliance_status?: string;
};

export type WorkerCompliance = {
  average_score: number;
  status: "compliant" | "at_risk" | "non_compliant";
  total_sessions: number;
  reviewed_sessions: number;
  at_risk: number;
  compliant_sessions?: number;
  sessions?: WorkerComplianceSession[];
  sessions_total?: number;
  latest_session?: WorkerComplianceSession | null;
};

export type ShiftSignature = {
  shift_id: string;
  worker_id: string;
  signed_at: string;
  signer_name?: string;
  signature_png_url?: string;
  confirm_tasks_accurate: boolean;
  confirm_safety_followed: boolean;
  confirm_no_unreported_incidents: boolean;
};

export type ClockInRequest = {
  method: "gps" | "qr";
  location?: { lat: number; lng: number; accuracy?: number } | null;
  qr_token?: string | null;
  client_timestamp?: string;
};

export function getWorkerShifts(
  filter: ShiftFilter = "today",
  options?: { limit?: number; offset?: number },
) {
  const params = new URLSearchParams({ filter });
  if (typeof options?.limit === "number") params.set("limit", String(options.limit));
  if (typeof options?.offset === "number") params.set("offset", String(options.offset));
  return workerFetch<WorkerShiftsResponse>(`/api/worker/shifts?${params.toString()}`);
}

export function getWorkerShift(id: string) {
  return workerFetch<WorkerShift>(`/api/worker/shifts/${id}`);
}

export type ShiftOfferSummary = {
  offer_id: string;
  shift_id: string;
  participant_first_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  shift_type: string | null;
  offered_at: string | null;
  /** Participant's branch zone. */
  timezone?: string | null;
};

/** Decision-only summary for a shift this worker has been offered but not
 * yet accepted/declined — deliberately excludes the full participant
 * profile, which stays locked until the worker actually commits to the
 * shift (getWorkerShift 403s until then; that's intentional, not a bug). */
export function getShiftOfferSummary(id: string) {
  return workerFetch<ShiftOfferSummary>(`/api/worker/shifts/${id}/offer`);
}

export function acceptShiftOffer(id: string) {
  return workerFetch<{ shift_id: string; shift: WorkerShift }>(`/api/worker/shifts/${id}/offer/accept`, {
    method: "POST",
  });
}

export function declineShiftOffer(id: string, reason?: string) {
  return workerFetch<{ shift_id: string }>(`/api/worker/shifts/${id}/offer/decline`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  });
}

export function clockInShift(id: string, body: ClockInRequest) {
  return workerFetch<WorkerShift>(`/api/worker/shifts/${id}/clock-in`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function acknowledgeShiftRisks(id: string) {
  return workerFetch<WorkerShift>(`/api/worker/shifts/${id}/acknowledge-risks`, {
    method: "POST",
  });
}

export type SafetyScenario = { trigger: string; response: string; sort_order?: number };
export type DeescalationTechnique = { title: string; steps: string[]; sort_order?: number };
export type PhysicalSafetyNote = { note: string; sort_order?: number };
export type EscalationContact = {
  role: "coordinator" | "on_call" | "emergency";
  label: string;
  phone: string;
  sort_order?: number;
};

export type SafetyProtocol = {
  participant_id: string;
  organization_id: string;
  safety_card_body: string;
  scenarios: SafetyScenario[];
  deescalation_techniques: DeescalationTechnique[];
  physical_safety_notes: PhysicalSafetyNote[];
  escalation_contacts: EscalationContact[];
  content_version: number;
  /** Always required fresh per shift — never satisfied by a past acknowledgement,
   * even for the same participant/content version. */
  requires_safety_ack?: boolean;
  has_safety_content?: boolean;
  /** Standing, org-wide acknowledgement text shown at every clock-in
   * regardless of whether this participant has any safety content on file -
   * never empty. */
  org_content_body: string;
  org_content_version: number;
};

export function getParticipantSafetyProtocol(participantId: string, shiftId?: string) {
  const query = shiftId ? `?shift_id=${encodeURIComponent(shiftId)}` : "";
  return workerFetch<SafetyProtocol>(`/api/worker/participants/${participantId}/safety-protocol${query}`);
}

export function acknowledgeParticipantSafetyProtocol(
  participantId: string,
  contentVersion: number,
  orgContentVersion?: number,
  shiftId?: string,
) {
  return workerFetch<{ acknowledged_at: string; requires_safety_ack: boolean }>(
    `/api/worker/participants/${participantId}/safety-protocol/acknowledge`,
    {
      method: "POST",
      body: JSON.stringify({
        content_version: contentVersion,
        org_content_version: orgContentVersion,
        shift_id: shiftId,
      }),
    },
  );
}

export function startShiftSession(id: string) {
  return workerFetch<WorkerShift>(`/api/worker/shifts/${id}/start-session`, {
    method: "POST",
  });
}

export function endShift(id: string, options?: { force?: boolean; reason?: string }) {
  return workerFetch<WorkerShift>(`/api/worker/shifts/${id}/end-shift`, {
    method: "POST",
    body: JSON.stringify({ force: options?.force ?? false, reason: options?.reason ?? null }),
  });
}

export type DocumentationComplianceRule = {
  rule: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  severity?: string;
  explanation?: string;
  is_blocking?: boolean;
  enforcement_tier?: string;
  category?: string;
};

export type DocumentationComplianceCheck =
  | { available: false; reason: string }
  | {
      available: true;
      score: number;
      passed: number;
      warnings: number;
      failed: number;
      total_rules: number;
      rules: DocumentationComplianceRule[];
      failed_rules: DocumentationComplianceRule[];
    };

/**
 * Real 12-rule NDIS documentation-quality check (compliance_engine.
 * run_compliance_check on the backend) run against this shift's notes so
 * far. Read-only, no AI call, safe to poll periodically while the shift is
 * in progress - distinct from the task-evidence compliance_score computed
 * at end_shift().
 */
export function checkShiftDocumentationCompliance(shiftId: string) {
  return workerFetch<DocumentationComplianceCheck>(
    `/api/worker/shifts/${shiftId}/documentation-compliance-check`,
  );
}

export function updateShiftTasks(id: string, tasks: ShiftTask[]) {
  return workerFetch<WorkerShift>(`/api/worker/shifts/${id}/tasks`, {
    method: "PATCH",
    body: JSON.stringify({ tasks }),
  });
}

/** The worker picks one of these four base actions; "given" is then classified automatically
 * into an on-time/late/early outcome by the server, from the logged timestamps. */
export type MedicationAdministrationAction = "given" | "refused" | "missed" | "withheld" | "administration_error";
export type MedicationErrorSubtype = "wrong_medication" | "wrong_dose" | "wrong_participant" | "wrong_route" | "other";
export const MEDICATION_ERROR_SUBTYPES: MedicationErrorSubtype[] = [
  "wrong_medication", "wrong_dose", "wrong_participant", "wrong_route", "other",
];
/** What a logged dose actually resolved to — the six outcomes the audit trail records. */
export type MedicationAdministrationOutcome = "given_on_time" | "given_late" | "given_early" | "refused" | "missed" | "withheld";
export type MedicationDueStatus = "upcoming" | "due_now" | "overdue" | MedicationAdministrationOutcome;

export const MEDICATION_REASON_CODES: Record<Exclude<MedicationAdministrationOutcome, "given_on_time">, string[]> = {
  given_late: ["participant_asleep", "worker_delayed", "participant_off_site", "other"],
  given_early: ["participant_requested", "schedule_conflict", "other"],
  refused: ["verbal", "behavioural", "communication_device", "other"],
  missed: ["participant_asleep", "worker_delayed", "participant_off_site", "other"],
  withheld: ["clinical_direction", "other"],
};

export type MedicationChecklistItem = {
  medication_id: string;
  name: string;
  strength?: string | null;
  dosage?: string | null;
  route: string;
  scheduled_time: string;
  due_status: MedicationDueStatus;
  administration?: { outcome: MedicationAdministrationOutcome; notes?: string | null } | null;
  is_high_risk?: boolean;
  high_risk_category?: string | null;
};

export function getMedicationChecklist(shiftId: string) {
  return workerFetch<{ checklist: MedicationChecklistItem[] }>(`/api/worker/shifts/${shiftId}/medication-checklist`);
}

export function logMedicationAdministration(
  shiftId: string,
  medicationId: string,
  body: {
    scheduled_time?: string;
    administered_time?: string;
    action: MedicationAdministrationAction;
    reason_code?: string;
    directed_by?: string;
    dose_given?: string;
    notes?: string;
    prn_reason?: string;
    voice_captured?: boolean;
    error_subtype?: MedicationErrorSubtype;
    verification_photo_url?: string;
    // Late-discovery correction only — references the original entry this one corrects.
    // Left unset for an immediate self-reported error, which stands as its own row.
    corrects_administration_id?: string;
    error_discovered_at?: string;
  },
) {
  return workerFetch<{ id: string; outcome: MedicationAdministrationOutcome }>(`/api/worker/shifts/${shiftId}/medications/${medicationId}/administrations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Point-of-administration photo required before a high-risk medication's "given" outcome can
 * be submitted. Call this first, then pass the returned url as verification_photo_url. */
export async function uploadMedicationVerificationPhoto(
  shiftId: string,
  medicationId: string,
  file: { uri: string; name: string; type: string },
): Promise<{ url: string }> {
  const formData = new FormData();
  if (Platform.OS === "web") {
    const res = await fetch(file.uri);
    const blob = await res.blob();
    formData.append("file", blob, file.name);
  } else {
    formData.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  return workerFetch<{ url: string }>(
    `/api/worker/shifts/${shiftId}/medications/${medicationId}/verification-photo`,
    { method: "POST", body: formData },
  );
}

export type PrnMedication = {
  id: string;
  name: string;
  strength?: string | null;
  dosage?: string | null;
  route: string;
  prn_max_per_day?: number | null;
  doses_given_today: number;
  at_or_over_max: boolean;
  is_high_risk?: boolean;
  high_risk_category?: string | null;
};

export type PrnPendingEffect = {
  id: string;
  medication_id: string;
  prn_reason: string;
  administered_time: string;
};

export function getPrnMedications(shiftId: string) {
  return workerFetch<{ medications: PrnMedication[]; pending_effects: PrnPendingEffect[] }>(
    `/api/worker/shifts/${shiftId}/prn-medications`,
  );
}

/** Follow-up for a "given" dose that came back given_late/given_early — the worker couldn't
 * have known that classification in advance of submitting it, so the reason is attached here. */
export function attachMedicationReason(administrationId: string, reasonCode: string | undefined, notes: string | undefined) {
  return workerFetch<{ id: string }>(`/api/worker/medication-administrations/${administrationId}/reason`, {
    method: "PATCH",
    body: JSON.stringify({ reason_code: reasonCode, notes }),
  });
}

export function logMedicationEffect(administrationId: string, effectObserved: string, voiceCaptured = false) {
  return workerFetch<{ id: string }>(`/api/worker/medication-administrations/${administrationId}/effect`, {
    method: "PATCH",
    body: JSON.stringify({ effect_observed: effectObserved, voice_captured: voiceCaptured }),
  });
}

export function getShiftBriefing(shiftId: string) {
  return workerFetch<ShiftBriefingPayload>(`/api/worker/shifts/${shiftId}/briefing`);
}

export function completeShiftBriefing(shiftId: string, scrolledToBottom = true) {
  return workerFetch<ShiftBriefingPayload>(
    `/api/worker/shifts/${shiftId}/briefing/complete`,
    {
      method: "POST",
      body: JSON.stringify({ scrolled_to_bottom: scrolledToBottom }),
    },
  );
}

export function listSessionNotes(sessionId: string) {
  return workerFetch<SessionNoteRecord[]>(`/api/worker/sessions/${sessionId}/notes`);
}

export function syncSessionNotes(sessionId: string, notes: SessionNoteRecord[]) {
  return workerFetch<{ session_id: string; notes: SessionNoteRecord[] }>(
    `/api/worker/sessions/${sessionId}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ notes }),
    },
  );
}

export type SessionAttachment = {
  id: string;
  session_id: string;
  file_name: string;
  file_path: string;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  attachment_type: string;
};

/** Actually uploads a photo/file to storage (unlike a note's file_name, which is just a
 * label) — call this before attaching a note so the note's attachment_urls references a
 * real, retrievable file rather than a placeholder string. */
export async function uploadSessionAttachment(
  sessionId: string,
  file: { uri: string; name: string; type: string },
): Promise<SessionAttachment> {
  const formData = new FormData();
  if (Platform.OS === "web") {
    const res = await fetch(file.uri);
    const blob = await res.blob();
    formData.append("file", blob, file.name);
  } else {
    formData.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  return workerFetch<SessionAttachment>(`/api/sessions/${sessionId}/attachments`, {
    method: "POST",
    body: formData,
  });
}

export async function transcribeSessionAudio(sessionId: string, uri: string) {
  const cleanPath = uri.split("?")[0] ?? uri;
  const ext = cleanPath.split(".").pop()?.toLowerCase() || "m4a";
  const mime =
    ext === "webm"
      ? "audio/webm"
      : ext === "wav"
        ? "audio/wav"
        : ext === "caf"
          ? "audio/x-caf"
          : ext === "mp3"
            ? "audio/mpeg"
            : "audio/mp4";
  const filename = `voice-note.${ext}`;

  const formData = new FormData();
  // Native RN FormData needs { uri, name, type }. Blob only works on web —
  // using Blob on Android causes "Network request failed".
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    formData.append("audio_file", blob, filename);
  } else {
    formData.append(
      "audio_file",
      {
        uri,
        name: filename,
        type: mime,
      } as unknown as Blob,
    );
  }

  return workerFetch<{ transcript: string }>(
    `/api/worker/sessions/${sessionId}/transcribe`,
    { method: "POST", body: formData },
  );
}

export function deleteSessionNote(sessionId: string, noteId: string) {
  return workerFetch<void>(`/api/worker/sessions/${sessionId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

export type ShiftSignaturePayload = {
  confirm_tasks_accurate: boolean;
  confirm_safety_followed: boolean;
  confirm_no_unreported_incidents: boolean;
  signature_svg: string;
  signature_png_data_url: string;
};

export function submitShiftSignature(shiftId: string, body: ShiftSignaturePayload) {
  return workerFetch<ShiftSignature>(`/api/worker/shifts/${shiftId}/sign`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getMyClients() {
  return workerFetch<WorkerClient[]>("/api/worker/my-clients");
}

export function getMyClientDetail(id: string) {
  return workerFetch<WorkerClientDetail>(`/api/worker/my-clients/${id}`);
}

export function getMyClientNdisPlan(id: string) {
  return workerFetch<WorkerNdisPlan>(`/api/worker/my-clients/${id}/ndis-plan`);
}

export function createMyClientSession(id: string, body: CreateWorkerSessionInput = {}) {
  return workerFetch<ClientSessionRecord>(`/api/worker/my-clients/${id}/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ShiftOfficeMessage = {
  id: string;
  shift_id: string;
  message: string;
  priority: "normal" | "urgent" | "emergency";
  created_at: string;
};

export function listShiftMessages(shiftId: string) {
  return workerFetch<ShiftOfficeMessage[]>(`/api/worker/shifts/${shiftId}/messages`);
}

export function sendShiftOfficeMessage(
  shiftId: string,
  body: {
    message: string;
    priority?: "normal" | "urgent" | "emergency";
    attachment_data?: string[];
  },
) {
  return workerFetch<ShiftOfficeMessage>(`/api/worker/shifts/${shiftId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function translateNoteToEnglish(text: string, sourceLanguage = "auto") {
  return workerFetch<{ translated?: string; detected_language?: string; status?: string }>(
    "/api/ai/translate",
    {
      method: "POST",
      body: JSON.stringify({ text, source_language: sourceLanguage }),
    },
  );
}

export function clinicalRewriteText(text: string, sourceLanguage = "auto") {
  return workerFetch<{ clinical?: string; note?: string; text?: string; translated_from?: string }>(
    "/api/ai/clinical-rewrite",
    {
      method: "POST",
      body: JSON.stringify({ text, source_language: sourceLanguage }),
    },
  );
}

export type ImproveNoteResult = {
  improved_note: string;
  rule_suggestions: { rule: string; issue: string; suggestion: string }[];
};

/**
 * Rewrites a draft note to fix specific issues (word count, vagueness,
 * missing participant reference, etc.) using the same AI capability already
 * used coordinator-side for full session notes (ai_service.improve_note) -
 * here scoped to a single in-progress task note rather than a whole shift.
 */
export function improveNote(
  notes: string,
  failedRules: { rule: string; message: string }[],
  participantId?: string | null,
) {
  return workerFetch<ImproveNoteResult>("/api/ai/improve-note", {
    method: "POST",
    body: JSON.stringify({
      notes,
      failed_rules: failedRules,
      participant_id: participantId ?? undefined,
    }),
  });
}

export type TranslatePreviewResult = {
  translated: string;
  target_language: string;
  translated_ok: boolean;
};

/**
 * Best-effort English -> display-language translation for a read-only
 * preview only (e.g. showing what an AI-suggested note rewrite says in the
 * worker's own app language) - never the saved legal record, which stays
 * English. Always resolves (backend degrades to the original text on
 * failure rather than erroring), so this never needs its own error UI.
 */
export function translateForWorkerPreview(text: string, targetLanguage: string) {
  return workerFetch<TranslatePreviewResult>("/api/ai/translate-preview", {
    method: "POST",
    body: JSON.stringify({ text, target_language: targetLanguage }),
  });
}

export function getMyCompliance(params?: { sessionsLimit?: number; sessionsOffset?: number }) {
  const q = new URLSearchParams();
  if (params?.sessionsLimit != null) q.set("sessions_limit", String(params.sessionsLimit));
  if (params?.sessionsOffset != null) q.set("sessions_offset", String(params.sessionsOffset));
  const query = q.toString();
  return workerFetch<WorkerCompliance>(`/api/worker/my-compliance${query ? `?${query}` : ""}`);
}

export type CheckinStatus = "GOING_WELL" | "NEEDS_ATTENTION" | "INCIDENT_REPORTED";

export type UpcomingCheckin = {
  id: string;
  sequence_number?: number;
  scheduled_at: string;
  status?: string;
};

export type MissedCheckin = {
  id: string;
  sequence_number?: number;
  scheduled_at: string | null;
};

export type CheckinWindowStatus = {
  applicable?: boolean;
  can_submit_checkin?: boolean;
  block_reason?: "on_break" | "cooldown" | "not_due_yet" | null;
  cooldown_remaining_secs?: number;
  next_checkin_due_secs?: number;
  checkin_overdue?: boolean;
  checkins_completed?: number;
  checkins_required?: number;
  last_checkin_at?: string | null;
  uses_random_schedule?: boolean;
  checkin_response_window_secs?: number;
  /** Pending/prompted check-ins — used to schedule offline-capable local notifications. */
  upcoming_checkins?: UpcomingCheckin[];
  /** Missed check-ins the worker hasn't explained yet — blocks shift submission until each has a reason. */
  missed_checkins_needing_reason?: MissedCheckin[];
};

export type UserNotification = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  severity: string;
  shift_id?: string | null;
  action_url?: string | null;
  read_at?: string | null;
  dismissed_at?: string | null;
  created_at: string;
};

export type WorkerComplianceRuleResult = {
  rule: string;
  label: string;
  status: string;
  message?: string;
  explanation?: string;
  category?: string;
  severity?: string;
  is_blocking?: boolean;
  enforcement_tier?: string;
};

export type WorkerComplianceDetail = {
  score: number;
  status: "compliant" | "at_risk" | "non_compliant";
  reviewed_sessions: number;
  rules: WorkerComplianceRuleResult[];
  failed_rules: WorkerComplianceRuleResult[];
  trend: Array<{ date: string; avg_score: number | null; session_count: number }>;
  trend_days: number;
};

export function getCheckinStatusByShift(shiftId: string) {
  return workerFetch<CheckinWindowStatus>(`/api/worker/shifts/${shiftId}/checkins/status`);
}

export function submitMissedCheckinReason(sessionId: string, scheduledCheckinId: string, reason: string) {
  return workerFetch<{ ok: boolean }>(
    `/api/worker/sessions/${sessionId}/checkins/${scheduledCheckinId}/missed-reason`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export function submitLongShiftCheckin(
  sessionId: string,
  body: { status: CheckinStatus; note?: string; prompt_triggered_at?: string },
) {
  return workerFetch<{ id: string; status: CheckinStatus; submitted_at: string }>(
    `/api/worker/sessions/${sessionId}/checkins`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function submitLongShiftCheckInForm(
  sessionId: string,
  form: import("@workspace/worker-compliance").LongShiftCheckInFormData,
) {
  const {
    buildLongShiftCheckinNote,
    mapLongShiftCheckinStatus,
  } = await import("@workspace/worker-compliance");

  const status = mapLongShiftCheckinStatus(form);
  const note = buildLongShiftCheckinNote(form);
  const checkin = await submitLongShiftCheckin(sessionId, {
    status,
    note,
    prompt_triggered_at: new Date().toISOString(),
  });

  const now = new Date().toISOString();
  const timelineNote: SessionNoteRecord = {
    note_id: globalThis.crypto?.randomUUID?.() ?? `checkin-${Date.now()}`,
    session_id: sessionId,
    content: note,
    note_type: "check-in",
    created_at: now,
    auto_saved_at: now,
    synced: true,
  };
  await syncSessionNotes(sessionId, [timelineNote]);

  return { checkin, status, note, timelineNote };
}

export type ShiftBreak = {
  id: string;
  break_start_at: string;
  break_end_at?: string | null;
  duration_secs?: number | null;
  is_compliant?: boolean | null;
};

export type ActiveBreakStatus = {
  active: boolean;
  id?: string;
  break_start_at?: string;
  break_number?: number;
  elapsed_secs?: number;
  completed_breaks?: number;
  total_break_secs?: number;
  max_breaks_per_shift?: number | null;
  can_start_break?: boolean;
  block_reason?: "break_in_progress" | "break_limit_reached" | null;
};

export function getBreakStatusByShift(shiftId: string) {
  return workerFetch<ActiveBreakStatus>(`/api/worker/shifts/${shiftId}/breaks/status`);
}

export function startLongShiftBreak(sessionId: string) {
  return workerFetch<ShiftBreak>(`/api/worker/sessions/${sessionId}/breaks/start`, {
    method: "POST",
  });
}

export function endLongShiftBreak(sessionId: string) {
  return workerFetch<ShiftBreak>(`/api/worker/sessions/${sessionId}/breaks/end`, {
    method: "POST",
  });
}

export function fetchNotifications(params?: {
  days?: number;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params?.days) q.set("days", String(params.days));
  if (params?.unread_only) q.set("unread_only", "true");
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  return workerFetch<{ notifications: UserNotification[]; count: number }>(
    `/api/worker/notifications?${q}`,
  );
}

export type MyCompletionStats = {
  credentials_verified: number;
  training_completed: number;
};

export type MyCompletionStatus = {
  onboarding_completed: boolean;
  onboarding_completed_seen_at: string | null;
  stats: MyCompletionStats;
};

/** Fires once when a worker reaches Active (cleared Credentials and Training) —
 * the mobile mirror of the web app's OnboardingCompleteGate. */
export function getMyCompletionStatus() {
  return workerFetch<MyCompletionStatus>("/api/onboarding/me/completion-status");
}

export function markMyCompletionSeen() {
  return workerFetch<{ onboarding_completed_seen_at: string | null }>(
    "/api/onboarding/me/completion-seen",
    { method: "POST" },
  );
}

export function markNotificationRead(id: string) {
  return workerFetch<{ ok: boolean }>(`/api/worker/notifications/${id}/read`, {
    method: "POST",
  });
}

export function dismissNotification(id: string) {
  return workerFetch<{ ok: boolean }>(`/api/worker/notifications/${id}/dismiss`, {
    method: "POST",
  });
}

export function getWorkerComplianceDetail(days: 7 | 30 = 7) {
  return workerFetch<WorkerComplianceDetail>(`/api/worker/compliance-detail?days=${days}`);
}

export function recordShiftViewed(shiftId: string) {
  return workerFetch<{ ok: boolean }>(`/api/worker/notifications/shifts/${shiftId}/viewed`, {
    method: "POST",
  });
}
