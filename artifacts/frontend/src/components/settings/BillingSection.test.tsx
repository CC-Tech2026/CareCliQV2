import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BillingSection } from "./BillingSection";
import { apiFetch } from "@/lib/api-fetch";
const auth = vi.hoisted(() => ({ role: "managing_director" }));
const fixtures = vi.hoisted(() => ({ grants: [] as Record<string, unknown>[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
// BillingSection also accepts platform_billing via a delegated-access grant.
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: fixtures.grants, isLoading: false }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  auth.role = "managing_director";
  fixtures.grants = [];
});
it("shows a trial even before a Stripe customer is linked", async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      plan_tier: "small",
      subscription_status: "trialing",
      trial_ends_at: "2026-10-01",
      stripe_customer_id: null,
    }),
  } as Response);
  render(<BillingSection />);
  expect(await screen.findByText("Small")).toBeTruthy();
  expect(screen.getByText("Free trial")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /NDIS/ })).toBeNull();
  expect(screen.queryByText("Participant invoicing")).toBeNull();
  expect(screen.queryByText("No plan selected")).toBeNull();
  expect(
    screen.getByRole("link", { name: /Manage plan/ }).getAttribute("href"),
  ).toBe("/platform-billing");
});
it("shows an error instead of no plan, and retries", async () => {
  vi.mocked(apiFetch)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan_tier: null,
        subscription_status: null,
        stripe_customer_id: null,
      }),
    } as Response);
  render(<BillingSection />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("No plan selected")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry subscription" }));
  expect(await screen.findByText("No plan selected")).toBeTruthy();
});
it("does not request or display subscription data for coordinators", () => {
  auth.role = "support_coordinator";
  const { container } = render(<BillingSection />);
  expect(container.textContent).toBe("");
  expect(apiFetch).not.toHaveBeenCalled();
});
it("shows the section, with a temporary-access banner, for a coordinator holding a platform_billing grant", async () => {
  auth.role = "support_coordinator";
  fixtures.grants = [{
    id: "grant-1",
    capability: "platform_billing",
    expires_at: "2026-10-01T00:00:00Z",
    revoked_at: null,
    status: "active",
  }];
  vi.mocked(apiFetch).mockResolvedValue({
    ok: true,
    json: async () => ({ plan_tier: "small", subscription_status: "active", stripe_customer_id: "cus_1" }),
  } as Response);
  render(<BillingSection />);
  expect(await screen.findByText(/Temporary access/)).toBeTruthy();
  expect(screen.getByText("Small")).toBeTruthy();
});
