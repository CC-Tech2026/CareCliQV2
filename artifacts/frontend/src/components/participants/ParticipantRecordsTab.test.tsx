import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ParticipantRecordsTab } from "./ParticipantRecordsTab";
import { ParticipantInvoicesPanel } from "./ParticipantInvoicesPanel";
import { apiFetch } from "@/lib/api-fetch";
import { triggerBlobDownload } from "@/lib/vaultZip";

const state = vi.hoisted(() => ({ error: false }));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: {
      invoices: [
        {
          id: "invoice-1",
          invoice_number: "INV-1",
          recipient_name: "Plan manager",
          status: "paid",
          created_at: "2026-09-20",
          total_cents: 10000,
          currency: "AUD",
          line_items: [],
        },
        {
          id: "invoice-2",
          invoice_number: "INV-2",
          recipient_name: "Plan manager",
          status: "sent",
          created_at: "2026-08-02",
          total_cents: 5000,
          currency: "AUD",
          line_items: [],
        },
      ],
      has_more: false,
    },
    isLoading: false,
    isError: state.error,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    headers: new Headers({
      "content-disposition": 'attachment; filename="records.zip"',
    }),
    blob: async () => new Blob(["zip"]),
  })),
}));
vi.mock("@/services/http", () => ({ jsonFetch: vi.fn() }));
vi.mock("@/lib/vaultZip", () => ({ triggerBlobDownload: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => {
  cleanup();
  state.error = false;
  vi.clearAllMocks();
  vi.useRealTimers();
});

const sentBody = () =>
  JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
const clickButton = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("export records panel", () => {
  const show = () =>
    render(
      <ParticipantRecordsTab
        participantId="participant-1"
        participantName="Test Person"
      />,
    );

  it("starts with nothing selected and has no invoice list", () => {
    show();
    expect(
      (
        screen.getByRole("button", {
          name: "Download selected records",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen
        .getAllByRole("checkbox")
        .every((box) => !(box as HTMLInputElement).checked),
    ).toBe(true);
    expect(screen.queryByText("INV-1")).toBeNull();
  });

  it("exports a single profile section as a PDF", async () => {
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: /Active goals/ }));
    clickButton("Download selected records");
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledOnce());
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe(
      "/api/participants/participant-1/records-export",
    );
    expect(sentBody()).toEqual({
      invoice_ids: [],
      sections: ["goals"],
      format: "pdf",
    });
  });

  it("exports every invoice and the shift history for a financial year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T10:00:00"));
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
      target: { value: "fy:2025" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Invoices in this period/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Shift history summary/ }),
    );
    clickButton("Download selected records");
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({
      invoice_ids: [],
      sections: [],
      format: "zip",
      all_invoices: true,
      include_shifts: true,
      date_from: "2025-07-01",
      date_to: "2026-06-30",
    });
  });

  it("downloads shift history on its own as a single PDF", async () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
      target: { value: "all" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Shift history summary/ }),
    );
    clickButton("Download selected records");
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({
      invoice_ids: [],
      sections: [],
      format: "pdf",
      include_shifts: true,
    });
  });
});

describe("invoices panel", () => {
  const show = () =>
    render(<ParticipantInvoicesPanel participantId="participant-1" />);

  it("downloads the selected invoices together as a ZIP", async () => {
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-2" }));
    clickButton("Download selected");
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({
      invoice_ids: ["invoice-1", "invoice-2"],
      sections: [],
      format: "zip",
    });
  });

  it("downloads a single invoice without any profile information", async () => {
    show();
    clickButton("Download PDF INV-1");
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({
      invoice_ids: ["invoice-1"],
      sections: [],
      format: "pdf",
    });
  });

  it("groups invoices by month and clears the selection when filters change", () => {
    show();
    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(screen.getByText("August 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-1" }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search linked invoices" }),
      { target: { value: "INV-2" } },
    );
    expect(screen.getByText("0 selected")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Download selected" }),
    ).toBeNull();
  });

  it("does not present a failed request as an empty invoice history", () => {
    state.error = true;
    show();
    expect(screen.getByRole("alert").textContent).toContain(
      "Invoices could not be loaded",
    );
    expect(
      screen.queryByText("No linked invoices match these filters."),
    ).toBeNull();
  });
});
