import { useState, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { formatAppDate, formatAppTimeWithZone } from "@/lib/datetime";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Notice, PageHeader, ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import {
  ChoiceCard,
  Field,
  PanelFooter,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  inputClass,
  textareaClass,
} from "@/pages/md/vault/components/PanelKit";
import { formatNotificationCountdown } from "@/components/incidents/IncidentAccordionCard";
import {
  ArrowLeft,
  Shield,
  Siren,
  Clock,
  CheckCircle2,
  XCircle,
  FileWarning,
  ClipboardList,
  Loader2,
  Calendar,
  User,
  Sparkles,
  History,
  ShieldAlert,
  UserX,
  Plus,
  UserSearch,
  GraduationCap,
  Check,
  Copy,
  FileText,
  BookOpen,
  ArrowUpCircle,
  type LucideIcon,
} from "lucide-react";
import {
  getIncident,
  updateIncident,
  getSimilarIncidentPatterns,
  overrideIncidentReportable,
  createSubjectOfAllegation,
  listSubjectOfAllegation,
  assignIncidentInvestigator,
  createIncidentInterview,
  listIncidentInterviews,
} from "@/services/incidentService";
import type {
  SimilarIncidentPatternsResult,
  WitnessItem,
  SubjectOfAllegationRecord,
  InterviewRecord,
} from "@/services/incidentService";
import { getCoordinatorTeam, getTrainingModules, createTrainingModule, assignTraining } from "@/services/coordinatorService";
import type { TeamMember, TrainingModule } from "@/services/coordinatorService";
import { useReAuth } from "@/hooks/useReAuth";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";

const SEVERITY_TONE: Record<string, string> = {
  low: "var(--cc-green)",
  medium: "var(--cc-amber)",
  high: "var(--cc-status-danger)",
  critical: "var(--cc-status-critical)",
};

/** The path every incident takes, shown as a tracker at the top of the record. */
const STAGES = ["reported", "under_investigation", "resolved", "closed"] as const;

const INCIDENT_TYPE_KEYS: Record<string, string> = {
  injury: "incidents.type.injury",
  medication_error: "incidents.type.medicationError",
  behaviour_of_concern: "incidents.type.behaviourOfConcern",
  property_damage: "incidents.type.propertyDamage",
  abuse_neglect: "incidents.type.abuseNeglect",
  restrictive_practice: "incidents.type.restrictivePractice",
  environmental: "incidents.type.environmental",
  elopement: "incidents.type.elopement",
  near_miss: "incidents.type.nearMiss",
  other: "incidents.type.other",
};

function severityLabel(value: string, translate: (key: string) => string) {
  return translate(`incidents.severity.${value}`);
}

function statusLabel(value: string, translate: (key: string) => string) {
  const map: Record<string, string> = {
    reported: "incidents.status.reported",
    under_investigation: "incidents.status.underInvestigation",
    resolved: "incidents.status.resolved",
    closed: "incidents.status.closed",
  };
  return translate(map[value] ?? "incidents.status.reported");
}

function incidentTypeLabel(type: string, translate: (key: string) => string) {
  const key = INCIDENT_TYPE_KEYS[type];
  return key ? translate(key) : type;
}

function fmtDateTime(iso?: string, tz?: string | null) {
  return iso ? `${formatAppDate(iso, tz)}, ${formatAppTimeWithZone(iso, tz)}` : "Not recorded";
}

/** Assembles NDIS Commission notification content from the incident record's existing
 * fields — deterministic, no AI call, so it's reliable and reviewable/editable before
 * submission. Coordinators can freely edit the result before marking as reported. */
function buildNotificationContent(
  incident: Incident,
  investigatorName: string | undefined,
  translate: (key: string) => string,
): string {
  const witnesses = incident.witnesses_structured?.length
    ? incident.witnesses_structured
        .map((w) => [w.name, w.relationship, w.contact].filter(Boolean).join(" — "))
        .join("\n")
    : incident.witnesses || "None recorded";

  const lines = [
    "NDIS REPORTABLE INCIDENT NOTIFICATION",
    "",
    `Reference: ${incident.reference_number || incident.id.slice(0, 8).toUpperCase()}`,
    `Participant: ${incident.participant_name || "Not recorded"}${incident.participant_ndis ? ` (NDIS: ${incident.participant_ndis})` : ""}`,
    `NDIS Practice Standard: ${incident.practice_standard || "Not classified"}`,
    `Severity: ${severityLabel(incident.severity, translate)}`,
    "",
    "INCIDENT DETAILS",
    `Date/time of incident: ${fmtDateTime(incident.incident_date, incident.timezone)}`,
    ...(incident.identified_at ? [`Date/time identified: ${fmtDateTime(incident.identified_at, incident.timezone)}`] : []),
    `Location: ${incident.location || "Not recorded"}${incident.location_type ? ` (${translate(`incidents.locationType.${incident.location_type}`)})` : ""}`,
    `Type: ${incidentTypeLabel(incident.incident_type, translate)}`,
    "",
    "DESCRIPTION",
    incident.description || "Not recorded",
    "",
    "PARTICIPANT IMPACT",
    incident.participant_impact || "Not recorded",
    "",
    "IMMEDIATE ACTIONS TAKEN",
    incident.worker_actions || "Not recorded",
    "",
    ...(incident.connection_to_service !== undefined && incident.connection_to_service !== null
      ? [
          "CONNECTION TO SERVICE PROVISION",
          `${incident.connection_to_service ? "Yes" : "No"}${incident.connection_to_service_reasoning ? ` — ${incident.connection_to_service_reasoning}` : ""}`,
          "",
        ]
      : []),
    "WITNESSES",
    witnesses,
    "",
    "INVESTIGATION STATUS",
    `Status: ${statusLabel(incident.status, translate)}`,
    `Assigned investigator: ${investigatorName || "Not yet assigned"}`,
    incident.investigation_notes ? `Investigation notes: ${incident.investigation_notes}` : "Investigation notes: Not yet recorded",
    "",
    "CORRECTIVE ACTIONS",
    incident.corrective_actions || "Not yet recorded",
  ];
  return lines.join("\n");
}

interface Incident {
  id: string;
  title: string;
  description: string;
  incident_type: string;
  severity: string;
  status: string;
  incident_date: string;
  reported_date: string;
  resolved_date?: string;
  location?: string;
  witnesses?: string;
  ndis_reportable: boolean;
  ndis_reported_at?: string;
  ndis_pending: boolean;
  overdue: boolean;
  practice_standard?: string;
  participant_id?: string;
  participant_name?: string;
  participant_ndis?: string;
  participant_impact?: string;
  worker_actions?: string;
  investigation_notes?: string;
  corrective_actions?: string;
  follow_up_required?: boolean;
  follow_up_date?: string;
  identified_at?: string;
  location_type?: string;
  witnesses_structured?: WitnessItem[];
  connection_to_service?: boolean;
  connection_to_service_reasoning?: string;
  ndis_reportable_override?: boolean;
  ndis_reportable_override_reason?: string;
  ndis_reportable_override_at?: string;
  notification_due_at?: string | null;
  assigned_investigator_id?: string;
  assigned_investigator_at?: string;
  created_by?: string;
  reference_number?: string;
  ndis_notification_content?: string;
  user_id?: string;
  worker_name?: string;
  pending_fields?: string[];
  pending_deadline_at?: string;
  /** Participant's branch zone. */
  timezone?: string | null;
}

const SUBJECT_TYPES = ["worker", "participant", "other"] as const;

export default function IncidentDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const queryClient = useQueryClient();
  const { requireReAuth, modal } = useReAuth();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: incident, isLoading } = useOrgQuery<Incident>(["incident", id], {
    queryFn: () => getIncident<Incident>(id),
  });

  const { data: patternData, isLoading: patternsLoading } = useOrgQuery<SimilarIncidentPatternsResult>(
    ["incident-patterns", id],
    {
      queryFn: () => getSimilarIncidentPatterns(id),
      enabled: !!incident,
      staleTime: 5 * 60 * 1000,
    },
  );

  const showPatternsPanel =
    patternData?.sufficient_context === true && (patternData.matches?.length ?? 0) > 0;

  const { data: subjectData } = useOrgQuery<{ records: SubjectOfAllegationRecord[] }>(
    ["incident-subjects", id],
    {
      queryFn: () => listSubjectOfAllegation(id),
      enabled: !!incident,
    },
  );

  const { data: interviewData } = useOrgQuery<{ records: InterviewRecord[] }>(
    ["incident-interviews", id],
    {
      queryFn: () => listIncidentInterviews(id),
      enabled: !!incident,
    },
  );

  const { data: team } = useOrgQuery<TeamMember[]>(["coordinator-team"], {
    queryFn: () => getCoordinatorTeam(),
    enabled: !!incident,
  });

  const [investigationNotes, setInvestigationNotes] = useState("");
  const [correctiveActions, setCorrectiveActions] = useState("");
  const [pendingDraft, setPendingDraft] = useState<Record<string, string>>({});
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideValue, setOverrideValue] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [subjectType, setSubjectType] = useState<(typeof SUBJECT_TYPES)[number]>("worker");
  const [subjectName, setSubjectName] = useState("");
  const [subjectRole, setSubjectRole] = useState("");
  const [subjectNotes, setSubjectNotes] = useState("");
  const [selectedInvestigator, setSelectedInvestigator] = useState("");
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewType, setInterviewType] = useState<"worker" | "participant" | "witness" | "other">("worker");
  const [interviewName, setInterviewName] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyContent, setNotifyContent] = useState("");
  const [submittedOpen, setSubmittedOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [trainingWorkerId, setTrainingWorkerId] = useState("");
  const [trainingMode, setTrainingMode] = useState<"existing" | "new">("existing");
  const [trainingModuleId, setTrainingModuleId] = useState("");
  const [trainingNewTitle, setTrainingNewTitle] = useState("");
  const [trainingNewDescription, setTrainingNewDescription] = useState("");

  const { data: trainingModules } = useOrgQuery<TrainingModule[]>(["training-modules"], {
    queryFn: () => getTrainingModules(),
    enabled: trainingOpen,
  });

  const subjectUserIds = new Set((subjectData?.records ?? []).map((s) => s.subject_user_id).filter(Boolean));
  const eligibleInvestigators = (team ?? []).filter(
    (m) => m.id !== incident?.created_by && !subjectUserIds.has(m.id),
  );

  useEffect(() => {
    if (incident) {
      setInvestigationNotes(incident.investigation_notes ?? "");
      setCorrectiveActions(incident.corrective_actions ?? "");
      const draft: Record<string, string> = {};
      for (const f of incident.pending_fields ?? []) {
        draft[f] = (incident as unknown as Record<string, string>)[f] === "[Pending — to be completed]"
          ? ""
          : (incident as unknown as Record<string, string>)[f] ?? "";
      }
      setPendingDraft(draft);
    }
  }, [incident]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const statusChange = typeof updates.status === "string";
      const closesOrReports = statusChange && ["closed", "resolved", "reported"].includes(updates.status as string);
      const ndisReport = typeof updates.ndis_reported_at === "string";
      if (closesOrReports || ndisReport) {
        return requireReAuth(() => updateIncident(id, updates));
      }
      return updateIncident(id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "incident", id] });
      queryClient.invalidateQueries({ queryKey: [orgId, "incidents"] });
      queryClient.invalidateQueries({ queryKey: [orgId, "incident-stats"] });
      toast({ title: translate("incidents.detail.updated") });
    },
    onError: () => toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" }),
  });

  // Raises the incident to critical and alerts the office team.
  const escalateMutation = useMutation({
    mutationFn: () => updateIncident(id, { escalate: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "incident", id] });
      queryClient.invalidateQueries({ queryKey: [orgId, "incidents"] });
      queryClient.invalidateQueries({ queryKey: [orgId, "incident-stats"] });
      toast({ title: "Incident escalated", description: "It's now critical and the office team has been alerted." });
    },
    onError: () => toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: (payload: { is_reportable: boolean; reason: string }) =>
      requireReAuth(() => overrideIncidentReportable(id, payload)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "incident", id] });
      queryClient.invalidateQueries({ queryKey: [orgId, "incidents"] });
      toast({ title: translate("incidents.detail.overrideSuccess") });
      setOverrideOpen(false);
      setOverrideReason("");
    },
    onError: () => toast({ title: translate("incidents.detail.overrideFailed"), variant: "destructive" }),
  });

  const subjectMutation = useMutation({
    mutationFn: () =>
      createSubjectOfAllegation(id, {
        subject_type: subjectType,
        subject_name: subjectName || undefined,
        subject_role: subjectRole || undefined,
        notes: subjectNotes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "incident-subjects", id] });
      setSubjectOpen(false);
      setSubjectName("");
      setSubjectRole("");
      setSubjectNotes("");
      setSubjectType("worker");
    },
    onError: () => toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" }),
  });

  const assignInvestigatorMutation = useMutation({
    mutationFn: (investigatorUserId: string) => assignIncidentInvestigator(id, investigatorUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "incident", id] });
      toast({ title: translate("incidents.detail.assignedInvestigator") });
      setSelectedInvestigator("");
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : translate("incidents.detail.assignInvestigatorFailed");
      toast({ title: translate("incidents.detail.assignInvestigatorFailed"), description: message, variant: "destructive" });
    },
  });

  const addInterviewMutation = useMutation({
    mutationFn: () =>
      createIncidentInterview(id, {
        interviewee_name: interviewName,
        interviewee_type: interviewType,
        notes: interviewNotes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "incident-interviews", id] });
      setInterviewOpen(false);
      setInterviewName("");
      setInterviewNotes("");
      setInterviewType("worker");
    },
    onError: () => toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" }),
  });

  const assignTrainingMutation = useMutation({
    mutationFn: ({ moduleId, title }: { moduleId: string; title: string }) =>
      assignTraining(trainingWorkerId, moduleId, title, id),
    onSuccess: () => {
      toast({ title: translate("incidents.detail.trainingAssigned") });
      setTrainingOpen(false);
      setTrainingModuleId("");
      setTrainingNewTitle("");
      setTrainingNewDescription("");
      setTrainingMode("existing");
    },
    onError: () => toast({ title: translate("incidents.detail.trainingAssignFailed"), variant: "destructive" }),
  });

  const createModuleMutation = useMutation({
    mutationFn: () =>
      createTrainingModule({ title: trainingNewTitle.trim(), description: trainingNewDescription.trim() || undefined }),
    onSuccess: (mod: TrainingModule) => {
      queryClient.invalidateQueries({ queryKey: [orgId, "training-modules"] });
      assignTrainingMutation.mutate({ moduleId: mod.id, title: mod.title });
    },
    onError: () => toast({ title: translate("incidents.detail.trainingAssignFailed"), variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pb-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="w-full text-center py-20 text-cc-text">
        {translate("incidents.detail.notFound")}{" "}
        <button onClick={() => navigate("/incidents")} className="underline text-cc-plum">
          {translate("incidents.detail.backToIncidents")}
        </button>
      </div>
    );
  }

  const canInvestigate = incident.status === "reported";
  const canResolve = incident.status === "under_investigation";
  const canClose = incident.status === "resolved";

  function handleStatusChange(newStatus: string) {
    updateMutation.mutate({ status: newStatus });
  }

  const ref = incident.reference_number || incident.id.slice(0, 8).toUpperCase();
  const investigatorName = (team ?? []).find((m) => m.id === incident.assigned_investigator_id)?.full_name;
  const stageIndex = STAGES.indexOf(incident.status as (typeof STAGES)[number]);
  const dueText = incident.ndis_pending && incident.notification_due_at
    ? formatNotificationCountdown(incident.notification_due_at, incident.overdue)
    : null;

  function openNotification() {
    setNotifyContent(incident!.ndis_notification_content || buildNotificationContent(incident!, investigatorName, translate));
    setNotifyOpen(true);
  }

  // The one next step for this incident, shown as the main button.
  const nextStep = canInvestigate
    ? { label: translate("incidents.detail.startInvestigation"), icon: FileWarning, status: "under_investigation" }
    : canResolve
      ? { label: translate("incidents.detail.markResolved"), icon: CheckCircle2, status: "resolved" }
      : canClose
        ? { label: translate("incidents.detail.closeIncident"), icon: XCircle, status: "closed" }
        : null;

  const details: [string, ReactNode][] = [
    [translate("incidents.detail.incidentDate"), incident.incident_date ? fmtDateTime(incident.incident_date, incident.timezone) : "Not recorded"],
    [translate("incidents.detail.type"), incidentTypeLabel(incident.incident_type, translate)],
    ...(incident.location ? [[translate("incidents.detail.location"), incident.location] as [string, ReactNode]] : []),
    ...(incident.location_type ? [[translate("incidents.detail.locationType"), translate(`incidents.locationType.${incident.location_type}`)] as [string, ReactNode]] : []),
    ...(incident.identified_at ? [[translate("incidents.detail.identifiedAt"), fmtDateTime(incident.identified_at, incident.timezone)] as [string, ReactNode]] : []),
    ...(incident.worker_name ? [["Reported by", incident.worker_name] as [string, ReactNode]] : []),
    ...(incident.practice_standard ? [[translate("incidents.detail.ndisPracticeStandard"), incident.practice_standard] as [string, ReactNode]] : []),
    [translate("incidents.register.ndisReportable"), incident.ndis_reportable ? translate("common.yes") : translate("common.no")],
    ...(incident.ndis_reportable_override !== undefined && incident.ndis_reportable_override !== null
      ? [[translate("incidents.detail.overrideOverridden"), `${incident.ndis_reportable_override ? translate("common.yes") : translate("common.no")}${incident.ndis_reportable_override_reason ? `. ${incident.ndis_reportable_override_reason}` : ""}`] as [string, ReactNode]]
      : []),
    ...(incident.connection_to_service !== undefined && incident.connection_to_service !== null
      ? [[translate("incidents.detail.connectionToService"), `${incident.connection_to_service ? translate("common.yes") : translate("common.no")}${incident.connection_to_service_reasoning ? `. ${incident.connection_to_service_reasoning}` : ""}`] as [string, ReactNode]]
      : []),
  ];

  const history: { label: string; at?: string | null; tone?: "danger" | "good" }[] = [
    { label: translate("incidents.detail.incidentReported"), at: incident.reported_date },
    ...(incident.ndis_reportable ? [{ label: translate("incidents.detail.ndisReportableFlagged"), at: incident.reported_date, tone: "danger" as const }] : []),
    ...(incident.assigned_investigator_at ? [{ label: `${translate("incidents.detail.assignedInvestigator")}: ${investigatorName ?? ""}`.trim(), at: incident.assigned_investigator_at }] : []),
    ...(incident.ndis_reported_at ? [{ label: translate("incidents.detail.reportedToNdisQsc"), at: incident.ndis_reported_at, tone: "good" as const }] : []),
    ...(incident.resolved_date ? [{ label: translate("incidents.detail.incidentResolved"), at: incident.resolved_date, tone: "good" as const }] : []),
  ];

  return (
    <div className="space-y-6 pb-12">
      {modal}
      <PageHeader
        back={
          <button type="button" onClick={() => navigate("/incidents")} className={`${ghostClass} -ml-4`}>
            <ArrowLeft size={15} /> {translate("incidents.detail.breadcrumbParent")}
          </button>
        }
        eyebrow={`${ref} · ${incidentTypeLabel(incident.incident_type, translate)}`}
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: SEVERITY_TONE[incident.severity] ?? SEVERITY_TONE.medium }}>
              <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_TONE[incident.severity] ?? SEVERITY_TONE.medium }} aria-hidden />
              {severityLabel(incident.severity, translate)} severity
            </span>
            {incident.participant_name && (
              <span className="inline-flex items-center gap-1.5">
                <User size={14} />
                {incident.participant_id ? (
                  <button type="button" onClick={() => navigate(`/participants/${incident.participant_id}`)} className="underline-offset-4 hover:underline" style={{ color: TEXT }}>
                    {incident.participant_name}
                  </button>
                ) : (
                  <span style={{ color: TEXT }}>{incident.participant_name}</span>
                )}
                {incident.participant_ndis && <span>· NDIS {incident.participant_ndis}</span>}
              </span>
            )}
            {incident.incident_date && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} />
                {formatAppDate(incident.incident_date, incident.timezone)} ({formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })})
              </span>
            )}
          </span>
        }
        actions={
          <>
            {(incident.ndis_reportable_override === undefined || incident.ndis_reportable_override === null) && (
              <button
                type="button"
                onClick={() => {
                  setOverrideValue(!incident.ndis_reportable);
                  setOverrideOpen(true);
                }}
                className={ghostClass}
              >
                <ShieldAlert size={15} />
                {translate("incidents.detail.overrideClassification")}
              </button>
            )}
            {incident.severity !== "critical" && incident.status !== "resolved" && incident.status !== "closed" && (
              <button
                type="button"
                onClick={() => escalateMutation.mutate()}
                disabled={escalateMutation.isPending}
                className={ghostClass}
                style={{ color: "var(--cc-danger-text)" }}
                title="Raise to critical and alert the office team"
              >
                {escalateMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUpCircle size={15} />}
                Escalate
              </button>
            )}
            {nextStep && (
              <button
                type="button"
                onClick={() => handleStatusChange(nextStep.status)}
                disabled={updateMutation.isPending}
                className={nextStep.status === "closed" ? outlineClass : ctaClass}
              >
                {updateMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <nextStep.icon size={15} />}
                {nextStep.label}
              </button>
            )}
          </>
        }
      />

      {/* Where this incident is up to */}
      <ol className="flex items-center gap-2 overflow-x-auto rounded-2xl border px-5 py-4" style={{ borderColor: BORDER, background: SURFACE }} aria-label="Progress">
        {STAGES.map((stage, i) => {
          // Closed is the last stage, so reaching it means the work is done.
          const done = stageIndex > i || (stageIndex === i && stage === "closed");
          const current = stageIndex === i && !done;
          return (
            <li
              key={stage}
              className={`flex items-center gap-2 ${i < STAGES.length - 1 ? "min-w-[9rem] flex-1" : "shrink-0"}`}
              aria-current={current ? "step" : undefined}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={
                  done
                    ? { background: "var(--cc-green)", color: "#fff" }
                    : current
                      ? { background: PURPLE_SOFT, color: PURPLE, boxShadow: `inset 0 0 0 2px ${PURPLE}` }
                      : { boxShadow: `inset 0 0 0 1px ${BORDER}`, color: MUTED }
                }
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className="whitespace-nowrap text-sm" style={{ color: done || current ? TEXT : MUTED, fontWeight: current ? 600 : 400 }}>
                {statusLabel(stage, translate)}
              </span>
              {i < STAGES.length - 1 && <span aria-hidden className="h-px min-w-4 flex-1" style={{ background: done ? "var(--cc-green)" : BORDER }} />}
            </li>
          );
        })}
      </ol>

      {incident.ndis_pending && (
        <Notice
          tone="danger"
          icon={Siren}
          title={
            <>
              {translate("incidents.detail.ndisReportableTitle")}
              {dueText && <span style={{ color: "var(--cc-danger-text)" }}> · {dueText}</span>}
            </>
          }
          action={
            <button type="button" onClick={openNotification} className={`${ctaClass} w-full sm:w-auto`} style={{ background: "var(--cc-danger-text)" }}>
              <Siren size={15} /> {translate("incidents.detail.notifyPrepTitle")}
            </button>
          }
        >
          {translate("incidents.detail.ndisReportableBody")}
          {incident.severity === "critical" && ` ${translate("incidents.detail.ndisCritical24h")}`}
        </Notice>
      )}

      {incident.overdue && !incident.ndis_pending && (
        <Notice tone="warning" icon={Clock} title={translate("incidents.detail.overdueWarning")} />
      )}

      {(incident.pending_fields?.length ?? 0) > 0 && (
        <Card
          icon={Clock}
          title={translate("incidents.detail.pendingTitle")}
          description={
            incident.pending_deadline_at
              ? translate("incidents.detail.pendingDeadline").replace(
                  "{time}",
                  formatDistanceToNow(parseISO(incident.pending_deadline_at), { addSuffix: true }),
                )
              : translate("incidents.detail.pendingBody")
          }
        >
          <div className="space-y-4">
            {(incident.pending_fields ?? []).map((field) => (
              <Field key={field} label={translate(`incidents.detail.pendingField.${field}`)} htmlFor={`pending-${field}`}>
                <textarea
                  id={`pending-${field}`}
                  rows={3}
                  value={pendingDraft[field] ?? ""}
                  onChange={(e) => setPendingDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                  className={`resize-y ${textareaClass}`}
                  style={{ borderColor: BORDER, color: TEXT }}
                />
              </Field>
            ))}
            <div className="flex justify-end">
              <PrimaryButton
                disabled={(incident.pending_fields ?? []).some((f) => !(pendingDraft[f] ?? "").trim())}
                busy={updateMutation.isPending}
                onClick={() => {
                  const updates: Record<string, unknown> = { pending_fields: [] };
                  for (const f of incident.pending_fields ?? []) {
                    updates[f] = pendingDraft[f];
                  }
                  updateMutation.mutate(updates);
                }}
              >
                {translate("incidents.detail.pendingComplete")}
              </PrimaryButton>
            </div>
          </div>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 space-y-6">
          <Card icon={FileText} title={translate("incidents.detail.whatHappened")}>
            <div className="space-y-5">
              <p className="whitespace-pre-wrap text-sm leading-7" style={{ color: TEXT }}>{incident.description || "Not recorded"}</p>
              {incident.participant_impact && (
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: TEXT }}>{translate("incidents.detail.participantImpact")}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-7" style={{ color: TEXT }}>{incident.participant_impact}</p>
                </div>
              )}
              {incident.worker_actions && (
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: TEXT }}>{translate("incidents.detail.immediateActions")}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-7" style={{ color: TEXT }}>{incident.worker_actions}</p>
                </div>
              )}
              {(incident.witnesses_structured?.length || incident.witnesses) && (
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: TEXT }}>{translate("incidents.detail.witnesses")}</h3>
                  {incident.witnesses_structured?.length ? (
                    <ul className="mt-1 space-y-0.5 text-sm" style={{ color: TEXT }}>
                      {incident.witnesses_structured.map((w, i) => (
                        <li key={i}>
                          {w.name}
                          {w.relationship ? ` (${w.relationship})` : ""}
                          {w.contact ? `, ${w.contact}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm" style={{ color: TEXT }}>{incident.witnesses}</p>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card icon={ClipboardList} title={translate("incidents.detail.investigationCorrective")}>
            <div className="space-y-5">
              <Field label={translate("incidents.detail.investigationNotes")} htmlFor="incident-investigation-notes">
                <textarea
                  id="incident-investigation-notes"
                  rows={5}
                  value={investigationNotes}
                  onChange={(e) => setInvestigationNotes(e.target.value)}
                  placeholder={translate("incidents.detail.investigationNotesPlaceholder")}
                  className={`resize-y ${textareaClass}`}
                  style={{ borderColor: BORDER, color: TEXT }}
                />
              </Field>
              <Field label={translate("incidents.detail.correctiveActions")} htmlFor="incident-corrective-actions">
                <textarea
                  id="incident-corrective-actions"
                  rows={3}
                  value={correctiveActions}
                  onChange={(e) => setCorrectiveActions(e.target.value)}
                  placeholder={translate("incidents.detail.correctiveActionsPlaceholder")}
                  className={`resize-y ${textareaClass}`}
                  style={{ borderColor: BORDER, color: TEXT }}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SecondaryButton
                  onClick={() => {
                    setTrainingWorkerId(incident.user_id || incident.assigned_investigator_id || "");
                    setTrainingNewTitle(incident.title ? `Follow-up: ${incident.title}` : "");
                    setTrainingOpen(true);
                  }}
                >
                  <GraduationCap size={15} />
                  {translate("incidents.detail.assignTraining")}
                </SecondaryButton>
                <PrimaryButton
                  busy={updateMutation.isPending}
                  disabled={
                    investigationNotes === (incident.investigation_notes ?? "") &&
                    correctiveActions === (incident.corrective_actions ?? "")
                  }
                  onClick={() =>
                    updateMutation.mutate({
                      investigation_notes: investigationNotes,
                      corrective_actions: correctiveActions,
                    })
                  }
                >
                  {translate("incidents.detail.saveNotes")}
                </PrimaryButton>
              </div>
            </div>
          </Card>

          {(patternsLoading || showPatternsPanel) && (
            <Card icon={History} title={translate("incidents.detail.similarPastIncidents")} description={translate("incidents.detail.similarPastSubtitle")}>
              {patternsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              ) : showPatternsPanel && patternData ? (
                <div className="space-y-5">
                  {patternData.ai_summary && (
                    <div className="space-y-3 rounded-2xl p-4" style={{ background: PURPLE_SOFT }}>
                      <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: PURPLE }}>
                        <Sparkles size={15} /> {translate("incidents.detail.aiPatternAnalysis")}
                      </p>
                      {[
                        [translate("incidents.detail.patternRecognised"), patternData.ai_summary.pattern_recognised],
                        [translate("incidents.detail.pastStrategies"), patternData.ai_summary.past_strategies],
                        [translate("incidents.detail.recommendations"), patternData.ai_summary.recommendations],
                      ].map(([heading, body]) => (
                        <div key={heading}>
                          <p className="text-sm font-semibold" style={{ color: TEXT }}>{heading}</p>
                          <p className="mt-0.5 text-sm leading-6" style={{ color: TEXT }}>{body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <ul className="divide-y" style={{ borderColor: BORDER }}>
                    {patternData.matches.map((match) => (
                      <li key={match.incident_id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: MUTED }}>
                          <span>{match.date ? format(parseISO(match.date), "d MMM yyyy") : "Date not recorded"}</span>
                          <span>{match.participant_label}</span>
                          <span className="ml-auto font-semibold" style={{ color: PURPLE }}>
                            {translateParams("incidents.detail.matchPercent", { percent: String(Math.round(match.similarity_score * 100)) })}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6" style={{ color: TEXT }}>{match.excerpt}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card icon={Calendar} title={translate("incidents.register.details")}>
            <dl className="space-y-3 text-sm">
              {details.map(([term, value]) => (
                <div key={term} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
                  <dt style={{ color: MUTED }}>{term}</dt>
                  <dd className="font-medium" style={{ color: TEXT }}>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card icon={UserSearch} title={translate("incidents.detail.investigation")} description={translate("incidents.detail.investigationSubtitle")}>
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium" style={{ color: TEXT }}>{translate("incidents.detail.assignedInvestigator")}</p>
                {incident.assigned_investigator_id ? (
                  <p className="flex items-center gap-1.5 text-sm" style={{ color: TEXT }}>
                    <CheckCircle2 size={15} style={{ color: "var(--cc-green)" }} />
                    {investigatorName ?? incident.assigned_investigator_id}
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: MUTED }}>{translate("incidents.detail.noInvestigatorAssigned")}</p>
                )}
                <div className="flex gap-2">
                  <Select value={selectedInvestigator} onValueChange={setSelectedInvestigator}>
                    <SelectTrigger className="h-10 flex-1 rounded-full px-4 text-sm" style={{ borderColor: BORDER }}>
                      <SelectValue placeholder={translate("incidents.detail.selectInvestigator")} />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleInvestigators.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs" style={{ color: MUTED }}>{translate("incidents.detail.investigatorNoOptions")}</div>
                      ) : (
                        eligibleInvestigators.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => assignInvestigatorMutation.mutate(selectedInvestigator)}
                    disabled={!selectedInvestigator || assignInvestigatorMutation.isPending}
                    className={outlineClass}
                  >
                    {assignInvestigatorMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                    {incident.assigned_investigator_id ? "Change" : "Assign"}
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t pt-4" style={{ borderColor: BORDER }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{translate("incidents.detail.interviews")}</p>
                  <button type="button" onClick={() => setInterviewOpen(true)} className={`${ghostClass} min-h-9 px-3`}>
                    <Plus size={14} /> {translate("incidents.detail.addInterview")}
                  </button>
                </div>
                {interviewData?.records && interviewData.records.length > 0 ? (
                  <ul className="divide-y" style={{ borderColor: BORDER }}>
                    {interviewData.records.map((iv) => (
                      <li key={iv.id} className="py-2.5 text-sm first:pt-0">
                        <p className="flex items-center justify-between gap-2">
                          <span className="font-medium" style={{ color: TEXT }}>{iv.interviewee_name}</span>
                          <span className="text-xs" style={{ color: MUTED }}>{translate(`incidents.interviewType.${iv.interviewee_type}`)}</span>
                        </p>
                        {iv.interviewed_at && <p className="text-xs" style={{ color: MUTED }}>{fmtDateTime(iv.interviewed_at, incident.timezone)}</p>}
                        {iv.notes && <p className="mt-1" style={{ color: TEXT }}>{iv.notes}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm" style={{ color: MUTED }}>{translate("incidents.detail.noInterviews")}</p>
                )}
              </div>
            </div>
          </Card>

          <Card
            icon={UserX}
            title={translate("incidents.detail.subjectOfAllegation")}
            description={translate("incidents.detail.subjectOfAllegationSubtitle")}
            action={
              <button type="button" onClick={() => setSubjectOpen(true)} className={`${ghostClass} min-h-9 px-3`}>
                <Plus size={14} /> {translate("incidents.detail.addSubject")}
              </button>
            }
          >
            {subjectData?.records && subjectData.records.length > 0 ? (
              <ul className="divide-y" style={{ borderColor: BORDER }}>
                {subjectData.records.map((s) => (
                  <li key={s.id} className="py-2.5 text-sm first:pt-0">
                    <p className="flex items-center justify-between gap-2">
                      <span className="font-medium" style={{ color: TEXT }}>{s.subject_name || translate(`incidents.subjectType.${s.subject_type}`)}</span>
                      <span className="text-xs" style={{ color: MUTED }}>{translate(`incidents.subjectType.${s.subject_type}`)}</span>
                    </p>
                    {s.subject_role && <p className="text-xs" style={{ color: MUTED }}>{s.subject_role}</p>}
                    {s.notes && <p className="mt-1" style={{ color: TEXT }}>{s.notes}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: MUTED }}>{translate("incidents.detail.noSubjects")}</p>
            )}
          </Card>

          <Card icon={Shield} title={translate("incidents.detail.auditTrail")}>
            <ol className="space-y-3">
              {history.map((item, i) => (
                <li key={`${item.label}-${i}`} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: item.tone === "danger" ? "var(--cc-danger-text)" : item.tone === "good" ? "var(--cc-green)" : PURPLE }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: TEXT }}>{item.label}</p>
                    <p className="text-xs" style={{ color: MUTED }}>{item.at ? fmtDateTime(item.at, incident.timezone) : "Not recorded"}</p>
                  </div>
                </li>
              ))}
            </ol>
            {incident.ndis_notification_content && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: BORDER }}>
                <button
                  type="button"
                  onClick={() => setSubmittedOpen((v) => !v)}
                  aria-expanded={submittedOpen}
                  className="text-sm font-semibold underline-offset-4 hover:underline"
                  style={{ color: PURPLE }}
                >
                  {translate("incidents.detail.viewSubmittedNotification")}
                </button>
                {submittedOpen && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl p-3 font-mono text-xs" style={{ background: SOFT, color: TEXT }}>
                    {incident.ndis_notification_content}
                  </pre>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Side panels ─────────────────────────────────────────────── */}
      <Sheet open={notifyOpen} onOpenChange={setNotifyOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-2xl">
          <SheetTitle className="sr-only">{translate("incidents.detail.notifyPrepTitle")}</SheetTitle>
          <SheetDescription className="sr-only">{translate("incidents.detail.notifyPrepSubtitle")}</SheetDescription>
          <PanelHeader icon={Siren} tone="danger" title={translate("incidents.detail.notifyPrepTitle")} description={translate("incidents.detail.notifyPrepSubtitle")} />
          <div className="mt-6 flex-1">
            <textarea
              aria-label={translate("incidents.detail.notifyPrepTitle")}
              rows={20}
              value={notifyContent}
              onChange={(e) => setNotifyContent(e.target.value)}
              className={`resize-y font-mono text-xs ${textareaClass}`}
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </div>
          <PanelFooter>
            <SecondaryButton
              onClick={() => {
                navigator.clipboard?.writeText(notifyContent).catch(() => {});
                toast({ title: translate("incidents.detail.copiedToClipboard") });
              }}
            >
              <Copy size={15} /> {translate("incidents.detail.copyToClipboard")}
            </SecondaryButton>
            <PrimaryButton
              tone="danger"
              busy={updateMutation.isPending}
              onClick={() =>
                updateMutation.mutate(
                  { ndis_reported_at: new Date().toISOString(), ndis_notification_content: notifyContent },
                  { onSuccess: () => setNotifyOpen(false) },
                )
              }
            >
              {translate("incidents.detail.markReported")}
            </PrimaryButton>
          </PanelFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={overrideOpen} onOpenChange={setOverrideOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetTitle className="sr-only">{translate("incidents.detail.overrideTitle")}</SheetTitle>
          <SheetDescription className="sr-only">{translate("incidents.detail.overrideReasonPlaceholder")}</SheetDescription>
          <PanelHeader icon={ShieldAlert} title={translate("incidents.detail.overrideTitle")} description={translate("incidents.detail.overrideReasonPlaceholder")} />
          <div className="mt-6 flex-1 space-y-5">
            <div role="radiogroup" aria-label={translate("incidents.detail.ndisReportableFlagged")} className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard selected={overrideValue} onSelect={() => setOverrideValue(true)} icon={Siren} title="Reportable" description="The Commission must be notified." />
              <ChoiceCard selected={!overrideValue} onSelect={() => setOverrideValue(false)} icon={CheckCircle2} title="Not reportable" description="Handled within the organisation." />
            </div>
            <Field label={translate("incidents.detail.overrideReason")} htmlFor="incident-override-reason">
              <textarea
                id="incident-override-reason"
                rows={4}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className={`resize-y ${textareaClass}`}
                style={{ borderColor: BORDER, color: TEXT }}
              />
            </Field>
          </div>
          <PanelFooter>
            <SecondaryButton onClick={() => setOverrideOpen(false)}>{translate("incidents.detail.overrideCancel")}</SecondaryButton>
            <PrimaryButton
              busy={overrideMutation.isPending}
              disabled={!overrideReason.trim()}
              onClick={() => overrideMutation.mutate({ is_reportable: overrideValue, reason: overrideReason })}
            >
              {translate("incidents.detail.overrideSubmit")}
            </PrimaryButton>
          </PanelFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={trainingOpen} onOpenChange={setTrainingOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetTitle className="sr-only">{translate("incidents.detail.assignTraining")}</SheetTitle>
          <SheetDescription className="sr-only">{incident.title}</SheetDescription>
          <PanelHeader icon={GraduationCap} title={translate("incidents.detail.assignTraining")} description={`Follow-up training after "${incident.title}".`} />
          <div className="mt-6 flex-1 space-y-5">
            <Field label={translate("incidents.detail.trainingWorker")} htmlFor="incident-training-worker">
              <Select value={trainingWorkerId} onValueChange={setTrainingWorkerId}>
                <SelectTrigger id="incident-training-worker" className="h-11 rounded-xl px-4 text-sm" style={{ borderColor: BORDER }}>
                  <SelectValue placeholder={translate("incidents.detail.selectInvestigator")} />
                </SelectTrigger>
                <SelectContent>
                  {(team ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div role="radiogroup" aria-label={translate("incidents.detail.trainingModule")} className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard selected={trainingMode === "existing"} onSelect={() => setTrainingMode("existing")} icon={BookOpen} title={translate("incidents.detail.trainingPickExisting")} />
              <ChoiceCard selected={trainingMode === "new"} onSelect={() => setTrainingMode("new")} icon={Plus} title={translate("incidents.detail.trainingCreateNew")} />
            </div>
            {trainingMode === "existing" ? (
              <Field label={translate("incidents.detail.trainingModule")} htmlFor="incident-training-module">
                <Select value={trainingModuleId} onValueChange={setTrainingModuleId}>
                  <SelectTrigger id="incident-training-module" className="h-11 rounded-xl px-4 text-sm" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder={translate("incidents.detail.trainingChooseModule")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(trainingModules ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <>
                <Field label={translate("incidents.detail.trainingModuleTitle")} htmlFor="incident-training-title">
                  <input id="incident-training-title" value={trainingNewTitle} onChange={(e) => setTrainingNewTitle(e.target.value)} className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
                </Field>
                <Field label={translate("incidents.detail.trainingModuleDescription")} htmlFor="incident-training-description" optional>
                  <input id="incident-training-description" value={trainingNewDescription} onChange={(e) => setTrainingNewDescription(e.target.value)} className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
                </Field>
              </>
            )}
          </div>
          <PanelFooter>
            <SecondaryButton onClick={() => setTrainingOpen(false)}>{translate("incidents.detail.overrideCancel")}</SecondaryButton>
            <PrimaryButton
              busy={assignTrainingMutation.isPending || createModuleMutation.isPending}
              disabled={!trainingWorkerId || (trainingMode === "existing" ? !trainingModuleId : !trainingNewTitle.trim())}
              onClick={() => {
                if (trainingMode === "new") {
                  createModuleMutation.mutate();
                } else {
                  const mod = (trainingModules ?? []).find((m) => m.id === trainingModuleId);
                  if (mod) assignTrainingMutation.mutate({ moduleId: mod.id, title: mod.title });
                }
              }}
            >
              {translate("incidents.detail.assignTraining")}
            </PrimaryButton>
          </PanelFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={interviewOpen} onOpenChange={setInterviewOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetTitle className="sr-only">{translate("incidents.detail.addInterview")}</SheetTitle>
          <SheetDescription className="sr-only">{translate("incidents.detail.interviewsSubtitle")}</SheetDescription>
          <PanelHeader icon={UserSearch} title={translate("incidents.detail.addInterview")} description={translate("incidents.detail.interviewsSubtitle")} />
          <div className="mt-6 flex-1 space-y-5">
            <Field label={translate("incidents.detail.subjectType")}>
              <PillGroup
                label={translate("incidents.detail.subjectType")}
                value={interviewType}
                onChange={(v) => setInterviewType(v as typeof interviewType)}
                options={(["worker", "participant", "witness", "other"] as const).map((t) => ({ value: t, label: translate(`incidents.interviewType.${t}`) }))}
              />
            </Field>
            <Field label={translate("incidents.detail.subjectName")} htmlFor="incident-interview-name">
              <input id="incident-interview-name" value={interviewName} onChange={(e) => setInterviewName(e.target.value)} className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
            <Field label={translate("incidents.detail.interviewNotes")} htmlFor="incident-interview-notes" optional>
              <textarea id="incident-interview-notes" rows={5} value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} className={`resize-y ${textareaClass}`} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
          </div>
          <PanelFooter>
            <SecondaryButton onClick={() => setInterviewOpen(false)}>{translate("incidents.detail.overrideCancel")}</SecondaryButton>
            <PrimaryButton busy={addInterviewMutation.isPending} disabled={!interviewName.trim()} onClick={() => addInterviewMutation.mutate()}>
              {translate("incidents.detail.addInterview")}
            </PrimaryButton>
          </PanelFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={subjectOpen} onOpenChange={setSubjectOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetTitle className="sr-only">{translate("incidents.detail.addSubject")}</SheetTitle>
          <SheetDescription className="sr-only">{translate("incidents.detail.subjectOfAllegationSubtitle")}</SheetDescription>
          <PanelHeader icon={UserX} title={translate("incidents.detail.addSubject")} description={translate("incidents.detail.subjectOfAllegationSubtitle")} />
          <div className="mt-6 flex-1 space-y-5">
            <Field label={translate("incidents.detail.subjectType")}>
              <PillGroup
                label={translate("incidents.detail.subjectType")}
                value={subjectType}
                onChange={(v) => setSubjectType(v as (typeof SUBJECT_TYPES)[number])}
                options={SUBJECT_TYPES.map((t) => ({ value: t, label: translate(`incidents.subjectType.${t}`) }))}
              />
            </Field>
            <Field label={translate("incidents.detail.subjectName")} htmlFor="incident-subject-name" optional>
              <input id="incident-subject-name" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
            <Field label={translate("incidents.detail.subjectRole")} htmlFor="incident-subject-role" optional>
              <input id="incident-subject-role" value={subjectRole} onChange={(e) => setSubjectRole(e.target.value)} className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
            <Field label={translate("incidents.detail.subjectNotes")} htmlFor="incident-subject-notes" optional>
              <textarea id="incident-subject-notes" rows={4} value={subjectNotes} onChange={(e) => setSubjectNotes(e.target.value)} className={`resize-y ${textareaClass}`} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
          </div>
          <PanelFooter>
            <SecondaryButton onClick={() => setSubjectOpen(false)}>{translate("incidents.detail.overrideCancel")}</SecondaryButton>
            <PrimaryButton busy={subjectMutation.isPending} onClick={() => subjectMutation.mutate()}>
              {translate("incidents.detail.addSubject")}
            </PrimaryButton>
          </PanelFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** A titled white card on the incident page. */
function Card({
  icon: Icon, title, description, action, children,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }} aria-label={title}>
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: BORDER }}>
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon size={17} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
            {description && <p className="mt-0.5 text-sm leading-6" style={{ color: MUTED }}>{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** One answer from a few, as pills. */
function PillGroup({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
            style={{
              borderColor: selected ? PURPLE : BORDER,
              background: selected ? PURPLE_SOFT : undefined,
              color: selected ? PURPLE : TEXT,
            }}
          >
            {selected && <Check size={14} strokeWidth={3} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
