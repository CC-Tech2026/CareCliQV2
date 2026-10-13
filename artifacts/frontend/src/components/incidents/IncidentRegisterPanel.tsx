import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { subDays, parseISO, isAfter } from "date-fns";
import { Plus, Download, ShieldAlert, AlertTriangle, Siren, ChevronRight } from "lucide-react";
import {
  EmptyState,
  Notice,
  PageHeader,
  PillTabs,
  RowList,
  SkeletonBlocks,
  StatusText,
  SummaryStrip,
  Surface,
  ctaClass,
  ghostClass,
  outlineClass,
  rowClass,
  type PillOption,
  type Tone,
} from "@/components/layout/PageKit";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { listIncidents, getIncidentStats } from "@/services/incidentService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { formatNotificationCountdown, type IncidentCardData } from "./IncidentAccordionCard";
import { formatAppDate } from "@/lib/datetime";
import { SectionInfo } from "@/components/ui/section-info";

type SubTab = "all" | "open" | "review" | "resolved" | "rp";
const SUB_TABS: readonly SubTab[] = ["all", "open", "review", "resolved", "rp"];

/** `/incidents?tab=open` etc. — lets stat tiles elsewhere link to a filtered register. */
function tabFromSearch(search: string): SubTab {
  const tab = new URLSearchParams(search).get("tab");
  return SUB_TABS.includes(tab as SubTab) ? (tab as SubTab) : "all";
}
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

const SEVERITY_DOT: Record<string, string> = {
  low: "var(--cc-green)",
  medium: "var(--cc-amber)",
  high: "var(--cc-status-danger)",
  critical: "var(--cc-status-critical)",
};

function statusTone(status: string): Tone {
  if (status === "reported") return "warning";
  if (status === "under_investigation") return "info";
  if (status === "resolved") return "good";
  return "neutral";
}

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
  const search = useSearch();
  const [subTab, setSubTab] = useState<SubTab>(() => tabFromSearch(search));
  useEffect(() => {
    setSubTab(tabFromSearch(search));
  }, [search]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);

  const { data: incidents = [], isLoading } = useOrgQuery<IncidentRow[]>(["incidents"], {
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

  const subTabs: PillOption<SubTab>[] = [
    { key: "all", label: translate("incidents.register.tabAll"), count: inWindow.length },
    { key: "open", label: translate("incidents.register.tabOpen"), count: kpis.open },
    { key: "review", label: translate("incidents.register.tabReview"), count: kpis.review || undefined },
    { key: "resolved", label: translate("incidents.register.tabResolved") },
    { key: "rp", label: translate("incidents.register.tabRp"), count: kpis.rp || undefined },
  ];

  const typeFilters: { id: TypeFilter; label: string }[] = [
    { id: "all", label: translate("incidents.register.filterAll") },
    { id: "restrictive_practice", label: translate("incidents.register.filterRp") },
    { id: "auto", label: translate("incidents.register.filterAuto") },
    { id: "manual", label: translate("incidents.register.filterManual") },
  ];

  const showTab = (tab: SubTab, type: TypeFilter = "all") => {
    setTypeFilter(type);
    setSubTab(tab);
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        eyebrow={translate("incidents.new.standard")}
        title={
          <span className="inline-flex items-center gap-2">
            {translate("incidents.register.title")}
            <SectionInfo text="Every incident recorded across your organisation, from all sources, aligned to NDIS Practice Standard Core." />
          </span>
        }
        description="Every incident from first report through investigation and NDIS Commission notification."
        actions={
          <>
            <button
              type="button"
              onClick={() => toast({ title: translate("incidents.register.exportSoon") })}
              className={ghostClass}
            >
              <Download size={15} />
              {translate("incidents.register.export")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/incidents/new")}
              className={`${ctaClass} order-first w-full sm:order-none sm:w-auto`}
            >
              <Plus size={15} />
              {translate("incidents.register.create")}
            </button>
          </>
        }
      />

      <SummaryStrip
        loading={isLoading}
        items={[
          { value: kpis.open, label: translate("incidents.register.kpiOpen"), tone: kpis.open ? "danger" : "good", onClick: () => showTab("open"), active: subTab === "open" && typeFilter === "all" },
          { value: kpis.rp, label: translate("incidents.register.kpiRp"), tone: kpis.rp ? "danger" : undefined, onClick: () => showTab("rp"), active: subTab === "rp" && typeFilter === "all" },
          { value: kpis.review, label: translate("incidents.register.kpiReview"), tone: kpis.review ? "warning" : undefined, onClick: () => showTab("review"), active: subTab === "review" && typeFilter === "all" },
          { value: kpis.resolvedMonth, label: translate("incidents.register.kpiResolved"), tone: "good", onClick: () => showTab("resolved"), active: subTab === "resolved" && typeFilter === "all" },
          { value: kpis.auto, label: translate("incidents.register.kpiAuto"), onClick: () => showTab("all", "auto"), active: subTab === "all" && typeFilter === "auto" },
        ]}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PillTabs<SubTab> label={translate("incidents.register.title")} value={subTab} onChange={setSubTab} options={subTabs} />
        <div className="flex items-center gap-3">
          <select
            aria-label={translate("incidents.register.filterBy")}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="min-h-10 rounded-full border bg-cc-surface px-4 text-sm outline-none focus:ring-2 focus:ring-cc-plum"
            style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
          >
            {typeFilters.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <span className="whitespace-nowrap text-sm text-[var(--cc-muted)]">
            {translate("incidents.register.last30Days")}
          </span>
        </div>
      </div>

      {subTab === "open" && kpis.open > 0 && (
        <Notice tone="warning" icon={AlertTriangle} title={translateParams("incidents.register.openBannerTitle", { count: String(kpis.open) })}>
          {translate("incidents.register.openBannerBody")}
        </Notice>
      )}

      {subTab === "rp" && kpis.rp > 0 && (
        <Notice tone="danger" icon={ShieldAlert} title={translate("incidents.register.rpBannerTitle")}>
          {translate("incidents.register.rpBannerBody")}
        </Notice>
      )}

      {isLoading ? (
        <SkeletonBlocks count={3} height="h-14" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Siren}
          title={translate("incidents.noIncidentsFound")}
          body={subTab !== "all" || typeFilter !== "all" ? "Try another view, or show every incident from the last 30 days." : undefined}
          action={
            subTab !== "all" || typeFilter !== "all" ? (
              <button type="button" className={outlineClass} onClick={() => showTab("all")}>
                {translate("incidents.register.tabAll")}
              </button>
            ) : undefined
          }
        />
      ) : (
        <Surface>
          <RowList>
            {paginated.map((incident) => {
              const due = incident.ndis_pending
                ? incident.notification_due_at
                  ? formatNotificationCountdown(incident.notification_due_at, !!incident.overdue)
                  : translate("incidents.register.windowOpen")
                : null;
              const meta = [
                incident.participant_name || translate("incidents.noParticipant"),
                typeLabel(incident.incident_type),
                incident.incident_date ? formatAppDate(incident.incident_date, incident.timezone) : null,
                incident.reference_number || null,
                incident.auto_detected ? translate("incidents.register.autoDetected") : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={incident.id}>
                  <button type="button" onClick={() => navigate(`/incidents/${incident.id}`)} className={`${rowClass} items-start sm:items-center`}>
                    <span
                      aria-hidden
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full sm:mt-0"
                      style={{ background: SEVERITY_DOT[incident.severity] ?? SEVERITY_DOT.medium }}
                      title={translate(`incidents.severity.${incident.severity}`)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--cc-text)]">
                        {incident.title || typeLabel(incident.incident_type)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--cc-muted)]">
                        <span className="sr-only">{translate(`incidents.severity.${incident.severity}`)}. </span>
                        {meta}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 sm:hidden">
                        {due && <StatusText tone={incident.overdue ? "danger" : "warning"}>NDIS: {due}</StatusText>}
                        <StatusText tone={statusTone(incident.status)}>{statusLabel(incident.status)}</StatusText>
                      </span>
                    </span>
                    {due && (
                      <span className="hidden sm:inline">
                        <StatusText tone={incident.overdue ? "danger" : "warning"}>NDIS: {due}</StatusText>
                      </span>
                    )}
                    <span className="hidden w-36 text-right sm:inline">
                      <StatusText tone={statusTone(incident.status)}>{statusLabel(incident.status)}</StatusText>
                    </span>
                    <ChevronRight size={16} className="mt-1 shrink-0 text-[var(--cc-muted)] sm:mt-0" />
                  </button>
                </li>
              );
            })}
          </RowList>
        </Surface>
      )}

      {!isLoading && stats && filtered.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--cc-muted)]">
            {translateParams("incidents.showingCount", {
              filtered: String(paginated.length),
              total: String(filtered.length),
            })}
          </p>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center gap-2 self-end">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className={outlineClass}
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
                    className="flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-sm font-medium transition hover:bg-[var(--cc-soft)]"
                    style={safePage === pageNumber ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: "var(--cc-text)" }}
                  >
                    {pageNumber}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className={outlineClass}
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
