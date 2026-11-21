import { describe, expect, it } from "vitest";

import type { HubComplianceAlert } from "@/services/hubService";
import { buildActions, buildOutcomes, type OutcomeInputs } from "./governance-outcomes";

const md: OutcomeInputs = {
  goals_active: 6,
  active_goals_supported_30d: 0,
  compliance_score: 76,
  compliance_target: 90,
  documentation_summary: { scored: 7 },
  incidents_this_month: 0,
  staff_retention_rate: 100,
  active_staff: 4,
  workers_at_risk: [{ id: "w1", full_name: "Tom Walsh", compliance_score: 75, sessions: 2 }],
};

const alert = (over: Partial<HubComplianceAlert>): HubComplianceAlert => ({
  id: "a", title: "Something", detail: "Detail", severity: "high", action_label: "Open", ...over,
});

const demand = {
  waitlist: { count: 1, hours: 6 },
  capacity: { reliable_hours: 0, casual_hours: 40, workers_counted: 3, workers_without_availability: 2, week_start: "2026-11-16" },
};

describe("governance outcomes", () => {
  it("says each outcome in words, with a status", () => {
    const alerts = [
      alert({ id: "i1", source: "incidents", severity: "critical", title: "Reportable incident: Fall on the front steps" }),
      alert({ id: "c1", source: "credentials", severity: "critical", title: "Tom Walsh: CPR" }),
      alert({ id: "c2", source: "credentials", severity: "high", title: "Aisha Rahman: CPR" }),
    ];
    const byId = Object.fromEntries(buildOutcomes(md, alerts, demand).map((o) => [o.id, o]));
    expect(byId.goals.headline).toBe("0 of 6 active goals were worked on in the last 30 days");
    expect(byId.goals.status).toBe("off_track");
    expect(byId.quality.headline).toBe("76% of shift notes meet the documentation standard");
    expect(byId.quality.status).toBe("off_track");
    expect(byId.quality.detail).toBe("14 points below the 90% target. 1 worker needs support.");
    expect(byId.safety.status).toBe("off_track");
    expect(byId.safety.detail).toContain("Fall on the front steps");
    expect(byId.workforce.headline).toBe("1 staff credential has expired");
    expect(byId.workforce.detail).toBe("1 more expires soon. Staff retention 100%.");
    expect(byId.demand.headline).toBe("1 enquiry is waiting, asking for 6 hours a week");
    expect(byId.demand.status).toBe("attention");
  });

  it("is on track when things are fine, and honest when there's no data", () => {
    const fine = buildOutcomes(
      { ...md, goals_active: 4, active_goals_supported_30d: 4, compliance_score: 93, workers_at_risk: [] },
      [],
      { ...demand, waitlist: { count: 0, hours: 0 } },
    );
    expect(fine.every((o) => o.status === "on_track")).toBe(true);
    const empty = buildOutcomes({ goals_active: 0, documentation_summary: { scored: 0 } }, [], null);
    expect(empty.find((o) => o.id === "goals")!.status).toBe("no_data");
    expect(empty.find((o) => o.id === "quality")!.status).toBe("no_data");
    expect(empty.find((o) => o.id === "demand")).toBeUndefined();
  });

  it("lists actions most urgent first, with one place to act on each", () => {
    const alerts = [
      alert({ id: "m", severity: "medium", title: "Policy review due" }),
      alert({ id: "c", severity: "critical", title: "Tom Walsh: Working with Children Check", due_date: "2026-11-19" }),
      alert({ id: "h", severity: "high", title: "Aisha Rahman: CPR", due_date: "2026-12-08" }),
      alert({ id: "p", severity: "positive", title: "All clear" }),
    ];
    const actions = buildActions(md, alerts, demand, (a) => `/route/${a.id}`);
    // CPR renewal, Tom's notes, the enquiry and the goals are all this week.
    expect(actions.map((a) => a.group)).toEqual(["now", "week", "week", "week", "week", "watch"]);
    expect(actions[0].title).toContain("Working with Children");
    expect(actions[0].href).toBe("/route/c");
    expect(actions.some((a) => a.title === "Help Tom Walsh with their shift notes")).toBe(true);
    expect(actions.some((a) => a.title === "Screen 1 new enquiry")).toBe(true);
    expect(actions.some((a) => a.title === "6 participant goals have had no support in 30 days")).toBe(true);
    expect(actions.some((a) => a.title === "All clear")).toBe(false);
  });

  it("puts safety first and words credentials as things to do", () => {
    const actions = buildActions(
      { ...md, workers_at_risk: [], goals_active: 0 },
      [
        alert({ id: "c", source: "credentials", severity: "critical", title: "Tom Walsh: First Aid", due_date: "2026-10-20" }),
        alert({ id: "i", source: "incidents", severity: "critical", title: "Reportable incident: Fall on the front steps", due_date: "2026-10-28" }),
        alert({ id: "s", source: "credentials", severity: "high", title: "James: CPR" }),
      ],
      null,
      () => "/x",
    );
    expect(actions.map((a) => a.title)).toEqual([
      "Reportable incident: Fall on the front steps",
      "Renew Tom Walsh's First Aid",
      "Follow up James' CPR renewal",
    ]);
  });
});
