import { describe, expect, it } from "vitest";

import { planQuery, planRings, planSummary, DEFAULT_SETTINGS, type WorkforcePlan } from "./workforce-plan";

function plan(over: Partial<WorkforcePlan> = {}): WorkforcePlan {
  return {
    as_of: "2026-11-18",
    history: [],
    demand: { current_weekly_hours: 29, trend_hours_per_week: 2, trend_pct_per_month: 30, booked_next_4_weeks: 30, pipeline: { open_enquiries: 2, requested_hours: 12, conversion_pct: 60, expected_hours: 7.2, starts_in_weeks: 2 } },
    capacity: { staff_hours: 40, reliable_hours: 20, casual_hours: 20, workers: 2, workers_without_hours: 0, utilisation_pct: 72.5, target_utilisation_pct: 85, annual_attrition_pct: 0 },
    forecast: [],
    hiring: { needed: true, hours_short: 22, workers: 2, fte: 0.6, hire_by: "2026-12-07", short_from: "2027-01-04", hours_per_new_worker: 20, lead_time_weeks: 4, expected_leavers: 0, spare_hours: 0 },
    finance: { wage_source: "pay records", revenue_per_hour: 70, wage_per_hour: 50, loaded_wage_per_hour: 57.5, margin_per_hour: 12.5, margin_pct: 17.9, weekly_wages: 1450, weekly_wages_loaded: 1667.5, projected_revenue: 30000, projected_wages_loaded: 24000, revenue_at_risk: 0, new_worker_weekly_cost: 978, new_worker_weekly_revenue: 1190 },
    funding: { plans_counted: 3, weekly_dollars: 2800, weekly_hours: 40 },
    growth: { months: [], participants_change_pct: 20, staff_change_pct: 0, open_enquiries: 2, conversion_pct: 60, days_to_activate: 14 },
    assumptions: { target_utilisation_pct: 85, on_cost_pct: 15, measured: {} },
    ...over,
  };
}

describe("workforce plan summary", () => {
  it("says who to hire, by when and why", () => {
    const s = planSummary(plan(), "2026-11-18");
    expect(s.headline).toBe("Hire 2 support workers (about 0.6 FTE) by 7 Dec");
    expect(s.tone).toBe("warning");
    expect(s.points[0]).toContain("From the week of 4 Jan");
    expect(s.points[0]).toContain("22 h a week short");
    expect(s.points.some((p) => p.includes("about 4 weeks from invite to first shift"))).toBe(true);
    expect(s.points.some((p) => p.includes("cost about $978 a week") && p.includes("$1,190"))).toBe(true);
  });

  it("says hire now when the date has passed", () => {
    const s = planSummary(plan({ hiring: { ...plan().hiring, hire_by: "2026-11-16" } }), "2026-11-18");
    expect(s.headline).toBe("Hire 2 support workers (about 0.6 FTE) now");
    expect(s.tone).toBe("danger");
  });

  it("says how much room there is when no hiring is needed", () => {
    const s = planSummary(
      plan({
        hiring: { ...plan().hiring, needed: false, hire_by: null, short_from: null, workers: 0, fte: 0, spare_hours: 30 },
        capacity: { ...plan().capacity, utilisation_pct: 20 },
      }),
      "2026-11-18",
    );
    expect(s.headline).toBe("Your team can cover the next 12 weeks, with 30 h a week to spare");
    expect(s.points[0]).toBe("That's room for about 5 more participants at the hours your enquiries ask for.");
    expect(s.points.some((p) => p.includes("grow participants before hiring"))).toBe(true);
  });

  it("warns when funding won't cover the hours, and when pay is unknown", () => {
    const s = planSummary(
      plan({
        funding: { plans_counted: 2, weekly_dollars: 700, weekly_hours: 10 },
        finance: { ...plan().finance, wage_source: null, new_worker_weekly_cost: null, wage_per_hour: null },
      }),
      "2026-11-18",
    );
    expect(s.points.some((p) => p.includes("only about 10 h a week"))).toBe(true);
    expect(s.points.some((p) => p.includes("Enter an average hourly wage"))).toBe(true);
  });

  it("sends only the settings that are set", () => {
    expect(planQuery(DEFAULT_SETTINGS)).toBe("target_utilisation=0.85&on_cost_rate=0.15");
    expect(planQuery({ ...DEFAULT_SETTINGS, wagePerHour: 38.5, leadTimeWeeks: 6 })).toContain("wage_per_hour=38.5");
  });
});

describe("workforce plan rings", () => {
  it("gives each area a short figure and a few words", () => {
    const rings = Object.fromEntries(planRings(plan(), "2026-11-18").map((o) => [o.id, o]));
    expect(rings.hiring.ring).toMatchObject({ value: "2", label: "Recruitment", caption: "by 7 Dec" });
    expect(rings.hiring.status).toBe("attention");
    expect(rings.busy.ring).toMatchObject({ value: "73%", caption: "on target" });
    expect(rings.funding.ring).toMatchObject({ value: "40h", caption: "sufficient" });
    expect(rings.margin.ring).toMatchObject({ value: "18%", caption: "$12.50 an hour" });
    expect(rings.turnover.status).toBe("on_track");
  });

  it("flags hiring now and a team stretched past its target", () => {
    const p = plan({
      hiring: { ...plan().hiring, hire_by: "2026-11-16" },
      capacity: { ...plan().capacity, utilisation_pct: 92 },
    });
    const rings = Object.fromEntries(planRings(p, "2026-11-18").map((o) => [o.id, o]));
    expect(rings.hiring.status).toBe("off_track");
    expect(rings.hiring.ring?.caption).toBe("hire now");
    expect(rings.busy.status).toBe("attention");
    expect(rings.busy.ring?.caption).toBe("over target");
  });
});
