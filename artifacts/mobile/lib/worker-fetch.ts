import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { readMobileAuthToken } from "@/lib/session";

export class WorkerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
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

  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string; message?: string };
      message = body.detail ?? body.message ?? message;
    } catch {
      /* use default */
    }
    throw new WorkerApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
