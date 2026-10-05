import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShiftVerificationQueueItem } from "@/services/coordinatorService";

const state = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
  reverse: vi.fn(),
  message: vi.fn(),
  search: "",
  preview: null as unknown,
}));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useSearch: () => state.search,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (opts: { mutationFn: () => Promise<unknown>; onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
    isPending: false,
    mutate: async () => {
      try {
        opts.onSuccess?.(await opts.mutationFn());
      } catch (err) {
        opts.onError?.(err);
      }
    },
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { organizationId: "org-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/contexts/AccessibilityContext", async () => {
  const { t, tParams } = await import("@/lib/i18n/translations");
  return {
    useAccessibility: () => ({
      translate: (key: string) => t("en", key),
      translateParams: (key: string, params: Record<string, string>) => tParams("en", key, params),
    }),
  };
});
vi.mock("@/services/coordinatorService", () => ({
  getShiftVerificationQueue: vi.fn(),
  getShiftPriceItemOptions: vi.fn(),
  getShiftVerificationPreview: vi.fn(),
  confirmShiftVerification: state.confirm,
  getRecentShiftVerifications: vi.fn(),
  reverseShiftVerification: state.reverse,
  sendShiftMessage: state.message,
}));

const checks = {
  any_flagged: false,
  computed_at: "2026-09-30T04:00:00Z",
  evidence: { compliance_score: 92, low_compliance: false, tasks_completed: 2, flagged: false, flagged_tasks: [] },
  hours_sanity: { status: "ok", scheduled_minutes: 240, actual_minutes: 239, flagged: false },
  force_ended: { force_ended: false, flagged: false },
} as unknown as ShiftVerificationQueueItem["checks"];
const queue: ShiftVerificationQueueItem[] = [
  {
    shift_id: "s1",
    worker_id: "w1",
    worker_name: "Priya Sharma",
    participant_name: "Liam Carter",
    shift_type: "personal_care",
    scheduled_start: "2026-09-29T23:30:00Z",
    scheduled_end: "2026-09-30T03:30:00Z",
    clocked_in_at: "2026-09-29T23:32:00Z",
    clocked_out_at: "2026-09-30T03:31:00Z",
    timezone: "Australia/Adelaide",
    clock_in_location_verified: true,
    tasks: [
      { id: "t1", label: "Morning medication", completed: true, completed_at: "2026-09-29T23:48:00Z" },
      { id: "t2", label: "Lunch", completed: false },
    ],
    session_note: "Liam had a good morning.",
    original_language_input: "Maganda ang umaga ni Liam.",
    detected_language: "Filipino",
    compliance_score: 92,
    expected_price_item_code: "01_011_0107_1_1",
    checks,
  },
  {
    shift_id: "s2",
    worker_id: "w2",
    worker_name: "Ben Ito",
    participant_name: "Ava Lee",
    scheduled_start: "2026-09-30T00:00:00Z",
    timezone: "Australia/Adelaide",
    checks,
  },
  {
    shift_id: "s3",
    worker_id: "w3",
    worker_name: "Mia Chen",
    participant_name: "Jack Nguyen",
    scheduled_start: "2026-09-30T00:00:00Z",
    scheduled_end: "2026-09-30T02:00:00Z",
    clocked_in_at: "2026-09-30T00:00:00Z",
    clocked_out_at: "2026-09-30T02:30:00Z",
    timezone: "Australia/Adelaide",
    session_note: "Went to the library and practised reading.",
    checks: {
      ...checks,
      note: { present: true, flagged: false },
      extra_time: {
        worked_minutes: 150, scheduled_minutes: 120, extra_minutes: 30, billable_minutes: 120,
        capped_at_scheduled: true, extra_time_approved: false, flagged: true,
      },
    } as ShiftVerificationQueueItem["checks"],
  },
];
const recent = [
  {
    shift_id: "v1",
    worker_name: "Priya Sharma",
    participant_name: "Noah Patel",
    scheduled_start: "2026-09-28T23:30:00Z",
    price_item_code: "01_011_0107_1_1",
    billed_amount: 280.92,
    billed_minutes: 240,
    verified_at: "2026-09-29T06:00:00Z",
    verified_by_name: "Sarah Coordinator",
    invoiced: false,
  },
  { shift_id: "v2", worker_name: "Ben Ito", participant_name: "Ava Lee", verified_at: "2026-09-29T06:00:00Z", invoiced: true },
];
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => ({
    data:
      key[0] === "shift-verification-queue"
        ? queue
        : key[0] === "shift-verifications-recent"
          ? recent
          : key[0] === "shift-verification-preview"
            ? state.preview
            : [{ item_code: "01_011_0107_1_1", name: "Personal care", unit: "H", price_national: 70.23 }],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import CoordinatorVerificationPage from "./coordinator-verification";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.search = "";
  state.preview = null;
});

it("opens the shift named in the link and shows its review detail", () => {
  state.search = "shiftId=s1";
  render(<CoordinatorVerificationPage />);
  expect(screen.getByRole("heading", { name: "Priya Sharma" })).toBeTruthy();
  expect(screen.getByText(/with Liam Carter · .* · Personal care/)).toBeTruthy();
  expect(screen.getByText("3h 59m")).toBeTruthy();
  expect(screen.getAllByText("GPS verified").length).toBeGreaterThan(0);
  expect(screen.getByText("Tasks · 1 of 2")).toBeTruthy();
  expect(screen.getByText("Translated from Filipino")).toBeTruthy();
  expect(screen.getByText(/Original: Maganda/)).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Documentation quality" }).getAttribute("aria-valuenow")).toBe("92");
});

it("approves with the expected price item and keeps the shift listed as approved", async () => {
  state.search = "shiftId=s1";
  state.confirm.mockResolvedValue({ billed_amount: 279.75 });
  render(<CoordinatorVerificationPage />);
  fireEvent.click(screen.getByRole("button", { name: /Approve shift/ }));
  await waitFor(() =>
    expect(state.confirm).toHaveBeenCalledWith("s1", "01_011_0107_1_1", { approveExtraTime: false, extraTimeReason: "", agreementReason: "" }),
  );
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Shift approved", description: expect.stringContaining("Liam Carter") }),
    ),
  );
  expect(screen.getByText(/Approved · \$279\.75/)).toBeTruthy();
  // Hidden under "Needs review", back under "All shifts".
  expect(screen.queryByRole("button", { name: /Priya Sharma · Liam Carter/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
  expect(screen.getByRole("button", { name: /Priya Sharma · Liam Carter/ })).toBeTruthy();
});

it("sends a change request to the worker", async () => {
  state.search = "shiftId=s1";
  state.message.mockResolvedValue({});
  render(<CoordinatorVerificationPage />);
  fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
  fireEvent.change(screen.getByLabelText("What does the worker need to fix?"), {
    target: { value: "Please add the lunch task note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send to worker" }));
  await waitFor(() =>
    expect(state.message).toHaveBeenCalledWith("s1", "w1", "Please add the lunch task note", "action_required"),
  );
});

it("filters the list by worker", () => {
  render(<CoordinatorVerificationPage />);
  fireEvent.change(screen.getByLabelText("Worker"), { target: { value: "w2" } });
  expect(screen.queryByRole("button", { name: /Priya Sharma · Liam Carter/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Ben Ito · Ava Lee/ })).toBeTruthy();
});

it("won't approve a shift without a progress note", () => {
  state.search = "shiftId=s2";
  render(<CoordinatorVerificationPage />);
  expect(screen.getByText(/A progress note is needed/)).toBeTruthy();
  expect((screen.getByRole("button", { name: /Approve shift/ }) as HTMLButtonElement).disabled).toBe(true);
  // The worker can still be asked to write it.
  expect((screen.getByRole("button", { name: "Request changes" }) as HTMLButtonElement).disabled).toBe(false);
});

it("bills extra time only when approved with a reason", async () => {
  state.search = "shiftId=s3";
  state.confirm.mockResolvedValue({ billed_amount: 175.58 });
  render(<CoordinatorVerificationPage />);
  expect(screen.getAllByText("Worked 30 min longer than scheduled").length).toBeGreaterThan(0);
  const approve = () => screen.getByRole("button", { name: /Approve shift/ }) as HTMLButtonElement;
  expect(approve().disabled).toBe(false); // billed at the scheduled 2h
  fireEvent.click(screen.getByLabelText("Approve the extra 30 min"));
  expect(approve().disabled).toBe(true); // needs a reason
  fireEvent.change(screen.getByLabelText("Reason for the extra time"), { target: { value: "Appointment ran late" } });
  fireEvent.click(approve());
  await waitFor(() =>
    expect(state.confirm).toHaveBeenCalledWith("s3", "01_011_0107_1_1", {
      approveExtraTime: true,
      extraTimeReason: "Appointment ran late",
      agreementReason: "",
    }),
  );
});

const preview = (over: Record<string, unknown> = {}, agreement: Record<string, unknown> = {}) => ({
  price_item_code: "01_013_0107_1_1",
  rate: 103.54,
  rate_source: "platform",
  unit: "H",
  price_limit: 103.54,
  over_limit: false,
  agreement: {
    bands: ["saturday", "sunday"],
    crosses_bands: true,
    suggested_code: "01_013_0107_1_1",
    billed_code: "01_013_0107_1_1",
    band_warning: null,
    stored_line_id: "line-wd",
    matched_line: {
      id: "line-sat", service_agreement_id: "sa-1", agreement_number: "SA-0001",
      support_item_code: "01_013_0107_1_1", item_name: "Assistance With Self-Care Activities - Standard - Saturday",
    },
    line_changed: true,
    agreed_rate: null,
    issues: [{ code: "unsigned", message: "The agreement hasn't been signed yet." }],
    ...agreement,
  },
  ...over,
});

it("bills the code the times suggest, against the matched agreement line, with a reason when outside it", async () => {
  state.search = "shiftId=s1";
  state.preview = preview();
  state.confirm.mockResolvedValue({ billed_amount: 414.16 });
  render(<CoordinatorVerificationPage />);

  expect(screen.getByText("Worked: Saturday, Sunday")).toBeTruthy();
  expect(screen.getByText(/the higher price limit applies to all of it/)).toBeTruthy();
  expect(screen.getByText("Counts against Assistance With Self-Care Activities - Standard - Saturday (SA-0001)")).toBeTruthy();
  expect(screen.getByText(/Moved from the support it was rostered on/)).toBeTruthy();
  expect(screen.getByText("$103.54/hr NDIS price")).toBeTruthy();
  expect(screen.getByText("Suggested from the times worked")).toBeTruthy();
  expect((screen.getByLabelText("NDIS price item") as HTMLSelectElement).value).toBe("01_013_0107_1_1");

  const approve = () => screen.getByRole("button", { name: /Approve shift/ }) as HTMLButtonElement;
  expect(screen.getByText("The agreement hasn't been signed yet.")).toBeTruthy();
  expect(approve().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Reason for billing it anyway"), { target: { value: "Signed copy arriving by post" } });
  fireEvent.click(approve());
  await waitFor(() =>
    expect(state.confirm).toHaveBeenCalledWith("s1", "01_013_0107_1_1", {
      approveExtraTime: false, extraTimeReason: "", agreementReason: "Signed copy arriving by post",
    }),
  );
});

it("won't approve a rate above the NDIS price limit", () => {
  state.search = "shiftId=s1";
  state.preview = preview({ rate: 110, rate_source: "agreement", over_limit: true }, { issues: [] });
  render(<CoordinatorVerificationPage />);
  expect(screen.getByText("$110.00/hr agreed rate")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/above the NDIS price limit/);
  expect((screen.getByRole("button", { name: /Approve shift/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("reverses a recent verification with a reason", async () => {
  state.reverse.mockResolvedValue({ shift_id: "v1", refunded_amount: 280.92, reversed_at: "2026-09-30T00:00:00Z" });
  render(<CoordinatorVerificationPage />);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "verified" } });
  expect(screen.getByText(/Verified by Sarah Coordinator/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reverse verification" }));
  const confirm = () => screen.getByRole("button", { name: "Reverse and refund" }) as HTMLButtonElement;
  expect(confirm().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Why is this verification being reversed?"), {
    target: { value: "Wrong support item" },
  });
  fireEvent.click(confirm());
  await waitFor(() => expect(state.reverse).toHaveBeenCalledWith("v1", "Wrong support item"));
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Verification reversed" })),
  );
});

it("doesn't offer to reverse a shift that's already invoiced", () => {
  render(<CoordinatorVerificationPage />);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "verified" } });
  fireEvent.click(screen.getByRole("button", { name: /Ben Ito · Ava Lee/ }));
  expect(screen.getByText(/Already on an invoice/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reverse verification" })).toBeNull();
});
