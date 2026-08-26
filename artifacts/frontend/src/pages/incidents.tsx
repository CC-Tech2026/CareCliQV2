import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useLocation } from "wouter";
import { parseISO, formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { SectionInfo } from "@/components/ui/section-info";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Clock, Activity, ClipboardList, Siren, AlertCircle, Loader2 } from "lucide-react";
import { getIncidentStats, listIncidents } from "@/services/incidentService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { IncidentRegisterPanel } from "@/components/incidents/IncidentRegisterPanel";

const PLUM   = "var(--cc-plum)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";
const PAGE_SIZE = 10;

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
  id: string; title: string; incident_type: string; severity: string;
  status: string; incident_date: string; ndis_pending: boolean;
  overdue: boolean; participant_name?: string;
}
interface IncidentStats {
  total: number; open: number; ndis_pending: number; overdue: number; critical: number;
}

function WorkerIncidentsList() {
  const [, navigate] = useLocation();
  const { translate, translateParams } = useAccessibility();
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data: incidents = [], isLoading } = useOrgQuery<Incident[]>(["incidents"], {
    queryFn: () => listIncidents<Incident[]>(),
  });
  const { data: stats } = useOrgQuery<IncidentStats>(["incident-stats"], {
    queryFn: () => getIncidentStats<IncidentStats>(),
  });

  const filtered = useMemo(() => incidents.filter(i => {
    if (filterSeverity !== "all" && i.severity !== filterSeverity) return false;
    if (filterStatus !== "all" && i.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.title.toLowerCase().includes(q) ||
        (i.participant_name ?? "").toLowerCase().includes(q) ||
        incidentTypeLabel(i.incident_type, translate).toLowerCase().includes(q);
    }
    return true;
  }), [incidents, filterSeverity, filterStatus, search, translate]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, filterSeverity, filterStatus]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const loadMore = useCallback(() => {
    setVisibleCount((n) => Math.min(n + PAGE_SIZE, filtered.length));
  }, [filtered.length]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) loadMore(); },
      { root, rootMargin: "80px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, visible.length]);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black tracking-tight" style={{ color: TEXT }}>
            {translate("incidents.title")}
            <SectionInfo text="Record and follow up on incidents, from first report through investigation and NDIS notification where required." />
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            {translate("incidents.workerSubtitle")}
          </p>
        </div>
        <button
          onClick={() => navigate("/incidents/new")}
          className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95"
          style={{ background: "var(--cc-cta)" }}
        >
          <Plus size={15} strokeWidth={2.5} />
          {translate("incidents.log")}
        </button>
      </div>

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

      <section className="rounded-lg border bg-white shadow-sm" style={{ borderColor: BORDER }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16" style={{ color: MUTED }}>
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-black" style={{ color: TEXT }}>{translate("incidents.noIncidentsFound")}</p>
          </div>
        ) : (
          <div ref={listRef} className="divide-y max-h-[min(60vh,560px)] overflow-y-auto">
            {visible.map(incident => {
              const sevStyle = SEVERITY_STYLES[incident.severity] ?? SEVERITY_STYLES.medium;
              const stStyle = STATUS_STYLES[incident.status] ?? STATUS_STYLES.reported;
              return (
                <button
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className="w-full text-left px-6 py-4 flex items-center gap-4 transition hover:bg-[#F8F6FE] group"
                  style={{ borderLeft: `3px solid ${sevStyle.leftBorder}` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: TEXT }}>{incident.title}</p>
                    <p className="text-xs font-medium mt-0.5 truncate" style={{ color: MUTED }}>
                      {incident.participant_name || translate("incidents.noParticipant")}
                      {" · "}
                      {incidentTypeLabel(incident.incident_type, translate)}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${stStyle.bg}`}>
                    {statusLabel(incident.status, translate)}
                  </span>
                </button>
              );
            })}
            {hasMore && <div ref={sentinelRef} className="h-4" aria-hidden />}
          </div>
        )}
      </section>

      {!isLoading && stats && filtered.length > 0 && (
        <p className="text-xs font-bold text-right" style={{ color: MUTED }}>
          {translateParams("incidents.showingCount", { filtered: String(filtered.length), total: String(stats.total) })}
        </p>
      )}
    </div>
  );
}

export default function Incidents() {
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator";

  if (isCoordinator) {
    return <IncidentRegisterPanel />;
  }

  return <WorkerIncidentsList />;
}
