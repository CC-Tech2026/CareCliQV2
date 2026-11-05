import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Page from "./coordinator-live";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
function renderLive() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Page />
    </QueryClientProvider>,
  );
}
const state = vi.hoisted(() => {
  const now = Date.now();
  const iso = (hours: number) => new Date(now + hours * 3600000).toISOString();
  return {
    error: false,
    loading: false,
    updatedAt: now,
    refetch: vi.fn(),
    rows: [
      {
        id: "active",
        worker_name: "Sam Worker",
        participant_name: "Alex",
        status: "in_progress",
        clocked_in_at: iso(-1),
        scheduled_start: iso(-1),
        scheduled_end: iso(1),
        live_status: "green",
      },
      {
        id: "late",
        worker_name: "Late Worker",
        participant_name: "Ava",
        status: "scheduled",
        scheduled_start: iso(-1),
        scheduled_end: iso(1),
        live_status: "red",
      },
      {
        id: "future",
        worker_name: "Future Worker",
        participant_name: "Ben",
        status: "scheduled",
        scheduled_start: iso(2),
        scheduled_end: iso(10),
        live_status: "green",
      },
      {
        id: "done",
        worker_name: "Finished Worker",
        participant_name: "Chris",
        status: "completed",
        clocked_in_at: iso(-4),
        clocked_out_at: iso(-2),
        scheduled_start: iso(-4),
        scheduled_end: iso(-2),
        live_status: "green",
      },
    ],
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org1" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useCoordinatorLiveRealtime", () => ({
  useLiveShiftsRealtime: () => {},
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    translate: (s: string) => s,
    translateParams: (s: string) => s,
  }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: state.rows,
    isLoading: state.loading,
    isError: state.error,
    dataUpdatedAt: state.updatedAt,
    refetch: state.refetch,
    isFetching: false,
  }),
}));
vi.mock("@/components/coordinator/ScheduleLiveCard", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/components/coordinator/ScheduleLiveCard")
    >();
  return {
    ...original,
    ScheduleLiveCard: ({ shift }: any) => (
      <article data-testid="live-card">{shift.worker_name}</article>
    ),
  };
});
afterEach(() => {
  cleanup();
  state.error = false;
  state.loading = false;
  vi.clearAllMocks();
});

it("puts attention items first and filters by shift stage", () => {
  renderLive();
  expect(screen.getAllByTestId("live-card")[0].textContent).toBe("Late Worker");
  fireEvent.click(screen.getByRole("button", { name: /On shift/ }));
  expect(screen.getAllByTestId("live-card")).toHaveLength(1);
  expect(screen.getByText("Sam Worker")).toBeTruthy();
});
it("keeps completed shifts out of the current clocked-in filter and clears all filters", () => {
  renderLive();
  fireEvent.change(screen.getByRole("combobox", { name: "Clock-in status" }), {
    target: { value: "clocked_in" },
  });
  expect(screen.getAllByTestId("live-card")).toHaveLength(1);
  expect(screen.queryByText("Finished Worker")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByTestId("live-card")).toHaveLength(4);
});
it("combines search and duration filters", () => {
  renderLive();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search live shifts" }),
    { target: { value: "Ben" } },
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Shift duration" }), {
    target: { value: "long" },
  });
  expect(screen.getAllByTestId("live-card")).toHaveLength(1);
  expect(screen.getByText("Future Worker")).toBeTruthy();
});
it("keeps the last loaded shifts visible on a refresh failure and offers retry", () => {
  state.error = true;
  renderLive();
  expect(screen.getByRole("alert").textContent).toContain(
    "Showing the last loaded shifts",
  );
  expect(screen.getAllByTestId("live-card")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
