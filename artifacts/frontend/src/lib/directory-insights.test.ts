import { describe, expect, it } from "vitest";
import type { Credential } from "@/services/credentialsService";
import {
  budgetUsage,
  notesStatus,
  planEndStatus,
  planManagementLabel,
  summariseCredentials,
} from "./directory-insights";

const today = new Date(2026, 9, 12); // 12 Oct 2026

function credential(overrides: Partial<Credential>): Credential {
  return { id: Math.random().toString(), credential_type: "screening", title: "Check", status: "valid", ...overrides };
}

describe("summariseCredentials", () => {
  it("leads with expired, then expiring, then awaiting review", () => {
    const summary = summariseCredentials(
      [
        credential({ user_id: "a", expiry_date: "2026-10-01" }),
        credential({ user_id: "a", expiry_date: "2026-10-20" }),
        credential({ user_id: "b", expiry_date: "2026-11-01" }),
        credential({ user_id: "c", status: "pending_review", expiry_date: "2027-06-01" }),
        credential({ user_id: "d", expiry_date: "2027-06-01" }),
        credential({ user_id: "d", status: "rejected" }),
      ],
      today,
    );
    expect(summary.get("a")).toMatchObject({ label: "1 expired", tone: "danger", expiring: 1 });
    expect(summary.get("b")).toMatchObject({ label: "1 expiring soon", tone: "warning" });
    expect(summary.get("c")).toMatchObject({ label: "1 awaiting review", tone: "info" });
    // Rejected uploads don't count towards what's on file.
    expect(summary.get("d")).toMatchObject({ label: "All 1 current", tone: "good", total: 1 });
    expect(summary.has("e")).toBe(false);
  });
});

describe("notesStatus", () => {
  it("puts flagged notes ahead of drafts", () => {
    expect(notesStatus(2, 1)).toEqual({ label: "1 flagged · 2 drafts", tone: "danger" });
    expect(notesStatus(1, 0)).toEqual({ label: "1 to finish", tone: "warning" });
    expect(notesStatus(0, 0)).toEqual({ label: "Up to date", tone: "neutral" });
  });
});

describe("planEndStatus", () => {
  it("flags ended and soon-ending plans", () => {
    expect(planEndStatus("2026-10-09", today)).toMatchObject({ detail: "Ended 3 days ago", tone: "danger" });
    expect(planEndStatus("2026-10-12", today)).toMatchObject({ detail: "Ends today", tone: "danger" });
    expect(planEndStatus("2026-11-11", today)).toMatchObject({ detail: "Ends in 30 days", tone: "warning" });
    expect(planEndStatus("2027-04-12", today)).toMatchObject({ detail: "In 6 months", tone: "neutral" });
    expect(planEndStatus(null, today)).toMatchObject({ label: "No plan dates", tone: "neutral" });
  });
});

describe("budgetUsage", () => {
  it("judges spending against how far through the plan we are", () => {
    const plan = { start: "2026-01-01", end: "2026-12-31", today: new Date(2026, 6, 1) }; // ~50% through
    expect(budgetUsage(40000, 20000, plan)).toEqual({ percent: 50, label: "50% used", detail: "$20k of $40k", tone: "good" });
    expect(budgetUsage(40000, 26000, plan)).toMatchObject({ percent: 65, tone: "warning", detail: "$26k of $40k · ahead of plan" });
    expect(budgetUsage(40000, 32000, plan)).toMatchObject({ percent: 80, tone: "danger" });
    expect(budgetUsage(40000, 41000, plan)).toMatchObject({ tone: "danger" });
  });

  it("falls back to fixed thresholds without plan dates", () => {
    expect(budgetUsage("10000", "8000")).toMatchObject({ percent: 80, tone: "warning", detail: "$8k of $10k" });
    expect(budgetUsage(0, 0)).toMatchObject({ percent: null, label: "No budget set" });
  });
});

it("labels plan management types", () => {
  expect(planManagementLabel("plan-managed")).toBe("Plan managed");
  expect(planManagementLabel("unknown")).toBeNull();
});
