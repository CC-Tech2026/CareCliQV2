import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShiftVerificationQueueItem } from "@/services/coordinatorService";

const state = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
  message: vi.fn(),
  search: "",
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
  confirmShiftVerification: state.confirm,
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
];
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => ({
    data:
      key[0] === "shift-verification-queue"
        ? queue
        : [{ item_code: "01_011_0107_1_1", name: "Personal care", unit: "H", price_national: 70.23 }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import CoordinatorVerificationPage from "./coordinator-verification";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.search = "";
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
  await waitFor(() => expect(state.confirm).toHaveBeenCalledWith("s1", "01_011_0107_1_1"));
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
