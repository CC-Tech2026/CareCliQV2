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

/** What a worker record needs for telling same-named staff apart. */
export type WorkerIdentity = {
  full_name: string;
  employee_id?: string | null;
  suburb?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** The short line that tells one worker from another: staff ID and suburb
 * ("ID 1042 · Glenelg"), else their email. Null when there's nothing. */
export function workerDetail(worker: WorkerIdentity): string | null {
  const parts = [worker.employee_id ? `ID ${worker.employee_id}` : null, worker.suburb?.trim() || null].filter(
    (p): p is string => !!p,
  );
  if (parts.length) return parts.join(" · ");
  return worker.email?.trim() || null;
}

/** Everything a search box should look at for a worker, so typing a staff
 * ID, suburb, phone or email finds them as well as their name. */
export function workerSearchText(worker: WorkerIdentity): string {
  return [worker.full_name, worker.employee_id, worker.suburb, worker.email, worker.phone].filter(Boolean).join(" ");
}

/** The worker's detail when their name is held by someone else in the list. */
export function detailIfShared(worker: WorkerIdentity, shared: Set<string>): string | null {
  return shared.has(worker.full_name.trim().toLowerCase()) ? workerDetail(worker) : null;
}

/** "Aisha Rahman" to "Aisha R", for narrow roster columns. */
export function shortWorkerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : parts[0] ?? "";
}

/** What each worker's roster column is headed with: the short name when no
 * one else shortens to it (two "Sam N"s get their full names), and their
 * staff ID or suburb when someone else has exactly the same name. Worked
 * out over the whole team, so a column never looks like someone it isn't
 * even while the other person is filtered out. */
export function rosterLabels(workers: (WorkerIdentity & { id: string })[]): Map<string, { short: string; full: string; detail: string | null }> {
  const shortCounts = new Map<string, Set<string>>();
  for (const w of workers) {
    const key = shortWorkerName(w.full_name).toLowerCase();
    const fulls = shortCounts.get(key) ?? new Set<string>();
    fulls.add(w.full_name.trim().toLowerCase());
    shortCounts.set(key, fulls);
  }
  const same = sharedNames(workers.map((w) => w.full_name));
  const labels = new Map<string, { short: string; full: string; detail: string | null }>();
  for (const w of workers) {
    const short = shortWorkerName(w.full_name);
    const clash = (shortCounts.get(short.toLowerCase())?.size ?? 0) > 1;
    labels.set(w.id, { short: clash ? w.full_name : short, full: w.full_name, detail: detailIfShared(w, same) });
  }
  return labels;
}
