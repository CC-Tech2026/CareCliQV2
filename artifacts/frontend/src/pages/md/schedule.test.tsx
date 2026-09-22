import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MDSchedulePage from "./schedule";
const state = vi.hoisted(() => ({
  error: false,
  refetch: vi.fn(),
  rows: [
    {
      id: "one",
      worker_id: "w1",
      worker_name: "Sam Taylor",
      participant_name: "Alex Morgan",
      status: "scheduled",
      scheduled_start: new Date().toISOString(),
      scheduled_end: new Date(Date.now() + 3600000).toISOString(),
    },
    {
      id: "two",
      worker_id: null,
      participant_name: "Casey Lee",
      status: "unassigned",
      scheduled_start: new Date().toISOString(),
      scheduled_end: new Date(Date.now() + 3600000).toISOString(),
    },
  ],
}));
vi.mock("@/components/layout/HubLayout", () => ({
  HubLayout: ({ children }: any) => children,
}));
vi.mock("@/components/ui/section-info", () => ({ SectionInfo: () => null }));
vi.mock("@/pages/coordinator-live", () => ({ default: () => null }));
vi.mock("@/pages/coordinator-rostering", () => ({
  MonthGrid: ({ shifts }: any) => (
    <div data-testid="month-records">
      {shifts.map((s: any) => s.participant_name).join(",")}
    </div>
  ),
}));
vi.mock("@/components/coordinator/RosterBoard", () => ({
  RosterBoard: () => null,
}));
vi.mock("@/services/coordinatorService", () => ({
  getCoordinatorWorkerStats: vi.fn(),
  getShiftDetail: vi.fn(),
  getWorkerAvailability: vi.fn(),
  listCoordinatorShifts: vi.fn(),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: any) =>
    key[1] === "worker-stats"
      ? { data: [] }
      : key[0] === "md-schedule-shift-detail"
        ? { data: null }
        : {
            data: state.rows,
            isError: state.error,
            isFetching: false,
            dataUpdatedAt: Date.now(),
            refetch: state.refetch,
          },
}));
afterEach(() => {
  cleanup();
  state.error = false;
  vi.clearAllMocks();
});
it("opens the compact list on narrow screens and filters it", () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  render(<MDSchedulePage />);
  expect(
    screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search schedule" }), {
    target: { value: "Alex" },
  });
  expect(screen.getByText("Alex Morgan")).toBeTruthy();
  expect(screen.queryByText("Casey Lee")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("Casey Lee")).toBeTruthy();
});
it("applies the status filter in Month and exposes refresh failures", () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  state.error = true;
  render(<MDSchedulePage />);
  fireEvent.click(screen.getByRole("button", { name: "Month" }));
  fireEvent.click(screen.getByRole("button", { name: "Scheduled (1)" }));
  expect(screen.getByTestId("month-records").textContent).toBe("Alex Morgan");
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
