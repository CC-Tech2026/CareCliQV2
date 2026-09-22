import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MDCompliancePage from "./compliance";
import MDExecutivePage from "./executive";
import { GovernanceTriage } from "@/components/hub/GovernanceTriage";
const mocks = vi.hoisted(() => ({ api: vi.fn(), alerts: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: mocks.api }));
vi.mock("@/services/hubService", () => ({
  getHubComplianceAlerts: mocks.alerts,
}));
vi.mock("@/components/layout/HubLayout", () => ({
  HubLayout: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (s: string) => s }),
}));
vi.mock("@/components/ui/section-info", () => ({ SectionInfo: () => null }));
const data = {
  active_participants: 12,
  active_staff: 8,
  support_workers: 6,
  staff_retention_rate: 95,
  sessions_this_week: 20,
  compliance_score: 90,
  compliance_target: 85,
  incidents_this_month: 0,
  goal_achievement_rate: 80,
  workers_at_risk: [],
  org_alerts: [],
  common_issues: [],
  team_compliance_breakdown: { compliant: 6, at_risk: 0, non_compliant: 0 },
  worker_rankings: [],
  generated_at: "2026-09-16T00:00:00Z",
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps the overview available when only the trend fails", async () => {
  mocks.alerts.mockResolvedValue([]);
  mocks.api.mockImplementation((url: string) =>
    url.endsWith("compliance-trend")
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ ok: true, json: async () => data }),
  );
  render(<MDExecutivePage />);
  expect(
    await screen.findByRole("heading", { name: "Organisation at a glance" }),
  ).toBeTruthy();
  expect(screen.getByText("Compliance trend unavailable")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "NDIS invoices" }).getAttribute("href"),
  ).toBe("/md/financial");
  expect(screen.queryByText("Building your performance trend")).toBeNull();
});
it("retries a failed overview without a page reload", async () => {
  mocks.alerts.mockResolvedValue([]);
  mocks.api.mockResolvedValue({ ok: false });
  render(<MDExecutivePage />);
  await screen.findByRole("button", { name: "Try again" });
  mocks.api.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        url.endsWith("compliance-trend") ? { trend: [] } : data,
    }),
  );
  const retry = await screen.findByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  expect(
    await screen.findByRole("heading", { name: "Organisation at a glance" }),
  ).toBeTruthy();
});
it("shows failed action items and recovers on retry", async () => {
  const fetchAlerts = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([]);
  render(<GovernanceTriage onNavigate={() => {}} fetchAlerts={fetchAlerts} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry action items" }));
  await screen.findAllByText(/All caught up/i);
  expect(fetchAlerts).toHaveBeenCalledTimes(2);
});

it("keeps compliance records visible when the trend fails", async () => {
  mocks.api.mockImplementation((url: string) =>
    url.endsWith("compliance-trend")
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ ok: true, json: async () => data }),
  );
  render(<MDCompliancePage />);
  expect(
    await screen.findByText(/The compliance trend could not be loaded/),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Competency & training" })
      .getAttribute("href"),
  ).toBe("/md/onboarding/training");
});
it("offers retry when compliance records fail to load", async () => {
  mocks.api.mockResolvedValue({ ok: false });
  render(<MDCompliancePage />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});
