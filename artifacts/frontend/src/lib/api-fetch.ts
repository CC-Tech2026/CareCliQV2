const TOKEN_KEY = "carescribe_token";
const REAUTH_TOKEN_KEY = "carescribe_reauth_token";

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
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("carescribe:unauthorized"));
  }
  return response;
}
