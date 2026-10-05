import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Page from "./coordinator-rostering";
import { isoWeekday } from "@/components/coordinator/RosterBoard";

// Monday 28 Sep 2026 is the first day of the week on screen.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-30T02:00:00Z"));

const state = vi.hoisted(() => ({ availability: {} as unknown, loading: false }));
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
               scheduled_start: monday, scheduled_end: "2026-09-28T02:30:00Z", status: "scheduled", timezone: "Australia/Adelaide" }]
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

afterEach(() => { cleanup(); state.loading = false; });

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
  const thursday = await screen.findByLabelText(/Alice Worker.*1 Oct|1 Oct.*Alice Worker/);
  fireEvent.click(thursday);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getAllByText("Liam Carter").length).toBeGreaterThan(0);
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  // Tuesday has passed: no new shift from the grid.
  expect(screen.queryByLabelText(/Alice Worker.*29 Sep|29 Sep.*Alice Worker/)).toBeNull();

  // Saturday is outside her usual days but can still be rostered.
  fireEvent.click(screen.getByLabelText(/3 Oct.*outside usual availability/));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("a worker with no availability days doesn't break the board", async () => {
  state.availability = { availability: { user_id: "w-1", available_days: null }, blackout_dates: null };
  renderPage();
  expect(await screen.findAllByTitle(/Alice Worker/)).not.toHaveLength(0);
  const board = screen.getByRole("table");
  expect(within(board).getByText("Alice Worker")).toBeTruthy();
});

it("keeps verification beside the roster navigation and hides empty assignment trays", async () => {
  renderPage();
  const navigation = screen.getByRole("navigation", { name: "Schedule" });
  expect(within(navigation).getByRole("button", { name: "Roster" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(navigation).getByRole("link", { name: "Shift verification" }).getAttribute("href")).toBe("/coordinator/verification");
  await screen.findByRole("table");
  expect(screen.queryByText("All assigned")).toBeNull();
});

it("does not present an empty roster while shifts are loading", () => {
  state.loading = true;
  renderPage();
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("All assigned")).toBeNull();
});
