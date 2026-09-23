import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Billing from "./billing";
import { resolveNdisPrice } from "@/services/ndisService";
import { apiFetch } from "@/lib/api-fetch";
const auth = vi.hoisted(() => ({ role: "support_coordinator" }));
vi.mock("@/services/ndisService", () => ({ resolveNdisPrice: vi.fn() }));

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
  useOrgQuery: () => ({ data: null, isLoading: false }),
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

afterEach(() => {
  cleanup();
  auth.role = "support_coordinator";
  vi.clearAllMocks();
});
describe("coordinator invoice workspace", () => {
  it("filters by recipient and status, and clears unmatched filters", async () => {
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    fireEvent.change(screen.getByRole("textbox", { name: "Search invoices" }), {
      target: { value: "alex@example.test" },
    });
    expect(screen.queryByText("Casey Lee")).toBeNull();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter invoice status" }),
      { target: { value: "paid" } },
    );
    expect(screen.queryByText("Alex Morgan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Alex Morgan")).toBeTruthy();
    expect(screen.getByText("Casey Lee")).toBeTruthy();
  });
  it("keeps drafting out of the register until requested and retains line-item detail", async () => {
    render(<Billing />);
    await screen.findByText("Alex Morgan");
    expect(screen.queryByTestId("select-billing-participant")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New invoice" }));
    await waitFor(() =>
      expect(screen.getByTestId("select-billing-participant")).toBeTruthy(),
    );
    expect(screen.getByText("Community participation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close draft form" }));
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
