import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { parseISO, formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Plus, Search, Clock, Activity,
  ClipboardList, Siren, AlertCircle, ChevronRight, Loader2,
} from "lucide-react";
import { getIncidentStats, listIncidents } from "@/services/incidentService";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const T1     = "#1E1640";
const T2     = "#4A3D5A";
const T3     = "#7A6A9E";
const BORDER = "#EBE5F6";
const CARD_SHADOW = "0 2px 12px rgba(85,51,204,0.05), 0 1px 3px rgba(0,0,0,0.03)";

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
  { value: "reported",             label: "Reported",             color: "#2563EB", bg: "rgba(37,99,235,0.08)"  },
  { value: "under_investigation",  label: "Under Investigation",  color: "#D97706", bg: "rgba(245,158,11,0.08)" },
  { value: "resolved",             label: "Resolved",             color: "#16A34A", bg: "rgba(22,163,74,0.08)"  },
  { value: "closed",               label: "Closed",               color: T3,        bg: "rgba(85,51,204,0.06)"  },
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

// ── Page ──────────────────────────────────────────────────────────────────────
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
    <div className="flex flex-col gap-5 h-full max-w-5xl mx-auto">

      {/* ── Page header banner ─────────────────────────────────────────────── */}
      <div
        className="rounded-2xl px-6 py-4 flex items-center justify-between gap-4"
        style={{
          background: "linear-gradient(135deg, rgba(85,51,204,0.07) 0%, rgba(240,48,96,0.03) 100%)",
          border: "1px solid rgba(85,51,204,0.1)",
        }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(240,48,96,0.1)" }}
          >
            <AlertTriangle className="h-5 w-5" style={{ color: CORAL }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-bold tracking-tight" style={{ color: T1 }}>Incident Management</h1>
            <p className="text-[12px] mt-0.5" style={{ color: T3 }}>
              NDIS Practice Standard 2.3 — Incident management &amp; notification
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate("/incidents/new")}
          className="flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-white text-[13px] font-bold transition-all active:scale-[0.98] hover:opacity-90 shrink-0 shadow-sm"
          style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
        >
          <Plus size={15} strokeWidth={2.5} /> Log Incident
        </button>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Total",        value: stats?.total        ?? 0, icon: ClipboardList, color: PLUM,      iconBg: "rgba(85,51,204,0.08)"   },
          { label: "Open",         value: stats?.open         ?? 0, icon: Activity,      color: "#D97706", iconBg: "rgba(245,158,11,0.10)"  },
          { label: "NDIS Pending", value: stats?.ndis_pending ?? 0, icon: Siren,         color: "#DC2626", iconBg: "rgba(239,68,68,0.10)"   },
          { label: "Overdue",      value: stats?.overdue      ?? 0, icon: Clock,         color: "#EA580C", iconBg: "rgba(234,88,12,0.10)"   },
          { label: "Critical",     value: stats?.critical     ?? 0, icon: AlertCircle,   color: "#DC2626", iconBg: "rgba(239,68,68,0.09)"   },
        ].map(({ label, value, icon: Icon, color, iconBg }) => (
          <div
            key={label}
            className="bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3"
            style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: iconBg }}>
              <Icon size={16} style={{ color }} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: T3 }}>{label}</p>
              <p className="text-[22px] font-black leading-none mt-0.5" style={{ color }}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── NDIS Warning Banner ─────────────────────────────────────────────── */}
      {(stats?.ndis_pending ?? 0) > 0 && (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
          style={{
            background: "rgba(239,68,68,0.05)",
            border: "1px solid rgba(239,68,68,0.15)",
            borderLeft: "3px solid #DC2626",
          }}
        >
          <Siren size={16} className="shrink-0 mt-0.5 animate-pulse" style={{ color: "#DC2626" }} />
          <p className="text-[13px] leading-relaxed" style={{ color: "#991B1B" }}>
            <strong>{stats?.ndis_pending}</strong> incident{(stats?.ndis_pending ?? 0) > 1 ? "s" : ""} require
            NDIS Quality &amp; Safeguards Commission notification. Critical incidents must be reported within 24 hours.
          </p>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div
        className="bg-white rounded-2xl p-3 flex flex-col sm:flex-row gap-2"
        style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
      >
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T3 }} />
          <Input
            placeholder="Search incidents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px] rounded-xl bg-[#F8F6FE] border-0 focus-visible:ring-1 focus-visible:ring-[#5533CC]/30"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="h-9 text-[13px] rounded-xl bg-[#F8F6FE] border-0 focus:ring-1 focus:ring-[#5533CC]/30 min-w-[130px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severity</SelectItem>
              {SEVERITIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 text-[13px] rounded-xl bg-[#F8F6FE] border-0 focus:ring-1 focus:ring-[#5533CC]/30 min-w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Card Feed ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20" style={{ color: T3 }}>
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3 rounded-2xl border border-dashed"
            style={{ borderColor: BORDER, background: "rgba(245,243,252,0.5)" }}
          >
            <AlertTriangle size={32} className="opacity-50" style={{ color: T3 }} />
            <p className="text-[14px] font-bold" style={{ color: T2 }}>No incidents found</p>
            {incidents.length === 0 && (
              <button
                onClick={() => navigate("/incidents/new")}
                className="mt-1 flex items-center gap-1.5 h-10 px-4 rounded-xl border text-[13px] font-bold transition-colors bg-white hover:bg-[#F8F6FE]"
                style={{ borderColor: BORDER, color: T2 }}
              >
                <Plus size={14} /> Log your first incident
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pb-4">
            {filtered.map(incident => {
              const sev = getSeverityConfig(incident.severity);
              const st  = getStatusConfig(incident.status);
              return (
                <button
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className="text-left w-full bg-white rounded-2xl p-4 border-l-4 transition-all duration-150 active:scale-[0.99] hover:-translate-y-0.5 group flex flex-col justify-between"
                  style={{
                    boxShadow: CARD_SHADOW,
                    border: `1px solid ${BORDER}`,
                    borderLeftColor: sev.leftBorder,
                    borderLeftWidth: 4,
                  }}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p
                        className="text-[14px] font-bold line-clamp-2 leading-snug flex-1 transition-colors duration-150 group-hover:text-[#5533CC]"
                        style={{ color: T1 }}
                      >
                        {incident.title}
                      </p>
                      <ChevronRight size={15} className="shrink-0 mt-0.5 text-slate-300 transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <p className="text-[12px] font-medium mb-3 line-clamp-1" style={{ color: T3 }}>
                      {incident.participant_name || "No participant linked"} · {INCIDENT_TYPES[incident.incident_type] ?? incident.incident_type}
                    </p>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: sev.bg, color: sev.color }}>
                        {sev.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                      {incident.ndis_pending && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: "rgba(239,68,68,0.08)", color: "#DC2626" }}>
                          NDIS Alert
                        </span>
                      )}
                      {incident.overdue && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: "rgba(234,88,12,0.08)", color: "#EA580C" }}>
                          Overdue
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-medium" style={{ color: T3 }}>
                      {incident.incident_date
                        ? formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })
                        : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Footer count ────────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <p className="shrink-0 text-[11px] font-semibold text-right border-t pt-2" style={{ color: T3, borderColor: BORDER }}>
          Showing {filtered.length} of {incidents.length} incidents
        </p>
      )}
    </div>
  );
}
