import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SubscriptionBanner } from "./SubscriptionBanner";

const { query, auth } = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn() }));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: query }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: auth }));

function as(role: string) {
  auth.mockReturnValue({ isAuthenticated: true, user: { role, organizationId: "org-1" } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("tells the director the trial has ended, with a date and a way to pay", () => {
  as("managing_director");
  query.mockReturnValue({ data: { state: "grace", subscription_status: "past_due", grace_ends_at: "2026-11-19T00:00:00Z", can_manage_billing: true } });
  render(<SubscriptionBanner />);
  expect(screen.getByRole("status").textContent).toContain("The last CareCliQ payment didn't go through");
  expect(screen.getByRole("status").textContent).toContain("19 Nov");
  expect(screen.getByRole("button", { name: /Choose a plan/ })).toBeTruthy();
});

it("doesn't worry staff during the grace period", () => {
  as("support_worker");
  query.mockReturnValue({ data: { state: "grace", subscription_status: "past_due", grace_ends_at: "2026-11-19T00:00:00Z", can_manage_billing: false } });
  const { container } = render(<SubscriptionBanner />);
  expect(container.innerHTML).toBe("");
});

it("explains read-only to everyone, and who can fix it", () => {
  as("support_worker");
  query.mockReturnValue({ data: { state: "read_only", subscription_status: "canceled", grace_ends_at: "2026-11-01T00:00:00Z", can_manage_billing: false } });
  render(<SubscriptionBanner />);
  const alert = screen.getByRole("alert").textContent ?? "";
  expect(alert).toContain("Records are read-only because the CareCliQ subscription was cancelled");
  expect(alert).toContain("report incidents");
  expect(alert).toContain("Your managing director can renew it.");
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows nothing when the subscription is fine", () => {
  as("managing_director");
  query.mockReturnValue({ data: { state: "full", subscription_status: "active", grace_ends_at: null, can_manage_billing: true } });
  const { container } = render(<SubscriptionBanner />);
  expect(container.innerHTML).toBe("");
});
