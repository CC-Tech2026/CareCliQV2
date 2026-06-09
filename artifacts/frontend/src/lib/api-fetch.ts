const TOKEN_KEY = "carescribe_token";
const REAUTH_TOKEN_KEY = "carescribe_reauth_token";
const USER_KEY = "carescribe_user";
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (BASE_URL && typeof input === "string" && input.startsWith("/")) {
    return `${BASE_URL}${input}`;
  }
  return input;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const reauthToken = localStorage.getItem(REAUTH_TOKEN_KEY);
  if (reauthToken && !headers.has("x-reauth-token")) {
    headers.set("x-reauth-token", reauthToken);
  }
  // CCQ-112: secondary org-id header for belt-and-suspenders enforcement
  if (!headers.has("x-organisation-id")) {
    try {
      const stored = localStorage.getItem(USER_KEY);
      const userObj = stored ? JSON.parse(stored) : null;
      const orgId: string | undefined = userObj?.organizationId;
      if (orgId) headers.set("x-organisation-id", orgId);
    } catch {
      // non-critical — server-side middleware is the primary guard
    }
  }
  const response = await fetch(applyBaseUrl(input), { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("carescribe:unauthorized"));
  }
  return response;
}
