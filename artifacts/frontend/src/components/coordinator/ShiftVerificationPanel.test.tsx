import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  ShiftVerificationPanel,
  filterVerificationQueue,
} from "./ShiftVerificationPanel";
import type { ShiftVerificationQueueItem } from "@/services/coordinatorService";
const state = vi.hoisted(() => ({
  error: false,
  mutate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "support_coordinator" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => ({
    data:
      key[0] === "shift-verification-queue"
        ? [shift]
        : key[0] === "shift-price-items"
          ? [
              {
                item_code: "TEST",
                name: "Test support",
                unit: "H",
                price_national: 70,
              },
            ]
          : undefined,
    isLoading: false,
    isError: state.error,
    refetch: state.refetch,
  }),
}));
const shift = {
  shift_id: "shift-abc",
  participant_id: "participant-123",
  participant_name: "Sam Taylor",
  worker_id: "worker-1",
  worker_name: "Alex Morgan",
  expected_price_item_code: "TEST",
  scheduled_start: "2026-09-24T15:30:00Z",
  timezone: "Australia/Adelaide",
  checks: {
    any_flagged: true,
    computed_at: "2026-09-25T00:00:00Z",
    evidence: {
      compliance_score: 80,
      low_compliance: false,
      tasks_completed: 4,
      tasks_total: 5,
      mandatory_total: 5,
      mandatory_with_evidence: 4,
      flagged: true,
      flagged_tasks: [],
      mandatory_without_evidence: 1,
    },
    hours_sanity: {
      status: "ok",
      flagged: false,
      variance_pct: 0,
      scheduled_minutes: 60,
      actual_minutes: 60,
    },
    force_ended: { force_ended: false, flagged: false },
  },
} as ShiftVerificationQueueItem;
afterEach(() => {
  cleanup();
  state.error = false;
  vi.clearAllMocks();
});
it("filters inclusively using the participant branch date and full identifiers", () => {
  expect(
    filterVerificationQueue(
      [shift],
      "participant-123",
      "2026-09-25",
      "2026-09-25",
      "review",
      "worker-1",
    ),
  ).toHaveLength(1);
  expect(
    filterVerificationQueue([shift], "shift-abc", "", "2026-09-24", "all", ""),
  ).toHaveLength(0);
  expect(
    filterVerificationQueue([shift], "", "", "", "all", "another-worker"),
  ).toHaveLength(0);
});
it("shows IDs, filters the queue and reveals checks on request", () => {
  render(<ShiftVerificationPanel />);
  expect(screen.getByText("Participant ID: participant-123")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Price item" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search shifts" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No shifts match these filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(
    screen.getByRole("button", { name: "Review shift shift-abc" }),
  ).toBeTruthy();
});
it("prefills only the recorded available price item and still requires verification", async () => {
  render(<ShiftVerificationPanel />);
  fireEvent.click(
    screen.getByRole("button", { name: "Review shift shift-abc" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("combobox", {
          name: "Price item",
        }) as HTMLSelectElement
      ).value,
    ).toBe("TEST"),
  );
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Price item" }), {
    target: { value: "" },
  });
  expect(
    (screen.getByRole("button", { name: "Verify shift" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("offers retry instead of an empty queue when loading fails", () => {
  state.error = true;
  render(<ShiftVerificationPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(
    screen.queryByText("No completed shifts are waiting to be checked."),
  ).toBeNull();
});
