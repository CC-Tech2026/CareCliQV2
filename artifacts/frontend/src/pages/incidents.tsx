import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Plus,
  Search,
  Clock,
  Activity,
  ClipboardList,
  Siren,
  AlertCircle,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const INCIDENT_TYPES: Record<string, string> = {
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

function severityBorderColor(sev: string) {
  return sev === "critical" ? "border-l-red-500" :
    sev === "high" ? "border-l-orange-500" :
    sev === "medium" ? "border-l-amber-400" : "border-l-emerald-400";
}

function getSeverityConfig(sev: string) {
  return SEVERITIES.find((s) => s.value === sev) ?? SEVERITIES[1];
}

function getStatusConfig(st: string) {
  return STATUSES.find((s) => s.value === st) ?? STATUSES[0];
}

interface Incident {
  id: string;
  title: string;
  incident_type: string;
  severity: string;
  status: string;
  incident_date: string;
  ndis_pending: boolean;
  overdue: boolean;
  participant_name?: string;
}

interface IncidentStats {
  total: number;
  open: number;
  ndis_pending: number;
  overdue: number;
  critical: number;
}

async function apiFetch(path: string) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export default function Incidents() {
  const [, navigate] = useLocation();
  useQueryClient();

  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: incidents = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: () => apiFetch("/incidents"),
  });

  const { data: stats } = useQuery<IncidentStats>({
    queryKey: ["incident-stats"],
    queryFn: () => apiFetch("/incidents/stats"),
  });

  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
      if (filterStatus !== "all" && i.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          i.title.toLowerCase().includes(q) ||
          (i.participant_name ?? "").toLowerCase().includes(q) ||
          (INCIDENT_TYPES[i.incident_type] ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [incidents, filterSeverity, filterStatus, search]);

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header */}
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
          onClick={() => navigate("/incidents/new")}
          className="bg-[#0D0D55] hover:bg-[#1a1a77] text-white rounded-2xl gap-2"
        >
          <Plus size={16} />
          Log Incident
        </Button>
      </div>

      {/* Stats bar */}
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

      {/* NDIS urgent banner */}
      {(stats?.ndis_pending ?? 0) > 0 && (
        <div className="shrink-0 flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-3">
          <Siren size={18} className="text-red-600 shrink-0" />
          <p className="text-sm text-red-800 font-medium">
            <strong>{stats?.ndis_pending}</strong> incident{(stats?.ndis_pending ?? 0) > 1 ? "s" : ""} require NDIS Quality &amp; Safeguards Commission notification. Critical incidents must be reported within 24 hours.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search incidents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-sm rounded-xl border-slate-200 h-9"
          />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-32 h-9 text-xs rounded-xl border-slate-200">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9 text-xs rounded-xl border-slate-200">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <AlertTriangle size={32} className="text-slate-200" />
            <p className="text-sm font-medium">No incidents found</p>
            {incidents.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/incidents/new")}
                className="mt-1 rounded-xl border-slate-200 gap-1.5"
              >
                <Plus size={14} /> Log your first incident
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((incident) => {
              const sev = getSeverityConfig(incident.severity);
              const st = getStatusConfig(incident.status);
              return (
                <button
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className={cn(
                    "text-left w-full rounded-2xl border-l-4 border border-slate-100 bg-white p-4 shadow-sm hover:shadow-md transition-all group",
                    severityBorderColor(incident.severity),
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-[#0D0D55] line-clamp-2 flex-1 group-hover:text-[#5271FF] transition-colors">
                      {incident.title}
                    </p>
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-[#5271FF] shrink-0 mt-0.5 transition-colors" />
                  </div>

                  <p className="text-xs text-slate-500 mb-2 line-clamp-1">
                    {incident.participant_name || "No participant linked"} · {INCIDENT_TYPES[incident.incident_type] ?? incident.incident_type}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", sev.color)}>
                      {sev.label}
                    </Badge>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", st.color)}>
                      {st.label}
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

                  <p className="text-[10px] text-slate-400">
                    {incident.incident_date
                      ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                      : ""}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer count */}
      {filtered.length > 0 && (
        <p className="shrink-0 text-xs text-slate-400 text-right">
          Showing {filtered.length} of {incidents.length} incidents
        </p>
      )}
    </div>
  );
}
