import { jsonFetch } from "@/services/http";

export type XeroSettings = {
  /** Revenue account the invoice lines are posted to, e.g. "200". */
  sales_account_code: string;
  /** Xero tax type for the lines; NDIS supports are GST-free ("EXEMPTOUTPUT"). */
  tax_type: string;
  /** AUTHORISED: ready for payment in Xero. DRAFT: approved in Xero by someone. */
  invoice_status: "AUTHORISED" | "DRAFT";
  /** Send each invoice when it's approved in CareCliQ. */
  auto_send: boolean;
};

export type XeroStatus = {
  /** Xero is set up on this CareCliQ server (client ID and secret). */
  available: boolean;
  connected: boolean;
  redirect_uri: string;
  tenant_name?: string | null;
  connected_at?: string | null;
  connected_by_name?: string | null;
  settings: XeroSettings;
  last_sync_at?: string | null;
  last_payment_check_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  counts?: { in_xero: number; waiting: number; failed: number };
  /** The latest invoices to go to (or fail to reach) Xero, newest first. */
  recent?: Array<{
    id: string;
    invoice_number: string;
    payer?: string | null;
    total_cents: number;
    currency: string;
    status: string;
    xero_status?: string | null;
    error?: string | null;
    at?: string | null;
  }>;
};

export type XeroOptions = {
  accounts: Array<{ code: string; name: string }>;
  tax_rates: Array<{ type: string; name: string; rate?: number | null }>;
};

/** Whether Xero is connected; for anyone who handles invoices. */
export function getXeroSummary() {
  return jsonFetch<{ connected: boolean; tenant_name?: string | null }>("/api/integrations/xero/summary");
}

export function getXeroStatus() {
  return jsonFetch<XeroStatus>("/api/integrations/xero");
}

/** The Xero sign-in link to send the director to. */
export function startXeroConnect() {
  return jsonFetch<{ url: string }>("/api/integrations/xero/connect", { method: "POST" });
}

export function completeXeroConnect(code: string, state: string) {
  return jsonFetch<XeroStatus>("/api/integrations/xero/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
}

export function disconnectXero() {
  return jsonFetch<XeroStatus>("/api/integrations/xero", { method: "DELETE" });
}

export function saveXeroSettings(settings: Partial<XeroSettings>) {
  return jsonFetch<XeroStatus>("/api/integrations/xero/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function getXeroOptions() {
  return jsonFetch<XeroOptions>("/api/integrations/xero/options");
}

export function syncXeroNow() {
  return jsonFetch<{ sent: number; failed: number; paid: number; status: XeroStatus }>("/api/integrations/xero/sync", {
    method: "POST",
  });
}

/** Send (or resend) one approved invoice to Xero. */
export function sendInvoiceToXero(invoiceId: string) {
  return jsonFetch<{ ok: boolean; message: string }>(`/api/integrations/xero/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "POST",
  });
}
