import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function IncidentDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: incident, isLoading } = useQuery<Incident>({
    queryKey: ["incident", id],
    queryFn: () => apiFetch(`/incidents/${id}`),
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
    mutationFn: (updates: Record<string, unknown>) =>
      apiFetch(`/incidents/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
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
      <div className="max-w-3xl mx-auto text-center py-20 text-slate-500">
        Incident not found.{" "}
        <button onClick={() => navigate("/incidents")} className="underline text-[#5271FF]">
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
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/incidents")}
          className="gap-1.5 text-slate-500 hover:text-[#0D0D55] -ml-2 rounded-xl"
        >
          <ArrowLeft size={15} />
          Incidents
        </Button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-[#0D0D55] truncate max-w-[260px]">{incident.title}</span>
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
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-[#0D0D55] leading-snug">{incident.title}</h1>
              {incident.participant_name && (
                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
                  <User size={13} />
                  {incident.participant_name}
                  {incident.participant_ndis && (
                    <span className="text-slate-400">· NDIS {incident.participant_ndis}</span>
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
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mb-0.5">
                <Calendar size={11} /> Incident Date
              </p>
              <p className="text-slate-700 font-medium">
                {incident.incident_date
                  ? format(parseISO(incident.incident_date), "d MMM yyyy")
                  : "—"}
              </p>
              <p className="text-xs text-slate-400">
                {incident.incident_date
                  ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-medium mb-0.5">Type</p>
              <p className="text-slate-700 font-medium">
                {INCIDENT_TYPE_LABELS[incident.incident_type] ?? incident.incident_type}
              </p>
            </div>
            {incident.location && (
              <div>
                <p className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mb-0.5">
                  <MapPin size={11} /> Location
                </p>
                <p className="text-slate-700">{incident.location}</p>
              </div>
            )}
            {incident.witnesses && (
              <div>
                <p className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mb-0.5">
                  <Users size={11} /> Witnesses
                </p>
                <p className="text-slate-700">{incident.witnesses}</p>
              </div>
            )}
            {incident.practice_standard && (
              <div className="col-span-2">
                <p className="text-[11px] text-slate-400 font-medium mb-0.5">NDIS Practice Standard</p>
                <p className="text-slate-700 flex items-center gap-1.5">
                  <Shield size={12} className="text-[#5271FF]" />
                  {incident.practice_standard}
                </p>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="col-span-2">
                <p className="text-[11px] text-slate-400 font-medium mb-0.5">NDIS QSC Notified</p>
                <p className="text-emerald-700 flex items-center gap-1.5 text-sm font-medium">
                  <CheckCircle2 size={13} />
                  {format(parseISO(incident.ndis_reported_at), "d MMM yyyy, h:mm a")}
                </p>
              </div>
            )}
            {incident.resolved_date && (
              <div>
                <p className="text-[11px] text-slate-400 font-medium mb-0.5">Resolved</p>
                <p className="text-slate-700">{format(parseISO(incident.resolved_date), "d MMM yyyy")}</p>
              </div>
            )}
          </div>

          {/* What happened */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-400 font-medium mb-2">What happened</p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{incident.description}</p>
          </div>

          {incident.participant_impact && (
            <div>
              <p className="text-xs text-slate-400 font-medium mb-2">Participant Impact</p>
              <p className="text-sm text-slate-700 leading-relaxed">{incident.participant_impact}</p>
            </div>
          )}

          {incident.worker_actions && (
            <div>
              <p className="text-xs text-slate-400 font-medium mb-2">Immediate Actions Taken</p>
              <p className="text-sm text-slate-700 leading-relaxed">{incident.worker_actions}</p>
            </div>
          )}

          {/* Workflow action buttons */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2">
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
                className="rounded-xl h-9 text-xs border-slate-200"
              >
                <XCircle size={13} className="mr-1.5" />
                Close Incident
              </Button>
            )}
            {updateMutation.isPending && (
              <Loader2 size={16} className="animate-spin text-slate-400 self-center" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Investigation & corrective actions */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList size={15} className="text-slate-400" />
            Investigation &amp; Corrective Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-slate-500 mb-1.5 block">Investigation Notes</Label>
            <Textarea
              rows={5}
              value={investigationNotes}
              onChange={(e) => setInvestigationNotes(e.target.value)}
              placeholder="Document the full investigation — root cause analysis, contributing factors, findings…"
              className="text-sm resize-none rounded-xl border-slate-200"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500 mb-1.5 block">Corrective Actions</Label>
            <Textarea
              rows={3}
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder="Actions taken or planned to prevent recurrence — training, process changes, equipment upgrades…"
              className="text-sm resize-none rounded-xl border-slate-200"
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
              className="bg-[#5271FF] hover:bg-[#3d5bdd] text-white rounded-xl h-9 text-sm"
            >
              {updateMutation.isPending
                ? <Loader2 size={13} className="animate-spin mr-1.5" />
                : null}
              Save Notes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit trail */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-500">
            <Shield size={14} /> Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>Incident reported</span>
              <span className="font-medium text-slate-700">
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
                <span className="font-medium text-slate-700">
                  {format(parseISO(incident.resolved_date), "d MMM yyyy")}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
