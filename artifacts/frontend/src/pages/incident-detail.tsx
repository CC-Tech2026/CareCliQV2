import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { formatAppDate, formatAppTimeWithZone } from "@/lib/datetime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
  MapPin,
  Users,
  User,
  Sparkles,
  History,
  ShieldAlert,
  UserX,
  Plus,
  UserSearch,
  GraduationCap,
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

const SEVERITY_COLORS: Record<string, string> = {
  low: "cc-status-success border",
  medium: "cc-status-warning border",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-[var(--cc-status-danger-bg)] text-[var(--cc-status-danger)] border-[var(--cc-border)]",
};

const STATUS_COLORS: Record<string, string> = {
  reported: "cc-status-info border",
  under_investigation: "cc-status-warning border",
  resolved: "cc-status-success border",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
};

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

  const sevColor = SEVERITY_COLORS[incident.severity] ?? SEVERITY_COLORS.medium;
  const stColor = STATUS_COLORS[incident.status] ?? STATUS_COLORS.reported;
  const canInvestigate = incident.status === "reported";
  const canResolve = incident.status === "under_investigation";
  const canClose = incident.status === "resolved";

  function handleStatusChange(newStatus: string) {
    updateMutation.mutate({ status: newStatus });
  }

  return (
    <div className="space-y-6 pb-10">
      {modal}
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/incidents")}
          className="flex items-center gap-1.5 text-cc-muted transition-opacity hover:opacity-70"
        >
          <ArrowLeft size={14} /> {translate("incidents.detail.breadcrumbParent")}
        </button>
        <span className="text-cc-muted/60">/</span>
        <span className="font-medium truncate max-w-[260px] text-cc-text">{incident.title}</span>
      </div>

      {/* NDIS urgent banner */}
      {incident.ndis_pending && (
        <div
          className="flex items-start gap-3 rounded-2xl p-4 border"
          style={{ background: "var(--cc-status-danger-bg)", borderColor: "color-mix(in srgb, var(--cc-status-danger) 25%, transparent)" }}
        >
          <Siren size={18} className="shrink-0 mt-0.5" style={{ color: "var(--cc-status-danger)" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: "var(--cc-status-danger)" }}>{translate("incidents.detail.ndisReportableTitle")}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--cc-status-danger)" }}>
              {translate("incidents.detail.ndisReportableBody")}
              {incident.severity === "critical" && ` ${translate("incidents.detail.ndisCritical24h")}`}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              const investigatorName = (team ?? []).find((m) => m.id === incident.assigned_investigator_id)?.full_name;
              setNotifyContent(incident.ndis_notification_content || buildNotificationContent(incident, investigatorName, translate));
              setNotifyOpen(true);
            }}
            className="shrink-0 bg-red-600 hover:bg-red-700 text-white text-xs h-8 rounded-xl"
          >
            <CheckCircle2 size={12} className="mr-1.5" />
            {translate("incidents.detail.markReported")}
          </Button>
        </div>
      )}

      {incident.overdue && !incident.ndis_pending && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
          <Clock size={16} className="text-orange-600 shrink-0" />
          <p className="text-sm text-orange-800 font-medium">
            {translate("incidents.detail.overdueWarning")}
          </p>
        </div>
      )}

      {(incident.pending_fields?.length ?? 0) > 0 && (
        <div className="cc-surface-card">
          <div className="cc-card-header flex items-start gap-3">
            <Clock size={16} className="text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest cc-card-muted">
                {translate("incidents.detail.pendingTitle")}
              </p>
              <p className="text-[12px] cc-card-muted mt-0.5">
                {incident.pending_deadline_at
                  ? translate("incidents.detail.pendingDeadline").replace(
                      "{time}",
                      formatDistanceToNow(parseISO(incident.pending_deadline_at), { addSuffix: true })
                    )
                  : translate("incidents.detail.pendingBody")}
              </p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {(incident.pending_fields ?? []).map((field) => (
              <div key={field}>
                <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">
                  {translate(`incidents.detail.pendingField.${field}`)}
                </Label>
                <Textarea
                  rows={3}
                  value={pendingDraft[field] ?? ""}
                  onChange={(e) => setPendingDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="text-[13px] resize-none rounded-xl"
                />
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={(incident.pending_fields ?? []).some((f) => !(pendingDraft[f] ?? "").trim())}
                onClick={() => {
                  const updates: Record<string, unknown> = { pending_fields: [] };
                  for (const f of incident.pending_fields ?? []) {
                    updates[f] = pendingDraft[f];
                  }
                  updateMutation.mutate(updates);
                }}
                className="text-xs h-9 rounded-xl text-white"
                style={{ background: "var(--cc-cta)" }}
              >
                {translate("incidents.detail.pendingComplete")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 items-start">
      <div className="space-y-6">

      {/* Overview */}
      <div className="cc-surface-card lg:col-start-1">
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>{incident.title}</h1>
              {incident.participant_name && (
                <p className="text-[13px] mt-1 flex items-center gap-1.5 text-cc-text">
                  <User size={13} />
                  {incident.participant_name}
                  {incident.participant_ndis && (
                    <span style={{ color: "#7A6A8A" }}>� NDIS {incident.participant_ndis}</span>
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 items-end shrink-0">
              <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5", sevColor)}>
                {severityLabel(incident.severity, translate)}
              </Badge>
              <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5", stColor)}>
                {statusLabel(incident.status, translate)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* What happened */}
          <div className="pt-2 border-t border-cc-border">
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 text-cc-muted">{translate("incidents.detail.whatHappened")}</p>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-cc-text">{incident.description}</p>
          </div>

          {incident.participant_impact && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 text-cc-muted">{translate("incidents.detail.participantImpact")}</p>
              <p className="text-[13px] leading-relaxed text-cc-text">{incident.participant_impact}</p>
            </div>
          )}

          {incident.worker_actions && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 text-cc-muted">{translate("incidents.detail.immediateActions")}</p>
              <p className="text-[13px] leading-relaxed text-cc-text">{incident.worker_actions}</p>
            </div>
          )}

          {/* Workflow action buttons */}
          <div className="pt-3 border-t border-cc-border flex flex-wrap gap-2">
            {canInvestigate && (
              <Button
                size="sm"
                onClick={() => handleStatusChange("under_investigation")}
                disabled={updateMutation.isPending}
                className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl h-9 text-xs"
              >
                <FileWarning size={13} className="mr-1.5" />
                {translate("incidents.detail.startInvestigation")}
              </Button>
            )}
            {canResolve && (
              <Button
                size="sm"
                onClick={() => handleStatusChange("resolved")}
                disabled={updateMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-9 text-xs"
              >
                <CheckCircle2 size={13} className="mr-1.5" />
                {translate("incidents.detail.markResolved")}
              </Button>
            )}
            {canClose && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange("closed")}
                disabled={updateMutation.isPending}
                className="rounded-xl h-9 text-xs border-cc-border"
              >
                <XCircle size={13} className="mr-1.5" />
                {translate("incidents.detail.closeIncident")}
              </Button>
            )}
            {incident.ndis_reportable_override === undefined || incident.ndis_reportable_override === null ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOverrideValue(!incident.ndis_reportable);
                  setOverrideOpen(true);
                }}
                className="rounded-xl h-9 text-xs border-cc-border"
              >
                <ShieldAlert size={13} className="mr-1.5" />
                {translate("incidents.detail.overrideClassification")}
              </Button>
            ) : null}
            {updateMutation.isPending && (
              <Loader2 size={16} className="animate-spin text-slate-400 self-center" />
            )}
          </div>
        </div>
      </div>

      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Siren size={16} className="text-red-600" />
              {translate("incidents.detail.notifyPrepTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-[12px] text-cc-muted">{translate("incidents.detail.notifyPrepSubtitle")}</p>
            <Textarea
              rows={16}
              value={notifyContent}
              onChange={(e) => setNotifyContent(e.target.value)}
              className="text-[12px] font-mono resize-none rounded-xl border-cc-border"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(notifyContent).catch(() => {});
                toast({ title: translate("incidents.detail.copiedToClipboard") });
              }}
              className="rounded-xl"
            >
              {translate("incidents.detail.copyToClipboard")}
            </Button>
            <Button variant="outline" onClick={() => setNotifyOpen(false)} className="rounded-xl">
              {translate("incidents.detail.overrideCancel")}
            </Button>
            <Button
              onClick={() =>
                updateMutation.mutate(
                  { ndis_reported_at: new Date().toISOString(), ndis_notification_content: notifyContent },
                  { onSuccess: () => setNotifyOpen(false) },
                )
              }
              disabled={updateMutation.isPending}
              className="rounded-xl text-white bg-red-600 hover:bg-red-700"
            >
              {updateMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
              {translate("incidents.detail.markReported")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-cc-plum" />
              {translate("incidents.detail.overrideTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.ndisReportableFlagged")}</Label>
              <Select value={overrideValue ? "yes" : "no"} onValueChange={(v) => setOverrideValue(v === "yes")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">{translate("common.yes")}</SelectItem>
                  <SelectItem value="no">{translate("common.no")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.overrideReason")}</Label>
              <Textarea
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={translate("incidents.detail.overrideReasonPlaceholder")}
                className="text-[13px] resize-none rounded-xl border-cc-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOverrideOpen(false)} className="rounded-xl">
              {translate("incidents.detail.overrideCancel")}
            </Button>
            <Button
              onClick={() => overrideMutation.mutate({ is_reportable: overrideValue, reason: overrideReason })}
              disabled={overrideMutation.isPending || !overrideReason.trim()}
              className="rounded-xl text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              {overrideMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
              {translate("incidents.detail.overrideSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Investigation & corrective actions */}
      <div className="cc-surface-card lg:col-start-1">
        <div className="cc-card-header">
          <div className="flex items-center gap-2">
            <ClipboardList size={15} className="text-cc-muted" />
            <p className="cc-card-title">{translate("incidents.detail.investigationCorrective")}</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.investigationNotes")}</Label>
            <Textarea
              rows={5}
              value={investigationNotes}
              onChange={(e) => setInvestigationNotes(e.target.value)}
              placeholder={translate("incidents.detail.investigationNotesPlaceholder")}
              className="text-[13px] resize-none rounded-xl border-cc-border"
            />
          </div>
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.correctiveActions")}</Label>
            <Textarea
              rows={3}
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder={translate("incidents.detail.correctiveActionsPlaceholder")}
              className="text-[13px] resize-none rounded-xl border-cc-border"
            />
          </div>
          <div className="flex justify-between items-center flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setTrainingWorkerId(incident.user_id || incident.assigned_investigator_id || "");
                setTrainingNewTitle(incident.title ? `Follow-up: ${incident.title}` : "");
                setTrainingOpen(true);
              }}
              className="rounded-xl h-9 text-[13px]"
            >
              <GraduationCap size={14} className="mr-1.5" />
              {translate("incidents.detail.assignTraining")}
            </Button>
            <Button
              onClick={() =>
                updateMutation.mutate({
                  investigation_notes: investigationNotes,
                  corrective_actions: correctiveActions,
                })
              }
              disabled={updateMutation.isPending}
              className="rounded-xl h-9 text-[13px] text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              {updateMutation.isPending
                ? <Loader2 size={13} className="animate-spin mr-1.5" />
                : null}
              {translate("incidents.detail.saveNotes")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={trainingOpen} onOpenChange={setTrainingOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap size={16} className="text-cc-plum" />
              {translate("incidents.detail.assignTraining")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.trainingWorker")}</Label>
              <Select value={trainingWorkerId} onValueChange={setTrainingWorkerId}>
                <SelectTrigger>
                  <SelectValue placeholder={translate("incidents.detail.selectInvestigator")} />
                </SelectTrigger>
                <SelectContent>
                  {(team ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-1 rounded-xl p-1 bg-cc-soft">
              {(["existing", "new"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTrainingMode(m)}
                  className={cn(
                    "flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors",
                    trainingMode === m ? "bg-white text-cc-plum" : "text-cc-muted",
                  )}
                >
                  {m === "existing" ? translate("incidents.detail.trainingPickExisting") : translate("incidents.detail.trainingCreateNew")}
                </button>
              ))}
            </div>

            {trainingMode === "existing" ? (
              <div>
                <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.trainingModule")}</Label>
                <Select value={trainingModuleId} onValueChange={setTrainingModuleId}>
                  <SelectTrigger>
                    <SelectValue placeholder={translate("incidents.detail.trainingChooseModule")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(trainingModules ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.trainingModuleTitle")}</Label>
                  <Input value={trainingNewTitle} onChange={(e) => setTrainingNewTitle(e.target.value)} className="rounded-xl border-cc-border" />
                </div>
                <div>
                  <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.trainingModuleDescription")}</Label>
                  <Input value={trainingNewDescription} onChange={(e) => setTrainingNewDescription(e.target.value)} className="rounded-xl border-cc-border" />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setTrainingOpen(false)} className="rounded-xl">
              {translate("incidents.detail.overrideCancel")}
            </Button>
            <Button
              onClick={() => {
                if (trainingMode === "new") {
                  createModuleMutation.mutate();
                } else {
                  const mod = (trainingModules ?? []).find((m) => m.id === trainingModuleId);
                  if (mod) assignTrainingMutation.mutate({ moduleId: mod.id, title: mod.title });
                }
              }}
              disabled={
                assignTrainingMutation.isPending ||
                createModuleMutation.isPending ||
                !trainingWorkerId ||
                (trainingMode === "existing" ? !trainingModuleId : !trainingNewTitle.trim())
              }
              className="rounded-xl text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              {assignTrainingMutation.isPending || createModuleMutation.isPending ? (
                <Loader2 size={13} className="animate-spin mr-1.5" />
              ) : null}
              {translate("incidents.detail.assignTraining")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Similar past incidents � CARECLIQV2-32 */}
      {(patternsLoading || showPatternsPanel) && (
        <div className="cc-surface-card lg:col-start-1">
          <div className="cc-card-header">
            <div className="flex items-center gap-2">
              <History size={15} className="text-cc-muted" />
              <p className="cc-card-title">{translate("incidents.detail.similarPastIncidents")}</p>
            </div>
            <p className="text-[11px] mt-1 text-cc-muted">
              {translate("incidents.detail.similarPastSubtitle")}
            </p>
          </div>

          {patternsLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : showPatternsPanel && patternData ? (
            <div className="p-6 space-y-5">
              {patternData.ai_summary && (
                <div className="cc-plum-panel rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-cc-plum" />
                    <p className="text-[12px] font-semibold uppercase tracking-widest text-cc-plum">{translate("incidents.detail.aiPatternAnalysis")}</p>
                  </div>
                  <div className="space-y-3 text-[13px] leading-relaxed text-cc-text">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-1 text-cc-muted">{translate("incidents.detail.patternRecognised")}</p>
                      <p>{patternData.ai_summary.pattern_recognised}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-1 text-cc-muted">{translate("incidents.detail.pastStrategies")}</p>
                      <p>{patternData.ai_summary.past_strategies}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-1 text-cc-muted">{translate("incidents.detail.recommendations")}</p>
                      <p>{patternData.ai_summary.recommendations}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {patternData.matches.map((match) => (
                  <div
                    key={match.incident_id}
                    className="rounded-xl p-4 border border-cc-border bg-cc-soft"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-cc-muted">
                        <span className="flex items-center gap-1">
                          <Calendar size={11} />
                          {match.date ? format(parseISO(match.date), "d MMM yyyy") : translate("common.emDash")}
                        </span>
                        <span className="flex items-center gap-1">
                          <User size={11} />
                          {match.participant_label}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px] px-2 py-0 shrink-0 bg-violet-50 text-violet-700 border-violet-200">
                        {translateParams("incidents.detail.matchPercent", { percent: String(Math.round(match.similarity_score * 100)) })}
                      </Badge>
                    </div>
                    <p className="text-[13px] leading-relaxed text-cc-text">{match.excerpt}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      </div>
      <div className="space-y-6">

      {/* Details */}
      <div className="cc-surface-card lg:col-start-2">
        <div className="cc-card-header">
          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-cc-muted" />
            <p className="cc-card-title">{translate("incidents.register.details")}</p>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <div>
              <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5 text-cc-muted">
                <Calendar size={11} /> {translate("incidents.detail.incidentDate")}
              </p>
              <p className="font-medium text-cc-text">
                {incident.incident_date
                  ? formatAppDate(incident.incident_date, incident.timezone)
                  : translate("common.emDash")}
              </p>
              <p className="text-[11px] mt-0.5 text-cc-muted">
                {incident.incident_date
                  ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.type")}</p>
              <p className="font-medium text-cc-text">
                {incidentTypeLabel(incident.incident_type, translate)}
              </p>
            </div>
            {incident.location && (
              <div>
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5 text-cc-muted">
                  <MapPin size={11} /> {translate("incidents.detail.location")}
                </p>
                <p className="text-cc-text">{incident.location}</p>
              </div>
            )}
            {incident.identified_at && (
              <div>
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.identifiedAt")}</p>
                <p className="text-cc-text">{fmtDateTime(incident.identified_at, incident.timezone)}</p>
              </div>
            )}
            {incident.location_type && (
              <div>
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.locationType")}</p>
                <p className="text-cc-text">{translate(`incidents.locationType.${incident.location_type}`)}</p>
              </div>
            )}
            {incident.connection_to_service !== undefined && incident.connection_to_service !== null && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.connectionToService")}</p>
                <p className="text-cc-text">
                  {incident.connection_to_service ? translate("common.yes") : translate("common.no")}
                  {incident.connection_to_service_reasoning ? ` — ${incident.connection_to_service_reasoning}` : ""}
                </p>
              </div>
            )}
            {incident.witnesses_structured && incident.witnesses_structured.length > 0 ? (
              <div className="col-span-2">
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5 text-cc-muted">
                  <Users size={11} /> {translate("incidents.detail.structuredWitnesses")}
                </p>
                <ul className="text-cc-text space-y-0.5">
                  {incident.witnesses_structured.map((w, i) => (
                    <li key={i}>
                      {w.name}
                      {w.relationship ? ` (${w.relationship})` : ""}
                      {w.contact ? ` — ${w.contact}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : incident.witnesses ? (
              <div>
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5 text-cc-muted">
                  <Users size={11} /> {translate("incidents.detail.witnesses")}
                </p>
                <p className="text-cc-text">{incident.witnesses}</p>
              </div>
            ) : null}
            {incident.practice_standard && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.ndisPracticeStandard")}</p>
                <p className="flex items-center gap-1.5 text-cc-text">
                  <Shield size={12} className="text-cc-plum" />
                  {incident.practice_standard}
                </p>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.ndisQscNotified")}</p>
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                  <CheckCircle2 size={13} />
                  {fmtDateTime(incident.ndis_reported_at, incident.timezone)}
                </p>
              </div>
            )}
            {incident.ndis_reportable_override !== undefined && incident.ndis_reportable_override !== null && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.overrideOverridden")}</p>
                <p className="text-cc-text">
                  {incident.ndis_reportable_override ? translate("common.yes") : translate("common.no")}
                  {incident.ndis_reportable_override_reason ? ` — ${incident.ndis_reportable_override_reason}` : ""}
                  {incident.ndis_reportable_override_at
                    ? ` (${formatAppDate(incident.ndis_reportable_override_at, incident.timezone)})`
                    : ""}
                </p>
              </div>
            )}
            {incident.resolved_date && (
              <div>
                <p className="text-[11px] font-medium mb-0.5 text-cc-muted">{translate("incidents.detail.resolved")}</p>
                <p className="text-cc-text">{formatAppDate(incident.resolved_date, incident.timezone)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Investigation: assigned investigator (conflict-of-interest gated) + interviews */}
      <div className="cc-surface-card lg:col-start-2">
        <div className="cc-card-header">
          <div className="flex items-center gap-2">
            <UserSearch size={15} className="text-cc-muted" />
            <p className="cc-card-title">{translate("incidents.detail.investigation")}</p>
          </div>
          <p className="text-[11px] mt-1 text-cc-muted">{translate("incidents.detail.investigationSubtitle")}</p>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.assignedInvestigator")}</Label>
            {incident.assigned_investigator_id ? (
              <p className="text-[13px] text-cc-text flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-600" />
                {(team ?? []).find((m) => m.id === incident.assigned_investigator_id)?.full_name ?? incident.assigned_investigator_id}
              </p>
            ) : (
              <p className="text-[13px] text-cc-muted mb-2">{translate("incidents.detail.noInvestigatorAssigned")}</p>
            )}
            <div className="flex gap-2 mt-2">
              <Select value={selectedInvestigator} onValueChange={setSelectedInvestigator}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={translate("incidents.detail.selectInvestigator")} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleInvestigators.length === 0 ? (
                    <div className="px-2 py-1.5 text-[12px] text-cc-muted">{translate("incidents.detail.investigatorNoOptions")}</div>
                  ) : (
                    eligibleInvestigators.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => assignInvestigatorMutation.mutate(selectedInvestigator)}
                disabled={!selectedInvestigator || assignInvestigatorMutation.isPending}
                className="rounded-xl h-9 text-xs text-white shrink-0"
                style={{ background: "var(--cc-cta)" }}
              >
                {assignInvestigatorMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
                {translate("incidents.detail.assignInvestigator")}
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t border-cc-border">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-[12px] font-medium text-cc-text">{translate("incidents.detail.interviews")}</Label>
              <Button size="sm" variant="outline" onClick={() => setInterviewOpen(true)} className="rounded-xl h-8 text-xs">
                <Plus size={12} className="mr-1.5" />
                {translate("incidents.detail.addInterview")}
              </Button>
            </div>
            <p className="text-[11px] text-cc-muted mb-3">{translate("incidents.detail.interviewsSubtitle")}</p>
            {interviewData?.records && interviewData.records.length > 0 ? (
              <div className="space-y-2">
                {interviewData.records.map((iv) => (
                  <div key={iv.id} className="rounded-xl border border-cc-border p-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-cc-text">{iv.interviewee_name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {translate(`incidents.interviewType.${iv.interviewee_type}`)}
                      </Badge>
                    </div>
                    {iv.interviewed_at && (
                      <p className="text-cc-muted text-[11px] mt-0.5">
                        {fmtDateTime(iv.interviewed_at, incident?.timezone)}
                      </p>
                    )}
                    {iv.notes && <p className="text-cc-text text-[12px] mt-1">{iv.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-cc-muted">{translate("incidents.detail.noInterviews")}</p>
            )}
          </div>
        </div>
      </div>

      <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserSearch size={16} className="text-cc-plum" />
              {translate("incidents.detail.addInterview")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.subjectType")}</Label>
              <Select value={interviewType} onValueChange={(v) => setInterviewType(v as typeof interviewType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["worker", "participant", "witness", "other"] as const).map((t) => (
                    <SelectItem key={t} value={t}>{translate(`incidents.interviewType.${t}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.subjectName")}</Label>
              <Input value={interviewName} onChange={(e) => setInterviewName(e.target.value)} className="rounded-xl border-cc-border" />
            </div>
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.interviewNotes")}</Label>
              <Textarea
                rows={4}
                value={interviewNotes}
                onChange={(e) => setInterviewNotes(e.target.value)}
                className="text-[13px] resize-none rounded-xl border-cc-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setInterviewOpen(false)} className="rounded-xl">
              {translate("incidents.detail.overrideCancel")}
            </Button>
            <Button
              onClick={() => addInterviewMutation.mutate()}
              disabled={addInterviewMutation.isPending || !interviewName.trim()}
              className="rounded-xl text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              {addInterviewMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
              {translate("incidents.detail.addInterview")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subject of allegation — separate from personnel records, coordinator/MD only */}
      <div className="cc-surface-card lg:col-start-2">
        <div className="cc-card-header flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UserX size={15} className="text-cc-muted" />
              <p className="cc-card-title">{translate("incidents.detail.subjectOfAllegation")}</p>
            </div>
            <p className="text-[11px] mt-1 text-cc-muted">{translate("incidents.detail.subjectOfAllegationSubtitle")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSubjectOpen(true)} className="rounded-xl h-8 text-xs shrink-0">
            <Plus size={12} className="mr-1.5" />
            {translate("incidents.detail.addSubject")}
          </Button>
        </div>
        <div className="p-6">
          {subjectData?.records && subjectData.records.length > 0 ? (
            <div className="space-y-3">
              {subjectData.records.map((s) => (
                <div key={s.id} className="rounded-xl border border-cc-border p-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-cc-text">{s.subject_name || translate(`incidents.subjectType.${s.subject_type}`)}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {translate(`incidents.subjectType.${s.subject_type}`)}
                    </Badge>
                  </div>
                  {s.subject_role && <p className="text-cc-muted text-[12px] mt-0.5">{s.subject_role}</p>}
                  {s.notes && <p className="text-cc-text text-[12px] mt-1">{s.notes}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-cc-muted">{translate("incidents.detail.noSubjects")}</p>
          )}
        </div>
      </div>

      <Dialog open={subjectOpen} onOpenChange={setSubjectOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX size={16} className="text-cc-plum" />
              {translate("incidents.detail.addSubject")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.subjectType")}</Label>
              <Select value={subjectType} onValueChange={(v) => setSubjectType(v as (typeof SUBJECT_TYPES)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{translate(`incidents.subjectType.${t}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.subjectName")}</Label>
              <Input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className="rounded-xl border-cc-border" />
            </div>
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.subjectRole")}</Label>
              <Input value={subjectRole} onChange={(e) => setSubjectRole(e.target.value)} className="rounded-xl border-cc-border" />
            </div>
            <div>
              <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">{translate("incidents.detail.subjectNotes")}</Label>
              <Textarea
                rows={3}
                value={subjectNotes}
                onChange={(e) => setSubjectNotes(e.target.value)}
                className="text-[13px] resize-none rounded-xl border-cc-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setSubjectOpen(false)} className="rounded-xl">
              {translate("incidents.detail.overrideCancel")}
            </Button>
            <Button
              onClick={() => subjectMutation.mutate()}
              disabled={subjectMutation.isPending}
              className="rounded-xl text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              {subjectMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
              {translate("incidents.detail.addSubject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit trail */}
      <div className="cc-surface-card lg:col-start-2">
        <div className="cc-card-header">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-cc-muted" />
            <p className="cc-card-title">{translate("incidents.detail.auditTrail")}</p>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-2 text-[12px] text-cc-muted">
            <div className="flex justify-between">
              <span>{translate("incidents.detail.incidentReported")}</span>
              <span className="font-medium text-cc-text">
                {incident.reported_date
                  ? fmtDateTime(incident.reported_date, incident.timezone)
                  : translate("common.emDash")}
              </span>
            </div>
            {incident.ndis_reportable && (
              <div className="flex justify-between">
                <span>{translate("incidents.detail.ndisReportableFlagged")}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-[var(--cc-status-danger-bg)] text-[var(--cc-status-danger)] border-[var(--cc-border)]">
                  {translate("common.yes")}
                </Badge>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="flex justify-between">
                <span>{translate("incidents.detail.reportedToNdisQsc")}</span>
                <span className="font-medium text-emerald-700">
                  {formatAppDate(incident.ndis_reported_at, incident.timezone)}
                </span>
              </div>
            )}
            {incident.resolved_date && (
              <div className="flex justify-between">
                <span>{translate("incidents.detail.incidentResolved")}</span>
                <span className="font-medium text-cc-text">
                  {formatAppDate(incident.resolved_date, incident.timezone)}
                </span>
              </div>
            )}
          </div>
          {incident.ndis_notification_content && (
            <div className="pt-3 mt-3 border-t border-cc-border">
              <button
                type="button"
                onClick={() => setSubmittedOpen((v) => !v)}
                className="text-[12px] font-semibold text-cc-plum hover:underline"
              >
                {translate("incidents.detail.viewSubmittedNotification")}
              </button>
              {submittedOpen && (
                <pre className="mt-2 whitespace-pre-wrap text-[11px] font-mono text-cc-text bg-cc-soft rounded-xl p-3 border border-cc-border">
                  {incident.ndis_notification_content}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>

      </div>
      </div>
    </div>
  );
}
