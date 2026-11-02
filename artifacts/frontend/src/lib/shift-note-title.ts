/**
 * Titles for shift notes in lists and headers. Every note used to read
 * "Support work" (its session_type), so a history was a column of identical
 * rows; these name what makes each one different: the participant, the day,
 * the actual times and who worked it. Same rules as the worker app's
 * lib/shift-note-title.ts.
 */

export type ShiftNoteLike = {
  session_date?: string | null;
  start_time?: string | null;
  started_at?: string | null;
  end_time?: string | null;
  ended_at?: string | null;
  duration_minutes?: number | null;
  participant_name?: string | null;
  participants?: { full_name?: string | null } | null;
  worker_name?: string | null;
};

function parse(value?: string | null): Date | null {
  if (!value) return null;
  // A bare date is a calendar day, not midnight UTC (which is the day before in Australia).
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clock(d: Date): string {
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
}

function start(n: ShiftNoteLike) {
  return parse(n.started_at || n.start_time);
}

function end(n: ShiftNoteLike) {
  return parse(n.ended_at || n.end_time);
}

/** Overnight shifts: " next day", or the end date when later still. */
function endsLater(s: Date, e: Date): string {
  const days = Math.round((new Date(e).setHours(0, 0, 0, 0) - new Date(s).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "";
  if (days === 1) return " next day";
  return ` on ${e.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}`;
}

/** "Sat 31 Oct", with the year when it isn't this year. */
export function shiftNoteDay(n: ShiftNoteLike): string | null {
  const d = start(n) ?? parse(n.session_date);
  if (!d) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function durationText(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ${h === 1 ? "hour" : "hours"}` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

/** "10:14 am to 1:17 pm", or the length when the times weren't recorded. */
export function shiftNoteTimes(n: ShiftNoteLike): string | null {
  const s = start(n);
  const e = end(n);
  if (s && e) return `${clock(s)} to ${clock(e)}${endsLater(s, e)}`;
  if (s) return `from ${clock(s)}`;
  return durationText(n.duration_minutes);
}

export function shiftNoteParticipant(n: ShiftNoteLike): string | null {
  return n.participant_name || n.participants?.full_name || null;
}

/**
 * The row's main line. `participant: false` where the list is already one
 * participant's history, so the day leads.
 */
export function shiftNoteTitle(n: ShiftNoteLike, { participant = true }: { participant?: boolean } = {}): string {
  const day = shiftNoteDay(n);
  const name = participant ? shiftNoteParticipant(n) : null;
  return [name, day].filter(Boolean).join(" · ") || "Shift note";
}

/** The line under it: the times, then who worked it unless that's the viewer. */
export function shiftNoteSubtitle(n: ShiftNoteLike, { worker = true }: { worker?: boolean } = {}): string {
  return [shiftNoteTimes(n), worker ? n.worker_name : null].filter(Boolean).join(" · ");
}
