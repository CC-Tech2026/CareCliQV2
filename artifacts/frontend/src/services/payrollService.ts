import { apiFetch } from "@/lib/api-fetch";
import { downloadBlob } from "@/lib/download-file";
import { jsonFetch } from "@/services/http";

/** A period of work inside a shift: active work, or the sleepover itself. */
export type PayrollPeriod = {
  kind: "active" | "sleepover";
  /** Local date and time, "YYYY-MM-DDTHH:MM". */
  start: string;
  end: string;
  minutes: number;
  break_minutes: number;
};

/** One approved shift, with the time the worker is paid for (not the billed time). */
export type PayrollShift = {
  shift_id: string;
  date: string;
  worker_id: string | null;
  worker_name: string;
  worker_email?: string | null;
  payroll_employee_id?: number | string | null;
  /** Initials only, e.g. "Liam C.". */
  participant: string;
  start: string;
  end: string;
  /** "clock" when clocked in and out; "roster" when the rostered times were used. */
  source: "clock" | "roster" | null;
  worked_minutes: number;
  scheduled_minutes: number | null;
  over_roster_minutes: number;
  break_minutes: number;
  sleepover: boolean;
  periods: PayrollPeriod[];
  travel_km: number;
  travel_cents: number;
  approved_at?: string | null;
  approved_by?: string | null;
  /** Null when no payroll system is connected. */
  payroll: { status: "sent" | "paid" | "failed" | "removed" | "waiting"; error?: string | null } | null;
};

/** A finished shift that isn't approved yet, so it isn't in the export. */
export type PayrollWaiting = {
  shift_id: string;
  date: string;
  worker_id: string | null;
  worker_name?: string | null;
  participant: string;
  problem?: string;
};

export type PayrollPeriodData = {
  start: string;
  end: string;
  connected: { employment_hero: boolean; xero_payroll?: boolean };
  totals: { shifts: number; hours: number; workers: number; waiting: number; sent: number; attention: number };
  shifts: PayrollShift[];
  waiting: PayrollWaiting[];
};

function query(start: string, end: string) {
  return `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}

export function getPayrollTimesheets(start: string, end: string) {
  return jsonFetch<PayrollPeriodData>(`/api/payroll/timesheets?${query(start, end)}`);
}

/** The hours as an Excel file (opens straight in Excel or Google Sheets,
 *  with day-first dates and wide enough columns) or as a CSV for payroll
 *  software that imports one. */
export async function downloadPayrollHours(start: string, end: string, format: "xlsx" | "csv") {
  const res = await apiFetch(`/api/payroll/timesheets.${format}?${query(start, end)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || "The file couldn't be made. Try again.");
  }
  downloadBlob(await res.blob(), `carecliq-hours-${start}-to-${end}.${format}`);
}
