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

// ---------------------------------------------------------------------------
// CareCliQ API keys and webhooks (for systems such as CORA Workforce)
// ---------------------------------------------------------------------------

export type ApiKey = {
  id: string;
  name: string;
  /** The start of the key, e.g. "cc_live_ab12cd34", to tell keys apart. */
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  description?: string | null;
  events: string[];
  active: boolean;
  created_at: string;
  last_delivery_at?: string | null;
  last_status_code?: number | null;
  failure_count: number;
};

export type WebhookDelivery = {
  id: string;
  event_type: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  response_status?: number | null;
  error?: string | null;
  created_at: string;
  delivered_at?: string | null;
  next_attempt_at?: string | null;
};

export type ApiOverview = {
  keys: ApiKey[];
  webhooks: WebhookEndpoint[];
  scopes: Array<{ id: string; description: string }>;
  events: Array<{ id: string; description: string }>;
};

export function getApiOverview() {
  return jsonFetch<ApiOverview>("/api/integrations/api");
}

/** The response carries the full key this once. */
export function createApiKey(name: string, scopes: string[]) {
  return jsonFetch<ApiKey & { key: string }>("/api/integrations/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, scopes }),
  });
}

export function revokeApiKey(id: string) {
  return jsonFetch<{ ok: boolean }>(`/api/integrations/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** The response carries the signing secret this once. */
export function createWebhook(url: string, events: string[], description?: string) {
  return jsonFetch<WebhookEndpoint & { secret: string }>("/api/integrations/api/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, events, description }),
  });
}

export function updateWebhook(id: string, changes: Partial<{ url: string; events: string[]; description: string; active: boolean }>) {
  return jsonFetch<WebhookEndpoint>(`/api/integrations/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function deleteWebhook(id: string) {
  return jsonFetch<{ ok: boolean }>(`/api/integrations/api/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function testWebhook(id: string) {
  return jsonFetch<{ ok: boolean; status?: number; message?: string | null }>(
    `/api/integrations/api/webhooks/${encodeURIComponent(id)}/test`,
    { method: "POST" },
  );
}

export function getWebhookDeliveries(id: string) {
  return jsonFetch<WebhookDelivery[]>(`/api/integrations/api/webhooks/${encodeURIComponent(id)}/deliveries`);
}
