import { describe, expect, it } from "vitest";

import { EDIT_COSTS, financeActions, financeOutcomes, type FinanceInputs } from "./finance-outcomes";

const links = { invoices: "/billing?workspace=invoices", claims: "/billing?workspace=claims" };

const base: FinanceInputs = {
  period_label: "Oct to Dec 2026",
  invoice_count: 2,
  billed_cents: 44148,
  collected_cents: 0,
  outstanding_cents: 44148,
  overdue_cents: 22074,
  profit_and_loss: { net_profit_cents: null, margin_pct: null, wages_complete: false, overheads_set: false },
  cash: { on_hand_cents: null, runway_months: null, cash_positive: false, covers_months: null },
};

describe("finance outcomes", () => {
  it("says where the money stands in words", () => {
    const byId = Object.fromEntries(financeOutcomes(base, { readyCents: 0, readyCount: 0, needsFixing: 0 }, links).map((o) => [o.id, o]));
    expect(byId.revenue.headline).toBe("You billed $441.48 in Oct to Dec 2026 and have collected 0% of it");
    expect(byId.revenue.status).toBe("off_track");
    expect(byId.owed.headline).toBe("$220.74 is overdue");
    expect(byId.profit.status).toBe("no_data");
    expect(byId.profit.action.href).toBe(EDIT_COSTS);
    expect(byId.cash.headline).toBe("Your cash position isn't set up");
    expect(byId.claims.status).toBe("on_track");
  });

  it("reports profit, losses and cash runway", () => {
    const good = financeOutcomes(
      { ...base, collected_cents: 44148, outstanding_cents: 0, overdue_cents: 0, profit_and_loss: { net_profit_cents: 1000000, margin_pct: 22, wages_complete: true, overheads_set: true }, cash: { on_hand_cents: 5000000, runway_months: null, cash_positive: true, covers_months: 4 } },
      null,
      links,
    );
    const byId = Object.fromEntries(good.map((o) => [o.id, o]));
    expect(byId.profit.headline).toBe("You made $10,000 profit in Oct to Dec 2026, a 22% margin");
    expect(byId.profit.status).toBe("on_track");
    expect(byId.owed.headline).toBe("Every invoice has been paid");
    expect(byId.cash.status).toBe("on_track");
    expect(byId.claims).toBeUndefined();

    const loss = financeOutcomes({ ...base, profit_and_loss: { net_profit_cents: -250000, margin_pct: -15, wages_complete: true, overheads_set: true }, cash: { on_hand_cents: 1000000, runway_months: 3, cash_positive: false, covers_months: 3 } }, null, links);
    const l = Object.fromEntries(loss.map((o) => [o.id, o]));
    expect(l.profit.headline).toBe("You made a loss of $2,500 in Oct to Dec 2026");
    expect(l.cash.headline).toBe("At this rate, cash lasts about 3 months");
    expect(l.cash.status).toBe("off_track");
  });

  it("lists what to do about it, most urgent first", () => {
    const actions = financeActions(base, { readyCents: 120000, readyCount: 3, needsFixing: 1 }, links);
    expect(actions.map((a) => [a.group, a.title])).toEqual([
      ["now", "Chase $220.74 of overdue invoices"],
      ["now", "Fix 1 NDIS claim"],
      ["week", "Send $1,200 of NDIS claims"],
      ["week", "Add your monthly overheads"],
      ["watch", "Add your cash balance"],
      ["watch", "$220.74 not yet due"],
    ]);
  });
});
