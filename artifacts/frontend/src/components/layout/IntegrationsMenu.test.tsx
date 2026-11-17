import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegrationsMenu } from "./IntegrationsMenu";
import * as integrations from "@/services/integrationsService";
import * as myob from "@/services/myobService";
import * as eh from "@/services/employmentHeroService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
vi.mock("@/services/integrationsService");
vi.mock("@/services/myobService");
vi.mock("@/services/employmentHeroService");

const SETTINGS = { sales_account_code: "200", tax_type: "EXEMPTOUTPUT", invoice_status: "AUTHORISED", auto_send: true } as const;
const MYOB_OFF = {
  available: false, connected: false, redirect_uri: "m",
  settings: { income_account_uid: null, tax_code_uid: null, auto_send: true },
};
const EH_OFF = {
  available: false, connected: false, redirect_uri: "e",
  settings: { auto_send: true, send_approved: true, send_from: null, sleepover_work_type_id: null },
};
const NO_API = { keys: [], webhooks: [], scopes: [], events: [] };

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IntegrationsMenu />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Top bar Integrations menu", () => {
  it("lists what's connected, flags what needs attention, and opens its page", async () => {
    vi.mocked(integrations.getXeroStatus).mockResolvedValue({
      available: true, connected: true, redirect_uri: "x", settings: { ...SETTINGS },
      tenant_name: "Sunrise Supports", counts: { in_xero: 4, waiting: 0, failed: 1 },
    });
    vi.mocked(myob.getMyobStatus).mockResolvedValue(MYOB_OFF);
    vi.mocked(eh.getEmploymentHeroStatus).mockResolvedValue(EH_OFF);
    vi.mocked(integrations.getApiOverview).mockResolvedValue({
      ...NO_API,
      keys: [{ id: "k1", name: "CORA", prefix: "cc_live_1", scopes: [], created_at: "2026-11-01T00:00:00Z", last_used_at: null }],
    });
    renderMenu();
    const button = await screen.findByRole("button", { name: "Integrations: something needs attention" });
    fireEvent.click(button);
    expect(await screen.findByText("Sunrise Supports")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("1 key · 0 webhooks")).toBeTruthy();
    expect(screen.queryByText("MYOB")).toBeNull();
    const openXero = screen.getByRole("link", { name: /Open Xero/ });
    expect(openXero.getAttribute("href")).toBe("https://go.xero.com/");
    expect(openXero.getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("link", { name: /Xero.*Sunrise Supports/ }));
    expect(window.location.search).toBe("?section=integrations&integration=xero");
  });

  it("shows Employment Hero with the timesheets waiting for an answer", async () => {
    vi.mocked(integrations.getXeroStatus).mockResolvedValue({
      available: true, connected: false, redirect_uri: "x", settings: { ...SETTINGS },
    });
    vi.mocked(myob.getMyobStatus).mockResolvedValue(MYOB_OFF);
    vi.mocked(eh.getEmploymentHeroStatus).mockResolvedValue({
      ...EH_OFF, available: true, connected: true, business_name: "Sunrise Payroll", needs_business: false,
      counts: { sent: 5, failed: 2, paid: 0 },
    });
    vi.mocked(integrations.getApiOverview).mockResolvedValue(NO_API);
    renderMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Integrations: something needs attention" }));
    expect(await screen.findByText("2 timesheets need your answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /Employment Hero/ }));
    expect(window.location.search).toBe("?section=integrations&integration=employment-hero");
  });

  it("offers to connect something when nothing is", async () => {
    vi.mocked(integrations.getXeroStatus).mockResolvedValue({
      available: true, connected: false, redirect_uri: "x", settings: { ...SETTINGS },
    });
    vi.mocked(myob.getMyobStatus).mockResolvedValue(MYOB_OFF);
    vi.mocked(eh.getEmploymentHeroStatus).mockResolvedValue(EH_OFF);
    vi.mocked(integrations.getApiOverview).mockResolvedValue(NO_API);
    renderMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Integrations" }));
    expect(await screen.findByText("Nothing connected yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect an integration" }).getAttribute("href")).toBe("/settings?section=integrations");
  });
});
