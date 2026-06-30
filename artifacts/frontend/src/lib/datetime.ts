/** Australian timezone helpers — shift times follow Adelaide (ACST/ACDT). */
export const APP_TIMEZONE = "Australia/Adelaide";

const TZ_PARTS_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

function tzParts(iso: string | Date): Record<string, string> {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", TZ_PARTS_OPTS)
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}

/** e.g. "9:00 am" in Australia/Adelaide */
export function formatAppTime(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Calendar date key yyyy-MM-dd in Australia/Adelaide */
export function appLocalDateKey(iso: string): string {
  const p = tzParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** UTC ISO → value for `<input type="datetime-local">` (Australia local) */
export function utcIsoToDatetimeLocalValue(iso: string): string {
  const p = tzParts(iso);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** datetime-local value (Australia local) → UTC ISO for API */
export function datetimeLocalValueToUtcIso(localValue: string): string {
  const [datePart, timePart] = localValue.split("T");
  if (!datePart || !timePart) return localValue;
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  let ms = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 4; i++) {
    const p = tzParts(new Date(ms));
    const tzH = Number(p.hour);
    const tzM = Number(p.minute);
    const tzD = Number(p.day);
    const diffMin = h * 60 + mi - (tzH * 60 + tzM) + (d - tzD) * 1440;
    if (diffMin === 0) break;
    ms += diffMin * 60_000;
  }
  return new Date(ms).toISOString();
}
