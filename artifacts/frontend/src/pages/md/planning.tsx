import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { HubLayout } from "@/components/layout/HubLayout";
import { PageHeader, Section, Surface, ghostClass } from "@/components/layout/PageKit";
import { SectionInfo } from "@/components/ui/section-info";
import { OutcomeList } from "@/components/hub/GovernanceOutcomes";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { jsonFetch } from "@/services/http";
import {
  DEFAULT_SETTINGS,
  dayLabel,
  hours,
  money,
  planQuery,
  planRings,
  planSummary,
  type PlanSettings,
  type WorkforcePlan,
} from "@/lib/workforce-plan";

// Chart colours: categorical slots 1-3, validated for colour-blind
// separation and contrast in light and dark (dataviz validator).
const VIZ_VARS =
  "[--s1:#2a78d6] [--s2:#eb6834] [--s3:#1baf7a] dark:[--s1:#3987e5] dark:[--s2:#d95926] dark:[--s3:#199e70]";
const AXIS = { fontSize: 12, fill: "var(--cc-muted)" };
const GRID = "var(--cc-border)";

const TONE = {
  good: { icon: CheckCircle2, color: "#0F7B57", bg: "bg-[#0F7B57]/5" },
  warning: { icon: AlertTriangle, color: "#9A5B0A", bg: "bg-[#9A5B0A]/5" },
  danger: { icon: AlertTriangle, color: "#B3261E", bg: "bg-[#B3261E]/5" },
};

function ChartTip({ active, payload, label, format }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; format: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-cc-border bg-cc-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-cc-text">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-cc-text">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-semibold tabular-nums">{format(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** The team's offered hours as one bar: what's worked now, the target share,
 *  and the busiest week ahead. Room to grow, or a shortfall, at a glance. */
function CapacityPicture({ plan }: { plan: WorkforcePlan }) {
  const total = plan.capacity.staff_hours;
  const now = plan.demand.current_weekly_hours;
  const peak = Math.max(0, ...plan.forecast.map((f) => f.demand_hours));
  const target = plan.capacity.target_utilisation_pct;
  const scale = Math.max(total, peak, 1);
  const pct = (h: number) => `${Math.min(100, (h / scale) * 100)}%`;
  const over = peak > total * (target / 100);
  return (
    <div className={`min-w-0 self-center rounded-xl bg-cc-surface p-phi-4 ${VIZ_VARS}`}>
      <p className="text-sm font-semibold text-cc-text">Your team's week</p>
      <p className="text-xs text-cc-muted">{hours(total)} offered by {plan.capacity.workers} {plan.capacity.workers === 1 ? "worker" : "workers"}</p>
      <div className="relative mt-phi-5 h-6" role="img" aria-label={`${hours(now)} worked now of ${hours(total)} offered. Busiest week ahead ${hours(peak)}. Target ${target}%.`}>
        <div className="absolute inset-0 rounded-full bg-cc-soft" style={{ width: pct(total) }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(now), minWidth: now > 0 ? 6 : 0, background: "var(--s1)" }} />
        <span className="absolute -top-1 bottom-[-4px] w-0.5 rounded bg-cc-text/50" style={{ left: pct(total * (target / 100)) }} aria-hidden />
        <span className="absolute -top-1 bottom-[-4px] w-0.5 rounded" style={{ left: pct(peak), background: over ? "#B3261E" : "var(--s2)" }} aria-hidden />
      </div>
      <ul className="mt-phi-4 grid grid-cols-1 gap-phi-2 text-xs text-cc-text sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--s1)" }} aria-hidden />Worked now {hours(now)}</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-cc-text/50" aria-hidden />Target {target}%</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded" style={{ background: over ? "#B3261E" : "var(--s2)" }} aria-hidden />Busiest week {hours(peak)}</li>
      </ul>
    </div>
  );
}

function Figure({ label, value, note, measured }: { label: string; value: string; note?: string; measured?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-cc-border bg-cc-surface px-phi-4 py-phi-3">
      <dt className="text-xs text-cc-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-cc-text">{value}</dd>
      {note || measured === false ? (
        <dd className="mt-0.5 text-xs text-cc-muted">
          {note}
          {measured === false ? <span className="ml-1 rounded bg-cc-soft px-1.5 py-0.5 text-[11px] font-medium">assumed</span> : null}
        </dd>
      ) : null}
    </div>
  );
}

/** The detailed figures, folded away until wanted. */
function FigureGroup({ children }: { children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-full border border-cc-border px-phi-4 text-xs font-semibold text-cc-text hover:bg-cc-soft [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show the figures</span>
        <span className="hidden group-open:inline">Hide the figures</span>
      </summary>
      <dl className="mt-phi-3 grid grid-cols-2 gap-phi-3 sm:grid-cols-4">{children}</dl>
    </details>
  );
}

/** Ring panels link to a section on this page. */
function jump(href: string) {
  if (href.startsWith("#")) document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function PlanningPage() {
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS);
  const [wageDraft, setWageDraft] = useState("");
  const query = useOrgQuery<WorkforcePlan>(["md", "workforce-plan", planQuery(settings)], {
    queryFn: () => jsonFetch<WorkforcePlan>(`/api/dashboard/workforce-plan?${planQuery(settings)}`),
    staleTime: 60_000,
  });
  const plan = query.data;
  const today = new Date().toISOString().slice(0, 10);

  const demandSeries = useMemo(() => {
    if (!plan) return [];
    return [
      ...plan.history.map((h) => ({ label: dayLabel(h.week), delivered: h.delivered_hours, ahead: null as number | null, usable: null as number | null })),
      ...plan.forecast.map((f, i) => ({
        label: dayLabel(f.week),
        // Join the two lines at this week so the forecast continues the history.
        delivered: i === 0 ? plan.demand.current_weekly_hours : null,
        ahead: f.demand_hours,
        usable: f.usable_hours,
      })),
    ];
  }, [plan]);
  const moneySeries = useMemo(
    () => (plan ? plan.history.map((h) => ({ label: dayLabel(h.week), revenue: h.revenue, wages: h.wages_loaded })) : []),
    [plan],
  );
  const growthSeries = useMemo(
    () =>
      plan
        ? plan.growth.months.map((m) => ({
            label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-AU", { month: "short" }),
            participants: m.participants,
            staff: m.staff,
          }))
        : [],
    [plan],
  );

  const summary = plan ? planSummary(plan, today) : null;
  const rings = useMemo(() => (plan ? planRings(plan, today) : []), [plan, today]);
  const measured = plan?.assumptions.measured ?? {};
  const thisWeekLabel = plan?.forecast[0] ? dayLabel(plan.forecast[0].week) : undefined;

  return (
    <HubLayout>
      <div className="min-w-0 space-y-phi-6 pb-phi-7">
        <PageHeader
          eyebrow="Governance & Strategy"
          title={
            <span className="inline-flex items-center gap-2">
              Workforce & growth
              <SectionInfo text="Whether your team can meet the support ahead, who to hire and when, what staff cost against what the hours earn, and how the organisation is growing. Worked out from your own records; anything assumed is marked." />
            </span>
          }
          actions={
            <button type="button" onClick={() => void query.refetch()} className={ghostClass} disabled={query.isFetching}>
              <RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} /> Refresh
            </button>
          }
        />

        {query.isLoading ? (
          <div role="status" className="space-y-4">
            <span className="sr-only">Working out the plan…</span>
            <div className="h-36 animate-pulse rounded-2xl bg-cc-soft" />
            <div className="h-80 animate-pulse rounded-2xl bg-cc-soft" />
          </div>
        ) : query.isError || !plan || !summary ? (
          <div role="alert" className="rounded-2xl border border-cc-border bg-cc-surface p-6 text-sm text-cc-text">
            The plan couldn't be worked out.{" "}
            <button type="button" className="font-semibold text-cc-plum underline" onClick={() => void query.refetch()}>Try again</button>
          </div>
        ) : (
          <>
            {/* The answer: one line, then rings. The reasons sit behind a click. */}
            {(() => {
              const t = TONE[summary.tone];
              const Icon = t.icon;
              return (
                <section aria-label="Recommendation" className="space-y-phi-5">
                  <h2 className="flex items-start gap-2 text-xl font-semibold leading-snug text-cc-text">
                    <Icon size={22} className="mt-0.5 shrink-0" style={{ color: t.color }} aria-hidden />
                    {summary.headline}
                  </h2>
                  <OutcomeList outcomes={rings} onNavigate={jump} />
                  <div className="grid gap-phi-4 lg:grid-golden">
                    <details className="group min-w-0 self-start rounded-xl border border-cc-border bg-cc-surface">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center px-phi-4 text-sm font-semibold text-cc-text hover:bg-cc-soft [&::-webkit-details-marker]:hidden">
                        Why we say this
                      </summary>
                      <ul className="space-y-phi-3 border-t border-cc-border px-phi-4 py-phi-4 text-sm leading-6 text-cc-text">
                        {summary.points.map((p) => (
                          <li key={p} className="flex gap-phi-3">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                    <CapacityPicture plan={plan} />
                  </div>
                </section>
              );
            })()}

            <div id="plan-demand" className="scroll-mt-24">
            <Section title="Demand and staff time" description="Hours delivered, hours ahead, and what your team can cover.">
              <Surface className={`p-5 ${VIZ_VARS}`}>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={demandSeries} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} unit=" h" />
                      <Tooltip content={<ChartTip format={(n) => hours(n)} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {thisWeekLabel ? <ReferenceLine x={thisWeekLabel} stroke="var(--cc-muted)" strokeDasharray="4 4" label={{ value: "This week", position: "insideTopLeft", fontSize: 11, fill: "var(--cc-muted)" }} /> : null}
                      <Line name="Delivered" dataKey="delivered" stroke="var(--s1)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                      <Line name="Expected" dataKey="ahead" stroke="var(--s1)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                      <Line name="Team can cover" dataKey="usable" stroke="var(--s3)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-cc-muted">Show the weekly figures</summary>
                  <div className="mt-2 max-h-64 overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-cc-muted"><tr><th className="py-1">Week of</th><th>Delivered</th><th>Expected</th><th>Team can cover</th><th>Gap</th></tr></thead>
                      <tbody className="tabular-nums">
                        {plan.history.map((h) => <tr key={h.week}><td className="py-1">{dayLabel(h.week)}</td><td>{hours(h.delivered_hours)}</td><td /><td /><td /></tr>)}
                        {plan.forecast.map((f) => <tr key={f.week}><td className="py-1">{dayLabel(f.week)}</td><td /><td>{hours(f.demand_hours)}</td><td>{hours(f.usable_hours)}</td><td className={f.gap_hours > 0 ? "font-semibold text-[#B3261E]" : ""}>{f.gap_hours > 0 ? `${hours(f.gap_hours)} short` : "covered"}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Surface>
              <div className="mt-phi-3">
                <FigureGroup>
                  <Figure label="Delivered a week now" value={hours(plan.demand.current_weekly_hours)} note="last 4 weeks" />
                  <Figure label="Trend" value={`${plan.demand.trend_hours_per_week >= 0 ? "+" : ""}${hours(plan.demand.trend_hours_per_week)} a week`} note={plan.demand.trend_pct_per_month != null ? `${plan.demand.trend_pct_per_month}% a month` : undefined} measured={measured.trend} />
                  <Figure label="Team's offered hours" value={hours(plan.capacity.staff_hours)} note={`${plan.capacity.workers} workers${plan.capacity.workers_without_hours ? `, ${plan.capacity.workers_without_hours} at the team average` : ""}`} measured={measured.staff_hours} />
                  <Figure label="Of those hours worked" value={plan.capacity.utilisation_pct != null ? `${plan.capacity.utilisation_pct}%` : "N/A"} note={`target ${plan.capacity.target_utilisation_pct}%`} />
                  <Figure label="Enquiries likely to start" value={hours(plan.demand.pipeline.expected_hours)} note={`${plan.demand.pipeline.open_enquiries} open, ${plan.demand.pipeline.conversion_pct}% usually start`} measured={measured.conversion} />
                  <Figure label="Booked, next 4 weeks" value={`${hours(plan.demand.booked_next_4_weeks)} a week`} />
                  <Figure label="Staff turnover" value={`${plan.capacity.annual_attrition_pct}% a year`} measured={measured.attrition} />
                  <Figure label="Time to hire" value={`${plan.hiring.lead_time_weeks} ${plan.hiring.lead_time_weeks === 1 ? "week" : "weeks"}`} note="invite to first shift" measured={measured.lead_time} />
                </FigureGroup>
              </div>
            </Section>
            </div>

            <div id="plan-money" className="scroll-mt-24">
            <Section title="What the hours earn and cost" description={`Revenue against pay plus ${plan.assumptions.on_cost_pct}% on-costs, by week.`}>
              <Surface className={`p-5 ${VIZ_VARS}`}>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={moneySeries} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barGap={2}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`)} />
                      <Tooltip content={<ChartTip format={money} />} cursor={{ fill: "var(--cc-soft)" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar name="Revenue" dataKey="revenue" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                      <Bar name="Pay with on-costs" dataKey="wages" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Surface>
              <div className="mt-phi-3">
                <FigureGroup>
                  <Figure label="Earned per hour" value={plan.finance.revenue_per_hour != null ? money(plan.finance.revenue_per_hour) : "N/A"} note="verified shifts" measured={measured.revenue_rate} />
                  <Figure label="Pay per hour" value={plan.finance.loaded_wage_per_hour != null ? money(plan.finance.loaded_wage_per_hour) : "N/A"} note={plan.finance.wage_per_hour != null ? `${money(plan.finance.wage_per_hour)} + on-costs${plan.finance.wage_source === "entered" ? ", entered" : ""}` : "no pay calculated yet"} />
                  <Figure label="Margin per hour" value={plan.finance.margin_per_hour != null ? money(plan.finance.margin_per_hour) : "N/A"} note={plan.finance.margin_pct != null ? `${plan.finance.margin_pct}% of revenue` : undefined} />
                  <Figure label="Weekly pay bill" value={money(plan.finance.weekly_wages_loaded)} note="with on-costs, last 4 weeks" />
                  <Figure label="Revenue, next 12 weeks" value={plan.finance.projected_revenue != null ? money(plan.finance.projected_revenue) : "N/A"} note="hours your team can cover" />
                  <Figure label="Pay bill, next 12 weeks" value={plan.finance.projected_wages_loaded != null ? money(plan.finance.projected_wages_loaded) : "N/A"} />
                  <Figure label="Revenue at risk" value={plan.finance.revenue_at_risk != null ? money(plan.finance.revenue_at_risk) : "N/A"} note="demand nobody can cover" />
                  <Figure label="Funding left supports" value={plan.funding.weekly_hours != null ? `${hours(plan.funding.weekly_hours)} a week` : "N/A"} note={`${plan.funding.plans_counted} active plans`} />
                </FigureGroup>
              </div>
            </Section>
            </div>

            <div id="plan-growth" className="scroll-mt-24">
            <Section title="Growth" description="Participants and staff at the end of each month.">
              <Surface className={`p-5 ${VIZ_VARS}`}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={growthSeries} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                      <Tooltip content={<ChartTip format={(n) => String(n)} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line name="Participants" dataKey="participants" stroke="var(--s1)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                      <Line name="Staff" dataKey="staff" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Surface>
              <div className="mt-phi-3">
                <FigureGroup>
                  <Figure label="Participants, 6 months" value={plan.growth.participants_change_pct != null ? `${plan.growth.participants_change_pct >= 0 ? "+" : ""}${plan.growth.participants_change_pct}%` : "New"} />
                  <Figure label="Staff, 6 months" value={plan.growth.staff_change_pct != null ? `${plan.growth.staff_change_pct >= 0 ? "+" : ""}${plan.growth.staff_change_pct}%` : "New"} />
                  <Figure label="Enquiries that start" value={`${plan.growth.conversion_pct}%`} measured={measured.conversion} />
                  <Figure label="Enquiry to first support" value={`${plan.growth.days_to_activate} days`} measured={measured.days_to_activate} />
                </FigureGroup>
              </div>
            </Section>
            </div>

            <Section title="Planning settings" description="Try changes here. Nothing is saved.">
              <Surface className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-medium text-cc-text">
                  Target share of staff hours worked
                  <select
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-sm"
                    value={settings.targetUtilisation}
                    onChange={(e) => setSettings((s) => ({ ...s, targetUtilisation: Number(e.target.value) }))}
                  >
                    {[0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-cc-text">
                  On-costs on top of pay
                  <select
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-sm"
                    value={settings.onCostRate}
                    onChange={(e) => setSettings((s) => ({ ...s, onCostRate: Number(e.target.value) }))}
                  >
                    {[0.12, 0.15, 0.18, 0.2, 0.25].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-cc-muted">12% super, plus workers comp and payroll tax if you pay it</span>
                </label>
                <label className="text-sm font-medium text-cc-text">
                  Weeks to hire
                  <select
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-sm"
                    value={settings.leadTimeWeeks ?? ""}
                    onChange={(e) => setSettings((s) => ({ ...s, leadTimeWeeks: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">From your hiring ({plan.hiring.lead_time_weeks})</option>
                    {[2, 3, 4, 6, 8, 12].map((v) => <option key={v} value={v}>{v} weeks</option>)}
                  </select>
                </label>
                <form
                  className="text-sm font-medium text-cc-text"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(wageDraft);
                    setSettings((s) => ({ ...s, wagePerHour: n > 0 ? n : null }));
                  }}
                >
                  <label htmlFor="plan-wage">Average hourly wage</label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="plan-wage"
                      inputMode="decimal"
                      value={wageDraft}
                      onChange={(e) => setWageDraft(e.target.value.replace(/[^\d.]/g, ""))}
                      placeholder={plan.finance.wage_source === "pay records" ? `${money(plan.finance.wage_per_hour ?? 0)} from pay` : "e.g. 38.50"}
                      disabled={plan.finance.wage_source === "pay records"}
                      className="min-h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-sm disabled:opacity-60"
                    />
                    <button type="submit" disabled={plan.finance.wage_source === "pay records"} className="min-h-10 rounded-lg border border-cc-border px-3 text-sm font-semibold hover:bg-cc-soft disabled:opacity-50">
                      Use
                    </button>
                  </div>
                  <span className="mt-1 block text-xs font-normal text-cc-muted">
                    {plan.finance.wage_source === "pay records" ? "Measured from your pay records." : "Used until pay is calculated for shifts."}
                  </span>
                </form>
              </Surface>
            </Section>

            <details className="rounded-2xl border border-cc-border bg-cc-surface">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-cc-text hover:bg-cc-soft [&::-webkit-details-marker]:hidden">
                <TrendingUp size={16} aria-hidden /> How these figures are worked out
              </summary>
              <ul className="space-y-2 border-t border-cc-border px-5 py-4 text-sm leading-6 text-cc-text">
                <li><b>Delivered hours</b>: completed shifts, by the week they were scheduled. Weeks run Monday to Sunday on your organisation's clock.</li>
                <li><b>Expected hours</b>: for each week ahead, whichever is higher of the shifts already booked or the trend (a straight line fitted through the last 12 weeks), plus enquiries likely to start: hours they asked for times the share of enquiries that became participants in the last year, from the usual time it takes them to start.</li>
                <li><b>Team can cover</b>: each support worker's offered weekly hours (the team average for anyone who hasn't set theirs), reduced week by week at this year's staff turnover, times the target share ({plan.capacity.target_utilisation_pct}%).</li>
                <li><b>Hiring</b>: the largest weekly shortfall, divided by a new worker's usual hours at the target share, rounded up. Hire by the first short week, less the time it takes to hire.</li>
                <li><b>Pay per hour</b>: each shift's net pay (reversals taken off) divided by the shift's length, plus on-costs ({plan.assumptions.on_cost_pct}%). Pay parts that overlap, such as a casual loading on the same hours, are never counted as extra hours.</li>
                <li><b>Earned per hour</b>: the amount billed when shifts were verified, divided by those shifts' hours. Reversed verifications are left out.</li>
                <li><b>Funding left</b>: each active plan's remaining budget spread over the weeks until it ends, at your earned rate per hour.</li>
                <li>Only your organisation's records are used. Figures marked <i>assumed</i> use a stated default because there isn't enough history yet.</li>
              </ul>
            </details>
          </>
        )}
      </div>
    </HubLayout>
  );
}
