/**
 * Australian timezone helpers.
 *
 * Every timestamp from the API is UTC. Which local zone it's shown in comes
 * from a *branch* (office): the signed-in user's branch for their own
 * views, or the participant's branch for anything about a participant
 * (shifts, notes, pay). Records that belong to a branch carry a
 * `timezone` field; pass it as `tz`. With no `tz` the user's own branch
 * zone is used (from /auth/me, kept in the stored session), and before
 * sign-in the deployment default.
 */
import { readStoredSession } from "@/lib/auth-session";

export const DEFAULT_TIMEZONE = "Australia/Adelaide";

/** @deprecated use getAppTimezone() — kept so older imports keep compiling. */
export const APP_TIMEZONE = DEFAULT_TIMEZONE;

let cachedUserZone: string | null = null;

/** Call when the signed-in user changes (login/logout/profile refresh). */
export function setAppTimezone(zone: string | null | undefined): void {
  cachedUserZone = isValidTimezone(zone) ? (zone as string) : null;
}

/** Fired on window when the user's zone changes mid-session; detail is the zone. */
export const TIMEZONE_CHANGED_EVENT = "ccq:timezone-changed";
/** Response header carrying the caller's zone (backend org_context). */
export const TIMEZONE_HEADER = "x-carecliq-timezone";

/**
 * The API says which zone this person is on with every response. When it
 * differs from the one in use (the business location or their branch was
 * just changed, here or by someone else), switch to it and let the app
 * redraw, so every time on screen follows the new location at once.
 */
export function noteServerTimezone(zone: string | null | undefined): void {
  if (!isValidTimezone(zone) || zone === getAppTimezone()) return;
  cachedUserZone = zone as string;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TIMEZONE_CHANGED_EVENT, { detail: zone }));
  }
}

/** Read the zone header off any API response. */
export function noteTimezoneFromResponse(response: Response): void {
  try {
    noteServerTimezone(response.headers?.get(TIMEZONE_HEADER));
  } catch {
    /* a response without headers (tests, opaque) */
  }
}

let timezoneSyncInstalled = false;

/**
 * Watch every response for the zone header, whichever client made the
 * request (apiFetch or the generated API client). Only reads a header; the
 * response itself is passed through untouched. Installed once at start-up.
 */
export function installTimezoneSync(): void {
  if (timezoneSyncInstalled || typeof window === "undefined" || typeof window.fetch !== "function") return;
  timezoneSyncInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    noteTimezoneFromResponse(response);
    return response;
  };
}

export function isValidTimezone(zone: unknown): boolean {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The signed-in user's branch zone, else the deployment default. */
export function getAppTimezone(): string {
  if (cachedUserZone) return cachedUserZone;
  try {
    const { userJson } = readStoredSession();
    const zone = userJson ? (JSON.parse(userJson)?.timezone as string | undefined) : undefined;
    if (isValidTimezone(zone)) {
      cachedUserZone = zone as string;
      return cachedUserZone;
    }
  } catch {
    /* no stored session */
  }
  return DEFAULT_TIMEZONE;
}

function resolveZone(tz?: string | null): string {
  return isValidTimezone(tz) ? (tz as string) : getAppTimezone();
}

/** The zone a time is shown in: `tz` when it's a real zone, else the
 * signed-in user's (their business location or branch). */
export function appZone(tz?: string | null): string {
  return resolveZone(tz);
}

/**
 * A Date whose *local* fields (getHours, date-fns format) read as the wall
 * clock in `tz`, whatever zone the browser itself is in. For showing a time
 * with date-fns or reading its hour; never for arithmetic between instants
 * or for sending back to the API (use the original ISO string for that).
 */
export function zonedDate(iso: string | Date, tz?: string | null): Date {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return d;
  const p = tzParts(d, resolveZone(tz));
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), d.getUTCSeconds());
}

/**
 * What to hand date-fns `format()` for a value from the API:
 * - a plain date ("2026-11-20") is that calendar day, as before;
 * - a timestamp (string with a time, or epoch ms) reads on the clock of
 *   `tz`, else the user's business location — never the browser's zone;
 * - a Date the app built itself (a calendar cell) is left as it is.
 */
export function displayDate(value: string | number | Date, tz?: string | null): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return zonedDate(new Date(value), tz);
  if (/T\d{2}:\d{2}/.test(value) || /\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return zonedDate(value, tz);
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return new Date(value);
}

/** "Now" as a zoned Date (see zonedDate): today's date and time in the
 * user's zone, for calendars and "today" markers built with date-fns. */
export function appNow(tz?: string | null): Date {
  return zonedDate(new Date(), tz);
}

function tzPartsOpts(zone: string): Intl.DateTimeFormatOptions {
  return {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
}

function tzParts(iso: string | Date, zone: string): Record<string, string> {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", tzPartsOpts(zone))
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}

/** e.g. "9:00 am" in the branch zone */
export function formatAppTime(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: resolveZone(tz),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/**
 * e.g. "9:00 am AEST" — a time paired with its zone abbreviation, always
 * shown (not just when it differs from the viewer's own branch). Records
 * that matter for audit — shift times, medication administrations,
 * progress notes, incidents, invoices — must never be ambiguous about
 * which branch's clock they're on, regardless of who's looking.
 */
export function formatAppTimeWithZone(iso: string, tz?: string | null): string {
  return `${formatAppTime(iso, tz)} ${zoneAbbreviation(iso, tz)}`;
}

/** Short zone name at that instant, e.g. "AEST" / "ACDT". */
export function zoneAbbreviation(iso: string | Date, tz?: string | null): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const part = new Intl.DateTimeFormat("en-AU", { timeZone: resolveZone(tz), timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/** e.g. "12 Sep 2026" — the calendar date in the branch zone (no time-of-day,
 * so no zone abbreviation attached; the day itself is what could shift). */
export function formatAppDate(
  iso: string,
  tz?: string | null,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  return new Intl.DateTimeFormat("en-AU", { ...opts, timeZone: resolveZone(tz) }).format(new Date(iso));
}

/** "Australia/Melbourne" gives "Melbourne": how people name a zone. */
export function zoneCityName(tz?: string | null): string {
  const zone = resolveZone(tz);
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/**
 * True when a record's zone differs from the viewer's — the cue to show a
 * zone label so a Melbourne 5:00 pm isn't read as an Adelaide 5:00 pm.
 */
export function isOtherBranchZone(tz?: string | null): boolean {
  return isValidTimezone(tz) && (tz as string) !== getAppTimezone();
}

/** e.g. "4:45 PM today" or "4:45 PM, 28 Jun" for mobile shift success screens */
export function formatMobileSubmittedAt(iso: string, tz?: string | null): string {
  const time = formatAppTime(iso, tz);
  const isToday = appLocalDateKey(iso, tz) === appLocalDateKey(new Date().toISOString(), tz);
  if (isToday) return `${time} today`;
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone: resolveZone(tz),
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
  return `${time}, ${date}`;
}

/** Calendar date key yyyy-MM-dd in the branch zone */
export function appLocalDateKey(iso: string, tz?: string | null): string {
  const p = tzParts(iso, resolveZone(tz));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today as yyyy-MM-dd in the branch zone. Use this, not
 * `new Date().toISOString().slice(0, 10)`, which is today in UTC: before
 * 10:30 am in Adelaide that is still yesterday. */
export function appTodayKey(tz?: string | null): string {
  return appLocalDateKey(new Date().toISOString(), tz);
}

/** Minutes since local midnight in the branch zone — for placing a shift on a
 * day timeline without the viewer's own zone shifting it. */
export function appMinutesOfDay(iso: string, tz?: string | null): number {
  const p = tzParts(iso, resolveZone(tz));
  // hour12:false renders midnight as "24" in some engines.
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** UTC ISO → value for `<input type="datetime-local">` (branch local) */
export function utcIsoToDatetimeLocalValue(iso: string, tz?: string | null): string {
  const p = tzParts(iso, resolveZone(tz));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** datetime-local value (branch local) → UTC ISO for API */
export function datetimeLocalValueToUtcIso(localValue: string, tz?: string | null): string {
  const [datePart, timePart] = localValue.split("T");
  if (!datePart || !timePart) return localValue;
  const zone = resolveZone(tz);
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  let ms = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 4; i++) {
    const p = tzParts(new Date(ms), zone);
    const tzH = Number(p.hour);
    const tzM = Number(p.minute);
    const tzD = Number(p.day);
    const diffMin = h * 60 + mi - (tzH * 60 + tzM) + (d - tzD) * 1440;
    if (diffMin === 0) break;
    ms += diffMin * 60_000;
  }
  return new Date(ms).toISOString();
}
