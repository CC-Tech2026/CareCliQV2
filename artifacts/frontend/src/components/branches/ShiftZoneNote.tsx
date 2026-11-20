import { formatAppTime, isOtherBranchZone, zoneAbbreviation, zoneCityName } from "@/lib/datetime";

/**
 * Under a shift's date and time fields: which clock the times are on, when
 * the shift's place is in a different zone from the person entering them.
 * "Times are in Melbourne time (AEDT). 9:00 am there is 8:30 am for you."
 * Nothing when the zones match, so single-office providers never see it.
 */
export function ShiftZoneNote({ tz, sampleIso, className = "" }: {
  /** The shift's zone (its participant's branch). */
  tz?: string | null;
  /** A time in the form, to show the viewer's equivalent. */
  sampleIso?: string | null;
  className?: string;
}) {
  if (!isOtherBranchZone(tz)) return null;
  const at = sampleIso && !Number.isNaN(new Date(sampleIso).getTime()) ? sampleIso : new Date().toISOString();
  const there = formatAppTime(at, tz);
  const here = formatAppTime(at);
  return (
    <p className={`text-sm text-cc-muted ${className}`} role="note">
      Times are in {zoneCityName(tz)} time ({zoneAbbreviation(at, tz)}), where the support happens.
      {sampleIso && there !== here ? ` ${there} there is ${here} for you.` : ""}
    </p>
  );
}
