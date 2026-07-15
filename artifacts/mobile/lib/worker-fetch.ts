import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { readMobileAuthToken } from "@/lib/session";

let lastSuccessfulWorkerFetchAt = 0;

export function getLastSuccessfulWorkerFetchAt(): number {
  return lastSuccessfulWorkerFetchAt;
}

export function touchSuccessfulWorkerFetch(): void {
  lastSuccessfulWorkerFetchAt = Date.now();
}

export class WorkerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
}

function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter((part): part is string => Boolean(part?.trim()));
    if (parts.length) return parts.join(". ");
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    const msg = String((detail as { msg: unknown }).msg ?? "").trim();
    if (msg) return msg;
  }
  return fallback;
}

export async function workerFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = getMobileApiBaseUrl();
  if (!base) {
    throw new WorkerApiError("API URL not configured", 0);
  }

  const token = await readMobileAuthToken();
  const headers: Record<string, string> = {
  ...(init.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (init.body && !headers["Content-Type"] && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const url = `${base}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Network request failed";
    throw new WorkerApiError(`${reason} → ${url}`, 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown; message?: string };
      message = formatApiErrorDetail(body.detail, body.message ?? message);
    } catch {
      /* use default */
    }
    throw new WorkerApiError(message, response.status);
  }

  if (response.status === 204) {
    touchSuccessfulWorkerFetch();
    return undefined as T;
  }

  const data = (await response.json()) as T;
  touchSuccessfulWorkerFetch();
  return data;
}
