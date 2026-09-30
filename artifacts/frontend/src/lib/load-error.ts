/** A short, specific reason a screen's data didn't load, for the error box
 * under "Couldn't load …". Distinguishes a server that hasn't been updated
 * with the feature (404) from access problems and genuine server errors. */
export class LoadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function loadErrorFrom(res: Response, fallback = "Request failed."): Promise<LoadError> {
  const body = await res.json().catch(() => ({}));
  const detail = body?.detail;
  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail) && detail[0]?.msg
        ? String(detail[0].msg)
        : fallback;
  return new LoadError(message, res.status);
}

export function loadErrorHint(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) return "The server doesn't have this feature yet — the API needs redeploying with the latest version.";
  if (status === 401) return "Your session has expired — sign in again.";
  if (status === 403) return error instanceof Error && error.message ? error.message : "You don't have access to this.";
  if (status && status >= 500) {
    const message = error instanceof Error ? error.message.replace(/\.$/, "") : "";
    return `Server error (${status})${message && !/^Request failed/.test(message) ? `: ${message}` : ""}.`;
  }
  if (error instanceof TypeError) return "Couldn't reach the server — check your connection.";
  return error instanceof Error && error.message ? error.message : "";
}
