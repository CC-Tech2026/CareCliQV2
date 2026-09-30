import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MDFinancialPage from "./financial";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: mocks.api }));
vi.mock("@/components/layout/HubLayout", () => ({ HubLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({ useAccessibility: () => ({ translate: (s: string) => s }) }));

// jsdom has no ResizeObserver; the chart only needs it to exist.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/md/financial");
});

const month = (m: string, billed: number, extra: Record<string, unknown> = {}) => ({
  month: m, billed_cents: billed, collected_cents: 0, wages_cents: null, overheads_cents: null, net_cents: null,
  current: false, future: false, ...extra,
});

const summary = (period: string, configured = true) => ({
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
    month("2026-08", 8_980_000, { collected_cents: 8_000_000, wages_cents: 2_500_000, overheads_cents: 1_000_000, net_cents: 5_480_000 }),
    month("2026-09", 7_240_000, { current: true }),
  ],
  recent_invoices: [
    { id: "i1", invoice_number: "INV-2291", name: "Liam Carter", total_cents: 140_500, status: "draft" },
    { id: "i2", invoice_number: "INV-2289", name: "Noah Brown", total_cents: 98_600, status: "overdue" },
  ],
  profit_and_loss: configured
    ? { revenue_cents: 45_130_000, wages_cents: 7_368_000, overheads_cents: 3_000_000, net_profit_cents: 34_762_000,
        margin_pct: 77, wages_complete: false, overheads_set: true }
    : { revenue_cents: 45_130_000, wages_cents: null, overheads_cents: null, net_profit_cents: null,
        margin_pct: null, wages_complete: false, overheads_set: false },
  cash: configured
    ? { on_hand_cents: 25_000_000, as_of: "2026-09-29", basis_months: ["2026-08"], avg_monthly_net_cents: -2_000_000,
        avg_monthly_costs_cents: 5_000_000, runway_months: 12.5, covers_months: 5, cash_positive: false }
    : { on_hand_cents: null, as_of: null, basis_months: [], avg_monthly_net_cents: null, avg_monthly_costs_cents: null,
        runway_months: null, covers_months: null, cash_positive: false },
  settings: configured
    ? { cash_on_hand_cents: 25_000_000, cash_as_of: "2026-09-29", monthly_overheads_cents: 1_000_000, updated_at: null }
    : { cash_on_hand_cents: null, cash_as_of: null, monthly_overheads_cents: null, updated_at: null },
});

const claims = {
  ready: [{ invoice_id: "c1", invoice_number: "INV-1", participant_id: "p1", participant_name: "Liam Carter", support_item: "01_011_0107_1_1",
            quantity_label: "4 hrs", total_cents: 28_092, status: "finalized", problems: [], claim_submitted_at: null, paid_at: null,
            payment_reference: null, batch: null }],
  submitted: [], paid: [], drafts_awaiting_review: 0, registration_number_missing: false,
};

function renderPage(configured = true) {
  mocks.api.mockImplementation((url: string, init?: RequestInit) => {
    const period = /period=(\w+)/.exec(url)?.[1];
    let body: unknown = [];
    if (url.startsWith("/api/billing/financial-summary")) body = summary(period ?? "quarter", configured);
    else if (url === "/api/billing/claims") body = claims;
    else if (url === "/api/billing/financial-settings" && init?.method === "PUT") body = {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MDFinancialPage />
    </QueryClientProvider>,
  );
}

it("shows revenue, profit, runway and outstanding for the period", async () => {
  renderPage();
  expect((await screen.findAllByText("$451,300.00"))[0]).toBeTruthy();
  expect(screen.getByText(/186 invoices · 91% collected/)).toBeTruthy();
  expect(screen.getAllByText("$347,620.00").length).toBeGreaterThan(0);
  expect(screen.getByText(/77% margin · costs incomplete/)).toBeTruthy();
  expect(screen.getAllByText("12.5 months")).toHaveLength(2); // tile and cash card
  expect(screen.getByText("$986.00 overdue")).toBeTruthy();
  // P&L: shifts not all costed yet.
  expect(screen.getByText("1,200 of 1,284 shifts costed")).toBeTruthy();
  expect(screen.getByText("−$73,680.00")).toBeTruthy();
  // Cash: reserves meter and basis.
  expect(screen.getByRole("meter", { name: "Months of costs covered" }).getAttribute("aria-valuenow")).toBe("5");
  expect(screen.getByText("Based on Aug.")).toBeTruthy();
  // Claims waiting.
  expect(await screen.findByText("$280.92")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Claim 1 invoice/ })).toBeTruthy();
  expect(screen.getByText("INV-2289")).toBeTruthy();
});

it("says what's missing instead of guessing profit and runway", async () => {
  renderPage(false);
  expect(await screen.findByText("Add costs to see profit")).toBeTruthy();
  expect(screen.getByText("Add your cash balance")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add monthly overheads" })).toBeTruthy();
});

it("saves cash and overheads", async () => {
  renderPage(false);
  fireEvent.click(await screen.findByRole("button", { name: /Add cash balance/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByPlaceholderText("e.g. 250000"), { target: { value: "250,000" } });
  fireEvent.change(within(dialog).getByPlaceholderText("e.g. 18000"), { target: { value: "18000" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith("/api/billing/financial-settings", expect.objectContaining({ method: "PUT" })),
  );
  const put = mocks.api.mock.calls.find(([url]) => url === "/api/billing/financial-settings")!;
  const body = JSON.parse(put[1].body);
  expect(body.cash_on_hand).toBe(250000);
  expect(body.monthly_overheads).toBe(18000);
  expect(body.cash_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("switches period", async () => {
  renderPage();
  await screen.findAllByText("$451,300.00");
  fireEvent.click(screen.getByRole("tab", { name: "Month" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/billing/financial-summary?period=month"));
  expect((await screen.findAllByText(/September 2026/)).length).toBeGreaterThan(0);
});

it("shows the months as a table", async () => {
  renderPage();
  await screen.findAllByText("$451,300.00");
  fireEvent.click(screen.getByRole("button", { name: /Table/ }));
  const table = screen.getByRole("table");
  expect(within(table).getByText("August 2026")).toBeTruthy();
  expect(within(table).getByText("$54,800.00")).toBeTruthy();
  expect(within(table).getByText("$35,000.00")).toBeTruthy();
});

it("opens NDIS claims as its own section and remembers it in the address", async () => {
  renderPage();
  await screen.findAllByText("$451,300.00");
  fireEvent.click(within(screen.getByRole("navigation", { name: "Financial sections" })).getByRole("button", { name: /NDIS claims/ }));
  expect(await screen.findByRole("region", { name: "NDIS invoices" })).toBeTruthy();
  expect(window.location.search).toBe("?tab=claims");
  fireEvent.click(await screen.findByRole("checkbox", { name: /Select Liam Carter/ }));
  expect(screen.getByText(/1 invoice selected/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.queryByText(/1 invoice selected/)).toBeNull();
});
