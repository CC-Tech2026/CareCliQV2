import { jsonFetch } from "@/services/http";

export type NdisPriceResolution = {
  id: string;
  item_code: string;
  name: string;
  price_national: number;
  price_remote: number | null;
  price_very_remote: number | null;
  effective_price: number;
  effective_price_source: "explicit" | "calculated_multiplier";
};

export type NdisPriceSchedule = {
  id: string;
  organization_id: string;
  financial_year: number;
  effective_date: string;
  source_document: string;
  version: number;
  items_loaded: number;
  loaded_by: string;
  created_at: string;
  superseded_date: string | null;
};

export type NdisPriceItem = {
  id: string;
  item_code: string;
  name: string;
  description: string | null;
  price_national: number;
  price_remote: number | null;
  price_very_remote: number | null;
  valid_from: string;
  valid_to: string | null;
  edited_by: string | null;
  edited_at: string | null;
};

export type LoadScheduleResponse = {
  schedule_id: string;
  financial_year: number;
  effective_date: string;
  items_loaded: number;
  validation_errors: string[];
};

export type EditItemPriceResponse = {
  item_code: string;
  new_version_id: string;
  previous_version_id: string;
  effective_from: string;
  previous_version_valid_to: string;
  audit_log_id: string;
};

/**
 * Resolve the effective price for an NDIS item code.
 * @param itemCode - NDIS item code (e.g., "01_011_0107_1_1")
 * @param asOfDate - ISO date string (e.g., "2025-01-27")
 * @param locationType - "national", "remote", or "very_remote"
 * @returns Resolved price details with effective amount and source
 */
export function resolveNdisPrice(
  itemCode: string,
  asOfDate: string = new Date().toISOString().split("T")[0],
  locationType: "national" | "remote" | "very_remote" = "national",
) {
  return jsonFetch<NdisPriceResolution>("/api/ndis-pricing/resolve", {
    method: "POST",
    body: JSON.stringify({ item_code: itemCode, as_of_date: asOfDate, location_type: locationType }),
  });
}

/**
 * Get version history for an NDIS item (for audit trail review).
 */
export function getNdisItemHistory(itemCode: string, limit = 10) {
  return jsonFetch<NdisPriceItem[]>(`/api/ndis-pricing/items/${encodeURIComponent(itemCode)}/history?limit=${limit}`);
}

/**
 * List all price schedules for the organization (newest first).
 */
export function listNdisPriceSchedules(limit = 20) {
  return jsonFetch<NdisPriceSchedule[]>(`/api/ndis-pricing/schedules?limit=${limit}`);
}

/**
 * Get details of a specific price schedule.
 */
export function getNdisPriceSchedule(scheduleId: string) {
  return jsonFetch<NdisPriceSchedule>(`/api/ndis-pricing/schedules/${scheduleId}`);
}

/**
 * Load an NDIS price schedule from raw JSON (coordinator only).
 * Requires recent reauthentication.
 */
export function loadNdisPriceSchedule(rawJson: string) {
  return jsonFetch<LoadScheduleResponse>("/api/ndis-pricing/schedules/load", {
    method: "POST",
    body: JSON.stringify({ raw_json: rawJson }),
  });
}

/**
 * Edit a single NDIS item price (coordinator only).
 * Requires recent reauthentication.
 */
export function editNdisItemPrice(
  itemCode: string,
  priceNational: number,
  effectiveDate: string,
  reason: string,
  priceRemote?: number | null,
  priceVeryRemote?: number | null,
) {
  return jsonFetch<EditItemPriceResponse>(`/api/ndis-pricing/items/${encodeURIComponent(itemCode)}/edit`, {
    method: "POST",
    body: JSON.stringify({
      price_national: priceNational,
      price_remote: priceRemote,
      price_very_remote: priceVeryRemote,
      effective_date: effectiveDate,
      reason,
    }),
  });
}
