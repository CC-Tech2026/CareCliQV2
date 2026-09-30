import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NdiaClaimsPanel, type ClaimRow } from "./NdiaClaimsPanel";

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useReAuth", () => ({
  useReAuth: () => ({ requireReAuth: (fn: () => Promise<unknown>) => fn(), modal: null }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const row = (over: Partial<ClaimRow>): ClaimRow => ({
  invoice_id: "i1",
  invoice_number: "CS-1",
  participant_id: "p1",
  participant_name: "Liam Carter",
  support_item: "01_011_0107_1_1",
  quantity_label: "4 hrs",
  total_cents: 28092,
  status: "finalized",
  problems: [],
  claim_submitted_at: null,
  paid_at: null,
  payment_reference: null,
  batch: null,
  ...over,
});

const data = {
  ready: [
    row({}),
    row({ invoice_id: "i2", invoice_number: "CS-2", participant_name: "Olivia Chen", support_item: "04_590_0125_6_1", quantity_label: "4", total_cents: 3960 }),
    row({ invoice_id: "i3", invoice_number: "CS-3", participant_name: "Noah Brown", problems: ["Noah Brown needs a 9-digit NDIS number."] }),
  ],
  submitted: [],
  paid: [],
  drafts_awaiting_review: 2,
  registration_number_missing: false,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NdiaClaimsPanel />
    </QueryClientProvider>,
  );
}

it("selects ready claims and totals them; claims needing fixes can't be selected", async () => {
  mocks.api.mockResolvedValue({ ok: true, json: async () => data });
  renderPanel();
  expect(await screen.findByText("Liam Carter")).toBeTruthy();
  expect(screen.getByText(/2 NDIA-managed draft invoices need reviewing/)).toBeTruthy();
  expect(screen.getByText("Noah Brown needs a 9-digit NDIS number.")).toBeTruthy();
  expect((screen.getByLabelText("Select Noah Brown CS-3") as HTMLInputElement).disabled).toBe(true);

  fireEvent.click(screen.getByLabelText("Select all"));
  expect(screen.getByRole("region", { name: "Selected claims" }).textContent).toContain("2 invoices selected · $320.52");
  expect(screen.getByRole("button", { name: /Submit bulk claim/ })).toBeTruthy();
});

it("submits the selection and downloads the claim file", async () => {
  mocks.api.mockImplementation((url: string, init?: RequestInit) =>
    Promise.resolve(
      url === "/api/billing/claims/batches"
        ? { ok: true, json: async () => ({ file_name: "ndia-bulk-claim-CLM-1.csv", csv: "a,b\r\n", invoice_count: 1, body: init?.body }) }
        : { ok: true, json: async () => data },
    ),
  );
  const createUrl = vi.fn(() => "blob:x");
  Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
  renderPanel();
  fireEvent.click(await screen.findByLabelText("Select Liam Carter CS-1"));
  fireEvent.click(screen.getByRole("button", { name: /Submit bulk claim/ }));
  await waitFor(() => expect(createUrl).toHaveBeenCalled());
  const call = mocks.api.mock.calls.find(([url]) => url === "/api/billing/claims/batches");
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ invoice_ids: ["i1"] });
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "1 invoice submitted" }));
});
