import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegularSchedulesPanel } from "./RegularSchedulesPanel";
import { BulkShiftModal } from "./BulkShiftModal";
import type { ShiftSeries, WorkerStats } from "@/services/coordinatorService";

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; method: string; body: unknown }> }));

const SERIES: ShiftSeries[] = [
  {
    id: "s-1", participant_id: "p-1", participant_name: "Liam Carter", worker_id: "w-sam1", worker_name: "Sam Nguyen",
    days_of_week: [0, 2, 4], start_time: "09:00:00", end_time: "12:00:00", interval_weeks: 1,
    start_date: "2026-11-16", end_date: null, shift_type: "standard_support",
    summary: "Mon, Wed, Fri 09:00 to 12:00", next_start: "2026-11-18T22:30:00Z", upcoming_count: 24, upcoming_open: 2,
  },
  {
    id: "s-2", participant_id: "p-2", participant_name: "Ava Mitchell", worker_id: null, worker_name: null,
    days_of_week: [5], start_time: "10:00:00", end_time: "14:00:00", interval_weeks: 2,
    start_date: "2026-11-21", end_date: "2027-03-01", shift_type: "community_access",
    summary: "Sat 10:00 to 14:00, every 2 weeks", next_start: null, upcoming_count: 0, upcoming_open: 0,
  },
];

const WORKERS = [
  { id: "w-sam1", full_name: "Sam Nguyen", employee_id: "1042", suburb: "Glenelg" },
  { id: "w-sam2", full_name: "Sam Nguyen", employee_id: "2210", suburb: "Elizabeth" },
  { id: "w-mia", full_name: "Mia Chen", employee_id: "3001" },
] as unknown as WorkerStats[];

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.list.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let body: unknown = [];
    if (String(url).includes("/shift-series") && method === "GET") body = SERIES;
    else if (method === "PATCH") body = { updated_count: 20, removed_count: 0, created_count: 0, left_alone_count: 1, opened: [{ date: "2026-11-25", shift_id: "x", reason: "On leave" }], skipped: [] };
    else if (String(url).endsWith("/end")) body = { removed_count: 22, left_alone_count: 0, end_date: "2026-11-30" };
    else if (String(url).endsWith("/shift-series") && method === "POST") {
      body = { series: { ...SERIES[0], id: "s-new" }, created_count: 24, opened: [], skipped: [] };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c1", organizationId: "org-1", role: "support_coordinator" } }),
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

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(() => { cleanup(); calls.list = []; });

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

it("lists each participant's regular schedules, with who, what's next and what needs a worker", async () => {
  renderWith(<RegularSchedulesPanel open onOpenChange={() => {}} workers={WORKERS} onNew={() => {}} />);
  const liam = await screen.findByRole("region", { name: "Liam Carter" });
  expect(within(liam).getByText("Mon, Wed, Fri 09:00 to 12:00")).toBeTruthy();
  // Two Sam Nguyens on the team: this one's staff ID and suburb.
  expect(within(liam).getByText("Sam Nguyen · ID 1042 · Glenelg")).toBeTruthy();
  expect(within(liam).getByText(/2 coming shifts need a worker/)).toBeTruthy();
  const ava = screen.getByRole("region", { name: "Ava Mitchell" });
  expect(within(ava).getByText("Open shifts")).toBeTruthy();
  expect(within(ava).getByText(/until Mon 1 Mar/)).toBeTruthy();

  // Found by the worker's staff ID.
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a regular schedule" }), { target: { value: "1042" } });
  expect(screen.queryByRole("region", { name: "Ava Mitchell" })).toBeNull();
  expect(screen.getByRole("region", { name: "Liam Carter" })).toBeTruthy();
});

it("changes a schedule from a date, sending only what changed, and says what happened", async () => {
  renderWith(<RegularSchedulesPanel open onOpenChange={() => {}} workers={WORKERS} onNew={() => {}} focus={{ seriesId: "s-1", fromDate: "2099-01-05" }} />);
  expect(await screen.findByText("Now: Mon, Wed, Fri 09:00 to 12:00")).toBeTruthy();
  // Nothing changed yet: nothing to save.
  const save = screen.getByRole("button", { name: /Change from Mon 5 Jan/ }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Wed" }));
  expect(save.disabled).toBe(false);
  fireEvent.click(save);

  expect(await screen.findByText(/20 shifts changed/)).toBeTruthy();
  expect(screen.getByText(/1 shift someone had changed by hand was left as it is/)).toBeTruthy();
  expect(screen.getByText(/Wed 25 Nov: On leave/)).toBeTruthy();
  const patch = calls.list.find((c) => c.method === "PATCH")!;
  expect(patch.url).toContain("/api/coordinator/shift-series/s-1");
  expect(patch.body).toEqual({ from_date: "2099-01-05", days_of_week: [0, 4] });
});

it("stops a schedule from a date", async () => {
  renderWith(<RegularSchedulesPanel open onOpenChange={() => {}} workers={WORKERS} onNew={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Stop Ava Mitchell's Sat 10:00 to 14:00, every 2 weeks" }));
  fireEvent.click(screen.getByRole("button", { name: /^Stop from/ }));
  await waitFor(() => expect(calls.list.some((c) => c.url.endsWith("/shift-series/s-2/end"))).toBe(true));
});

it("a new regular schedule keeps going unless given an end, and can repeat fortnightly", async () => {
  renderWith(
    <BulkShiftModal open onOpenChange={() => {}} participants={[{ id: "p-1", full_name: "Liam Carter" }]} workers={WORKERS} initialParticipantId="p-1" />,
  );
  expect(screen.getByText("New regular schedule")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Keeps going" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /Start regular schedule/ }));
  expect(await screen.findByText(/24 shifts made/)).toBeTruthy();
  const post = calls.list.find((c) => c.method === "POST")!;
  expect(post.url).toContain("/api/coordinator/shift-series");
  expect(post.body).toMatchObject({ participant_id: "p-1", days_of_week: [0, 2, 4], interval_weeks: 1, end_date: null, worker_id: null });
});
