import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeaveCoverPanel, leaveClashToast } from "./LeaveCoverPanel";
import type { LeaveClash, WorkerStats } from "@/services/coordinatorService";

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; method: string; body: unknown }>, toasts: [] as Array<{ title?: string }> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string }) => calls.toasts.push(t) }) }));

const leave = { start_date: "2026-11-23", end_date: "2026-11-27", reason: "Annual leave" };
const clash = (id: string, workerId: string, name: string, start: string, extra: Partial<LeaveClash> = {}): LeaveClash => ({
  shift_id: id, worker_id: workerId, worker_name: name, participant_id: "p-1", participant_name: "Liam Carter",
  scheduled_start: start, scheduled_end: start.replace("T22:30", "T01:30"), timezone: "Australia/Adelaide",
  series_id: null, leave, ...extra,
});
const CLASHES: LeaveClash[] = [
  clash("s-1", "w-sam1", "Sam Nguyen", "2026-11-23T22:30:00Z", { series_id: "series-1" }),
  clash("s-2", "w-sam1", "Sam Nguyen", "2026-11-25T22:30:00Z"),
  clash("s-3", "w-mia", "Mia Chen", "2026-11-24T22:30:00Z", { leave: { start_date: "2026-11-25", end_date: "2026-11-25", reason: null } }),
];
const WORKERS = [
  { id: "w-sam1", full_name: "Sam Nguyen", employee_id: "1042", suburb: "Glenelg" },
  { id: "w-sam2", full_name: "Sam Nguyen", employee_id: "2210", suburb: "Elizabeth" },
  { id: "w-mia", full_name: "Mia Chen" },
] as unknown as WorkerStats[];

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.list.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = method === "POST"
      ? { released_count: 2, skipped: [] }
      : { shifts: CLASHES };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c1", organizationId: "org-1", role: "support_coordinator" } }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => { cleanup(); calls.list = []; calls.toasts = []; });

function renderPanel(onFindCover = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LeaveCoverPanel open onOpenChange={() => {}} workers={WORKERS} onFindCover={onFindCover} />
    </QueryClientProvider>,
  );
  return onFindCover;
}

it("groups shifts by person and leave, telling same-named staff apart", async () => {
  renderPanel();
  const sam = await screen.findByRole("region", { name: "Sam Nguyen, on leave" });
  expect(within(sam).getByText("Sam Nguyen · ID 1042 · Glenelg")).toBeTruthy();
  expect(within(sam).getByText("Annual leave: Mon 23 Nov to Fri 27 Nov")).toBeTruthy();
  expect(within(sam).getAllByRole("listitem")).toHaveLength(2);
  // The shift from a regular schedule is marked.
  expect(within(sam).getByLabelText("Regular schedule")).toBeTruthy();
  const mia = screen.getByRole("region", { name: "Mia Chen, on leave" });
  expect(within(mia).getByText("Leave: Wed 25 Nov")).toBeTruthy();
  expect(screen.getByText("3 coming shifts are rostered to someone on leave.")).toBeTruthy();
});

it("makes one or all of a person's shifts open, and finds cover for one", async () => {
  const onFindCover = renderPanel();
  const sam = await screen.findByRole("region", { name: "Sam Nguyen, on leave" });
  fireEvent.click(within(sam).getByRole("button", { name: "Make all 2 open" }));
  await waitFor(() => expect(calls.list.find((c) => c.method === "POST")?.body).toEqual({ shift_ids: ["s-1", "s-2"] }));
  await waitFor(() => expect(calls.toasts.map((t) => t.title)).toContain("2 shifts are now open"));

  // 22:30 UTC on the 24th is 9am Wednesday 25th in Adelaide: the shift's own day.
  fireEvent.click(screen.getByRole("button", { name: "Find cover for Liam Carter, Wed 25 Nov" }));
  expect(onFindCover).toHaveBeenCalledWith(expect.objectContaining({ id: "s-3", worker_id: "w-mia", status: "scheduled" }));
});

it("says how many shifts new leave lands on, and nothing when none", () => {
  expect(leaveClashToast(0)).toBeNull();
  expect(leaveClashToast(undefined)).toBeNull();
  expect(leaveClashToast(1)?.title).toBe("1 rostered shift falls in their leave");
  expect(leaveClashToast(3)?.title).toBe("3 rostered shifts fall in their leave");
});
