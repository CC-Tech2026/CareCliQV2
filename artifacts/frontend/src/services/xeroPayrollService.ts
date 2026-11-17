import { jsonFetch } from "@/services/http";

/** Which Xero pay item each kind of hours goes under. */
export type XeroPayItemKey = "weekday" | "saturday" | "sunday" | "public_holiday" | "sleepover";

export type XeroPayrollStatus = {
  connected: boolean;
  /** Xero has allowed CareCliQ payroll access (signed in with payroll ticked). */
  has_access: boolean;
  enabled: boolean;
  rates: Record<XeroPayItemKey, string | null>;
  rate_names: Record<XeroPayItemKey, string | null>;
  breaks_unpaid: boolean;
  linked: number;
  employment_hero_connected: boolean;
};

export type XeroEarningsRate = { id: string; name: string; type?: string; rate_type?: string; units?: string | null };

export type XeroPayrollWorker = {
  worker_id: string;
  name: string | null;
  email: string | null;
  employee_id: string | null;
  employee_name: string | null;
  matched_by: "email" | "name" | "chosen" | null;
};

export type XeroPayrollOptions = {
  earnings_rates: XeroEarningsRate[];
  /** Pay items picked by name, for any not chosen yet. */
  suggested: Partial<Record<XeroPayItemKey, string>>;
  employees: { id: string; name: string }[];
  workers: XeroPayrollWorker[];
};

export type XeroPayrollResult = {
  worker_id: string;
  worker_name: string;
  status: "sent" | "updated" | "skipped" | "failed";
  period?: string;
  hours?: number;
  message?: string;
};

export type XeroPayrollSend = { sent: number; failed: number; skipped: number; results: XeroPayrollResult[]; waiting: number };

const BASE = "/api/integrations/xero/payroll";

export function getXeroPayroll() {
  return jsonFetch<XeroPayrollStatus>(BASE);
}

/** The Xero sign-in link that also asks for payroll access. */
export function startXeroPayrollConnect() {
  return jsonFetch<{ url: string }>(`${BASE}/connect`, { method: "POST" });
}

export function getXeroPayrollOptions() {
  return jsonFetch<XeroPayrollOptions>(`${BASE}/options`);
}

export function saveXeroPayroll(settings: {
  enabled?: boolean;
  rates?: Partial<Record<XeroPayItemKey, string | null>>;
  rate_names?: Partial<Record<XeroPayItemKey, string | null>>;
  breaks_unpaid?: boolean;
}) {
  return jsonFetch<XeroPayrollStatus>(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function linkXeroEmployee(workerId: string, employeeId: string | null) {
  return jsonFetch<XeroPayrollStatus>(`${BASE}/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: workerId, employee_id: employeeId }),
  });
}

/** Send a pay period's approved hours to Xero Payroll as draft timesheets. */
export function sendHoursToXero(start: string, end: string) {
  return jsonFetch<XeroPayrollSend>(`${BASE}/send?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
    method: "POST",
  });
}
