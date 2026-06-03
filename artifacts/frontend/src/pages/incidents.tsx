import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { parseISO, formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Plus, Clock, Activity, ClipboardList, Siren, AlertCircle, Loader2 } from "lucide-react";
import { getIncidentStats, listIncidents } from "@/services/incidentService";

// ── Design tokens — aligned with Dashboard ────────────────────────────────────
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

// ── Constants ─────────────────────────────────────────────────────────────────
const INCIDENT_TYPES: Record<string, string> = {
  injury: "Injury", medication_error: "Medication Error",
  behaviour_of_concern: "Behaviour of Concern", property_damage: "Property Damage",
  abuse_neglect: "Abuse / Neglect", restrictive_practice: "Restrictive Practice",
  environmental: "Environmental Hazard", elopement: "Elopement",
  near_miss: "Near Miss", other: "Other",
};

const SEVERITIES = [
  { value: "low",      label: "Low",      color: "#16A34A", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "#16A34A", leftBorder: "#16A34A" },
  { value: "medium",   label: "Medium",   color: "#D97706", bg: "bg-amber-50 text-amber-700 border-amber-200",       dot: "#D97706", leftBorder: "#D97706" },
  { value: "high",     label: "High",     color: "#EA580C", bg: "bg-orange-50 text-orange-700 border-orange-200",    dot: "#EA580C", leftBorder: "#EA580C" },
  { value: "critical", label: "Critical", color: "#DC2626", bg: "bg-red-50 text-red-700 border-red-200",             dot: "#DC2626", leftBorder: "#DC2626" },
] as const;

const STATUSES = [
  { value: "reported",            label: "Reported",            color: "#2563EB", bg: "bg-blue-50 text-blue-700 border-blue-200"     },
  { value: "under_investigation", label: "Under Investigation", color: "#D97706", bg: "bg-amber-50 text-amber-700 border-amber-200"  },
  { value: "resolved",            label: "Resolved",            color: "#16A34A", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "closed",              label: "Closed",              color: MUTED,     bg: "bg-slate-50 text-slate-600 border-slate-200"  },
] as const;

function getSeverityConfig(sev: string) { return SEVERITIES.find(s => s.value === sev) ?? SEVERITIES[1]; }
function getStatusConfig(st: string)    { return STATUSES.find(s => s.value === st)    ?? STATUSES[0];   }

interface Incident {
  id: string; title: string; incident_type: string; severity: string;
  status: string; incident_date: string; ndis_pending: boolean;
  overdue: boolean; participant_name?: string;
}
interface IncidentStats {
  total: number; open: number; ndis_pending: number; overdue: number; critical: number;
}

export default function Incidents() {
  const [, navigate] = useLocation();
  const [search,         setSearch        ] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus,   setFilterStatus  ] = useState("all");

  const { data: incidents = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: () => listIncidents<Incident[]>(),
  });
  const { data: stats } = useQuery<IncidentStats>({
    queryKey: ["incident-stats"],
    queryFn: () => getIncidentStats<IncidentStats>(),
  });

  const filtered = useMemo(() => incidents.filter(i => {
    if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
    if (filterStatus   !== "all" && i.status   !== filterStatus  ) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.title.toLowerCase().includes(q) ||
        (i.participant_name ?? "").toLowerCase().includes(q) ||
        (INCIDENT_TYPES[i.incident_type] ?? "").toLowerCase().includes(q);
    }
    return true;
  }), [incidents, filterSeverity, filterStatus, search]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            NDIS Practice Standard 2.3
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
            Incident Management
          </h1>
        </div>
        <button
          onClick={() => navigate("/incidents/new")}
          className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95 active:scale-[0.99]"
          style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Log Incident
        </button>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {([
          { label: "Total",        value: stats?.total        ?? 0, icon: ClipboardList, valueColor: PLUM    },
          { label: "Open",         value: stats?.open         ?? 0, icon: Activity,      valueColor: "#D97706" },
          { label: "NDIS Pending", value: stats?.ndis_pending ?? 0, icon: Siren,         valueColor: "#DC2626" },
          { label: "Overdue",      value: stats?.overdue      ?? 0, icon: Clock,         valueColor: "#EA580C" },
          { label: "Critical",     value: stats?.critical     ?? 0, icon: AlertCircle,   valueColor: "#DC2626" },
        ] as const).map(({ label, value, icon: Icon, valueColor }) => (
          <section key={label} className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>{label}</p>
                <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: valueColor }}>{value}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg shrink-0" style={{ background: SOFT, color: PLUM }}>
                <Icon size={20} strokeWidth={2.5} />
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* ── NDIS notification banner ─────────────────────────────────────────── */}
      {(stats?.ndis_pending ?? 0) > 0 && (
        <div
          className="rounded-lg border px-4 py-3.5 flex items-start gap-3"
          style={{ background: "#FFF5F5", borderColor: "#FECACA", borderLeft: "3px solid #DC2626" }}
        >
          <Siren size={15} className="shrink-0 mt-0.5 animate-pulse" style={{ color: "#DC2626" }} />
          <p className="text-sm font-medium" style={{ color: "#991B1B" }}>
            <strong className="font-black">{stats?.ndis_pending}</strong> incident{(stats?.ndis_pending ?? 0) > 1 ? "s" : ""} require NDIS Quality &amp; Safeguards Commission notification. Critical incidents must be reported within 24 hours.
          </p>
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Input
            placeholder="Search incidents, participant, type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 rounded-lg text-sm"
            style={{ borderColor: BORDER }}
          />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="h-10 rounded-lg text-sm w-full sm:w-40" style={{ borderColor: BORDER }}>
            <SelectValue placeholder="All severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            {SEVERITIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-10 rounded-lg text-sm w-full sm:w-48" style={{ borderColor: BORDER }}>
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Incident list ────────────────────────────────────────────────────── */}
      <section className="rounded-lg border bg-white shadow-sm" style={{ borderColor: BORDER }}>

        {/* list header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            {filterSeverity !== "all" || filterStatus !== "all" || search ? "Filtered Results" : "All Incidents"}
          </h2>
          {filtered.length > 0 && (
            <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: SOFT, color: PLUM }}>
              {filtered.length} {filtered.length === 1 ? "record" : "records"}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16" style={{ color: MUTED }}>
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-black" style={{ color: TEXT }}>No incidents found</p>
            {incidents.length === 0 && (
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                No incidents have been logged yet.{" "}
                <button
                  onClick={() => navigate("/incidents/new")}
                  className="font-black underline underline-offset-2"
                  style={{ color: PLUM }}
                >
                  Log the first one
                </button>
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "#EEEAFB" }}>
            {filtered.map(incident => {
              const sev = getSeverityConfig(incident.severity);
              const st  = getStatusConfig(incident.status);
              return (
                <button
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className="w-full text-left px-6 py-4 flex items-center gap-4 transition hover:bg-[#F8F6FE] group"
                  style={{ borderLeft: `3px solid ${sev.leftBorder}` }}
                >
                  {/* Severity dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: sev.dot }}
                  />

                  {/* Main text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate transition group-hover:text-[#5533CC]" style={{ color: TEXT }}>
                      {incident.title}
                    </p>
                    <p className="text-xs font-medium mt-0.5 truncate" style={{ color: MUTED }}>
                      {incident.participant_name || "No participant linked"}
                      {" · "}
                      {INCIDENT_TYPES[incident.incident_type] ?? incident.incident_type}
                      {incident.incident_date && (
                        <> · {formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })}</>
                      )}
                    </p>
                  </div>

                  {/* Badges */}
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${sev.bg}`}>
                      {sev.label}
                    </span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${st.bg}`}>
                      {st.label}
                    </span>
                    {incident.ndis_pending && (
                      <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold bg-red-50 text-red-700 border-red-200">
                        NDIS Alert
                      </span>
                    )}
                    {incident.overdue && (
                      <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold bg-orange-50 text-orange-700 border-orange-200">
                        Overdue
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer count */}
      {!isLoading && filtered.length > 0 && filtered.length < incidents.length && (
        <p className="text-xs font-bold text-right" style={{ color: MUTED }}>
          Showing {filtered.length} of {incidents.length} incidents
        </p>
      )}
    </div>
  );
}
