import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, X } from "lucide-react";
import { getHubComplianceAlerts, type HubComplianceAlert } from "@/services/hubService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";

const GREEN = "#0F7B57";
const GREEN_SOFT = "#E9F5F0";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";
const RED = "#B3261E";
const RED_SOFT = "#FBEAE9";
const BLUE = "#2A5C8A";
const BLUE_SOFT = "#EAF1F7";

function severityColors(severity: string) {
  if (severity === "critical") return { color: RED, soft: RED_SOFT };
  if (severity === "high") return { color: AMBER, soft: AMBER_SOFT };
  if (severity === "positive") return { color: GREEN, soft: GREEN_SOFT };
  return { color: BLUE, soft: BLUE_SOFT };
}

function severityLabel(severity: string) {
  if (severity === "critical") return "Critical";
  if (severity === "high") return "High";
  if (severity === "medium") return "Medium";
  if (severity === "positive") return "Clear";
  return "Info";
}

function defaultRouteForSource(source: string | undefined): string {
  if (source === "credentials" || source === "worker-compliance") return "/md/staff";
  if (source === "incidents") return "/incidents";
  if (source === "invoices") return "/md/financial";
  return "/md/compliance";
}

/** Worker names/scores are already fetched by the parent's MDData call — this just
 *  reshapes them into the same alert row shape so they render in one consistent
 *  list instead of a second, differently-styled card. */
function workersAtRiskToAlerts(
  workers: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>,
): HubComplianceAlert[] {
  return workers.map((w) => ({
    id: `worker-${w.id}`,
    title: `${w.full_name}: ${w.compliance_score}% compliance`,
    detail: `Below the 85% threshold across ${w.sessions} session${w.sessions === 1 ? "" : "s"}.`,
    severity: w.compliance_score < 70 ? "critical" : "high",
    affected_staff: [w.full_name],
    action_label: "View Worker",
    source: "worker-compliance",
    category: "exposure",
  }));
}

function AlertRow({
  alert,
  onNavigate,
  routeForSource,
}: {
  alert: HubComplianceAlert;
  onNavigate: (path: string) => void;
  routeForSource: (source: string | undefined) => string;
}) {
  const { color, soft } = severityColors(alert.severity);
  const go = () => onNavigate(routeForSource(alert.source));
  return (
    // A plain div (not <button>) so the title/detail text stays selectable and
    // copyable - wrapping the whole row in a <button> blocked click-drag text
    // selection in every browser tested. Still fully keyboard-operable.
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
      className="flex w-full cursor-pointer items-stretch gap-3 px-5 py-3.5 transition-colors hover:bg-cc-soft focus-visible:bg-cc-soft focus-visible:outline-none"
    >
      <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: color }} />
      {/* Content is capped and left-packed rather than letting the title/action
          pair stretch to the row's full width - on a wide card that stretch
          reads as a big blank gap in the middle of a two-line alert. */}
      <div className="flex min-w-0 max-w-2xl flex-1 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold leading-snug" style={{ color: TEXT }}>{alert.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: MUTED }}>{alert.detail}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {alert.category === "urgent" && (
              <span className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide" style={{ background: RED_SOFT, color: RED }}>
                Urgent
              </span>
            )}
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide"
              style={{ background: soft, color }}
            >
              {severityLabel(alert.severity)}
            </span>
            {alert.due_date && (
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                style={{ background: "var(--cc-soft)", color: MUTED }}
              >
                Due {new Date(alert.due_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
              </span>
            )}
          </div>
        </div>
        <span className="mt-0.5 shrink-0 whitespace-nowrap text-[10.5px] font-black" style={{ color }}>
          {alert.action_label}
        </span>
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
      <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: "var(--cc-soft)" }} />
      <div className="min-w-0 max-w-2xl flex-1 space-y-2">
        <div className="h-2.5 w-3/5 animate-pulse rounded" style={{ background: "var(--cc-soft)" }} />
        <div className="h-2 w-4/5 animate-pulse rounded" style={{ background: "var(--cc-soft)" }} />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div>
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-8 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: GREEN_SOFT, color: GREEN }}>
        <CheckCircle2 size={16} strokeWidth={2.4} />
      </div>
      <p className="mt-3 text-[11.5px] font-bold" style={{ color: TEXT }}>{message}</p>
    </div>
  );
}

export function GovernanceTriage({
  onNavigate,
  workersAtRisk = [],
  fetchAlerts = getHubComplianceAlerts,
  routeForSource = defaultRouteForSource,
  viewAllHref = "/md/compliance",
  viewAllLabel = "Compliance Centre",
  variant = "panel",
}: {
  onNavigate: (path: string) => void;
  workersAtRisk?: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  fetchAlerts?: () => Promise<HubComplianceAlert[]>;
  routeForSource?: (source: string | undefined) => string;
  viewAllHref?: string;
  viewAllLabel?: string;
  /** "panel" (default): a full-width card sitting in the page flow, own
   *  collapse toggle, remembered per page. "floating": a small header-bar
   *  trigger button (badge count) that opens the same content as a dropdown
   *  instead of permanently taking up page height - for pages that already
   *  have several stacked sections and don't want one more. "sidebar": a
   *  narrow, always-expanded column meant to sit beside real content (e.g. a
   *  chart) in a two-column row - unlike "panel", which was deliberately
   *  kept full-width elsewhere because a lone half-width card next to blank
   *  canvas read as unfinished; this is for when the other half isn't blank. */
  variant?: "panel" | "floating" | "sidebar";
}) {
  const [alerts, setAlerts] = useState<HubComplianceAlert[] | null>(null);
  const [error, setError] = useState(false);
  // Remembered per page (keyed by viewAllHref, which differs per usage) so
  // collapsing it on Staff Onboarding doesn't also collapse it on Compliance.
  const storageKey = `cc-triage-collapsed:${viewAllHref}`;
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }
  const [floatingOpen, setFloatingOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAlerts(null);
    fetchAlerts()
      .then((data) => {
        if (!cancelled) setAlerts(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAlerts]);

  if (error) return null;

  const loading = alerts === null;
  const loaded = alerts ?? [];
  const urgent = loaded.filter((a) => a.category === "urgent");
  const exposure = [
    ...loaded.filter((a) => a.category !== "urgent"),
    ...workersAtRiskToAlerts(workersAtRisk),
  ];
  const all = [...urgent, ...exposure];

  const topSeverity = all.some((a) => a.severity === "critical") ? "critical"
    : all.some((a) => a.severity === "high") ? "high"
    : all.length > 0 ? "medium" : null;
  const topSeverityColors = topSeverity ? severityColors(topSeverity) : { color: GREEN, soft: GREEN_SOFT };
  const HeaderIcon = urgent.length > 0 ? AlertTriangle : exposure.length > 0 ? ShieldAlert : CheckCircle2;

  const subtitle = loading
    ? "Checking for open items..."
    : urgent.length > 0
      ? `${urgent.length} with a real deadline this week, ${exposure.length} more building exposure`
      : exposure.length > 0
        ? "Nothing urgent right now. These are building exposure if left unaddressed"
        : "All caught up. Nothing needs action and nothing is building exposure";

  if (variant === "floating") {
    return (
      <div className="relative">
        <button
          onClick={() => setFloatingOpen((v) => !v)}
          aria-expanded={floatingOpen}
          className="flex items-center gap-2 rounded-full border px-4 py-2.5 text-[12px] font-black transition-all hover:-translate-y-0.5"
          style={{ borderColor: BORDER, background: SURFACE, color: TEXT }}
        >
          <HeaderIcon size={15} strokeWidth={2} style={{ color: topSeverityColors.color }} />
          Attention
          {!loading && all.length > 0 && (
            <span className="flex h-4 min-w-[17px] items-center justify-center rounded-full px-1 text-[9.5px] font-black text-white" style={{ background: topSeverityColors.color }}>
              {all.length}
            </span>
          )}
        </button>
        {floatingOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setFloatingOpen(false)} />
            <div
              className="absolute right-0 top-[calc(100%+8px)] z-20 w-[420px] max-w-[92vw] overflow-hidden rounded-2xl border shadow-xl"
              style={{ borderColor: BORDER, background: SURFACE }}
            >
              <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: BORDER }}>
                <div className="min-w-0">
                  <h2 className="text-[13px] font-black" style={{ color: TEXT }}>Needs your attention</h2>
                  <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>{subtitle}</p>
                </div>
                <button onClick={() => setFloatingOpen(false)} aria-label="Close" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-cc-soft">
                  <X size={14} style={{ color: MUTED }} />
                </button>
              </div>
              {loading ? (
                <ListSkeleton />
              ) : all.length === 0 ? (
                <EmptyState message="All caught up. Nothing needs action and nothing is building exposure." />
              ) : (
                <>
                  <div className="max-h-[420px] divide-y overflow-y-auto" style={{ borderColor: BORDER }}>
                    {all.map((a) => (
                      <AlertRow key={a.id} alert={a} onNavigate={(p) => { setFloatingOpen(false); onNavigate(p); }} routeForSource={routeForSource} />
                    ))}
                  </div>
                  <button
                    onClick={() => { setFloatingOpen(false); onNavigate(viewAllHref); }}
                    className="w-full border-t px-5 py-3 text-center text-[11px] font-bold transition-colors hover:bg-cc-soft"
                    style={{ borderColor: BORDER, color: "var(--cc-plum)" }}
                  >
                    Review all in {viewAllLabel}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <section className="flex h-full flex-col overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
        <div className="flex items-center justify-between gap-2 border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <h2 className="text-[13px] font-black" style={{ color: TEXT }}>Needs your attention</h2>
          {!loading && all.length > 0 && (
            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-black text-white" style={{ background: topSeverityColors.color }}>
              {all.length}
            </span>
          )}
        </div>
        {loading ? (
          <ListSkeleton />
        ) : all.length === 0 ? (
          <EmptyState message="All caught up. Nothing needs action right now." />
        ) : (
          <div className="flex-1 divide-y overflow-y-auto" style={{ borderColor: BORDER }}>
            {all.slice(0, 6).map((a) => {
              const { color } = severityColors(a.severity);
              return (
                <button
                  key={a.id}
                  onClick={() => onNavigate(routeForSource(a.source))}
                  className="w-full px-5 py-3.5 text-left transition-colors hover:bg-cc-soft"
                >
                  <p className="text-[9px] font-black uppercase tracking-wide" style={{ color }}>{severityLabel(a.severity)}</p>
                  <p className="mt-1 text-[12px] font-bold leading-snug" style={{ color: TEXT }}>{a.title}</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed" style={{ color: MUTED }}>{a.detail}</p>
                </button>
              );
            })}
          </div>
        )}
        {!loading && all.length > 0 && (
          <button
            onClick={() => onNavigate(viewAllHref)}
            className="border-t px-5 py-3 text-center text-[11px] font-bold transition-colors hover:bg-cc-soft"
            style={{ borderColor: BORDER, color: "var(--cc-plum)" }}
          >
            View all in {viewAllLabel}
          </button>
        )}
      </section>
    );
  }

  return (
    // One always-full-width card instead of two side-by-side panels - avoids
    // both the "empty half" and the "half-width card floating next to blank
    // canvas" problems that came from trying to keep two panels in sync.
    <section className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        style={{ borderColor: BORDER, borderBottom: !collapsed && all.length > 0 ? `1px solid ${BORDER}` : "none" }}
      >
        <button onClick={toggleCollapsed} className="flex min-w-0 items-center gap-3 text-left">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: topSeverityColors.soft }}>
            <HeaderIcon size={16} strokeWidth={2} style={{ color: topSeverityColors.color }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Needs your attention</h2>
            <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>{subtitle}</p>
          </div>
        </button>
        <div className="flex items-center gap-2.5">
          {!loading && all.length > 0 && topSeverity && (
            <span className="rounded-full px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wide" style={{ background: topSeverityColors.soft, color: topSeverityColors.color }}>
              {severityLabel(topSeverity)}
            </span>
          )}
          {!loading && all.length > 0 && !collapsed && (
            <button
              onClick={() => onNavigate(viewAllHref)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[11.5px] font-black text-white transition-all hover:-translate-y-0.5"
              style={{ background: "var(--cc-plum)" }}
            >
              Review all <ArrowRight size={13} />
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-cc-soft"
          >
            {collapsed ? <ChevronDown size={16} style={{ color: MUTED }} /> : <ChevronUp size={16} style={{ color: MUTED }} />}
          </button>
        </div>
      </div>
      {collapsed ? null : loading ? (
        <ListSkeleton />
      ) : all.length === 0 ? (
        <EmptyState message="All caught up. Nothing needs action and nothing is building exposure." />
      ) : (
        <div className="divide-y border-t" style={{ borderColor: BORDER }}>
          {all.slice(0, 6).map((a) => <AlertRow key={a.id} alert={a} onNavigate={onNavigate} routeForSource={routeForSource} />)}
        </div>
      )}
    </section>
  );
}
