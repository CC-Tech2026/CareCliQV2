import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Page from "./coordinator-rostering";
import { isoWeekday } from "@/components/coordinator/RosterBoard";

// Monday 28 Sep 2026 is the first day of the week on screen.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-30T02:00:00Z"));

const state = vi.hoisted(() => ({ availability: {} as unknown, loading: false, openShifts: [] as unknown[] }));
const monday = "2026-09-28T00:30:00Z"; // 10am Monday in Adelaide

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async (url: string) => {
    const u = String(url);
    if (state.loading && (u.includes("worker-stats") || u.includes("/coordinator/shifts?"))) return new Promise(() => {});
    const body = u.includes("worker-stats")
      ? [{ id: "w-1", full_name: "Alice Worker", onboarding_completed: true }]
      : u.includes("/availability")
        ? state.availability
        : u.includes("/coordinator/shifts?")
          ? [{ id: "s1", worker_id: "w-1", worker_name: "Alice Worker", participant_name: "Liam Carter",
               scheduled_start: monday, scheduled_end: "2026-09-28T02:30:00Z", status: "scheduled", timezone: "Australia/Adelaide" },
             ...state.openShifts]
          : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c1", organizationId: "org-1", role: "support_coordinator", full_name: "Coord" } }),
}));
vi.mock("@/contexts/AccessibilityContext", async () => {
  const { t, tParams } = await import("@/lib/i18n/translations");
  return {
    useAccessibility: () => ({
      translate: (key: string) => t("en", key),
      translateParams: (key: string, p: Record<string, string>) => tParams("en", key, p),
    }),
  };
});

// The page remembers the last view (Day, Week...) on the device.
afterEach(() => { cleanup(); state.loading = false; state.openShifts = []; localStorage.clear(); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}

it("numbers weekdays the way availability is saved (1 = Monday)", () => {
  expect(isoWeekday(new Date(2026, 8, 28))).toBe(1);
  expect(isoWeekday(new Date(2026, 9, 4))).toBe(7);
});

it("Create shift opens from the header and from an empty day", async () => {
  state.availability = { availability: { user_id: "w-1", available_days: [1, 2, 3, 4, 5] }, blackout_dates: [] };
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /Create shift/i }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  // Mon–Fri worker, today is Wednesday 30 Sep. Thursday is open; the Monday
  // shift is shown, not hidden.
  const thursday = await screen.findByLabelText("Add a shift for Alice Worker on Thursday 1 October");
  fireEvent.click(thursday);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getAllByText("Liam Carter").length).toBeGreaterThan(0);
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  // Tuesday has passed: no new shift from the calendar.
  expect(screen.queryByLabelText("Add a shift for Alice Worker on Tuesday 29 September")).toBeNull();

  // Saturday is outside her usual days (greyed, "Off") but can still be rostered.
  fireEvent.click(screen.getByLabelText("Add a shift for Alice Worker on Saturday 3 October"));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  // Opens the full shift form three times, so more than the default 5s.
}, 15_000);

it("a worker with no availability days doesn't break the board", async () => {
  state.availability = { availability: { user_id: "w-1", available_days: null }, blackout_dates: null };
  renderPage();
  expect(await screen.findAllByTitle(/Alice Worker/)).not.toHaveLength(0);
  const board = screen.getByRole("region", { name: "Roster calendar" });
  // Her full name over each day's column, not "Alice W".
  expect(within(board).getAllByText("Alice Worker").length).toBe(7);
  // A small team's week stays by the hour.
  expect(screen.getByRole("button", { name: "By hour" }).getAttribute("aria-pressed")).toBe("true");
});

it("keeps verification beside the roster navigation and hides empty assignment trays", async () => {
  renderPage();
  const navigation = screen.getByRole("navigation", { name: "Schedule" });
  expect(within(navigation).getByRole("button", { name: "Roster" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(navigation).getByRole("link", { name: "Shift verification" }).getAttribute("href")).toBe("/coordinator/verification");
  await screen.findByRole("region", { name: "Roster calendar" });
  expect(screen.queryByText("All assigned")).toBeNull();
});

it("does not present an empty roster while shifts are loading", () => {
  state.loading = true;
  renderPage();
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Roster calendar" })).toBeNull();
  expect(screen.queryByText("All assigned")).toBeNull();
});

it("shows open shifts under their day, and adds one from the open shifts row", async () => {
  state.availability = { availability: { user_id: "w-1", available_days: [1, 2, 3, 4, 5] }, blackout_dates: [] };
  state.openShifts = [{
    id: "open-1", worker_id: "00000000-0000-0000-0000-000000000000", participant_name: "Priya Singh",
    scheduled_start: "2026-10-01T23:30:00Z", scheduled_end: "2026-10-02T02:30:00Z", status: "unassigned", timezone: "Australia/Adelaide",
  }];
  renderPage();
  const board = await screen.findByRole("region", { name: "Roster calendar" });
  // Friday 2 Oct, 9am in Adelaide.
  expect(await within(board).findByText("Priya Singh")).toBeTruthy();
  expect(within(board).getByText("1 to fill")).toBeTruthy();
  expect(within(board).getByText("1 open")).toBeTruthy();
  // Past days can't take a new open shift; Thursday can.
  expect(screen.queryByLabelText("Add an open shift on Tuesday 29 September")).toBeNull();
  fireEvent.click(screen.getByLabelText("Add an open shift on Thursday 1 October"));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByText("Alice Worker")).toBeNull();
});

it("opens a day on its own from its heading, a column per worker", async () => {
  state.availability = { availability: { user_id: "w-1", available_days: [1, 2, 3, 4, 5], day_start_time: "08:00", day_end_time: "18:00" }, blackout_dates: [] };
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Open Monday 28 September as a day calendar" }));
  expect(await screen.findByText("Monday 28 September 2026")).toBeTruthy();
  const board = await screen.findByRole("region", { name: "Roster calendar" });
  expect(await within(board).findByText("Open shifts")).toBeTruthy();
  expect(within(board).getByText("Alice Worker")).toBeTruthy();
  // Her usual hours, and the 10am to 12pm shift as a block.
  expect(within(board).getByText(/8am–6pm · 2h rostered/)).toBeTruthy();
  expect(within(board).getByLabelText("Liam Carter, Alice Worker, 10am – 12pm")).toBeTruthy();
  // Back to the week it's in.
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  expect(await screen.findByText("28 Sep to 4 Oct 2026")).toBeTruthy();
});
