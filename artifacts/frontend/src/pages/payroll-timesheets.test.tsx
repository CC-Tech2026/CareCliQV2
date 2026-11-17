import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PayrollTimesheetsPage, { clock, duration, periodFor } from "./payroll-timesheets";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SHIFT: PayrollShift = {
  shift_id: "s-late", date: "2026-11-12", worker_id: "w-1", worker_name: "Aisha Rahman", worker_email: "aisha@example.com",
  participant: "Liam C.", start: "2026-11-12T09:00", end: "2026-11-12T12:40", source: "clock",
  worked_minutes: 220, scheduled_minutes: 180, over_roster_minutes: 40, break_minutes: 30, sleepover: false,
  periods: [], travel_km: 12.5, travel_cents: 1100, approved_by: "Olivia Bennett", payroll: null,
};

function data(overrides: Partial<PayrollPeriodData> = {}): PayrollPeriodData {
  return {
    start: "2026-11-09", end: "2026-11-15", connected: { employment_hero: false },
    totals: { shifts: 2, hours: 15.67, workers: 1, waiting: 1, sent: 0, attention: 0 },
    shifts: [SHIFT, { ...SHIFT, shift_id: "s-sleep", date: "2026-11-13", start: "2026-11-13T20:00", end: "2026-11-14T08:00",
      worked_minutes: 720, over_roster_minutes: 0, break_minutes: 0, travel_km: 0, sleepover: true }],
    waiting: [{ shift_id: "s-todo", date: "2026-11-12", worker_id: "w-2", worker_name: "Tom Walsh", participant: "Liam C." }],
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
  it("runs weeks Monday to Sunday", () => {
    expect(periodFor("this_week", "2026-11-19")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(periodFor("last_week", "2026-11-19")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(periodFor("last_fortnight", "2026-11-16")).toEqual({ start: "2026-11-02", end: "2026-11-15" });
  });

  it("says times and lengths the way people do", () => {
    expect(clock("09:05")).toBe("9:05am");
    expect(clock("00:30")).toBe("12:30am");
    expect(clock("13:00")).toBe("1:00pm");
    expect(duration(220)).toBe("3h 40m");
    expect(duration(45)).toBe("45m");
    expect(duration(120)).toBe("2h");
  });
});

describe("Payroll timesheets", () => {
  it("shows last week's approved shifts by worker, with time over the roster and what's still to approve", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Aisha Rahman" })).toBeTruthy();
    expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-09", "2026-11-15");
    expect(screen.getByText("9:00am to 12:40pm")).toBeTruthy();
    expect(screen.getByText("40m over roster")).toBeTruthy();
    expect(screen.getByText("Sleepover")).toBeTruthy();
    expect(screen.getByText("12.5 km")).toBeTruthy();
    expect(screen.getByText("1 finished shift isn't approved yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review timesheets" }).getAttribute("href")).toBe("/coordinator/verification");
    // Not connected to Employment Hero: no payroll status shown.
    expect(screen.queryByText("In Employment Hero")).toBeNull();
  });

  it("downloads the CSV for the period on screen", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data());
    mocks.downloadPayrollCsv.mockResolvedValue(undefined);
    renderPage();
    await screen.findByRole("heading", { name: "Aisha Rahman" });
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(mocks.getPayrollTimesheets).toHaveBeenCalledWith("2026-11-16", "2026-11-22"));
    await screen.findByRole("heading", { name: "Aisha Rahman" });
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    await waitFor(() => expect(mocks.downloadPayrollCsv).toHaveBeenCalledWith("2026-11-16", "2026-11-22"));
  });

  it("with Employment Hero connected, says which shifts reached it and why one didn't", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      connected: { employment_hero: true },
      totals: { shifts: 2, hours: 15.67, workers: 1, waiting: 0, sent: 1, attention: 1 },
      waiting: [],
      shifts: [
        { ...SHIFT, payroll: { status: "sent" } },
        { ...SHIFT, shift_id: "s-2", date: "2026-11-13", payroll: { status: "failed", error: "Choose the work type for sleepovers." } },
      ],
    }));
    renderPage();
    expect(await screen.findByText("In Employment Hero")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Choose the work type for sleepovers.")).toBeTruthy();
    expect(screen.getByText("need attention")).toBeTruthy();
  });

  it("says so when nothing is approved, and won't download an empty file", async () => {
    mocks.getPayrollTimesheets.mockResolvedValue(data({
      shifts: [], waiting: [], totals: { shifts: 0, hours: 0, workers: 0, waiting: 0, sent: 0, attention: 0 },
    }));
    renderPage();
    expect(await screen.findByText("No approved shifts in this period")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Download CSV/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
