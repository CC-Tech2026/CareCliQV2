import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PayrollTimesheetsPage, { clock, duration, payPeriod } from "./payroll-timesheets";
import type { PayrollPeriodData, PayrollShift } from "@/services/payrollService";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  getPayrollTimesheets: vi.fn(),
  downloadPayrollHours: vi.fn(),
  sendHoursToXero: vi.fn(),
  markPayrollTravelPaid: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/services/xeroPayrollService", () => ({ sendHoursToXero: mocks.sendHoursToXero }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c-1", organizationId: "org-1", role: "support_coordinator" } }),
}));
vi.mock("@/lib/datetime", () => ({ appTodayKey: () => "2026-11-19" })); // a Thursday
vi.mock("@/services/payrollService", () => ({
  getPayrollTimesheets: mocks.getPayrollTimesheets,
  downloadPayrollHours: mocks.downloadPayrollHours,
  markPayrollTravelPaid: mocks.markPayrollTravelPaid,
}));

// The side panel and the menu measure themselves; jsdom has no ResizeObserver.
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
  periods: [], travel_km: 12.5, travel_km_cents: 1100, travel_fares_cents: 0, travel_cents: 1100,
  travel_claims: { km: ["t-1"], fares: [] }, travel_unpaid: 1, approved_by: "Olivia Bennett", payroll: null,
};
const SLEEP: PayrollShift = {
  ...SHIFT, shift_id: "s-sleep", date: "2026-11-13", start: "2026-11-13T20:00", end: "2026-11-14T08:00",
  worked_minutes: 720, over_roster_minutes: 0, break_minutes: 0, travel_km: 0, travel_km_cents: 0, travel_cents: 0,
  travel_claims: { km: [], fares: [] }, travel_unpaid: 0, sleepover: true,
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

function openExport() {
  const trigger = screen.getByRole("button", { name: /Export/ });
  fireEvent.keyDown(trigger, { key: "Enter" }); // also proves it works from the keyboard
}

describe("pay periods and labels", () => {
  it("runs weeks Monday to Sunday, and fortnights as two of them", () => {
    expect(payPeriod("weekly", "2026-11-19", 0)).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(payPeriod("weekly", "2026-11-19", -1)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(payPeriod("fortnightly", "2026-11-19", -1)).toEqual({ start: "2026-11-02", end: "2026-11-15" });
  });

  it("says times and lengths the way people do", () => {
    expect(clock("09:05")).toBe("9:05am");
    expect(clock("00:30")).toBe("12:30am");
    expect(duration(220)).toBe("3h 40m");
    expect(duration(45)).toBe("45m");
  });
});

describe("Payroll", () => {
  it("opens on last week: one table of hours, a total, and a line about what isn't approved", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    expect(await screen.findByText("Aisha Rahman")).toBeTruthy();
    expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-09", "2026-11-15");
    expect(screen.getByText("9 Nov to 15 Nov")).toBeTruthy();
    expect(screen.getByText("15h 40m")).toBeTruthy(); // Aisha: 3h 40m + 12h
    expect(screen.getByText("Total · 2 staff members")).toBeTruthy();
    expect(screen.getByText("18h 40m")).toBeTruthy(); // everyone
    expect(screen.getByText(/1 shift in this period isn't approved yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Approve timesheets" }).getAttribute("href")).toBe("/coordinator/verification");
    // A sleepover and a real late stay are noted for Aisha; Tom's 3 minutes aren't.
    expect(screen.getAllByText("1 sleepover · Stayed late on 1 shift · Travel $11.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Stayed late/)).toHaveLength(2); // Aisha on wide and narrow screens only
  });

  it("shows someone's shifts in a side panel, with the sleepover split", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Aisha Rahman/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("9:00am to 12:40pm · with Liam C.")).toBeTruthy();
    expect(within(panel).getByText("40m longer than rostered")).toBeTruthy();
    expect(within(panel).getByText("Sleepover 10:00pm to 6:00am")).toBeTruthy();
  });

  it("exports the period on screen as Excel or CSV", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    mocks.downloadPayrollHours.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Aisha Rahman");
    fireEvent.click(screen.getByRole("button", { name: "Previous pay period" }));
    await waitFor(() => expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-02", "2026-11-08"));
    await screen.findByText("Aisha Rahman");
    openExport();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Excel spreadsheet/ }));
    await waitFor(() => expect(mocks.downloadPayrollHours).toHaveBeenCalledWith("2026-11-02", "2026-11-08", "xlsx"));
    await waitFor(() => expect((screen.getByRole("button", { name: /Export/ }) as HTMLButtonElement).disabled).toBe(false));
    openExport();
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV file/ }));
    await waitFor(() => expect(mocks.downloadPayrollHours).toHaveBeenCalledWith("2026-11-02", "2026-11-08", "csv"));
  });

  it("can't go past the current period, and remembers fortnightly", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    await screen.findByText("Aisha Rahman");
    fireEvent.click(screen.getByRole("button", { name: "Next pay period" }));
    expect((screen.getByRole("button", { name: "Next pay period" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("How often you pay"), { target: { value: "fortnightly" } });
    await waitFor(() => expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-02", "2026-11-15"));
    expect(window.localStorage.getItem("carecliq-payroll-frequency")).toBe("fortnightly");
  });

  it("with Employment Hero connected, says when shifts couldn't be sent", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      connected: { employment_hero: true }, waiting: [],
      totals: { shifts: 2, hours: 15.67, workers: 1, waiting: 0, sent: 1, attention: 1 },
      shifts: [{ ...SHIFT, payroll: { status: "sent" } }, { ...SLEEP, payroll: { status: "failed", error: "Choose the work type for sleepovers." } }],
    }));
    renderPage();
    expect(await screen.findByText(/1 shift couldn't be sent to Employment Hero/)).toBeTruthy();
    expect(screen.getAllByText(/1 shift not sent to Employment Hero/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/isn't approved yet/)).toBeNull();
  });

  it("with Xero Payroll on, sends the period to Xero and says who didn't go", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({ connected: { employment_hero: false, xero_payroll: true } }));
    mocks.sendHoursToXero.mockResolvedValue({
      sent: 1, failed: 1, skipped: 0, waiting: 0,
      results: [
        { worker_id: "w-1", worker_name: "Aisha Rahman", status: "sent", period: "09/11 to 15/11", hours: 15.67 },
        { worker_id: "w-2", worker_name: "Tom Walsh", status: "failed", message: "Tom Walsh isn't matched to a Xero employee. Choose who they are on the Xero page." },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Send to Xero/ }));
    await waitFor(() => expect(mocks.sendHoursToXero).toHaveBeenCalledWith("2026-11-09", "2026-11-15"));
    expect(await screen.findByText(/1 timesheet in Xero as a draft/)).toBeTruthy();
    expect(screen.getByText(/Tom Walsh isn't matched to a Xero employee/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Xero settings" })).toBeTruthy();
  });

  it("shows approved travel paid with wages and marks it paid after the pay run", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      totals: { shifts: 1, hours: 3.67, workers: 1, waiting: 0, sent: 0, attention: 0,
        travel_km: 12.5, travel_km_cents: 1100, travel_fares_cents: 450, travel_unpaid: 2 },
      shifts: [SHIFT], waiting: [],
    }));
    mocks.markPayrollTravelPaid.mockResolvedValue({ marked_paid: 2 });
    renderPage();
    expect(await screen.findByText(/12.5 km, \$11.00 vehicle allowance · \$4.50 fares to reimburse/)).toBeTruthy();
    expect(screen.getByText(/2 claims not paid yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mark travel paid/ }));
    await waitFor(() => expect(mocks.markPayrollTravelPaid).toHaveBeenCalledWith("2026-11-09", "2026-11-15"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "2 travel claims marked paid" }));
  });

  it("with Xero Payroll on, travel goes with Send to Xero instead of a Mark paid button", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      connected: { employment_hero: false, xero_payroll: true },
      totals: { shifts: 1, hours: 3.67, workers: 1, waiting: 0, sent: 0, attention: 0,
        travel_km: 12.5, travel_km_cents: 1100, travel_fares_cents: 0, travel_unpaid: 1 },
      shifts: [SHIFT], waiting: [],
    }));
    renderPage();
    expect(await screen.findByText(/Send to Xero puts the kilometres on the timesheets/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mark travel paid/ })).toBeNull();
  });

  it("without Xero Payroll, there's no Send to Xero button", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    await screen.findByText("Aisha Rahman");
    expect(screen.queryByRole("button", { name: /Send to Xero/ })).toBeNull();
  });

  it("with nothing approved, says so and can't export", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      shifts: [], waiting: [], totals: { shifts: 0, hours: 0, workers: 0, waiting: 0, sent: 0, attention: 0 },
    }));
    renderPage();
    expect(await screen.findByText("No approved hours in this period")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Export/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
