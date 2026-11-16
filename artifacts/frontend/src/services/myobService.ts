import { jsonFetch } from "@/services/http";

/** MYOB Business (AccountRight): invoices out, payments back. */
export type MyobSettings = {
  /** The income account the invoice lines are posted to (its MYOB UID). */
  income_account_uid: string | null;
  income_account_name?: string | null;
  /** The tax code for the lines; NDIS supports are GST-free ("FRE"). */
  tax_code_uid: string | null;
  tax_code_name?: string | null;
  /** Send each invoice when it's approved in CareCliQ. */
  auto_send: boolean;
};

export type MyobStatus = {
  /** MYOB is set up on this CareCliQ server (API key and secret). */
  available: boolean;
  connected: boolean;
  /** Xero is connected, so MYOB can't be (invoices go to one system). */
  blocked_by_xero?: boolean;
  redirect_uri: string;
  business_name?: string | null;
  connected_at?: string | null;
  connected_by_name?: string | null;
  settings: MyobSettings;
  last_sync_at?: string | null;
  last_payment_check_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  counts?: { in_myob: number; waiting: number; failed: number };
  recent?: Array<{
    id: string;
    invoice_number: string;
    /** MYOB's own number, when CareCliQ's was too long for MYOB. */
    myob_number?: string | null;
    payer?: string | null;
    total_cents: number;
    currency: string;
    status: string;
    myob_status?: "Open" | "Closed" | "Deleted" | string | null;
    error?: string | null;
    at?: string | null;
  }>;
};

export type MyobOptions = {
  accounts: Array<{ uid: string; label: string }>;
  tax_codes: Array<{ uid: string; code: string; label: string; rate?: number | null }>;
};

const BASE = "/api/integrations/myob";

export function getMyobStatus() {
  return jsonFetch<MyobStatus>(BASE);
}

/** Whether MYOB is connected; for anyone who handles invoices. */
export function getMyobSummary() {
  return jsonFetch<{ connected: boolean; business_name?: string | null }>(`${BASE}/summary`);
}

/** The MYOB sign-in link to send the director to. */
export function startMyobConnect() {
  return jsonFetch<{ url: string }>(`${BASE}/connect`, { method: "POST" });
}

export function completeMyobConnect(code: string, state: string, businessId: string) {
  return jsonFetch<MyobStatus>(`${BASE}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state, business_id: businessId }),
  });
}

export function disconnectMyob() {
  return jsonFetch<MyobStatus>(BASE, { method: "DELETE" });
}

export function saveMyobSettings(settings: Partial<MyobSettings>) {
  return jsonFetch<MyobStatus>(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function getMyobOptions() {
  return jsonFetch<MyobOptions>(`${BASE}/options`);
}

export function syncMyobNow() {
  return jsonFetch<{ sent: number; failed: number; paid: number; status: MyobStatus }>(`${BASE}/sync`, {
    method: "POST",
  });
}

/** Send (or resend) one approved invoice to MYOB. */
export function sendInvoiceToMyob(invoiceId: string) {
  return jsonFetch<{ ok: boolean; message: string }>(`${BASE}/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "POST",
  });
}
