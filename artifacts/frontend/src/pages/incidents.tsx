import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetParticipants } from "@workspace/api-client-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  FileWarning,
  Shield,
  ChevronRight,
  Loader2,
  AlertCircle,
  Activity,
  ClipboardList,
  Siren,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

const INCIDENT_TYPES = [
  { value: "injury", label: "Injury" },
  { value: "medication_error", label: "Medication Error" },
  { value: "behaviour_of_concern", label: "Behaviour of Concern" },
  { value: "property_damage", label: "Property Damage" },
  { value: "abuse_neglect", label: "Abuse / Neglect" },
  { value: "restrictive_practice", label: "Restrictive Practice" },
  { value: "environmental", label: "Environmental Hazard" },
  { value: "elopement", label: "Elopement" },
  { value: "near_miss", label: "Near Miss" },
  { value: "other", label: "Other" },
] as const;

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

const NDIS_REPORTABLE_TYPES = new Set(["abuse_neglect", "restrictive_practice"]);

function severityBorderColor(sev: string) {
  return sev === "critical" ? "border-l-red-500" :
    sev === "high" ? "border-l-orange-500" :
    sev === "medium" ? "border-l-amber-400" :
    "border-l-emerald-400";
}

function getSeverityConfig(sev: string) {
  return SEVERITIES.find((s) => s.value === sev) ?? SEVERITIES[1];
}

function getStatusConfig(st: string) {
  return STATUSES.find((s) => s.value === st) ?? STATUSES[0];
}

function getTypeLabel(t: string) {
  return INCIDENT_TYPES.find((x) => x.value === t)?.label ?? t;
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

interface IncidentStats {
  total: number;
  open: number;
  ndis_pending: number;
  overdue: number;
  critical: number;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function Incidents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: incidents = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: () => apiFetch("/incidents"),
  });

  const { data: stats } = useQuery<IncidentStats>({
    queryKey: ["incident-stats"],
    queryFn: () => apiFetch("/incidents/stats"),
  });

  const { data: participantsData } = useGetParticipants({});
  const participants = (participantsData as { data?: unknown[] } | undefined)?.data ?? [];

  const selectedIncident = useMemo(
    () => incidents.find((i) => i.id === selectedId) ?? null,
    [incidents, selectedId],
  );

  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
      if (filterStatus !== "all" && i.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          i.title.toLowerCase().includes(q) ||
          (i.participant_name ?? "").toLowerCase().includes(q) ||
          getTypeLabel(i.incident_type).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [incidents, filterSeverity, filterStatus, search]);

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      apiFetch(`/incidents/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-stats"] });
      toast({ title: "Incident updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  function handleStatusChange(id: string, newStatus: string) {
    updateMutation.mutate({ id, updates: { status: newStatus } });
  }

  function handleMarkNdisReported(id: string) {
    updateMutation.mutate({ id, updates: { ndis_reported_at: new Date().toISOString() } });
  }

  return (
    <div className="flex flex-col h-full gap-6">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-[#0D0D55] flex items-center gap-2">
            <AlertTriangle className="text-orange-500" size={22} />
            Incident Management
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            NDIS Practice Standard 2.3 — Incident management &amp; notification
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-[#0D0D55] hover:bg-[#1a1a77] text-white rounded-2xl gap-2"
        >
          <Plus size={16} />
          Log Incident
        </Button>
      </div>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
        {[
          { label: "Total", value: stats?.total ?? 0, icon: ClipboardList, color: "text-[#5271FF]", bg: "bg-blue-50" },
          { label: "Open", value: stats?.open ?? 0, icon: Activity, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "NDIS Pending", value: stats?.ndis_pending ?? 0, icon: Siren, color: "text-red-600", bg: "bg-red-50" },
          { label: "Overdue", value: stats?.overdue ?? 0, icon: Clock, color: "text-orange-600", bg: "bg-orange-50" },
          { label: "Critical", value: stats?.critical ?? 0, icon: AlertCircle, color: "text-rose-700", bg: "bg-rose-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={cn("rounded-2xl p-4 flex items-center gap-3", bg)}>
            <Icon size={20} className={color} />
            <div>
              <p className="text-xs text-slate-500 font-medium">{label}</p>
              <p className={cn("text-2xl font-bold", color)}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── NDIS urgent banner ── */}
      {(stats?.ndis_pending ?? 0) > 0 && (
        <div className="shrink-0 flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-3">
          <Siren size={18} className="text-red-600 shrink-0" />
          <p className="text-sm text-red-800 font-medium">
            <strong>{stats?.ndis_pending}</strong> incident{stats!.ndis_pending > 1 ? "s" : ""} require NDIS Quality &amp; Safeguards Commission notification. Critical incidents must be reported within 24 hours.
          </p>
        </div>
      )}

      {/* ── Split pane ── */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left list */}
        <div className="flex flex-col gap-3 w-96 shrink-0">
          {/* Search + filters */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search incidents…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-sm rounded-xl border-slate-200 h-9"
              />
            </div>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="w-28 h-9 text-xs rounded-xl border-slate-200">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severity</SelectItem>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-32 h-9 text-xs rounded-xl border-slate-200">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Incident list */}
          <div className="flex flex-col gap-2 overflow-y-auto flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 size={22} className="animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                <AlertTriangle size={28} className="text-slate-300" />
                <p className="text-sm">No incidents found</p>
              </div>
            ) : (
              filtered.map((incident) => (
                <button
                  key={incident.id}
                  onClick={() => setSelectedId(incident.id)}
                  className={cn(
                    "text-left w-full rounded-2xl border-l-4 border border-slate-100 bg-white p-4 shadow-sm hover:shadow-md transition-all",
                    severityBorderColor(incident.severity),
                    selectedId === incident.id && "ring-2 ring-[#5271FF]/30 shadow-md",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[#0D0D55] line-clamp-1 flex-1">
                      {incident.title}
                    </p>
                    <ChevronRight size={14} className="text-slate-400 shrink-0 mt-0.5" />
                  </div>

                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                    {incident.participant_name || "No participant linked"} · {getTypeLabel(incident.incident_type)}
                  </p>

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", getSeverityConfig(incident.severity).color)}>
                      {getSeverityConfig(incident.severity).label}
                    </Badge>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", getStatusConfig(incident.status).color)}>
                      {getStatusConfig(incident.status).label}
                    </Badge>
                    {incident.ndis_pending && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200">
                        NDIS Alert
                      </Badge>
                    )}
                    {incident.overdue && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-50 text-orange-600 border-orange-200">
                        Overdue
                      </Badge>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400 mt-2">
                    {incident.incident_date
                      ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                      : ""}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right detail */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {selectedIncident ? (
            <IncidentDetail
              incident={selectedIncident}
              onStatusChange={handleStatusChange}
              onMarkNdisReported={handleMarkNdisReported}
              onUpdate={(updates) =>
                updateMutation.mutate({ id: selectedIncident.id, updates })
              }
              saving={updateMutation.isPending}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
              <AlertTriangle size={40} className="text-slate-200" />
              <p className="text-sm font-medium">Select an incident to view details</p>
              <p className="text-xs text-slate-300">or log a new incident</p>
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateIncidentModal
          participants={participants as Array<{ id: string; full_name: string }>}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["incidents"] });
            queryClient.invalidateQueries({ queryKey: ["incident-stats"] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Incident Detail Panel
───────────────────────────────────────────────────────── */
function IncidentDetail({
  incident,
  onStatusChange,
  onMarkNdisReported,
  onUpdate,
  saving,
}: {
  incident: Incident;
  onStatusChange: (id: string, status: string) => void;
  onMarkNdisReported: (id: string) => void;
  onUpdate: (updates: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [investigationNotes, setInvestigationNotes] = useState(incident.investigation_notes ?? "");
  const [correctiveActions, setCorrectiveActions] = useState(incident.corrective_actions ?? "");

  const sev = getSeverityConfig(incident.severity);
  const st = getStatusConfig(incident.status);

  const canInvestigate = incident.status === "reported";
  const canResolve = incident.status === "under_investigation";
  const canClose = incident.status === "resolved";

  return (
    <div className="space-y-4">
      {/* NDIS Urgent Banner */}
      {incident.ndis_pending && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4">
          <Siren size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-800">NDIS Reportable Incident</p>
            <p className="text-xs text-red-700 mt-0.5">
              This incident must be reported to the NDIS Quality &amp; Safeguards Commission.
              {incident.severity === "critical" && " Critical incidents require notification within 24 hours."}
            </p>
            <Button
              size="sm"
              onClick={() => onMarkNdisReported(incident.id)}
              disabled={saving}
              className="mt-2 bg-red-600 hover:bg-red-700 text-white text-xs h-7 rounded-lg"
            >
              <CheckCircle2 size={12} className="mr-1" />
              Mark as Reported to NDIS QSC
            </Button>
          </div>
        </div>
      )}

      {incident.overdue && !incident.ndis_pending && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
          <Clock size={16} className="text-orange-600 shrink-0" />
          <p className="text-sm text-orange-800 font-medium">
            This incident is overdue for resolution — escalation may be required.
          </p>
        </div>
      )}

      {/* Header card */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg text-[#0D0D55] leading-snug">{incident.title}</CardTitle>
              {incident.participant_name && (
                <p className="text-sm text-slate-500 mt-1">
                  {incident.participant_name}
                  {incident.participant_ndis && <span className="text-slate-400"> · NDIS {incident.participant_ndis}</span>}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 items-end shrink-0">
              <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5", sev.color)}>{sev.label}</Badge>
              <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5", st.color)}>{st.label}</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-xs text-slate-400 font-medium block">Incident Date</span>
              <span className="text-slate-700">
                {incident.incident_date
                  ? format(parseISO(incident.incident_date), "d MMM yyyy, h:mm a")
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 font-medium block">Type</span>
              <span className="text-slate-700">{getTypeLabel(incident.incident_type)}</span>
            </div>
            {incident.location && (
              <div>
                <span className="text-xs text-slate-400 font-medium block">Location</span>
                <span className="text-slate-700">{incident.location}</span>
              </div>
            )}
            {incident.witnesses && (
              <div>
                <span className="text-xs text-slate-400 font-medium block">Witnesses</span>
                <span className="text-slate-700">{incident.witnesses}</span>
              </div>
            )}
            {incident.practice_standard && (
              <div className="col-span-2">
                <span className="text-xs text-slate-400 font-medium block">NDIS Practice Standard</span>
                <span className="text-slate-700 flex items-center gap-1.5">
                  <Shield size={12} className="text-[#5271FF]" />
                  {incident.practice_standard}
                </span>
              </div>
            )}
            {incident.ndis_reported_at && (
              <div className="col-span-2">
                <span className="text-xs text-slate-400 font-medium block">NDIS QSC Reported</span>
                <span className="text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 size={12} />
                  {format(parseISO(incident.ndis_reported_at), "d MMM yyyy, h:mm a")}
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <p className="text-xs text-slate-400 font-medium mb-1">What happened</p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{incident.description}</p>
          </div>

          {incident.participant_impact && (
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">Participant Impact</p>
              <p className="text-sm text-slate-700 leading-relaxed">{incident.participant_impact}</p>
            </div>
          )}

          {incident.worker_actions && (
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">Immediate Actions Taken</p>
              <p className="text-sm text-slate-700 leading-relaxed">{incident.worker_actions}</p>
            </div>
          )}

          {/* Workflow actions */}
          <div className="pt-2 border-t border-slate-100 flex gap-2 flex-wrap">
            {canInvestigate && (
              <Button
                size="sm"
                onClick={() => onStatusChange(incident.id, "under_investigation")}
                disabled={saving}
                className="bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-xl h-8"
              >
                <FileWarning size={12} className="mr-1.5" />
                Start Investigation
              </Button>
            )}
            {canResolve && (
              <Button
                size="sm"
                onClick={() => onStatusChange(incident.id, "resolved")}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-xl h-8"
              >
                <CheckCircle2 size={12} className="mr-1.5" />
                Mark Resolved
              </Button>
            )}
            {canClose && (
              <Button
                size="sm"
                onClick={() => onStatusChange(incident.id, "closed")}
                disabled={saving}
                variant="outline"
                className="text-xs rounded-xl h-8 border-slate-300"
              >
                <XCircle size={12} className="mr-1.5" />
                Close Incident
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Investigation & corrective actions */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList size={15} className="text-slate-400" /> Investigation &amp; Corrective Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-slate-500 mb-1.5 block">Investigation Notes</Label>
            <Textarea
              rows={4}
              value={investigationNotes}
              onChange={(e) => setInvestigationNotes(e.target.value)}
              placeholder="Document investigation findings…"
              className="text-sm resize-none rounded-xl border-slate-200"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500 mb-1.5 block">Corrective Actions</Label>
            <Textarea
              rows={3}
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder="Actions taken to prevent recurrence…"
              className="text-sm resize-none rounded-xl border-slate-200"
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={saving}
              onClick={() =>
                onUpdate({
                  investigation_notes: investigationNotes,
                  corrective_actions: correctiveActions,
                })
              }
              className="bg-[#5271FF] hover:bg-[#3d5bdd] text-white rounded-xl h-8 text-xs"
            >
              {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : null}
              Save Notes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Create Incident Modal
───────────────────────────────────────────────────────── */
function CreateIncidentModal({
  participants,
  onClose,
  onCreated,
}: {
  participants: Array<{ id: string; full_name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    participant_id: "",
    incident_type: "injury",
    severity: "medium",
    title: "",
    description: "",
    location: "",
    witnesses: "",
    participant_impact: "",
    worker_actions: "",
    incident_date: new Date().toISOString().slice(0, 16),
  });

  const ndisReportable =
    NDIS_REPORTABLE_TYPES.has(form.incident_type) || form.severity === "critical";

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: "Title and description are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await fetch(`${API_BASE}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          participant_id: form.participant_id || undefined,
          incident_date: new Date(form.incident_date).toISOString(),
        }),
      });
      toast({ title: "Incident logged successfully" });
      onCreated();
    } catch {
      toast({ title: "Failed to log incident", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#0D0D55]">
            <AlertTriangle size={18} className="text-orange-500" />
            Log New Incident
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {ndisReportable && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <Siren size={15} className="text-red-600 shrink-0" />
              <p className="text-xs text-red-700 font-medium">
                This will be flagged as an NDIS Reportable Incident requiring notification to the NDIS QSC.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Incident Type *</Label>
              <Select value={form.incident_type} onValueChange={(v) => set("incident_type", v)}>
                <SelectTrigger className="h-9 text-sm rounded-xl border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Severity *</Label>
              <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                <SelectTrigger className="h-9 text-sm rounded-xl border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Participant (optional)</Label>
            <Select value={form.participant_id} onValueChange={(v) => set("participant_id", v)}>
              <SelectTrigger className="h-9 text-sm rounded-xl border-slate-200">
                <SelectValue placeholder="Select participant…" />
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Incident Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Brief descriptive title…"
              className="h-9 text-sm rounded-xl border-slate-200"
            />
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Date &amp; Time of Incident *</Label>
            <Input
              type="datetime-local"
              value={form.incident_date}
              onChange={(e) => set("incident_date", e.target.value)}
              className="h-9 text-sm rounded-xl border-slate-200"
            />
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-1 block">What happened? *</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Describe the incident in detail…"
              className="text-sm resize-none rounded-xl border-slate-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Location</Label>
              <Input
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Where did it occur?"
                className="h-9 text-sm rounded-xl border-slate-200"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Witnesses</Label>
              <Input
                value={form.witnesses}
                onChange={(e) => set("witnesses", e.target.value)}
                placeholder="Names of witnesses"
                className="h-9 text-sm rounded-xl border-slate-200"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Participant Impact</Label>
            <Textarea
              rows={2}
              value={form.participant_impact}
              onChange={(e) => set("participant_impact", e.target.value)}
              placeholder="How was the participant affected?"
              className="text-sm resize-none rounded-xl border-slate-200"
            />
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Immediate Actions Taken</Label>
            <Textarea
              rows={2}
              value={form.worker_actions}
              onChange={(e) => set("worker_actions", e.target.value)}
              placeholder="What actions did you take immediately after the incident?"
              className="text-sm resize-none rounded-xl border-slate-200"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl border-slate-200">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[#0D0D55] hover:bg-[#1a1a77] text-white rounded-xl"
          >
            {saving ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
            Log Incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
