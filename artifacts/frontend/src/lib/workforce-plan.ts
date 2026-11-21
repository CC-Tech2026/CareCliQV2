/** The workforce plan as the API returns it (/api/dashboard/workforce-plan). */
export type WorkforcePlan = {
  as_of: string;
  history: Array<{ week: string; delivered_hours: number; revenue: number; wages: number; wages_loaded: number }>;
  demand: {
    current_weekly_hours: number;
    trend_hours_per_week: number;
    trend_pct_per_month: number | null;
    booked_next_4_weeks: number;
    pipeline: { open_enquiries: number; requested_hours: number; conversion_pct: number; expected_hours: number; starts_in_weeks: number };
  };
  capacity: {
    staff_hours: number;
    reliable_hours: number;
    casual_hours: number;
    workers: number;
    workers_without_hours: number;
    utilisation_pct: number | null;
    target_utilisation_pct: number;
    annual_attrition_pct: number;
  };
  forecast: Array<{ week: string; booked_hours: number; demand_hours: number; staff_hours: number; usable_hours: number; gap_hours: number }>;
  hiring: {
    needed: boolean;
    hours_short: number;
    workers: number;
    fte: number;
    hire_by: string | null;
    short_from: string | null;
    hours_per_new_worker: number;
    lead_time_weeks: number;
    expected_leavers: number;
    spare_hours: number;
  };
  finance: {
    wage_source: "pay records" | "entered" | null;
    revenue_per_hour: number | null;
    wage_per_hour: number | null;
    loaded_wage_per_hour: number | null;
    margin_per_hour: number | null;
    margin_pct: number | null;
    weekly_wages: number;
    weekly_wages_loaded: number;
    projected_revenue: number | null;
    projected_wages_loaded: number | null;
    revenue_at_risk: number | null;
    new_worker_weekly_cost: number | null;
    new_worker_weekly_revenue: number | null;
  };
  funding: { plans_counted: number; weekly_dollars: number; weekly_hours: number | null };
  growth: {
    months: Array<{ month: string; participants: number; staff: number; hours: number; revenue: number }>;
    participants_change_pct: number | null;
    staff_change_pct: number | null;
    open_enquiries: number;
    conversion_pct: number;
    days_to_activate: number;
  };
  assumptions: { target_utilisation_pct: number; on_cost_pct: number; measured: Record<string, boolean> };
};

export type PlanSettings = {
  targetUtilisation: number;
  onCostRate: number;
  leadTimeWeeks: number | null;
  wagePerHour: number | null;
};

export const DEFAULT_SETTINGS: PlanSettings = { targetUtilisation: 0.85, onCostRate: 0.15, leadTimeWeeks: null, wagePerHour: null };

export function planQuery(s: PlanSettings): string {
  const q = new URLSearchParams({ target_utilisation: String(s.targetUtilisation), on_cost_rate: String(s.onCostRate) });
  if (s.leadTimeWeeks) q.set("lead_time_weeks", String(s.leadTimeWeeks));
  if (s.wagePerHour) q.set("wage_per_hour", String(s.wagePerHour));
  return q.toString();
}

/** Whole dollars, except cents on amounts under $100 that have them
 *  (hourly rates such as $57.50). */
export const money = (n: number) => {
  const cents = Math.abs(n) < 100 && !Number.isInteger(n) ? 2 : 0;
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: cents, maximumFractionDigits: cents });
};

export const hours = (n: number) => `${Math.round(n * 10) / 10} h`;

export function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * The plan's answer in sentences, from its numbers: whether to hire (how
 * many, by when, why), or how much room there is to grow; whether funding
 * supports it; and what a new worker costs and earns.
 */
export function planSummary(plan: WorkforcePlan, today: string): { headline: string; points: string[]; tone: "good" | "warning" | "danger" } {
  const { hiring, capacity, demand, finance, funding } = plan;
  const points: string[] = [];
  let headline: string;
  let tone: "good" | "warning" | "danger";

  if (hiring.needed && hiring.hire_by && hiring.short_from) {
    const now = hiring.hire_by <= today;
    headline = `Hire ${hiring.workers} support ${plural(hiring.workers, "worker")} (about ${hiring.fte} FTE) ${now ? "now" : `by ${dayLabel(hiring.hire_by)}`}`;
    tone = now ? "danger" : "warning";
    points.push(
      `From the week of ${dayLabel(hiring.short_from)}, the support booked and expected is more than your team can cover at ${capacity.target_utilisation_pct}% of their hours, up to ${hours(hiring.hours_short)} a week short.`,
    );
    points.push(`Hiring usually takes about ${hiring.lead_time_weeks} ${plural(hiring.lead_time_weeks, "week")} from invite to first shift.`);
  } else {
    const perParticipant = demand.pipeline.open_enquiries
      ? demand.pipeline.requested_hours / demand.pipeline.open_enquiries
      : null;
    const room = perParticipant && perParticipant > 0 ? Math.floor(hiring.spare_hours / perParticipant) : null;
    headline = `Your team can cover the next 12 weeks, with ${hours(hiring.spare_hours)} a week to spare`;
    tone = "good";
    if (room) points.push(`That's room for about ${room} more ${plural(room, "participant")} at the hours your enquiries ask for.`);
  }

  if (capacity.utilisation_pct != null) {
    const u = capacity.utilisation_pct;
    points.push(
      u < 50
        ? `Your team is working ${u}% of the hours they've offered. Most of their time is free, so grow participants before hiring.`
        : u > capacity.target_utilisation_pct
          ? `Your team is working ${u}% of the hours they've offered, above the ${capacity.target_utilisation_pct}% target. Expect tiredness, overtime and cancellations.`
          : `Your team is working ${u}% of the hours they've offered.`,
    );
  }
  if (hiring.expected_leavers >= 0.5) {
    points.push(`At this year's turnover, expect about ${Math.round(hiring.expected_leavers)} ${plural(Math.round(hiring.expected_leavers), "worker")} to leave in the next 12 weeks.`);
  }
  if (funding.weekly_hours != null && demand.current_weekly_hours > 0) {
    points.push(
      funding.weekly_hours >= demand.current_weekly_hours
        ? `Participants' remaining funding pays for about ${hours(funding.weekly_hours)} a week, enough for the ${hours(demand.current_weekly_hours)} being delivered.`
        : `Participants' remaining funding pays for only about ${hours(funding.weekly_hours)} a week, less than the ${hours(demand.current_weekly_hours)} being delivered. Some plans will run out early.`,
    );
  }
  if (finance.new_worker_weekly_cost != null && finance.new_worker_weekly_revenue != null) {
    points.push(
      `A new worker on ${hours(hiring.hours_per_new_worker)} a week would cost about ${money(finance.new_worker_weekly_cost)} a week with on-costs, and bring in about ${money(finance.new_worker_weekly_revenue)}.`,
    );
  } else if (finance.wage_source == null) {
    points.push("No pay has been calculated yet, so staff costs aren't known. Enter an average hourly wage below to see them.");
  }
  return { headline, points, tone };
}
