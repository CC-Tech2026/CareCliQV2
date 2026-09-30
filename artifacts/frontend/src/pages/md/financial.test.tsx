import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MDFinancialPage from "./financial";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: mocks.api }));
vi.mock("@/components/layout/HubLayout", () => ({ HubLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({ useAccessibility: () => ({ translate: (s: string) => s }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const summary = (period: string) => ({
  period,
  period_label: period === "month" ? "September 2026" : "Jul–Sep 2026",
  invoice_count: 186,
  billed_cents: 45_130_000,
  collected_cents: 41_238_000,
  outstanding_cents: 3_892_000,
  overdue_cents: 98_600,
  session_count: 1284,
  costed_session_count: 1200,
  labour_cost_cents: 7_368_000,
  cost_per_session_cents: 6140,
  revenue_by_month: [
    { month: "2026-08", billed_cents: 8_980_000, current: false },
    { month: "2026-09", billed_cents: 7_240_000, current: true },
  ],
  recent_invoices: [
    { id: "i1", invoice_number: "INV-2291", name: "Liam Carter", total_cents: 140_500, status: "draft" },
    { id: "i2", invoice_number: "INV-2289", name: "Noah Brown", total_cents: 98_600, status: "overdue" },
  ],
});

function renderPage() {
  mocks.api.mockImplementation((url: string) => {
    const period = /period=(\w+)/.exec(url)?.[1];
    const body = url.startsWith("/api/billing/financial-summary") ? summary(period ?? "quarter") : [];
    return Promise.resolve({ ok: true, json: async () => body });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MDFinancialPage />
    </QueryClientProvider>,
  );
}

it("shows the period's figures from the server", async () => {
  renderPage();
  expect(await screen.findByText("186")).toBeTruthy();
  expect(screen.getByText("$412,380.00")).toBeTruthy();
  expect(screen.getByText("$986.00 overdue")).toBeTruthy();
  expect(screen.getByText("1,284")).toBeTruthy();
  expect(screen.getByText("$61.40")).toBeTruthy();
  expect(screen.getByText("INV-2289")).toBeTruthy();
  expect(screen.getByText("Overdue")).toBeTruthy();
  expect(screen.getByLabelText("Sep: $72,400.00")).toBeTruthy();
});

it("switches period", async () => {
  renderPage();
  await screen.findByText("186");
  fireEvent.click(screen.getByRole("tab", { name: "Month" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/billing/financial-summary?period=month"));
  expect(await screen.findByText(/September 2026/)).toBeTruthy();
});
