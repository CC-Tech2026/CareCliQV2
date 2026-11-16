import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvoiceMyobLine } from "./InvoiceMyobLine";
import * as myob from "@/services/myobService";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { organizationId: "org-1" } }) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/services/myobService");

function renderLine(invoice: Parameters<typeof InvoiceMyobLine>[0]["invoice"], connected = true) {
  vi.mocked(myob.getMyobSummary).mockResolvedValue({ connected, business_name: "Sunrise Supports" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvoiceMyobLine invoice={invoice} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("shows nothing for an organisation that doesn't use MYOB", async () => {
  const { container } = renderLine({ id: "inv-1", status: "sent" }, false);
  await waitFor(() => expect(myob.getMyobSummary).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

it("shows MYOB's own number and state", async () => {
  renderLine({
    id: "inv-1", status: "sent", invoice_number: "HBCC-INV-202611-004",
    myob_invoice_uid: "minv-1", myob_invoice_number: "00000123", myob_status: "Open",
  });
  expect(await screen.findByText("In MYOB as 00000123, awaiting payment (Sunrise Supports).")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
});

it("sends an approved invoice that isn't in MYOB yet", async () => {
  vi.mocked(myob.sendInvoiceToMyob).mockResolvedValue({ ok: true, message: "Sent to MYOB as 00000124." });
  renderLine({ id: "inv-2", status: "finalized" });
  fireEvent.click(await screen.findByRole("button", { name: "Send to MYOB" }));
  await waitFor(() => expect(myob.sendInvoiceToMyob).toHaveBeenCalledWith("inv-2"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Sent to MYOB as 00000124." }));
});

it("shows why it couldn't be sent", async () => {
  renderLine({ id: "inv-3", status: "sent", myob_sync_error: "Choose the income account and tax code for MYOB first." });
  expect(await screen.findByText("Choose the income account and tax code for MYOB first.")).toBeTruthy();
});
