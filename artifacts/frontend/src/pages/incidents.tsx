import { useState, useMemo } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useLocation } from "wouter";
import { parseISO, formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Plus, Clock, Activity, ClipboardList, Siren, AlertCircle, Loader2 } from "lucide-react";
import { getIncidentStats, listIncidents } from "@/services/incidentService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

// -- Design tokens � aligned with Dashboard ------------------------------------
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

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

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
const SEVERITY_STYLES: Record<string, { color: string; bg: string; dot: string; leftBorder: string }> = {
  low: { color: "#16A34A", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "#16A34A", leftBorder: "#16A34A" },
  medium: { color: "#D97706", bg: "bg-amber-50 text-amber-700 border-amber-200", dot: "#D97706", leftBorder: "#D97706" },
  high: { color: "#EA580C", bg: "bg-orange-50 text-orange-700 border-orange-200", dot: "#EA580C", leftBorder: "#EA580C" },
  critical: { color: "#DC2626", bg: "bg-red-50 text-red-700 border-red-200", dot: "#DC2626", leftBorder: "#DC2626" },
};

const STATUS_VALUES = ["reported", "under_investigation", "resolved", "closed"] as const;
const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  reported: { color: "#2563EB", bg: "bg-blue-50 text-blue-700 border-blue-200" },
  under_investigation: { color: "#D97706", bg: "bg-amber-50 text-amber-700 border-amber-200" },
  resolved: { color: "#16A34A", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { color: MUTED, bg: "bg-slate-50 text-slate-600 border-slate-200" },
};

function severityLabel(value: string, translate: (key: string) => string) {
  const key = `incidents.severity.${value}` as const;
  return translate(key);
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
  id: string; title: string; incident_type: string; severity: string;
  status: string; incident_date: string; ndis_pending: boolean;
  overdue: boolean; participant_name?: string;
}
interface IncidentStats {
  total: number; open: number; ndis_pending: number; overdue: number; critical: number;
}

export default function Incidents() {
  const [, navigate] = useLocation();
  const { translate, translateParams } = useAccessibility();
  const [search,         setSearch        ] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus,   setFilterStatus  ] = useState("all");

  const { data: incidents = [], isLoading } = useOrgQuery<Incident[]>(["incidents"], {
    queryFn: () => listIncidents<Incident[]>(),
  });
  const { data: stats } = useOrgQuery<IncidentStats>(["incident-stats"], {
    queryFn: () => getIncidentStats<IncidentStats>(),
  });

  const filtered = useMemo(() => incidents.filter(i => {
    if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
    if (filterStatus   !== "all" && i.status   !== filterStatus  ) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.title.toLowerCase().includes(q) ||
        (i.participant_name ?? "").toLowerCase().includes(q) ||
        incidentTypeLabel(i.incident_type, translate).toLowerCase().includes(q);
    }
    return true;
  }), [incidents, filterSeverity, filterStatus, search, translate]);

  return (
    <div className="space-y-6 pb-10">

      {/* -- Page header ------------------------------------------------------- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            NDIS Practice Standard 2.3
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight" style={{ color: TEXT }}>
            {translate("incidents.title")}
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            Report and track incidents, restrictive practices and safety concerns
          </p>
        </div>
        <button
          onClick={() => navigate("/incidents/new")}
          className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95 active:scale-[0.99]"
          style={{ background: "var(--cc-cta)" }}
        >
          <Plus size={15} strokeWidth={2.5} />
          {translate("incidents.log")}
        </button>
      </div>

      {/* -- Stat cards -------------------------------------------------------- */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {([
          { label: translate("incidents.total"), value: stats?.total ?? 0, icon: ClipboardList, valueColor: PLUM },
          { label: translate("incidents.open"), value: stats?.open ?? 0, icon: Activity, valueColor: "#D97706" },
          { label: translate("incidents.ndisPending"), value: stats?.ndis_pending ?? 0, icon: Siren, valueColor: "#DC2626" },
          { label: translate("incidents.overdue"), value: stats?.overdue ?? 0, icon: Clock, valueColor: "#EA580C" },
          { label: translate("incidents.critical"), value: stats?.critical ?? 0, icon: AlertCircle, valueColor: "#DC2626" },
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

      {/* -- NDIS notification banner ------------------------------------------- */}
      {(stats?.ndis_pending ?? 0) > 0 && (
        <div
          className="rounded-lg border px-4 py-3.5 flex items-start gap-3"
          style={{ background: "#FFF5F5", borderColor: "#FECACA", borderLeft: "3px solid #DC2626" }}
        >
          <Siren size={15} className="shrink-0 mt-0.5 animate-pulse" style={{ color: "#DC2626" }} />
          <p className="text-sm font-medium" style={{ color: "#991B1B" }}>
            {translateParams("incidents.ndisBanner", { count: String(stats?.ndis_pending ?? 0) })}
          </p>
        </div>
      )}

      {/* -- Filter bar -------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Input
            placeholder={translate("incidents.searchPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 rounded-lg text-sm"
            style={{ borderColor: BORDER }}
          />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="h-10 rounded-lg text-sm w-full sm:w-40" style={{ borderColor: BORDER }}>
            <SelectValue placeholder={translate("incidents.allSeverity")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{translate("incidents.allSeverity")}</SelectItem>
            {SEVERITY_VALUES.map((value) => (
              <SelectItem key={value} value={value}>{severityLabel(value, translate)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-10 rounded-lg text-sm w-full sm:w-48" style={{ borderColor: BORDER }}>
            <SelectValue placeholder={translate("incidents.allStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{translate("incidents.allStatus")}</SelectItem>
            {STATUS_VALUES.map((value) => (
              <SelectItem key={value} value={value}>{statusLabel(value, translate)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* -- Incident list ------------------------------------------------------ */}
      <section className="rounded-lg border bg-white shadow-sm" style={{ borderColor: BORDER }}>

        {/* list header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            {filterSeverity !== "all" || filterStatus !== "all" || search
              ? translate("incidents.filteredResults")
              : translate("incidents.allIncidents")}
          </h2>
          {filtered.length > 0 && (
            <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: SOFT, color: PLUM }}>
              {filtered.length} {filtered.length === 1 ? translate("incidents.record") : translate("incidents.records")}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16" style={{ color: MUTED }}>
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-black" style={{ color: TEXT }}>{translate("incidents.noIncidentsFound")}</p>
            {incidents.length === 0 && (
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                {translate("incidents.noIncidentsYet")}{" "}
                <button
                  onClick={() => navigate("/incidents/new")}
                  className="font-black underline underline-offset-2"
                  style={{ color: PLUM }}
                >
                  {translate("incidents.logFirst")}
                </button>
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "#EDE3FC" }}>
            {filtered.map(incident => {
              const sevStyle = SEVERITY_STYLES[incident.severity] ?? SEVERITY_STYLES.medium;
              const stStyle = STATUS_STYLES[incident.status] ?? STATUS_STYLES.reported;
              return (
                <button
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className="w-full text-left px-6 py-4 flex items-center gap-4 transition hover:bg-[#F8F6FE] group"
                  style={{ borderLeft: `3px solid ${sevStyle.leftBorder}` }}
                >
                  {/* Severity dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: sevStyle.dot }}
                  />

                  {/* Main text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate transition group-hover:text-[#E8457A]" style={{ color: TEXT }}>
                      {incident.title}
                    </p>
                    <p className="text-xs font-medium mt-0.5 truncate" style={{ color: MUTED }}>
                      {incident.participant_name || translate("incidents.noParticipant")}
                      {" � "}
                      {incidentTypeLabel(incident.incident_type, translate)}
                      {incident.incident_date && (
                        <> � {formatDistanceToNow(parseISO(incident.incident_date), { addSuffix: true })}</>
                      )}
                    </p>
                  </div>

                  {/* Badges */}
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${sevStyle.bg}`}>
                      {severityLabel(incident.severity, translate)}
                    </span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${stStyle.bg}`}>
                      {statusLabel(incident.status, translate)}
                    </span>
                    {incident.ndis_pending && (
                      <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold bg-red-50 text-red-700 border-red-200">
                        {translate("incidents.ndisAlert")}
                      </span>
                    )}
                    {incident.overdue && (
                      <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold bg-orange-50 text-orange-700 border-orange-200">
                        {translate("incidents.overdue")}
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
          {translateParams("incidents.showingCount", {
            filtered: String(filtered.length),
            total: String(incidents.length),
          })}
        </p>
      )}
    </div>
  );
}
