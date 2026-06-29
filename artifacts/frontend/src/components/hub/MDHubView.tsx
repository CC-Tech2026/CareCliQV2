import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  AlertTriangle, ArrowRight,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";
const PLUM   = "var(--cc-plum)";
const AMBER  = "#F59E0B";

interface MDData {
  active_participants: number;
  active_staff: number;
  staff_retention_rate: number;
  sessions_this_week: number;
  compliance_score: number;
  compliance_target: number;
  incidents_this_month: number;
  goal_achievement_rate: number;
  workers_at_risk: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  org_alerts: Array<{ type: string; severity: string; message: string }>;
  common_issues: Array<{ issue: string; count: number }>;
  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

/* ── Stat strip item ───────────────────────────────────────── */
function StatItem({
  label,
  value,
  sub,
  warn,
  last,
}: {
  label: string;
  value: string | number;
  sub?: string;
  warn?: boolean;
  last?: boolean;
}) {
  const valueColor = warn ? "#EF4444" : TEXT;
  return (
    <div
      className="flex flex-1 flex-col px-5 py-4"
      style={{ borderRight: last ? undefined : `1px solid ${BORDER}` }}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.18em] mb-2" style={{ color: MUTED }}>
        {label}
      </p>
      <p className="text-[22px] font-black leading-none tracking-tight" style={{ color: valueColor }}>
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-[11px] font-medium" style={{ color: warn ? "#EF4444" : MUTED }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ── Alert row ─────────────────────────────────────────────── */
const ALERT_STYLES: Record<string, string> = {
  high:   "border-red-200 bg-red-50 text-red-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low:    "border-blue-200 bg-blue-50 text-blue-700",
};

function AlertRow({ alert }: { alert: { type: string; severity: string; message: string } }) {
  const cls = ALERT_STYLES[alert.severity] ?? ALERT_STYLES.low;
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[12px] font-medium ${cls}`}>
      <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>{alert.message}</span>
    </div>
  );
}

/* ── Panel wrapper ─────────────────────────────────────────── */
function Panel({
  title,
  sub,
  action,
  children,
  noPad,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  noPad?: boolean;
}) {
  return (
    <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>{title}</h2>
          {sub && <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{sub}</p>}
        </div>
        {action}
      </div>
      <div className={noPad ? undefined : "px-6 py-5"}>{children}</div>
    </section>
  );
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] font-bold"
      style={{ color: PLUM }}
    >
      {children} <ArrowRight size={11} strokeWidth={2} />
    </button>
  );
}

/* ── Main component ────────────────────────────────────────── */
export function MDHubView() {
  const { translate, translateParams } = useAccessibility();
  const [, navigate] = useLocation();
  const [data,    setData]    = useState<MDData | null>(null);
  const [trend,   setTrend]   = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch("/api/dashboard/managing-director").then((r) => (r.ok ? r.json() : Promise.reject())),
      apiFetch("/api/dashboard/compliance-trend").then((r) => (r.ok ? r.json() : { trend: [] })),
    ])
      .then(([mdData, trendData]) => {
        if (!cancelled) {
          setData(mdData);
          setTrend(trendData.trend ?? []);
        }
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl" style={{ background: SOFT }} />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
        <AlertTriangle size={26} className="mx-auto mb-3" style={{ color: "#F97316" }} />
        <p className="text-[14px] font-black" style={{ color: TEXT }}>{translate("hub.mdHub.loadFailed")}</p>
        <p className="mt-1 text-[12px]" style={{ color: MUTED }}>{translate("hub.mdHub.retryHint")}</p>
      </div>
    );
  }

  const complianceWarn = data.compliance_score < data.compliance_target;
  const chartData = trend
    .filter((t) => t.avg_score !== null)
    .slice(-13)
    .map((t) => ({ week: t.week.replace(/^\d{4}-/, ""), score: t.avg_score, sessions: t.session_count }));

  return (
    <div className="space-y-5">

      {/* ── Primary stat strip ───────────────────────── */}
      <Panel
        title={translate("hub.mdHub.executiveMetrics")}
        sub={translate("hub.mdHub.liveSnapshot")}
        action={<LinkBtn onClick={() => navigate("/md/executive")}>{translate("hub.mdHub.fullReport")}</LinkBtn>}
        noPad
      >
        <div className="flex flex-wrap divide-y sm:divide-y-0" style={{ borderTop: `0` }}>
          <StatItem
            label={translate("hub.mdHub.participants")}
            value={data.active_participants}
          />
          <StatItem
            label={translate("hub.mdHub.activeStaff")}
            value={data.active_staff}
            sub={translateParams("hub.mdHub.retention", { rate: String(data.staff_retention_rate) })}
          />
          <StatItem
            label={translate("hub.mdHub.sessionsWeek")}
            value={data.sessions_this_week}
          />
          <StatItem
            label={translate("hub.mdHub.complianceScore")}
            value={`${data.compliance_score}%`}
            sub={complianceWarn ? translateParams("hub.mdHub.belowTarget", { target: String(data.compliance_target) }) : translate("hub.mdHub.onTarget")}
            warn={complianceWarn}
          />
          <StatItem
            label={translate("hub.mdHub.incidents")}
            value={data.incidents_this_month}
            sub={translate("hub.mdHub.thisMonth")}
            warn={data.incidents_this_month > 0}
          />
          <StatItem
            label={translate("hub.mdHub.goalAchievement")}
            value={`${data.goal_achievement_rate}%`}
          />
          <StatItem
            label={translate("hub.mdHub.staffAtRisk")}
            value={data.workers_at_risk.length}
            warn={data.workers_at_risk.length > 0}
            last
          />
        </div>
      </Panel>

      {/* ── Org alerts ──────────────────────────────── */}
      {data.org_alerts.length > 0 && (
        <Panel
          title={translate("hub.mdHub.orgAlerts")}
          sub={translate("hub.mdHub.alertsSub")}
          action={<LinkBtn onClick={() => navigate("/md/compliance")}>{translate("hub.mdHub.viewCompliance")}</LinkBtn>}
        >
          <div className="space-y-2">
            {data.org_alerts.map((alert, i) => <AlertRow key={i} alert={alert} />)}
          </div>
        </Panel>
      )}

      {/* ── Compliance trend chart ───────────────────── */}
      {chartData.length > 1 && (
        <Panel
          title={translate("hub.mdHub.complianceTrend")}
          sub={translate("hub.mdHub.trendSub")}
          action={<LinkBtn onClick={() => navigate("/md/compliance")}>{translate("hub.mdHub.fullReport")}</LinkBtn>}
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: MUTED }} />
              <YAxis domain={[50, 100]} tick={{ fontSize: 10, fill: MUTED }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }}
                formatter={(val: number) => [`${val}%`, translate("hub.mdHub.avgScore")]}
              />
              <ReferenceLine
                y={data.compliance_target}
                stroke={AMBER}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{ value: translateParams("hub.mdHub.target", { target: String(data.compliance_target) }), fontSize: 10, fill: AMBER, position: "insideTopRight" }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={PLUM}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: PLUM }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* ── Financial summary ───────────────────────── */}
      <FinancialSummaryStrip onNavigate={() => navigate("/md/financial")} />
    </div>
  );
}

/* ── Financial strip ───────────────────────────────────────── */
function FinancialSummaryStrip({ onNavigate }: { onNavigate: () => void }) {
  const { translate, translateParams } = useAccessibility();
  const [rev, setRev] = useState<{
    total_billed_cents?: number;
    total_paid_cents?: number;
    invoice_count?: number;
  } | null>(null);

  useEffect(() => {
    apiFetch("/api/billing/revenue-report")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRev(d))
      .catch(() => {});
  }, []);

  const totalRev      = (rev?.total_billed_cents ?? 0) / 100;
  const totalInvoices = rev?.invoice_count ?? 0;
  const target        = Math.max(totalRev * 1.05, 1000);
  const pct           = totalRev > 0 ? Math.round((totalRev / target) * 100) : 0;

  return (
    <Panel
      title={translate("hub.mdHub.financialSummary")}
      sub={translate("hub.mdHub.financialSub")}
      action={<LinkBtn onClick={onNavigate}>{translate("hub.mdHub.fullReport")}</LinkBtn>}
      noPad
    >
      <div className="flex">
        <StatItem
          label={translate("hub.mdHub.totalRevenue")}
          value={`$${totalRev.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`}
        />
        <StatItem
          label={translate("hub.mdHub.totalInvoices")}
          value={totalInvoices}
        />
        <StatItem
          label={translate("hub.mdHub.vsTarget")}
          value={`${pct}%`}
          warn={pct > 0 && pct < 90}
          last
        />
      </div>
    </Panel>
  );
}
