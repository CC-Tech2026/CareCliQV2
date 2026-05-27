import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  AlertTriangle,
  Calendar,
  MapPin,
  Users,
  User,
} from "lucide-react";
import { getIncident, updateIncident } from "@/services/incidentService";
import { useReAuth } from "@/hooks/useReAuth";

const SEVERITIES = [
  { value: "low", label: "Low", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "medium", label: "Medium", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "high", label: "High", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "critical", label: "Critical", color: "bg-red-100 text-red-700 border-red-200" },
] as const;

const STATUSES = [
  { value: "reported", label: "Reported", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "under_investigation", label: "Under Investigation", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "resolved", label: "Resolved", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "closed", label: "Closed", color: "bg-slate-100 text-slate-600 border-slate-200" },
] as const;

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  injury: "Injury",
  medication_error: "Medication Error",
  behaviour_of_concern: "Behaviour of Concern",
  property_damage: "Property Damage",
  abuse_neglect: "Abuse / Neglect",
  restrictive_practice: "Restrictive Practice",
  environmental: "Environmental Hazard",
  elopement: "Elopement",
  near_miss: "Near Miss",
  other: "Other",
};

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

function getSeverityConfig(sev: string) {
  return SEVERITIES.find((s) => s.value === sev) ?? SEVERITIES[1];
}

function getStatusConfig(st: string) {
  return STATUSES.find((s) => s.value === st) ?? STATUSES[0];
}

export default function IncidentDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { requireReAuth, modal } = useReAuth();

  const { data: incident, isLoading } = useQuery<Incident>({
    queryKey: ["incident", id],
    queryFn: () => getIncident<Incident>(id),
  });

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
      queryClient.invalidateQueries({ queryKey: ["incident", id] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-stats"] });
      toast({ title: "Incident updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20" style={{ color: "#4A3D5A" }}>
        Incident not found.{" "}
        <button onClick={() => navigate("/incidents")} className="underline" style={{ color: "#F1738A" }}>
          Back to Incidents
        </button>
      </div>
    );
  }

  const sev = getSeverityConfig(incident.severity);
  const st = getStatusConfig(incident.status);
  const canInvestigate = incident.status === "reported";
  const canResolve = incident.status === "under_investigation";
  const canClose = incident.status === "resolved";

  function handleStatusChange(newStatus: string) {
    updateMutation.mutate({ status: newStatus });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {modal}
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/incidents")}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: "#7A6A8A" }}
        >
          <ArrowLeft size={14} /> Incidents
        </button>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="font-medium truncate max-w-[260px]" style={{ color: "#1C1626" }}>{incident.title}</span>
      </div>

      {/* NDIS urgent banner */}
      {incident.ndis_pending && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4">
          <Siren size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-800">NDIS Reportable — Notification Required</p>
            <p className="text-xs text-red-700 mt-0.5">
              This incident must be reported to the NDIS Quality &amp; Safeguards Commission.
              {incident.severity === "critical" && " Critical incidents require notification within 24 hours."}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => updateMutation.mutate({ ndis_reported_at: new Date().toISOString() })}
            disabled={updateMutation.isPending}
            className="shrink-0 bg-red-600 hover:bg-red-700 text-white text-xs h-8 rounded-xl"
          >
            <CheckCircle2 size={12} className="mr-1.5" />
            Mark Reported
          </Button>
        </div>
      )}

      {incident.overdue && !incident.ndis_pending && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
          <Clock size={16} className="text-orange-600 shrink-0" />
          <p className="text-sm text-orange-800 font-medium">
            This incident is overdue for resolution. Escalation action may be required.
          </p>
        </div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-[20px] font-bold leading-snug" style={{ color: "#1C1626" }}>{incident.title}</h1>
              {incident.participant_name && (
                <p className="text-[13px] mt-1 flex items-center gap-1.5" style={{ color: "#4A3D5A" }}>
                  <User size={13} />
                  {incident.participant_name}
                  {incident.participant_ndis && (
                    <span style={{ color: "#7A6A8A" }}>· NDIS {incident.participant_ndis}</span>
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 items-end shrink-0">
              <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5", sev.color)}>
                {sev.label}
              </Badge>
              <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5", st.color)}>
                {st.label}
              </Badge>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5" style={{ color: "#7A6A8A" }}>
                <Calendar size={11} /> Incident Date
              </p>
              <p className="font-medium" style={{ color: "#1C1626" }}>
                {incident.incident_date
                  ? format(parseISO(incident.incident_date), "d MMM yyyy")
                  : "—"}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "#7A6A8A" }}>
                {incident.incident_date
                  ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>Type</p>
              <p className="font-medium" style={{ color: "#1C1626" }}>
                {INCIDENT_TYPE_LABELS[incident.incident_type] ?? incident.incident_type}
              </p>
            </div>
            {incident.location && (
              <div>
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5" style={{ color: "#7A6A8A" }}>
                  <MapPin size={11} /> Location
                </p>
                <p style={{ color: "#4A3D5A" }}>{incident.location}</p>
              </div>
            )}
            {incident.witnesses && (
              <div>
                <p className="text-[11px] font-medium flex items-center gap-1 mb-0.5" style={{ color: "#7A6A8A" }}>
                  <Users size={11} /> Witnesses
                </p>
                <p style={{ color: "#4A3D5A" }}>{incident.witnesses}</p>
              </div>
            )}
            {incident.practice_standard && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>NDIS Practice Standard</p>
                <p className="flex items-center gap-1.5" style={{ color: "#4A3D5A" }}>
                  <Shield size={12} style={{ color: "#542269" }} />
                  {incident.practice_standard}
                </p>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>NDIS QSC Notified</p>
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                  <CheckCircle2 size={13} />
                  {format(parseISO(incident.ndis_reported_at), "d MMM yyyy, h:mm a")}
                </p>
              </div>
            )}
            {incident.resolved_date && (
              <div>
                <p className="text-[11px] font-medium mb-0.5" style={{ color: "#7A6A8A" }}>Resolved</p>
                <p style={{ color: "#4A3D5A" }}>{format(parseISO(incident.resolved_date), "d MMM yyyy")}</p>
              </div>
            )}
          </div>

          {/* What happened */}
          <div className="pt-2 border-t" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7A6A8A" }}>What happened</p>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "#4A3D5A" }}>{incident.description}</p>
          </div>

          {incident.participant_impact && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7A6A8A" }}>Participant Impact</p>
              <p className="text-[13px] leading-relaxed" style={{ color: "#4A3D5A" }}>{incident.participant_impact}</p>
            </div>
          )}

          {incident.worker_actions && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7A6A8A" }}>Immediate Actions Taken</p>
              <p className="text-[13px] leading-relaxed" style={{ color: "#4A3D5A" }}>{incident.worker_actions}</p>
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
                Start Investigation
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
                Mark Resolved
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
                Close Incident
              </Button>
            )}
            {updateMutation.isPending && (
              <Loader2 size={16} className="animate-spin text-slate-400 self-center" />
            )}
          </div>
        </div>
      </div>

      {/* Investigation & corrective actions */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
          <div className="flex items-center gap-2">
            <ClipboardList size={15} style={{ color: "#7A6A8A" }} />
            <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>Investigation &amp; Corrective Actions</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block" style={{ color: "#4A3D5A" }}>Investigation Notes</Label>
            <Textarea
              rows={5}
              value={investigationNotes}
              onChange={(e) => setInvestigationNotes(e.target.value)}
              placeholder="Document the full investigation — root cause analysis, contributing factors, findings…"
              className="text-[13px] resize-none rounded-xl"
              style={{ borderColor: "rgba(232,213,232,0.5)" }}
            />
          </div>
          <div>
            <Label className="text-[12px] font-medium mb-1.5 block" style={{ color: "#4A3D5A" }}>Corrective Actions</Label>
            <Textarea
              rows={3}
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder="Actions taken or planned to prevent recurrence — training, process changes, equipment upgrades…"
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
              style={{ background: "linear-gradient(135deg, #F1738A 0%, #542269 100%)" }}
            >
              {updateMutation.isPending
                ? <Loader2 size={13} className="animate-spin mr-1.5" />
                : null}
              Save Notes
            </Button>
          </div>
        </div>
      </div>

      {/* Audit trail */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
          <div className="flex items-center gap-2">
            <Shield size={14} style={{ color: "#7A6A8A" }} />
            <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>Audit Trail</p>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-2 text-[12px]" style={{ color: "#7A6A8A" }}>
            <div className="flex justify-between">
              <span>Incident reported</span>
              <span className="font-medium" style={{ color: "#1C1626" }}>
                {incident.reported_date
                  ? format(parseISO(incident.reported_date), "d MMM yyyy, h:mm a")
                  : "—"}
              </span>
            </div>
            {incident.ndis_reportable && (
              <div className="flex justify-between">
                <span>NDIS reportable flagged</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200">
                  Yes
                </Badge>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="flex justify-between">
                <span>Reported to NDIS QSC</span>
                <span className="font-medium text-emerald-700">
                  {format(parseISO(incident.ndis_reported_at), "d MMM yyyy")}
                </span>
              </div>
            )}
            {incident.resolved_date && (
              <div className="flex justify-between">
                <span>Incident resolved</span>
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
