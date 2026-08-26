import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { subDays, parseISO, isAfter } from "date-fns";
import {
  Plus, Download, Flag, ShieldAlert, Hourglass, CircleCheck, Bot,
  List, User, AlertTriangle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { listIncidents, getIncidentStats, updateIncident } from "@/services/incidentService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { IncidentAccordionCard, type IncidentCardData } from "./IncidentAccordionCard";
import { SectionInfo } from "@/components/ui/section-info";

type SubTab = "all" | "open" | "review" | "resolved" | "rp";
type TypeFilter = "all" | "restrictive_practice" | "auto" | "manual";
const PAGE_SIZE = 15;

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

const STATUS_MAP: Record<string, string> = {
  reported: "incidents.status.reported",
  under_investigation: "incidents.status.underInvestigation",
  resolved: "incidents.status.resolved",
  closed: "incidents.status.closed",
};

interface IncidentRow extends IncidentCardData {
  session_id?: string;
}

interface Stats {
  total: number;
  open: number;
  ndis_pending: number;
  overdue: number;
  critical: number;
}

function isAutoDetected(row: IncidentRow) {
  return Boolean(row.session_id) || /auto-detect/i.test(row.title || "");
}

export function IncidentRegisterPanel() {
  const [, navigate] = useLocation();
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<SubTab>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);

  const { data: incidents = [], isLoading, refetch } = useOrgQuery<IncidentRow[]>(["incidents"], {
    queryFn: () => listIncidents<IncidentRow[]>(),
  });
  const { data: stats } = useOrgQuery<Stats>(["incident-stats"], {
    queryFn: () => getIncidentStats<Stats>(),
  });

  const thirtyDaysAgo = subDays(new Date(), 30);

  const enriched = useMemo(
    () => incidents.map((row) => ({ ...row, auto_detected: isAutoDetected(row) })),
    [incidents],
  );

  const inWindow = useMemo(
    () =>
      enriched.filter((row) => {
        if (!row.incident_date) return true;
        try {
          return isAfter(parseISO(row.incident_date), thirtyDaysAgo);
        } catch {
          return true;
        }
      }),
    [enriched, thirtyDaysAgo],
  );

  const kpis = useMemo(() => {
    const open = inWindow.filter((r) => r.status === "reported" || r.status === "under_investigation");
    const rp = inWindow.filter((r) => r.incident_type === "restrictive_practice" && r.status !== "closed");
    const review = inWindow.filter((r) => r.status === "under_investigation");
    const resolvedMonth = inWindow.filter((r) => r.status === "resolved" || r.status === "closed");
    const auto = inWindow.filter((r) => r.auto_detected);
    return { open: open.length, rp: rp.length, review: review.length, resolvedMonth: resolvedMonth.length, auto: auto.length };
  }, [inWindow]);

  const filtered = useMemo(() => {
    let rows = inWindow;
    if (subTab === "open") {
      rows = rows.filter((r) => r.status === "reported" || r.status === "under_investigation");
    } else if (subTab === "review") {
      rows = rows.filter((r) => r.status === "under_investigation");
    } else if (subTab === "resolved") {
      rows = rows.filter((r) => r.status === "resolved" || r.status === "closed");
    } else if (subTab === "rp") {
      rows = rows.filter((r) => r.incident_type === "restrictive_practice");
    }
    if (typeFilter === "restrictive_practice") {
      rows = rows.filter((r) => r.incident_type === "restrictive_practice");
    } else if (typeFilter === "auto") {
      rows = rows.filter((r) => r.auto_detected);
    } else if (typeFilter === "manual") {
      rows = rows.filter((r) => !r.auto_detected);
    }
    return rows;
  }, [inWindow, subTab, typeFilter]);

  useEffect(() => {
    setPage(1);
  }, [subTab, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);
  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, index) => index + 1), [totalPages]);

  function typeLabel(type: string) {
    const key = INCIDENT_TYPE_KEYS[type];
    return key ? translate(key) : type.replace(/_/g, " ");
  }

  function statusLabel(status: string) {
    const key = STATUS_MAP[status];
    return key ? translate(key) : status;
  }

  async function handleMarkResolved(id: string) {
    try {
      await updateIncident(id, { status: "resolved", resolved_date: new Date().toISOString() });
      await refetch();
      toast({ title: translate("incidents.detail.markResolved") });
    } catch {
      toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" });
    }
  }

  async function handleNotifyCommission(id: string) {
    try {
      await updateIncident(id, { ndis_reported_at: new Date().toISOString() });
      await refetch();
      toast({ title: translate("incidents.register.notifyCommissionDone") });
    } catch {
      toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" });
    }
  }

  async function handleEscalate(id: string) {
    try {
      await updateIncident(id, { escalate: true });
      await refetch();
      toast({ title: translate("incidents.register.escalateDone") });
    } catch {
      toast({ title: translate("incidents.detail.updateFailed"), variant: "destructive" });
    }
  }

  const subTabs: { id: SubTab; label: string; count?: number }[] = [
    { id: "all", label: translate("incidents.register.tabAll"), count: inWindow.length },
    { id: "open", label: translate("incidents.register.tabOpen"), count: kpis.open },
    { id: "review", label: translate("incidents.register.tabReview"), count: kpis.review || undefined },
    { id: "resolved", label: translate("incidents.register.tabResolved") },
    { id: "rp", label: translate("incidents.register.tabRp"), count: kpis.rp || undefined },
  ];

  const typeFilters: { id: TypeFilter; label: string; icon: typeof List }[] = [
    { id: "all", label: translate("incidents.register.filterAll"), icon: List },
    { id: "restrictive_practice", label: translate("incidents.register.filterRp"), icon: ShieldAlert },
    { id: "auto", label: translate("incidents.register.filterAuto"), icon: Bot },
    { id: "manual", label: translate("incidents.register.filterManual"), icon: User },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--cc-coral)]">
            {translate("incidents.new.standard")}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-black tracking-tight text-[var(--cc-text)]">
            {translate("incidents.register.title")}
            <SectionInfo text="Every incident recorded across your organisation, from all sources, aligned to NDIS Practice Standard Core." />
          </h1>
          <p className="mt-1 text-sm font-medium text-[var(--cc-muted)]">
            All incidents, all sources.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => toast({ title: translate("incidents.register.exportSoon") })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold border border-[var(--cc-border)] text-[var(--cc-text-secondary)] bg-white hover:bg-[var(--cc-soft)]"
          >
            <Download size={14} />
            {translate("incidents.register.export")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/incidents/new")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold text-white bg-[var(--cc-cta)] hover:opacity-95"
          >
            <Plus size={14} />
            {translate("incidents.register.create")}
          </button>
        </div>
      </div>

      <div className="flex gap-0 border-b border-[var(--cc-border)] overflow-x-auto">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={cn(
              "px-4 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 -mb-px transition-colors",
              subTab === tab.id
                ? "text-[var(--cc-plum)] border-[var(--cc-plum)]"
                : "text-[var(--cc-muted)] border-transparent hover:text-[var(--cc-text)]",
            )}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FCEBEB] text-[#791F1F]">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: translate("incidents.register.kpiOpen"), value: kpis.open, sub: translate("incidents.register.kpiOpenSub"), tone: "text-[#E24B4A]", icon: Flag },
          { label: translate("incidents.register.kpiRp"), value: kpis.rp, sub: translate("incidents.register.kpiRpSub"), tone: "text-[#E24B4A]", icon: ShieldAlert },
          { label: translate("incidents.register.kpiReview"), value: kpis.review, sub: translate("incidents.register.kpiReviewSub"), tone: "text-[#BA7517]", icon: Hourglass },
          { label: translate("incidents.register.kpiResolved"), value: kpis.resolvedMonth, sub: translate("incidents.register.kpiResolvedSub"), tone: "text-[#3B9E5A]", icon: CircleCheck },
          { label: translate("incidents.register.kpiAuto"), value: kpis.auto, sub: translate("incidents.register.kpiAutoSub"), tone: "text-[var(--cc-plum)]", icon: Bot },
        ].map(({ label, value, sub, tone, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-[var(--cc-border)] bg-white p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)] flex items-center gap-1 mb-1">
              <Icon size={12} /> {label}
            </p>
            <p className={cn("text-2xl font-black", tone)}>{value}</p>
            <p className="text-[11px] text-[var(--cc-muted)] mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {subTab === "open" && kpis.open > 0 && (
        <div className="rounded-xl border border-[#FAC775] bg-[#FAEEDA] px-4 py-3 flex gap-3">
          <AlertTriangle size={18} className="text-[#BA7517] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-[#633806]">
              {translateParams("incidents.register.openBannerTitle", { count: String(kpis.open) })}
            </p>
            <p className="text-xs text-[#854F0B] mt-0.5">{translate("incidents.register.openBannerBody")}</p>
          </div>
        </div>
      )}

      {subTab === "rp" && kpis.rp > 0 && (
        <div className="rounded-xl border border-[#F7C1C1] bg-[#FCEBEB] px-4 py-3 flex gap-3">
          <ShieldAlert size={18} className="text-[#E24B4A] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-[#791F1F]">{translate("incidents.register.rpBannerTitle")}</p>
            <p className="text-xs text-[#A32D2D] mt-0.5">{translate("incidents.register.rpBannerBody")}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--cc-muted)]">{translate("incidents.register.filterBy")}</span>
        {typeFilters.map((f) => {
          const Icon = f.icon;
          const on = typeFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setTypeFilter(f.id)}
              className={cn(
                "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                on
                  ? "bg-[#EEEDFE] border-[#AFA9EC] text-[#534AB7]"
                  : "bg-white border-[var(--cc-border)] text-[var(--cc-muted)] hover:bg-[var(--cc-soft)]",
              )}
            >
              <Icon size={12} />
              {f.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-[var(--cc-muted)]">
          {translate("incidents.register.last30Days")}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-[var(--cc-muted)]">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--cc-muted)]">
          {translate("incidents.noIncidentsFound")}
        </div>
      ) : (
        <div className="space-y-3">
          {paginated.map((incident) => (
            <IncidentAccordionCard
              key={incident.id}
              incident={incident}
              typeLabel={typeLabel(incident.incident_type)}
              statusLabel={statusLabel(incident.status)}
              translate={translate}
              onViewFull={(id) => navigate(`/incidents/${id}`)}
              onCompleteReport={(id) => navigate(`/incidents/${id}`)}
              onAddNote={(id) => navigate(`/incidents/${id}`)}
              onMarkResolved={handleMarkResolved}
              onNotifyCommission={incident.ndis_reportable ? handleNotifyCommission : undefined}
              onEscalate={handleEscalate}
            />
          ))}
        </div>
      )}

      {!isLoading && stats && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--cc-muted)]">
            {translateParams("incidents.showingCount", {
              filtered: String(filtered.length),
              total: String(stats.total),
            })}
          </p>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center gap-2 self-end">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-3 py-1.5 rounded-full border border-[var(--cc-border)] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <div className="flex items-center gap-1">
                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    aria-current={safePage === pageNumber ? "page" : undefined}
                    className={cn(
                      "min-w-8 px-2.5 py-1.5 rounded-full border text-xs font-semibold transition-colors",
                      safePage === pageNumber
                        ? "bg-[var(--cc-plum)] border-[var(--cc-plum)] text-white"
                        : "border-[var(--cc-border)] text-[var(--cc-muted)] hover:bg-[var(--cc-soft)]",
                    )}
                  >
                    {pageNumber}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded-full border border-[var(--cc-border)] text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
