import { jsonFetch } from "@/services/http";

export type ToolkitItem = {
  id: string;
  organization_id?: string;
  assigned_user_id?: string | null;
  name: string;
  category?: string | null;
  sku?: string | null;
  quantity: number;
  unit: string;
  minimum_quantity: number;
  expiry_date?: string | null;
  batch_number?: string | null;
  fifo_order?: number | null;
  status: string;
  created_at?: string;
  updated_at?: string;
};

export type RestockRequest = {
  id: string;
  item_id: string;
  requested_by: string;
  quantity_requested: number;
  status: "pending" | "approved" | "rejected" | "fulfilled";
  notes?: string | null;
  item?: ToolkitItem;
};

export async function getMyToolkit(): Promise<{ items: ToolkitItem[]; movements: unknown[]; restock_requests: RestockRequest[] }> {
  return jsonFetch("/api/toolkit/me");
}

export async function useToolkitItem(payload: { item_id: string; quantity: number; notes?: string }) {
  return jsonFetch("/api/toolkit/me/use-item", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function requestRestock(payload: { item_id: string; quantity_requested: number; notes?: string }) {
  return jsonFetch<RestockRequest>("/api/toolkit/me/restock-request", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getTeamToolkit(): Promise<{ items: ToolkitItem[]; movements: unknown[] }> {
  return jsonFetch("/api/toolkit/team");
}

export async function createToolkitItem(payload: Partial<ToolkitItem>) {
  return jsonFetch<ToolkitItem>("/api/toolkit/items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateToolkitItem(id: string, payload: Partial<ToolkitItem>) {
  return jsonFetch<ToolkitItem>(`/api/toolkit/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function assignToolkitItem(id: string, payload: { assigned_user_id?: string | null; quantity?: number; notes?: string }) {
  return jsonFetch<ToolkitItem>(`/api/toolkit/items/${id}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRestockRequests(): Promise<RestockRequest[]> {
  return jsonFetch<RestockRequest[]>("/api/toolkit/restock-requests");
}

export async function updateRestockRequest(id: string, payload: { status: RestockRequest["status"]; notes?: string }) {
  return jsonFetch<RestockRequest>(`/api/toolkit/restock-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
