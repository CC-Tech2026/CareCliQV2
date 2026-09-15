import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BillingSection } from "./BillingSection";
import { apiFetch } from "@/lib/api-fetch";
const auth = vi.hoisted(() => ({ role: "managing_director" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  auth.role = "managing_director";
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
