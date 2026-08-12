function formatUnit(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  const abs = Math.abs(value);
  const plural = abs === 1 ? unit : `${unit}s`;
  if (value === 0) return `this ${unit}`;
  if (value < 0) return `${abs} ${plural} ago`;
  return `in ${abs} ${plural}`;
}

function formatWithIntl(diffSec: number): string | null {
  const RelativeTimeFormat = (
    globalThis as typeof globalThis & {
      Intl?: { RelativeTimeFormat?: typeof Intl.RelativeTimeFormat };
    }
  ).Intl?.RelativeTimeFormat;

  if (typeof RelativeTimeFormat !== "function") {
    return null;
  }

  try {
    const rtf = new RelativeTimeFormat("en", { numeric: "auto" });
    const absSec = Math.abs(diffSec);

    if (absSec < 60) return rtf.format(diffSec, "second");
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
    const diffHour = Math.round(diffSec / 3600);
    if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
    const diffDay = Math.round(diffSec / 86400);
    if (Math.abs(diffDay) < 30) return rtf.format(diffDay, "day");
    const diffMonth = Math.round(diffSec / (86400 * 30));
    if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month");
    return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
  } catch {
    return null;
  }
}

function formatFallback(diffSec: number): string {
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return formatUnit(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return formatUnit(diffMin, "minute");
  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) return formatUnit(diffHour, "hour");
  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 30) return formatUnit(diffDay, "day");
  const diffMonth = Math.round(diffSec / (86400 * 30));
  if (Math.abs(diffMonth) < 12) return formatUnit(diffMonth, "month");
  return formatUnit(Math.round(diffSec / (86400 * 365)), "year");
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;

  const diffSec = Math.round((then - Date.now()) / 1000);
  return formatWithIntl(diffSec) ?? formatFallback(diffSec);
}
