import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PayrollTimesheetsPage, { clock, duration, payPeriod } from "./payroll-timesheets";
import type { PayrollPeriodData, PayrollShift } from "@/services/payrollService";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  getPayrollTimesheets: vi.fn(),
  downloadPayrollCsv: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c-1", organizationId: "org-1", role: "support_coordinator" } }),
}));
vi.mock("@/lib/datetime", () => ({ appTodayKey: () => "2026-11-19" })); // a Thursday
vi.mock("@/services/payrollService", () => ({
  getPayrollTimesheets: mocks.getPayrollTimesheets,
  downloadPayrollCsv: mocks.downloadPayrollCsv,
}));

// The side panel's sheet measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

const SHIFT: PayrollShift = {
  shift_id: "s-late", date: "2026-11-12", worker_id: "w-1", worker_name: "Aisha Rahman", worker_email: "aisha@example.com",
  participant: "Liam C.", start: "2026-11-12T09:00", end: "2026-11-12T12:40", source: "clock",
  worked_minutes: 220, scheduled_minutes: 180, over_roster_minutes: 40, break_minutes: 30, sleepover: false,
  periods: [], travel_km: 12.5, travel_cents: 1100, approved_by: "Olivia Bennett", payroll: null,
};
const SLEEP: PayrollShift = {
  ...SHIFT, shift_id: "s-sleep", date: "2026-11-13", start: "2026-11-13T20:00", end: "2026-11-14T08:00",
  worked_minutes: 720, over_roster_minutes: 0, break_minutes: 0, travel_km: 0, sleepover: true,
  periods: [
    { kind: "active", start: "2026-11-13T20:00", end: "2026-11-13T22:00", minutes: 120, break_minutes: 0 },
    { kind: "sleepover", start: "2026-11-13T22:00", end: "2026-11-14T06:00", minutes: 480, break_minutes: 0 },
    { kind: "active", start: "2026-11-14T06:00", end: "2026-11-14T08:00", minutes: 120, break_minutes: 0 },
  ],
};

function data(overrides: Partial<PayrollPeriodData> = {}): PayrollPeriodData {
  return {
    start: "2026-11-09", end: "2026-11-15", connected: { employment_hero: false },
    totals: { shifts: 3, hours: 18.67, workers: 2, waiting: 1, sent: 0, attention: 0 },
    shifts: [SHIFT, SLEEP, { ...SHIFT, shift_id: "s-tom", worker_id: "w-2", worker_name: "Tom Walsh", over_roster_minutes: 3, worked_minutes: 180 }],
    waiting: [{ shift_id: "s-todo", date: "2026-11-12", worker_id: "w-3", worker_name: "Sam Lee", participant: "Liam C." }],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PayrollTimesheetsPage />
    </QueryClientProvider>,
  );
}

describe("pay periods and labels", () => {
  it("runs weeks Monday to Sunday, and fortnights as two of them", () => {
    expect(payPeriod("weekly", "2026-11-19", 0)).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(payPeriod("weekly", "2026-11-19", -1)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(payPeriod("fortnightly", "2026-11-19", -1)).toEqual({ start: "2026-11-02", end: "2026-11-15" });
    expect(payPeriod("fortnightly", "2026-11-19", 0)).toEqual({ start: "2026-11-16", end: "2026-11-29" });
  });

  it("says times and lengths the way people do", () => {
    expect(clock("09:05")).toBe("9:05am");
    expect(clock("00:30")).toBe("12:30am");
    expect(duration(220)).toBe("3h 40m");
    expect(duration(45)).toBe("45m");
  });
});

describe("Payroll", () => {
  it("opens on last week: what's left to approve, the download, and hours by worker", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    expect(await screen.findByRole("region", { name: "Approve timesheets" })).toBeTruthy();
    expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-09", "2026-11-15");
    expect(screen.getByText("Last week")).toBeTruthy();
    expect(screen.getByText("1 shift still to approve")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Approve timesheets" }).getAttribute("href")).toBe("/coordinator/verification");
    const rows = within(screen.getByRole("region", { name: "Hours by worker" }));
    expect(rows.getByText("Aisha Rahman")).toBeTruthy();
    expect(rows.getByText("15h 40m")).toBeTruthy(); // 3h 40m + 12h
    // A sleepover and a real late stay are noted; Tom's 3 minutes aren't.
    expect(rows.getAllByText("1 sleepover · Stayed late on 1 shift").length).toBeGreaterThan(0);
    expect(rows.getAllByText(/Stayed late on/)).toHaveLength(2); // Aisha, on wide and narrow screens; not Tom
  });

  it("shows a worker's shifts in a side panel, with the sleepover split", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Aisha Rahman/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("9:00am to 12:40pm · with Liam C.")).toBeTruthy();
    expect(within(panel).getByText("40m longer than rostered")).toBeTruthy();
    expect(within(panel).getByText("Sleepover 10:00pm to 6:00am")).toBeTruthy();
  });

  it("downloads the hours for the period on screen, and moves between periods", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    mocks.downloadPayrollCsv.mockResolvedValue(undefined);
    renderPage();
    await screen.findByRole("region", { name: "Hours by worker" });
    fireEvent.click(screen.getByRole("button", { name: "Previous pay period" }));
    await waitFor(() => expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-02", "2026-11-08"));
    await screen.findByRole("region", { name: "Hours by worker" });
    fireEvent.click(screen.getByRole("button", { name: /Download hours/ }));
    await waitFor(() => expect(mocks.downloadPayrollCsv).toHaveBeenCalledWith("2026-11-02", "2026-11-08"));
    // Can't go past the current period.
    fireEvent.click(screen.getByRole("button", { name: "Next pay period" }));
    fireEvent.click(screen.getByRole("button", { name: "Next pay period" }));
    expect((screen.getByRole("button", { name: "Next pay period" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches to fortnights and remembers the choice", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    await screen.findByRole("region", { name: "Hours by worker" });
    fireEvent.click(screen.getByRole("button", { name: "Fortnightly" }));
    await waitFor(() => expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-02", "2026-11-15"));
    expect(window.localStorage.getItem("carecliq-payroll-frequency")).toBe("fortnightly");
  });

  it("with Employment Hero connected, says what was sent and what wasn't", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      connected: { employment_hero: true }, waiting: [],
      totals: { shifts: 2, hours: 15.67, workers: 1, waiting: 0, sent: 1, attention: 1 },
      shifts: [{ ...SHIFT, payroll: { status: "sent" } }, { ...SLEEP, payroll: { status: "failed", error: "Choose the work type for sleepovers." } }],
    }));
    renderPage();
    expect(await screen.findByText("Every finished shift in this period is approved.")).toBeTruthy();
    expect(screen.getByText("1 of 2 shifts sent.")).toBeTruthy();
    expect(screen.getByText("1 shift couldn't be sent")).toBeTruthy();
    expect(screen.getByText("1 shift not sent")).toBeTruthy();
  });

  it("with nothing worked, says so and won't download an empty file", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      shifts: [], waiting: [], totals: { shifts: 0, hours: 0, workers: 0, waiting: 0, sent: 0, attention: 0 },
    }));
    renderPage();
    expect(await screen.findByText("No shifts were worked in this period.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Download hours/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("region", { name: "Hours by worker" })).toBeNull();
  });
});
