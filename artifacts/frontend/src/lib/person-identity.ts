// Telling people apart in long lists. Two participants (or two workers) can
// share a name, so lists show what makes each one theirs (age, suburb, NDIS
// or staff number) and search looks at all of it, not just the name.

/** Whole years since a date of birth, or null when it isn't a real date. */
export function ageFrom(dob?: string | null, today = new Date()): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  let age = today.getFullYear() - born.getFullYear();
  const beforeBirthday =
    today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** "15 Jan 1941" */
export function formatBirthDate(dob?: string | null): string | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  return born.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const STATE_POSTCODE = /^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)?\s*\d{4}$/i;

/** The suburb from a one-line address: "12 Smith St, Glenelg, SA 5045" gives
 * "Glenelg". Null when the address doesn't split into parts. */
export function suburbFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  if (STATE_POSTCODE.test(last)) return parts.length >= 3 ? parts[parts.length - 2] : null;
  // "Glenelg SA 5045" as the last part.
  const tail = last.replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)?\s*\d{4}$/i, "").trim();
  return tail && tail !== last ? tail : null;
}

/** Ways someone might type a date of birth: 1941-01-15, 15/01/1941, 15/1/1941. */
function birthDateForms(dob?: string | null): string[] {
  if (!dob) return [];
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!match) return [dob];
  const [, y, m, d] = match;
  return [`${y}-${m}-${d}`, `${d}/${m}/${y}`, `${Number(d)}/${Number(m)}/${y}`];
}

/** True when every word of the query appears in one of the fields (or a form
 * of the date of birth). Numbers match with or without spaces, so
 * "4300 00001" finds NDIS 430000001 and "0400" finds a phone number. */
export function matchesPerson(
  query: string,
  fields: (string | null | undefined)[],
  dob?: string | null,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [...fields, ...birthDateForms(dob)]
    .filter((f): f is string => !!f)
    .map((f) => f.toLowerCase());
  const squashed = haystack.map((f) => f.replace(/\s+/g, ""));
  const qSquashed = q.replace(/\s+/g, "");
  if (/\d/.test(qSquashed) && squashed.some((f) => f.includes(qSquashed))) return true;
  return q.split(/\s+/).every((word) => haystack.some((f) => f.includes(word)));
}

/** Names held by more than one person in the list, lower-cased. */
export function sharedNames(names: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
}
