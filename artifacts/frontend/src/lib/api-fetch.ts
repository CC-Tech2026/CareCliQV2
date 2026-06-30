import { getDeviceId } from "@/lib/device-id";
import { readStoredSession } from "@/lib/auth-session";
import { CCQ_REAUTH_TOKEN_KEY, CCQ_UNAUTHORIZED_EVENT } from "@/lib/storage-keys";
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (BASE_URL && typeof input === "string" && input.startsWith("/")) {
    return `${BASE_URL}${input}`;
  }
  return input;
}

function readStoredUserOrgId(): string | undefined {
  try {
    const { userJson } = readStoredSession();
    const userObj = userJson ? JSON.parse(userJson) : null;
    return userObj?.organizationId;
  } catch {
    return undefined;
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const { token } = readStoredSession();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const reauthToken = localStorage.getItem(CCQ_REAUTH_TOKEN_KEY);
  if (reauthToken && !headers.has("x-reauth-token")) {
    headers.set("x-reauth-token", reauthToken);
  }
  if (!headers.has("x-organisation-id")) {
    const orgId = readStoredUserOrgId();
    if (orgId) headers.set("x-organisation-id", orgId);
  }
  if (!headers.has("x-device-id")) {
    headers.set("x-device-id", getDeviceId());
  }
  const response = await fetch(applyBaseUrl(input), { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(CCQ_UNAUTHORIZED_EVENT));
  }
  return response;
}
