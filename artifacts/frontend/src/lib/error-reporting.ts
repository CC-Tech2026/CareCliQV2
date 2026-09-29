import { apiFetch } from "@/lib/api-fetch";

/** Crash reports go to POST /api/client-errors, which writes them to the
 * server logs. Deduplicated and capped per page load so one render loop
 * can't flood the endpoint. */

const MAX_REPORTS_PER_PAGE_LOAD = 10;
const sent = new Set<string>();
let count = 0;

// Browser noise that isn't an app bug.
const IGNORED = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /AbortError/i,
  /The user aborted a request/i,
];

export interface ClientErrorReport {
  kind: "page-crash" | "app-crash" | "uncaught" | "unhandled-rejection";
  error: unknown;
  componentStack?: string | null;
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack };
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function reportClientError({ kind, error, componentStack }: ClientErrorReport): void {
  const { message, stack } = describe(error);
  if (!message || IGNORED.some((re) => re.test(message))) return;
  const key = `${kind}|${message}|${(stack ?? "").slice(0, 300)}`;
  if (sent.has(key) || count >= MAX_REPORTS_PER_PAGE_LOAD) return;
  sent.add(key);
  count += 1;

  void apiFetch("/api/client-errors", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 8000),
      component_stack: componentStack?.slice(0, 8000),
      url: window.location.pathname + window.location.search,
      user_agent: navigator.userAgent.slice(0, 500),
    }),
  }).catch(() => {
    // Reporting must never throw — the app is already in a bad state.
  });
}

let installed = false;

/** Errors thrown outside React rendering (event handlers, timers, rejected
 * promises nobody awaited) never reach an error boundary. */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportClientError({ kind: "uncaught", error: event.error ?? event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError({ kind: "unhandled-rejection", error: event.reason });
  });
}
