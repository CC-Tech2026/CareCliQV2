import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import Billing, {
  NdisCatalogueBrowser,
  RevenueInvoiceLedger,
  overdueDays,
  invoiceReviewWarnings,
  type Invoice,
} from "./billing";
import { resolveNdisPrice } from "@/services/ndisService";
import { apiFetch } from "@/lib/api-fetch";
const queryState = vi.hoisted(() => ({
  data: null as unknown,
  error: false,
  refetch: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "support_coordinator" }));
vi.mock("@/services/ndisService", () => ({
  resolveNdisPrice: vi.fn(),
  listCurrentNdisCatalogue: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth }) }));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    translate: (key: string) => key,
    translateParams: (key: string) => key,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useReAuth", () => ({
  useReAuth: () => ({ requireReAuth: vi.fn(), modal: null }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetParticipants: () => ({ data: [] }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: queryState.data,
    isLoading: false,
    isError: queryState.error,
    refetch: queryState.refetch,
  }),
}));
vi.mock("@/components/NdisPriceEditor", () => ({
  NdisPriceEditor: () => null,
}));
vi.mock("@/components/NdisScheduleLoader", () => ({
  NdisScheduleLoader: () => null,
}));
vi.mock("@/components/ui/section-info", () => ({ SectionInfo: () => null }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("subscription")
        ? null
        : [
            {
              id: "a",
              invoice_number: "INV-101",
              recipient_name: "Alex Morgan",
              recipient_email: "alex@example.test",
              status: "draft",
              total_cents: 12500,
              currency: "AUD",
              created_at: "2026-09-14",
              line_items: [
                {
                  description: "Community participation",
                  quantity: 1,
                  unit_amount_cents: 12500,
                  line_total_cents: 12500,
                  agreement_number: "SA-2026-0001",
                },
              ],
            },
            {
              id: "b",
              invoice_number: "INV-102",
              recipient_name: "Casey Lee",
              status: "paid",
              total_cents: 8000,
              currency: "AUD",
              created_at: "2026-09-14",
              line_items: [],
            },
          ],
  })),
}));

/** The register is a section now; NDIS claims is the landing view. */
function openRegister() {
  window.history.replaceState(null, "", "/billing?workspace=invoices");
}

afterEach(() => {
  window.history.replaceState(null, "", "/billing");
  cleanup();
  queryState.data = null;
  queryState.error = false;
  auth.role = "support_coordinator";
  vi.clearAllMocks();
});
describe("coordinator invoice workspace", () => {
  it("opens on NDIS claims and keeps the chosen section in the address", async () => {
    render(<Billing />);
    expect(await screen.findByRole("heading", { name: /NDIS invoices/ })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Invoicing sections" });
    expect(within(nav).getByRole("button", { name: /NDIS claims/ }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(nav).getByRole("button", { name: /All invoices/ }));
    expect(window.location.search).toBe("?workspace=invoices");
    expect(await screen.findByRole("textbox", { name: "Search invoices" })).toBeTruthy();
  });
  it("filters by recipient and status, and clears unmatched filters", async () => {
    openRegister();
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    fireEvent.change(screen.getByRole("textbox", { name: "Search invoices" }), {
      target: { value: "alex@example.test" },
    });
    expect(screen.queryByText("Casey Lee")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search invoices" }), {
      target: { value: "nobody" },
    });
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    // Paid invoices are in the register, with their own filter.
    const filters = within(screen.getByRole("group", { name: "Filter invoice status" }));
    fireEvent.click(filters.getByRole("button", { name: /^Paid/ }));
    expect(screen.getByText("Casey Lee")).toBeTruthy();
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    // Plain-English statuses.
    fireEvent.click(filters.getByRole("button", { name: /^All/ }));
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
  });
  it("hides organisation revenue and totals from coordinators", async () => {
    openRegister();
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    const nav = screen.getByRole("navigation", { name: "Invoicing sections" });
    expect(within(nav).queryByRole("button", { name: /Revenue/ })).toBeNull();
    expect(within(nav).getByRole("button", { name: /Check shifts/ })).toBeTruthy();
    expect(screen.queryByText(/outstanding ·/)).toBeNull();
  });
  it("gives the managing director revenue and the register's totals", async () => {
    auth.role = "managing_director";
    openRegister();
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    const nav = screen.getByRole("navigation", { name: "Invoicing sections" });
    expect(within(nav).getByRole("button", { name: /Revenue/ })).toBeTruthy();
    expect(screen.getByText("Casey Lee")).toBeTruthy();
    expect(screen.getByText(/\$125\.00 outstanding · \$80\.00 paid/)).toBeTruthy();
  });
  it("keeps drafting out of the register until requested and shows line items on a row", async () => {
    openRegister();
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    expect(screen.queryByTestId("select-billing-participant")).toBeNull();
    expect(screen.queryByText("Community participation")).toBeNull();
    fireEvent.click(screen.getByText("Alex Morgan"));
    expect(screen.getByText("Community participation")).toBeTruthy();
    // Traced to the service agreement it was delivered under.
    expect(screen.getByText(/Agreement SA-2026-0001/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New invoice" }));
    await waitFor(() =>
      expect(screen.getByTestId("select-billing-participant")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("select-billing-participant")).toBeNull();
  });
});

it.each([
  ["managing_director", false],
  ["support_coordinator", false],
] as const)(
  "keeps subscriptions off the invoice page for %s",
  async (role, loadsSubscription) => {
    auth.role = role;
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    expect(screen.getByRole("button", { name: "New invoice" })).toBeTruthy();
    expect(
      vi
        .mocked(apiFetch)
        .mock.calls.some(([url]) => String(url).endsWith("subscription")),
    ).toBe(loadsSubscription);
  },
);
it("resolves dollars for the selected date and region and clears a failed lookup", async () => {
  vi.mocked(resolveNdisPrice).mockResolvedValue({
    id: "v1",
    item_code: "TEST",
    name: "Support",
    unit: "Hour",
    price_national: 73.45,
    price_remote: null,
    price_very_remote: null,
    effective_price: 73.45,
    effective_price_source: "explicit",
    day_type: null,
    time_type: null,
  });
  render(<Billing />);
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("button", { name: "New invoice" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Service date"), {
    target: { value: "2026-07-01" },
  });
  fireEvent.change(screen.getByLabelText("Pricing region"), {
    target: { value: "remote" },
  });
  fireEvent.change(screen.getByLabelText("NDIS support item code"), {
    target: { value: "TEST" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Resolve catalogue rate" }),
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Unit rate in AUD") as HTMLInputElement).value,
    ).toBe("73.45"),
  );
  expect(resolveNdisPrice).toHaveBeenCalledWith("TEST", "2026-07-01", "remote");
  vi.mocked(resolveNdisPrice).mockRejectedValueOnce(
    new Error("No catalogue item"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Resolve catalogue rate" }),
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Unit rate in AUD") as HTMLInputElement).value,
    ).toBe(""),
  );
});

it("keeps pricing and reports separate from the invoice list", async () => {
  openRegister();
  render(<Billing />);
  await screen.findByText("Alex Morgan");
  const nav = () => within(screen.getByRole("navigation", { name: "Invoicing sections" }));
  expect(screen.getByRole("textbox", { name: "Search invoices" })).toBeTruthy();
  fireEvent.click(nav().getByRole("button", { name: /NDIS pricing/ }));
  expect(screen.queryByRole("textbox", { name: "Search invoices" })).toBeNull();
  expect(
    screen.getByRole("region", { name: "NDIS pricing catalogue" }),
  ).toBeTruthy();
  fireEvent.click(nav().getByRole("button", { name: /To invoice/ }));
  expect(
    screen.getByText("No verified shifts are waiting to be invoiced."),
  ).toBeTruthy();
  fireEvent.click(nav().getByRole("button", { name: /All invoices/ }));
  expect(screen.getByRole("textbox", { name: "Search invoices" })).toBeTruthy();
});

it("pages the register fifteen at a time and resets the page when searching", async () => {
  openRegister();
  vi.mocked(apiFetch).mockResolvedValueOnce({
    ok: true,
    json: async () =>
      Array.from({ length: 17 }, (_, index) => ({
        id: String(index),
        invoice_number: "INV-" + index,
        recipient_name: "Participant " + index,
        status: "draft",
        total_cents: 10000,
        currency: "AUD",
        created_at: "2026-09-01",
        line_items: [],
      })),
  } as Response);
  render(<Billing />);
  await screen.findByText("Participant 0");
  expect(screen.queryByText("Participant 15")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Participant 15")).toBeTruthy();
  expect(screen.queryByText("Participant 0")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search invoices" }), {
    target: { value: "Participant 0" },
  });
  expect(screen.getByText("Participant 0")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});

it("shows stored units and regional rates without guessing missing prices", () => {
  queryState.data = [
    {
      item_code: "TEST",
      name: "Test travel item",
      unit: "KM",
      price_national: 1.2,
      price_remote: null,
      source: "platform",
    },
  ];
  render(<NdisCatalogueBrowser />);
  expect(screen.getByText("$1.20 / KM")).toBeTruthy();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Catalogue pricing region" }),
    { target: { value: "remote" } },
  );
  expect(screen.getByText("Not listed")).toBeTruthy();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search NDIS catalogue" }),
    { target: { value: "other" } },
  );
  expect(screen.getByText("No items match the current filters.")).toBeTruthy();
});
it.each([
  ["catalogue", "Retry catalogue"],
  ["ledger", "Retry invoice history"],
])("offers a retry for failed %s requests", (kind, label) => {
  queryState.error = true;
  render(
    kind === "catalogue" ? <NdisCatalogueBrowser /> : <RevenueInvoiceLedger />,
  );
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(queryState.refetch).toHaveBeenCalledOnce();
});
it("searches paid invoice history by email and filters creation dates", () => {
  queryState.data = [
    {
      id: "paid-id",
      invoice_number: "INV-P",
      recipient_name: "Casey Lee",
      recipient_email: "casey@example.test",
      status: "paid",
      created_at: "2026-09-14",
      total_cents: 8000,
      currency: "AUD",
    },
  ];
  render(<RevenueInvoiceLedger />);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search invoice history" }),
    { target: { value: "casey@example.test" } },
  );
  expect(screen.getByText("INV-P")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Invoice created from"), {
    target: { value: "2026-09-15" },
  });
  expect(screen.queryByText("INV-P")).toBeNull();
  expect(
    screen.getByText("No invoices match the current filters."),
  ).toBeTruthy();
});

const reviewFixture: Invoice = {
  id: "review",
  invoice_number: "INV-R",
  recipient_name: "Test participant",
  recipient_email: "billing@example.test",
  status: "sent",
  due_date: "2026-09-20",
  created_at: "2026-09-01",
  currency: "AUD",
  total_cents: 12500,
  line_items: [
    {
      description: "Support",
      quantity: 1,
      unit_amount_cents: 12500,
      line_total_cents: 12500,
      item_code: "TEST",
      service_date: "2026-09-01",
    },
  ],
};
it("calculates overdue days only for unpaid issued invoices", () => {
  expect(overdueDays(reviewFixture, "2026-09-27")).toBe(7);
  expect(overdueDays(reviewFixture, "2026-09-20")).toBe(0);
  for (const status of ["draft", "paid", "void", "cancelled", "finalized"])
    expect(overdueDays({ ...reviewFixture, status }, "2026-09-27")).toBe(0);
  expect(overdueDays({ ...reviewFixture, due_date: null }, "2026-09-27")).toBe(
    0,
  );
});
it("flags incomplete NDIS service dates and failed PDFs for review", () => {
  expect(invoiceReviewWarnings(reviewFixture)).toEqual([]);
  expect(
    invoiceReviewWarnings({
      ...reviewFixture,
      pdf_generation_failed: true,
      line_items: [{ ...reviewFixture.line_items[0], service_date: null }],
    }),
  ).toHaveLength(2);
});
it("requires deliberate review before finalising a draft", async () => {
  openRegister();
  render(<Billing />);
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByText("Alex Morgan"));
  fireEvent.click(screen.getByRole("button", { name: "Review & finalise" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  const finalise = screen.getByRole("button", {
    name: "Finalise invoice",
  }) as HTMLButtonElement;
  expect(finalise.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(finalise.disabled).toBe(false);
  expect(
    vi
      .mocked(apiFetch)
      .mock.calls.every(([, init]) => !init || init.method !== "POST"),
  ).toBe(true);
});
