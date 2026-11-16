import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyobTile } from "./MyobIntegration";
import * as myob from "@/services/myobService";
import type { MyobStatus } from "@/services/myobService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/services/myobService");

Element.prototype.scrollIntoView = vi.fn();

const READY = { income_account_uid: "acc-1", income_account_name: "4-1000 NDIS services", tax_code_uid: "fre", tax_code_name: "FRE GST Free", auto_send: true };
const NOT_CONNECTED: MyobStatus = {
  available: true, connected: false, redirect_uri: "m",
  settings: { income_account_uid: null, tax_code_uid: null, auto_send: true },
};

function renderTile(status: MyobStatus) {
  vi.mocked(myob.getMyobStatus).mockResolvedValue(status);
  vi.mocked(myob.getMyobOptions).mockResolvedValue({
    accounts: [{ uid: "acc-1", label: "4-1000 NDIS services" }, { uid: "acc-2", label: "4-2000 Other income" }],
    tax_codes: [{ uid: "fre", code: "FRE", label: "FRE GST Free" }, { uid: "gst", code: "GST", label: "GST Goods & Services Tax" }],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyobTile />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("MYOB tile", () => {
  it("connects to MYOB", async () => {
    vi.mocked(myob.startMyobConnect).mockResolvedValue({ url: "https://secure.myob.com/oauth2/account/authorize?x=1" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderTile(NOT_CONNECTED);
    expect(await screen.findByText(/invoices paid there are marked paid here/)).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Connect to MYOB/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://secure.myob.com/oauth2/account/authorize?x=1"));
  });

  it("can't be connected while Xero is", async () => {
    renderTile({ ...NOT_CONNECTED, blocked_by_xero: true });
    expect(await screen.findByText("Xero is connected. Disconnect Xero to use MYOB instead.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Connect to MYOB/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when MYOB isn't switched on for the server", async () => {
    renderTile({ ...NOT_CONNECTED, available: false });
    expect(await screen.findByText("Not switched on")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Connect to MYOB/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for the account and tax code when they aren't chosen yet", async () => {
    renderTile({ ...NOT_CONNECTED, connected: true, business_name: "Sunrise Supports", settings: NOT_CONNECTED.settings });
    expect(await screen.findByText("Needs attention")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText(/Invoices wait until both are set/)).toBeTruthy();
  });

  it("shows the company file, MYOB's own number, and saves a change", async () => {
    vi.mocked(myob.saveMyobSettings).mockResolvedValue({ ...NOT_CONNECTED, connected: true, settings: READY });
    renderTile({
      ...NOT_CONNECTED,
      connected: true,
      business_name: "Sunrise Supports",
      settings: READY,
      counts: { in_myob: 3, waiting: 0, failed: 0 },
      recent: [{
        id: "inv-1", invoice_number: "HBCC-INV-202611-004", myob_number: "00000123", payer: "Plan Partners",
        total_cents: 10535, currency: "AUD", status: "sent", myob_status: "Open",
      }],
    });
    expect(await screen.findByText("Connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText(/HBCC-INV-202611-004 · MYOB 00000123/)).toBeTruthy();
    expect(screen.getByText("Awaiting payment")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save MYOB settings" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Send each invoice when it's approved" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(myob.saveMyobSettings).toHaveBeenCalledWith({ ...READY, auto_send: false }));
  });
});
