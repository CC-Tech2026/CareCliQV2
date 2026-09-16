import { isOtherBranchZone, zoneAbbreviation } from "@/lib/datetime";

/**
 * Short zone tag (e.g. "AEST") shown next to a time whose branch differs
 * from the viewer's own — so a Melbourne 5:00 pm is never misread as an
 * Adelaide 5:00 pm. Renders nothing when the zones match (or when `always`
 * is not set and no zone is known).
 */
export function ZoneLabel({
  tz,
  at,
  always = false,
  className = "",
}: {
  /** IANA zone of the record (e.g. shift.timezone). */
  tz?: string | null;
  /** Instant the abbreviation is evaluated at (DST-aware); defaults to now. */
  at?: string | Date;
  /** Show even when the zone matches the viewer's. */
  always?: boolean;
  className?: string;
}) {
  if (!always && !isOtherBranchZone(tz)) return null;
  const label = zoneAbbreviation(at ?? new Date(), tz);
  if (!label) return null;
  return (
    <span
      className={`inline-block align-middle rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
      style={{ background: "var(--cc-plum-soft, #efe6f7)", color: "var(--cc-plum, #5b2a86)" }}
      title={tz ?? undefined}
      aria-label={`Time shown in ${tz}`}
    >
      {label}
    </span>
  );
}
