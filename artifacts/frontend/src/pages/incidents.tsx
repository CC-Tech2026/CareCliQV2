import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Plus, Search, Clock, Activity,
  ClipboardList, Siren, AlertCircle, ChevronRight, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM  = "#542269";
const CORAL = "#F1738A";
const T1    = "#1C1626";
const T2    = "#4A3D5A";
const T3    = "#7A6A8A";
const BORDER = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

// ── Constants ─────────────────────────────────────────────────────────────────
const INCIDENT_TYPES: Record<string, string> = {
  injury: "Injury", medication_error: "Medication Error",
  behaviour_of_concern: "Behaviour of Concern", property_damage: "Property Damage",
  abuse_neglect: "Abuse / Neglect", restrictive_practice: "Restrictive Practice",
  environmental: "Environmental Hazard", elopement: "Elopement",
  near_miss: "Near Miss", other: "Other",
};

const SEVERITIES = [
  { value: "low",      label: "Low",      color: "#16A34A", bg: "rgba(22,163,74,0.08)",   border: "rgba(22,163,74,0.2)",   leftBorder: "#16A34A" },
  { value: "medium",   label: "Medium",   color: "#D97706", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  leftBorder: "#D97706" },
  { value: "high",     label: "High",     color: "#EA580C", bg: "rgba(234,88,12,0.08)",   border: "rgba(234,88,12,0.2)",   leftBorder: "#EA580C" },
  { value: "critical", label: "Critical", color: "#DC2626", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   leftBorder: "#DC2626" },
] as const;

const STATUSES = [
  { value: "reported",             label: "Reported",             color: "#2563EB", bg: "rgba(37,99,235,0.08)"   },
  { value: "under_investigation",  label: "Under Investigation",  color: "#D97706", bg: "rgba(245,158,11,0.08)"  },
  { value: "resolved",             label: "Resolved",             color: "#16A34A", bg: "rgba(22,163,74,0.08)"   },
  { value: "closed",               label: "Closed",               color: T3,        bg: `rgba(84,34,105,0.06)`   },
] as const;

function getSeverityConfig(sev: string) { return SEVERITIES.find(s => s.value === sev) ?? SEVERITIES[1]; }
function getStatusConfig(st: string)    { return STATUSES.find(s => s.value === st)    ?? STATUSES[0];   }

// ── Types ─────────────────────────────────────────────────────────────────────
interface Incident {
  id: string; title: string; incident_type: string; severity: string;
  status: string; incident_date: string; ndis_pending: boolean;
  overdue: boolean; participant_name?: string;
}
interface IncidentStats {
  total: number; open: number; ndis_pending: number; overdue: number; critical: number;
}

async function apiFetch(path: string) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Incidents() {
  const [, navigate] = useLocation();
  const [search,         setSearch        ] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus,   setFilterStatus  ] = useState("all");

  const { data: incidents = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: () => apiFetch("/incidents"),
  });
  const { data: stats } = useQuery<IncidentStats>({
    queryKey: ["incident-stats"],
    queryFn: () => apiFetch("/incidents/stats"),
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
    <div className="flex flex-col gap-6 h-full max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-end justify-between shrink-0 gap-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight" style={{ color: T1 }}>
            Incident Management
          </h1>
          <p className="text-[14px] mt-1" style={{ color: T2 }}>
            NDIS Practice Standard 2.3 — Incident management &amp; notification
          </p>
        </div>
        <button
          onClick={() => navigate("/incidents/new")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all duration-200 hover:opacity-90 shrink-0"
          style={{ background: PLUM }}
        >
          <Plus size={14} strokeWidth={2.5} /> Log Incident
        </button>
      </div>

      {/* ── Stat pills ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
        {[
          { label: "Total",        value: stats?.total        ?? 0, icon: ClipboardList, color: PLUM,      bg: `${PLUM}0A`               },
          { label: "Open",         value: stats?.open         ?? 0, icon: Activity,      color: "#D97706", bg: "rgba(245,158,11,0.08)"   },
          { label: "NDIS Pending", value: stats?.ndis_pending ?? 0, icon: Siren,         color: "#DC2626", bg: "rgba(239,68,68,0.08)"    },
          { label: "Overdue",      value: stats?.overdue      ?? 0, icon: Clock,         color: "#EA580C", bg: "rgba(234,88,12,0.08)"    },
          { label: "Critical",     value: stats?.critical     ?? 0, icon: AlertCircle,   color: "#DC2626", bg: "rgba(239,68,68,0.07)"    },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label}
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: bg, border: `1px solid rgba(232,213,232,0.4)` }}>
            <Icon size={18} style={{ color }} />
            <div>
              <p className="text-[11px] font-medium" style={{ color: T3 }}>{label}</p>
              <p className="text-[22px] font-bold leading-none mt-0.5" style={{ color }}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── NDIS urgent banner ── */}
      {(stats?.ndis_pending ?? 0) > 0 && (
        <div className="shrink-0 flex items-center gap-3 rounded-2xl px-5 py-3.5"
          style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)" }}>
          <Siren size={16} className="shrink-0" style={{ color: "#DC2626" }} />
          <p className="text-[13px] leading-relaxed" style={{ color: "#991B1B" }}>
            <strong>{stats?.ndis_pending}</strong> incident{(stats?.ndis_pending ?? 0) > 1 ? "s" : ""} require
            NDIS Quality &amp; Safeguards Commission notification. Critical incidents must be reported within 24 hours.
          </p>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex gap-2 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T3 }} />
          <Input
            placeholder="Search incidents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-[13px] rounded-xl"
            style={{ borderColor: BORDER }}
          />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-32 h-9 text-[12px] rounded-xl" style={{ borderColor: BORDER }}>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            {SEVERITIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 h-9 text-[12px] rounded-xl" style={{ borderColor: BORDER }}>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Incident grid ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20" style={{ color: T3 }}>
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <AlertTriangle size={28} style={{ color: "rgba(232,213,232,0.8)" }} />
            <p className="text-[14px] font-medium" style={{ color: T2 }}>No incidents found</p>
            {incidents.length === 0 && (
              <button
                onClick={() => navigate("/incidents/new")}
                className="mt-1 flex items-center gap-1.5 px-4 py-2 rounded-xl border text-[13px] font-semibold transition-colors duration-150 hover:bg-[#F6F4FB]"
                style={{ borderColor: BORDER, color: T2 }}
              >
                <Plus size={13} /> Log your first incident
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(incident => {
              const sev = getSeverityConfig(incident.severity);
              const st  = getStatusConfig(incident.status);
              return (
                <button
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className="text-left w-full rounded-2xl bg-white p-4 border-l-4 transition-all duration-200 hover:-translate-y-0.5 group"
                  style={{
                    boxShadow: CARD_SHADOW,
                    borderLeftColor: sev.leftBorder,
                    borderTopColor: BORDER, borderRightColor: BORDER, borderBottomColor: BORDER,
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-[14px] font-semibold line-clamp-2 flex-1 transition-colors duration-150 group-hover:text-[#542269]"
                      style={{ color: T1 }}>
                      {incident.title}
                    </p>
                    <ChevronRight size={13} className="shrink-0 mt-0.5 transition-colors duration-150" style={{ color: T3 }} />
                  </div>

                  <p className="text-[12px] mb-3 line-clamp-1" style={{ color: T3 }}>
                    {incident.participant_name || "No participant linked"} · {INCIDENT_TYPES[incident.incident_type] ?? incident.incident_type}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: sev.bg, color: sev.color }}>
                      {sev.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                    {incident.ndis_pending && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#DC2626" }}>
                        NDIS Alert
                      </span>
                    )}
                    {incident.overdue && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: "rgba(234,88,12,0.08)", color: "#EA580C" }}>
                        Overdue
                      </span>
                    )}
                  </div>

                  <p className="text-[11px]" style={{ color: T3 }}>
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

      {filtered.length > 0 && (
        <p className="shrink-0 text-[11px] text-right" style={{ color: T3 }}>
          Showing {filtered.length} of {incidents.length} incidents
        </p>
      )}
    </div>
  );
}
