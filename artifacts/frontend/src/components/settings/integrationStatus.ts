/**
 * How each integration is doing, in one word, shared by the Settings >
 * Integrations tiles, each integration's own page and the top bar's
 * Integrations menu, so they always agree.
 */
import type { ApiOverview, XeroStatus } from "@/services/integrationsService";
import type { MyobStatus } from "@/services/myobService";

export type TileStatus = "connected" | "available" | "attention" | "soon" | "unavailable";

/** Xero's official wordmark, in Xero Blue (public/integrations/XERO), never redrawn or recoloured. */
export const XERO_WORDMARK = "/integrations/XERO/Xero%20Wordmark%20Blue.svg";

export function xeroTileStatus(status: XeroStatus): TileStatus {
  if (!status.connected) return status.available ? "available" : "unavailable";
  return status.last_error || (status.counts?.failed ?? 0) > 0 ? "attention" : "connected";
}

/** MYOB also needs attention until its income account and tax code are chosen. */
export function myobTileStatus(status: MyobStatus): TileStatus {
  if (!status.connected) return status.available ? "available" : "unavailable";
  return status.last_error || (status.counts?.failed ?? 0) > 0 || !status.settings.income_account_uid || !status.settings.tax_code_uid
    ? "attention"
    : "connected";
}

/** Connected, needs attention (a webhook is failing) or not set up yet. */
export function apiTileStatus(overview: ApiOverview): TileStatus {
  const keys = overview.keys.filter((k) => !k.revoked_at).length;
  const hooks = overview.webhooks ?? [];
  if (hooks.some((h) => h.active && h.failure_count > 0)) return "attention";
  return keys || hooks.length ? "connected" : "available";
}
