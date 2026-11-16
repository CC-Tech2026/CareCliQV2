import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegrationsSection } from "./IntegrationsSection";
import * as integrations from "@/services/integrationsService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/services/integrationsService");

const SETTINGS = { sales_account_code: "200", tax_type: "EXEMPTOUTPUT", invoice_status: "AUTHORISED", auto_send: true } as const;

const NO_API = { keys: [], webhooks: [], scopes: [], events: [] };

function renderSection() {
  vi.mocked(integrations.getApiOverview).mockResolvedValue(NO_API);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IntegrationsSection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Settings > Integrations", () => {
  it("lists Xero, the API and a way to suggest one, and connects to Xero", async () => {
    vi.mocked(integrations.getXeroStatus).mockResolvedValue({
      available: true, connected: false, redirect_uri: "x", settings: { ...SETTINGS },
    });
    vi.mocked(integrations.startXeroConnect).mockResolvedValue({ url: "https://login.xero.com/identity/connect/authorize?x=1" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderSection();
    expect(await screen.findByText(/payments made there mark them paid here/)).toBeTruthy();
    expect(screen.getAllByText("Not connected")).toHaveLength(2); // Xero, and the API with no keys yet
    expect(screen.getByText("API and webhooks")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Set up" })).toBeTruthy();
    expect(screen.getByText("Need another integration?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Connect to Xero/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.xero.com/identity/connect/authorize?x=1"));
    vi.unstubAllGlobals();
  });

  it("says when Xero isn't switched on for the server", async () => {
    vi.mocked(integrations.getXeroStatus).mockResolvedValue({
      available: false, connected: false, redirect_uri: "x", settings: { ...SETTINGS },
    });
    renderSection();
    expect(await screen.findByText("Not switched on")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Connect to Xero/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the connected organisation, how syncing is going, and saves a change", async () => {
    vi.mocked(integrations.getXeroStatus).mockResolvedValue({
      available: true, connected: true, redirect_uri: "x", settings: { ...SETTINGS },
      tenant_name: "Sunrise Supports", connected_by_name: "Morgan Hayes", connected_at: "2026-11-16T01:00:00Z",
      counts: { in_xero: 12, waiting: 2, failed: 1 },
      last_payment_check_at: "2026-11-16T02:00:00Z",
      recent: [
        { id: "i1", invoice_number: "INV-0042", payer: "Plan Partners", total_cents: 220004, currency: "AUD", status: "paid", xero_status: "PAID", at: "2026-11-16T02:00:00Z" },
        { id: "i2", invoice_number: "INV-0043", payer: "NDIA", total_cents: 10535, currency: "AUD", status: "sent", error: "Account code '999' is not valid.", at: "2026-11-16T01:00:00Z" },
      ],
    });
    vi.mocked(integrations.getXeroOptions).mockResolvedValue({
      accounts: [{ code: "200", name: "Sales" }, { code: "260", name: "NDIS income" }],
      tax_rates: [{ type: "EXEMPTOUTPUT", name: "GST Free Income" }],
    });
    vi.mocked(integrations.saveXeroSettings).mockResolvedValue({} as never);
    renderSection();
    // The tile: connected (one invoice failed, so it needs attention), then Manage.
    expect(await screen.findByText("Sunrise Supports")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("Couldn't be sent")).toBeTruthy();
    // Recent invoices: their state in Xero, and why one didn't go.
    expect(screen.getByText("Paid in Xero")).toBeTruthy();
    expect(screen.getByText("$2,200.04")).toBeTruthy();
    expect(screen.getByText("Couldn't send")).toBeTruthy();
    expect(screen.getByText("Account code '999' is not valid.")).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save Xero settings/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "As drafts" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(integrations.saveXeroSettings).toHaveBeenCalledWith({ ...SETTINGS, invoice_status: "DRAFT" }),
    );
    // Opens the side panel and its selects, so more than the default 5s.
  }, 15_000);
});
