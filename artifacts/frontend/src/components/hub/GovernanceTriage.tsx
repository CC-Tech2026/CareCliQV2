import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
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
  return (
    <button
      onClick={() => onNavigate(routeForSource(alert.source))}
      className="flex w-full items-stretch gap-3 px-5 py-3.5 text-left transition-colors hover:bg-cc-soft"
    >
      <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-bold leading-snug" style={{ color: TEXT }}>{alert.title}</p>
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: MUTED }}>{alert.detail}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
      <span className="mt-0.5 shrink-0 self-start text-[10.5px] font-black" style={{ color: color }}>
        {alert.action_label}
      </span>
    </button>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
      <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: "var(--cc-soft)" }} />
      <div className="min-w-0 flex-1 space-y-2">
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
}: {
  onNavigate: (path: string) => void;
  workersAtRisk?: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  fetchAlerts?: () => Promise<HubComplianceAlert[]>;
  routeForSource?: (source: string | undefined) => string;
  viewAllHref?: string;
  viewAllLabel?: string;
}) {
  const [alerts, setAlerts] = useState<HubComplianceAlert[] | null>(null);
  const [error, setError] = useState(false);

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

  const loaded = alerts ?? [];
  const urgent = loaded.filter((a) => a.category === "urgent");
  const exposure = [
    ...loaded.filter((a) => a.category !== "urgent"),
    ...workersAtRiskToAlerts(workersAtRisk),
  ];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      {/* Needs action today / this week */}
      <section className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} strokeWidth={2} style={{ color: RED }} />
              <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Needs action today / this week</h2>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Named items with a real deadline attached</p>
          </div>
          {urgent.length > 0 && (
            <span className="rounded-full px-2 py-1 text-[9px] font-black" style={{ background: RED_SOFT, color: RED }}>
              {urgent.length} open
            </span>
          )}
        </div>
        {alerts === null ? (
          <ListSkeleton />
        ) : urgent.length === 0 ? (
          <EmptyState message="Nothing needs action right now." />
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {urgent.map((a) => <AlertRow key={a.id} alert={a} onNavigate={onNavigate} routeForSource={routeForSource} />)}
          </div>
        )}
      </section>

      {/* Exposure building up */}
      <section className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert size={15} strokeWidth={2} style={{ color: AMBER }} />
              <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Exposure building up</h2>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Becomes an audit finding if left unaddressed</p>
          </div>
          {exposure.length > 0 && (
            <span className="rounded-full px-2 py-1 text-[9px] font-black" style={{ background: AMBER_SOFT, color: AMBER }}>
              {exposure.length} open
            </span>
          )}
        </div>
        {alerts === null ? (
          <ListSkeleton />
        ) : exposure.length === 0 ? (
          <EmptyState message="No exposure currently building up." />
        ) : (
          <>
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {exposure.slice(0, 8).map((a) => <AlertRow key={a.id} alert={a} onNavigate={onNavigate} routeForSource={routeForSource} />)}
            </div>
            {exposure.length > 8 && (
              <button
                onClick={() => onNavigate(viewAllHref)}
                className="w-full border-t px-5 py-3 text-center text-[11px] font-bold transition-colors hover:bg-cc-soft"
                style={{ borderColor: BORDER, color: AMBER }}
              >
                View all {exposure.length} in {viewAllLabel}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
