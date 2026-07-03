import { apiFetch } from "@/lib/api-fetch";

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const { detail, message } = payload as { detail?: unknown; message?: unknown };

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
      .filter((m): m is string => !!m);
    if (msgs.length) return msgs.join("; ");
  }
  if (typeof message === "string") return message;
  return undefined;
}

export async function jsonFetch<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Only set content-type for JSON, NOT for FormData (which needs multipart/form-data)
  if (!headers.has("content-type") && init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await apiFetch(input, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = extractErrorMessage(payload) || `Request failed with ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
