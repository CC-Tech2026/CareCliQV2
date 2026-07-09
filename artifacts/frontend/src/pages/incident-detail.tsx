import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { getIncident, updateIncident, getSimilarIncidentPatterns } from "@/services/incidentService";
import type { SimilarIncidentPatternsResult } from "@/services/incidentService";
import { useReAuth } from "@/hooks/useReAuth";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  reported: "bg-blue-100 text-blue-700 border-blue-200",
  under_investigation: "bg-amber-100 text-amber-700 border-amber-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
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
}

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

  const [investigationNotes, setInvestigationNotes] = useState("");
  const [correctiveActions, setCorrectiveActions] = useState("");

  useEffect(() => {
    if (incident) {
      setInvestigationNotes(incident.investigation_notes ?? "");
      setCorrectiveActions(incident.corrective_actions ?? "");
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
      <div className="w-full text-center py-20" style={{ color: "var(--cc-text)" }}>
        {translate("incidents.detail.notFound")}{" "}
        <button onClick={() => navigate("/incidents")} className="underline" style={{ color: "#F1738A" }}>
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
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: "#7A6A8A" }}
        >
          <ArrowLeft size={14} /> {translate("incidents.detail.breadcrumbParent")}
        </button>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="font-medium truncate max-w-[260px]" style={{ color: "#1C1626" }}>{incident.title}</span>
      </div>

      {/* NDIS urgent banner */}
      {incident.ndis_pending && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4">
          <Siren size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-800">{translate("incidents.detail.ndisReportableTitle")}</p>
            <p className="text-xs text-red-700 mt-0.5">
              {translate("incidents.detail.ndisReportableBody")}
              {incident.severity === "critical" && ` ${translate("incidents.detail.ndisCritical24h")}`}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => updateMutation.mutate({ ndis_reported_at: new Date().toISOString() })}
            disabled={updateMutation.isPending}
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

      {/* Header card */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>{incident.title}</h1>
              {incident.participant_name && (
                <p className="text-[13px] mt-1 flex items-center gap-1.5" style={{ color: "var(--cc-text)" }}>
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
          {/* Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5" style={{ color: "#7A6A8A" }}>
                <Calendar size={11} /> {translate("incidents.detail.incidentDate")}
              </p>
              <p className="font-medium" style={{ color: "#1C1626" }}>
                {incident.incident_date
                  ? format(parseISO(incident.incident_date), "d MMM yyyy")
                  : translate("common.emDash")}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "#7A6A8A" }}>
                {incident.incident_date
                  ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.type")}</p>
              <p className="font-medium" style={{ color: "#1C1626" }}>
                {incidentTypeLabel(incident.incident_type, translate)}
              </p>
            </div>
            {incident.location && (
              <div>
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5" style={{ color: "#7A6A8A" }}>
                  <MapPin size={11} /> {translate("incidents.detail.location")}
                </p>
                <p style={{ color: "var(--cc-text)" }}>{incident.location}</p>
              </div>
            )}
            {incident.witnesses && (
              <div>
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5" style={{ color: "#7A6A8A" }}>
                  <Users size={11} /> {translate("incidents.detail.witnesses")}
                </p>
                <p style={{ color: "var(--cc-text)" }}>{incident.witnesses}</p>
              </div>
            )}
            {incident.practice_standard && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.ndisPracticeStandard")}</p>
                <p className="flex items-center gap-1.5" style={{ color: "var(--cc-text)" }}>
                  <Shield size={12} style={{ color: "#E8457A" }} />
                  {incident.practice_standard}
                </p>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.ndisQscNotified")}</p>
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                  <CheckCircle2 size={13} />
                  {format(parseISO(incident.ndis_reported_at), "d MMM yyyy, h:mm a")}
                </p>
              </div>
            )}
            {incident.resolved_date && (
              <div>
                <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.resolved")}</p>
                <p style={{ color: "var(--cc-text)" }}>{format(parseISO(incident.resolved_date), "d MMM yyyy")}</p>
              </div>
            )}
          </div>

          {/* What happened */}
          <div className="pt-2 border-t" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.whatHappened")}</p>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--cc-text)" }}>{incident.description}</p>
          </div>

          {incident.participant_impact && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.participantImpact")}</p>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--cc-text)" }}>{incident.participant_impact}</p>
            </div>
          )}

          {incident.worker_actions && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.immediateActions")}</p>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--cc-text)" }}>{incident.worker_actions}</p>
            </div>
          )}

          {/* Workflow action buttons */}
          <div className="pt-3 border-t flex flex-wrap gap-2" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
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
                className="rounded-xl h-9 text-xs"
                style={{ borderColor: "rgba(232,213,232,0.7)" }}
              >
                <XCircle size={13} className="mr-1.5" />
                {translate("incidents.detail.closeIncident")}
              </Button>
            )}
            {updateMutation.isPending && (
              <Loader2 size={16} className="animate-spin text-slate-400 self-center" />
            )}
          </div>
        </div>
      </div>

      {/* Similar past incidents � CARECLIQV2-32 */}
      {(patternsLoading || showPatternsPanel) && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
            <div className="flex items-center gap-2">
              <History size={15} style={{ color: "#7A6A8A" }} />
              <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>{translate("incidents.detail.similarPastIncidents")}</p>
            </div>
            <p className="text-[11px] mt-1" style={{ color: "#7A6A8A" }}>
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
                <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(241,115,138,0.06)", border: "1px solid rgba(241,115,138,0.15)" }}>
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} style={{ color: "#E8457A" }} />
                    <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "#E8457A" }}>{translate("incidents.detail.aiPatternAnalysis")}</p>
                  </div>
                  <div className="space-y-3 text-[13px] leading-relaxed" style={{ color: "var(--cc-text)" }}>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.patternRecognised")}</p>
                      <p>{patternData.ai_summary.pattern_recognised}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.pastStrategies")}</p>
                      <p>{patternData.ai_summary.past_strategies}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#7A6A8A" }}>{translate("incidents.detail.recommendations")}</p>
                      <p>{patternData.ai_summary.recommendations}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {patternData.matches.map((match) => (
                  <div
                    key={match.incident_id}
                    className="rounded-xl p-4"
                    style={{ border: "1px solid rgba(232,213,232,0.6)", background: "rgba(250,248,252,0.5)" }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "#7A6A8A" }}>
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
                    <p className="text-[13px] leading-relaxed" style={{ color: "var(--cc-text)" }}>{match.excerpt}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Investigation & corrective actions */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
          <div className="flex items-center gap-2">
            <ClipboardList size={15} style={{ color: "#7A6A8A" }} />
            <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>{translate("incidents.detail.investigationCorrective")}</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--cc-text)" }}>{translate("incidents.detail.investigationNotes")}</Label>
            <Textarea
              rows={5}
              value={investigationNotes}
              onChange={(e) => setInvestigationNotes(e.target.value)}
              placeholder={translate("incidents.detail.investigationNotesPlaceholder")}
              className="text-[13px] resize-none rounded-xl"
              style={{ borderColor: "rgba(232,213,232,0.5)" }}
            />
          </div>
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--cc-text)" }}>{translate("incidents.detail.correctiveActions")}</Label>
            <Textarea
              rows={3}
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder={translate("incidents.detail.correctiveActionsPlaceholder")}
              className="text-[13px] resize-none rounded-xl"
              style={{ borderColor: "rgba(232,213,232,0.5)" }}
            />
          </div>
          <div className="flex justify-end">
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

      {/* Audit trail */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
          <div className="flex items-center gap-2">
            <Shield size={14} style={{ color: "#7A6A8A" }} />
            <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>{translate("incidents.detail.auditTrail")}</p>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-2 text-[12px]" style={{ color: "#7A6A8A" }}>
            <div className="flex justify-between">
              <span>{translate("incidents.detail.incidentReported")}</span>
              <span className="font-medium" style={{ color: "#1C1626" }}>
                {incident.reported_date
                  ? format(parseISO(incident.reported_date), "d MMM yyyy, h:mm a")
                  : translate("common.emDash")}
              </span>
            </div>
            {incident.ndis_reportable && (
              <div className="flex justify-between">
                <span>{translate("incidents.detail.ndisReportableFlagged")}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200">
                  {translate("common.yes")}
                </Badge>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="flex justify-between">
                <span>{translate("incidents.detail.reportedToNdisQsc")}</span>
                <span className="font-medium text-emerald-700">
                  {format(parseISO(incident.ndis_reported_at), "d MMM yyyy")}
                </span>
              </div>
            )}
            {incident.resolved_date && (
              <div className="flex justify-between">
                <span>{translate("incidents.detail.incidentResolved")}</span>
                <span className="font-medium" style={{ color: "#1C1626" }}>
                  {format(parseISO(incident.resolved_date), "d MMM yyyy")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
