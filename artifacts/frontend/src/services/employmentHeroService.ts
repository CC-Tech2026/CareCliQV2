import { jsonFetch } from "@/services/http";

/** Employment Hero Payroll (formerly KeyPay): approved timesheets out to payroll. */
export type EmploymentHeroSettings = {
  /** Send each timesheet when it's approved in CareCliQ. */
  auto_send: boolean;
  /** Arrive approved in Employment Hero (ready for the pay run), not just submitted. */
  send_approved: boolean;
  /** Shifts worked from this date (YYYY-MM-DD) go; set to the day of connecting. */
  send_from: string | null;
  /** Employment Hero work type used for sleepovers. */
  sleepover_work_type_id: number | null;
  sleepover_work_type_name?: string | null;
  /** Breaks taken in the worker app are unpaid meal breaks (default: marked paid). */
  breaks_unpaid?: boolean;
  /** Expense categories approved travel is paid under, in the next pay run. */
  travel_km_category_id?: number | null;
  travel_km_category_name?: string | null;
  travel_fares_category_id?: number | null;
  travel_fares_category_name?: string | null;
};

export type EmploymentHeroAttention = {
  shift_id: string;
  worker_id?: string | null;
  worker_name?: string | null;
  start_time?: string | null;
  status: "failed" | "paid";
  message?: string | null;
  /** The worker couldn't be matched to an Employment Hero employee: choose who they are. */
  needs_employee: boolean;
};

export type EmploymentHeroStatus = {
  /** Employment Hero is switched on for CareCliQ (its sign-in is set up). */
  available: boolean;
  connected: boolean;
  redirect_uri: string;
  business_id?: number | null;
  business_name?: string | null;
  businesses?: Array<{ id: number; name: string }>;
  /** The login sees several payroll businesses and none is chosen yet. */
  needs_business?: boolean;
  connected_at?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
  settings: EmploymentHeroSettings;
  counts?: { sent: number; failed: number; paid: number };
  attention?: EmploymentHeroAttention[];
};

export type EmploymentHeroOptions = {
  work_types: Array<{ id: number; name: string }>;
  /** Empty when expense management isn't switched on in Employment Hero. */
  expense_categories?: Array<{ id: number; name: string }>;
  suggested_travel?: { travel_km_category: number | null; travel_fares_category: number | null };
  employees: Array<{ id: number; name: string }>;
};

const BASE = "/api/integrations/employment-hero";

export function getEmploymentHeroStatus() {
  return jsonFetch<EmploymentHeroStatus>(BASE);
}

export function startEmploymentHeroConnect() {
  return jsonFetch<{ url: string }>(`${BASE}/connect`, { method: "POST" });
}

export function completeEmploymentHeroConnect(code: string, state: string) {
  return jsonFetch<EmploymentHeroStatus>(`${BASE}/callback`, {
    method: "POST",
    body: JSON.stringify({ code, state }),
  });
}

export function chooseEmploymentHeroBusiness(businessId: number) {
  return jsonFetch<EmploymentHeroStatus>(`${BASE}/business`, {
    method: "PUT",
    body: JSON.stringify({ business_id: businessId }),
  });
}

export function disconnectEmploymentHero() {
  return jsonFetch<EmploymentHeroStatus>(BASE, { method: "DELETE" });
}

export function saveEmploymentHeroSettings(settings: Partial<EmploymentHeroSettings>) {
  return jsonFetch<EmploymentHeroStatus>(`${BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function getEmploymentHeroOptions() {
  return jsonFetch<EmploymentHeroOptions>(`${BASE}/options`);
}

export function chooseEmploymentHeroEmployee(workerId: string, employeeId: number, employeeName?: string) {
  return jsonFetch<EmploymentHeroStatus>(`${BASE}/workers/${encodeURIComponent(workerId)}`, {
    method: "PUT",
    body: JSON.stringify({ employee_id: employeeId, employee_name: employeeName ?? null }),
  });
}

export function sendEmploymentHeroNow() {
  return jsonFetch<EmploymentHeroStatus & { result: { sent: number; failed: number } }>(`${BASE}/sync`, {
    method: "POST",
  });
}
