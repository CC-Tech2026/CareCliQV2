import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, FileSpreadsheet, FileText, Loader2, Moon } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { LoadError, PageHeader, SearchField, SkeletonBlocks, Surface, ctaClass, rowClass } from "@/components/layout/PageKit";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { appTodayKey } from "@/lib/datetime";
import {
  downloadPayrollHours, getPayrollTimesheets, type PayrollShift,
} from "@/services/payrollService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const WARN = "var(--cc-amber)";
const DANGER = "var(--cc-danger-text)";

const EH_PAGE = "/settings?section=integrations&integration=employment-hero";
const FREQUENCY_KEY = "carecliq-payroll-frequency";
/** Staying on a few minutes is normal; from this many it's worth a look. */
const LATE_MINUTES = 15;

export type Frequency = "weekly" | "fortnightly";

// ── Dates ("YYYY-MM-DD" in the organisation's calendar) ────────────────────

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(key: string, days: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The pay period `offset` periods from the one containing today (0 = the
 *  current one, -1 = the last finished one). Weeks run Monday to Sunday,
 *  the default in payroll systems; a fortnight is two of them. */
export function payPeriod(frequency: Frequency, today: string, offset: number): { start: string; end: string } {
  const monday = addDays(today, -((parseKey(today).getUTCDay() + 6) % 7));
  if (frequency === "weekly") {
    const start = addDays(monday, 7 * offset);
    return { start, end: addDays(start, 6) };
  }
  const end = addDays(monday, 14 * offset + 13);
  return { start: addDays(end, -13), end };
}

function shortDate(key: string, withYear = false): string {
  return parseKey(key).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}
function dayLabel(key: string): string {
  return parseKey(key).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "09:05" -> "9:05am". */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** 220 -> "3h 40m". */
export function duration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function readFrequency(): Frequency {
  try {
    return window.localStorage.getItem(FREQUENCY_KEY) === "fortnightly" ? "fortnightly" : "weekly";
  } catch {
    return "weekly";
  }
}

// ── Per worker ──────────────────────────────────────────────────────────────

type WorkerHours = {
  key: string;
  name: string;
  email?: string | null;
  shifts: PayrollShift[];
  minutes: number;
  sleepovers: number;
  late: number;
  failed: number;
};

function byWorker(shifts: PayrollShift[]): WorkerHours[] {
  const map = new Map<string, WorkerHours>();
  for (const s of shifts) {
    const key = s.worker_id ?? s.worker_name;
    const row = map.get(key) ?? { key, name: s.worker_name, email: s.worker_email, shifts: [], minutes: 0, sleepovers: 0, late: 0, failed: 0 };
    row.shifts.push(s);
    row.minutes += s.worked_minutes || 0;
    if (s.sleepover) row.sleepovers += 1;
    if (s.over_roster_minutes >= LATE_MINUTES) row.late += 1;
    if (s.payroll?.status === "failed") row.failed += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function notesFor(w: WorkerHours): string {
  if (w.failed) return `${plural(w.failed, "shift")} not sent to Employment Hero`;
  return [
    w.sleepovers ? plural(w.sleepovers, "sleepover") : "",
    w.late ? `Stayed late on ${plural(w.late, "shift")}` : "",
  ].filter(Boolean).join(" · ");
}

// ── A worker's shifts, in the side panel ───────────────────────────────────

function ShiftDetail({ shift }: { shift: PayrollShift }) {
  const pieces = shift.periods.length > 1 ? shift.periods : [];
  return (
    <li className="space-y-1 py-3" style={{ borderColor: BORDER }}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: TEXT }}>{dayLabel(shift.date)}</p>
        <p className="text-sm font-semibold tabular-nums" style={{ color: TEXT }}>{duration(shift.worked_minutes)}</p>
      </div>
      <p className="text-sm tabular-nums" style={{ color: MUTED }}>
        {clock(shift.start.slice(11, 16))} to {clock(shift.end.slice(11, 16))}
        {shift.participant ? ` · with ${shift.participant}` : ""}
      </p>
      {pieces.length > 0 && (
        <ul className="space-y-0.5 text-xs" style={{ color: MUTED }}>
          {pieces.map((p) => (
            <li key={p.start} className="flex items-center gap-1.5">
              {p.kind === "sleepover" && <Moon size={12} />}
              {p.kind === "sleepover" ? "Sleepover" : "Active"} {clock(p.start.slice(11, 16))} to {clock(p.end.slice(11, 16))}
            </li>
          ))}
        </ul>
      )}
      {[
        shift.over_roster_minutes >= 1 ? `${duration(shift.over_roster_minutes)} longer than rostered` : "",
        shift.break_minutes > 0 ? `${duration(shift.break_minutes)} break` : "",
        shift.travel_km > 0 ? `${shift.travel_km} km travel` : "",
        shift.source === "roster" ? "No clock-in, so the rostered times are used" : "",
      ].filter(Boolean).map((note) => (
        <p key={note} className="text-xs" style={{ color: note.startsWith("No clock") ? WARN : MUTED }}>{note}</p>
      ))}
      {shift.payroll?.status === "failed" && (
        <p className="text-xs font-medium" style={{ color: DANGER }}>Not sent: {shift.payroll.error || "Employment Hero said no."}</p>
      )}
    </li>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

// The Notes column only when someone has a note, so the table stays tight.
const GRID_NOTES = "sm:grid-cols-[minmax(0,1fr)_5rem_6rem_minmax(0,1fr)_1.25rem]";
const GRID_PLAIN = "sm:grid-cols-[minmax(0,1fr)_5rem_6rem_1.25rem]";

/** Payroll: one table of the hours each worker worked in a pay period, and
 *  an Export button. Only approved shifts count. CareCliQ doesn't work out
 *  pay; the provider's payroll applies the award. */
export default function PayrollTimesheetsPage() {
  const { toast } = useToast();
  const today = appTodayKey();
  const [frequency, setFrequency] = useState<Frequency>(readFrequency);
  const [offset, setOffset] = useState(-1);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<WorkerHours | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(FREQUENCY_KEY, frequency);
    } catch {
      /* a remembered choice is a convenience only */
    }
  }, [frequency]);

  const range = payPeriod(frequency, today, offset);
  const query = useOrgQuery(["payroll-timesheets", range.start, range.end], {
    queryFn: () => getPayrollTimesheets(range.start, range.end),
  });
  const data = query.data;
  const workers = useMemo(() => byWorker(data?.shifts ?? []), [data]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? workers.filter((w) => [w.name, w.email].some((v) => (v ?? "").toLowerCase().includes(needle))) : workers;
  }, [workers, search]);
  const totalMinutes = workers.reduce((sum, w) => sum + w.minutes, 0);
  const hasNotes = workers.some((w) => notesFor(w));
  const GRID = hasNotes ? GRID_NOTES : GRID_PLAIN;
  const waiting = data?.waiting.length ?? 0;
  const failed = data?.totals.attention ?? 0;

  async function exportAs(format: "xlsx" | "csv") {
    setDownloading(true);
    try {
      await downloadPayrollHours(range.start, range.end, format);
    } catch (err) {
      toast({ title: "Couldn't export the hours", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  const period = (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-full border bg-cc-surface" style={{ borderColor: BORDER }} role="group" aria-label="Pay period">
        <button type="button" aria-label="Previous pay period" onClick={() => setOffset((o) => o - 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-cc-soft" style={{ color: TEXT }}>
          <ChevronLeft size={17} />
        </button>
        <span className="min-w-[9.5rem] text-center text-sm font-medium tabular-nums" style={{ color: TEXT }} aria-live="polite">
          {shortDate(range.start)} to {shortDate(range.end)}
        </span>
        <button type="button" aria-label="Next pay period" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-cc-soft disabled:opacity-30" style={{ color: TEXT }}>
          <ChevronRight size={17} />
        </button>
      </div>
      <select
        aria-label="How often you pay"
        value={frequency}
        onChange={(e) => { setFrequency(e.target.value as Frequency); setOffset(-1); }}
        className="h-10 rounded-full border bg-cc-surface px-3 text-sm"
        style={{ borderColor: BORDER, color: TEXT }}
      >
        <option value="weekly">Weekly</option>
        <option value="fortnightly">Fortnightly</option>
      </select>
    </div>
  );

  const exportButton = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={ctaClass} disabled={downloading || !workers.length}>
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export
          <ChevronDown size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => void exportAs("xlsx")} className="items-start gap-2.5 py-2">
          <FileSpreadsheet size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">Excel spreadsheet</span>
            <span className="block text-xs" style={{ color: MUTED }}>To check or send to your bookkeeper</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportAs("csv")} className="items-start gap-2.5 py-2">
          <FileText size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">CSV file</span>
            <span className="block text-xs" style={{ color: MUTED }}>To import into payroll software</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4 pb-10">
      <PageHeader
        eyebrow="Finance"
        title="Payroll"
        description="Hours worked by each staff member in a pay period, from approved timesheets. Staff are paid for the time they worked, clock-in to clock-out. Export the hours for your payroll software or bookkeeper; your payroll works out the pay."
        actions={<>{period}{exportButton}</>}
      />

      {query.isLoading ? (
        <SkeletonBlocks count={2} />
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()}>
          {query.error instanceof Error ? query.error.message : "The hours couldn't be loaded."}
        </LoadError>
      ) : data ? (
        <>
          {waiting > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-4 py-2.5 text-sm"
              style={{ background: "var(--cc-status-warning-bg)", color: TEXT }}>
              <CircleAlert size={16} style={{ color: WARN }} />
              {plural(waiting, "shift")} in this period {waiting === 1 ? "isn't" : "aren't"} approved yet, so {waiting === 1 ? "it's" : "they're"} not included.
              <Link href="/coordinator/verification" className="font-semibold underline">Approve timesheets</Link>
            </p>
          )}
          {failed > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-4 py-2.5 text-sm"
              style={{ background: "var(--cc-status-danger-bg)", color: TEXT }}>
              <CircleAlert size={16} style={{ color: DANGER }} />
              {plural(failed, "shift")} couldn't be sent to Employment Hero.
              <Link href={EH_PAGE} className="font-semibold underline">See why</Link>
            </p>
          )}

          {workers.length === 0 ? (
            <div className="rounded-2xl bg-cc-surface px-6 py-12 text-center">
              <Clock size={24} className="mx-auto mb-2" style={{ color: MUTED }} />
              <p className="text-base font-semibold" style={{ color: TEXT }}>No approved hours in this period</p>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>Hours show here once timesheets are approved.</p>
            </div>
          ) : (
            <>
              {workers.length > 8 && (
                <SearchField value={search} onChange={setSearch} label="Find a staff member" placeholder="Find a staff member" />
              )}
              <Surface>
                <div className={`hidden gap-3 border-b px-5 py-2.5 text-xs font-semibold uppercase tracking-wide sm:grid ${GRID}`}
                  style={{ borderColor: BORDER, color: MUTED }}>
                  <span>Staff member</span><span className="text-right">Shifts</span><span className="text-right">Hours</span>{hasNotes && <span>Notes</span>}<span />
                </div>
                <ul className="divide-y" style={{ borderColor: BORDER }}>
                  {shown.map((w) => (
                    <li key={w.key}>
                      <button type="button" onClick={() => setOpen(w)} className={`${rowClass} sm:grid ${GRID}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{w.name}</span>
                          <span className="block truncate text-xs sm:hidden" style={{ color: w.failed ? DANGER : MUTED }}>
                            {[plural(w.shifts.length, "shift"), notesFor(w)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="hidden text-right text-sm tabular-nums sm:block" style={{ color: TEXT }}>{w.shifts.length}</span>
                        <span className="text-right text-sm font-semibold tabular-nums" style={{ color: TEXT }}>{duration(w.minutes)}</span>
                        {hasNotes && (
                          <span className="hidden min-w-0 truncate text-sm sm:block" style={{ color: w.failed ? DANGER : MUTED }}>{notesFor(w)}</span>
                        )}
                        <ChevronRight size={16} className="shrink-0" style={{ color: MUTED }} />
                      </button>
                    </li>
                  ))}
                  {shown.length === 0 && <li className="px-5 py-4 text-sm" style={{ color: MUTED }}>No one matches "{search}".</li>}
                </ul>
                <div className={`flex items-center gap-3 border-t px-4 py-3 text-sm font-semibold sm:grid sm:px-5 ${GRID}`}
                  style={{ borderColor: BORDER, color: TEXT, background: "var(--cc-soft)" }}>
                  <span className="flex-1">Total · {plural(workers.length, "staff member")}</span>
                  <span className="hidden text-right tabular-nums sm:block">{data.totals.shifts}</span>
                  <span className="text-right tabular-nums">{duration(totalMinutes)}</span>
                  {hasNotes && <span className="hidden sm:block" />}<span className="hidden w-4 sm:block" />
                </div>
              </Surface>
              {!data.connected.employment_hero && (
                <p className="text-xs" style={{ color: MUTED }}>
                  Use Employment Hero? <Link href={EH_PAGE} className="font-medium underline" style={{ color: TEXT }}>Connect it</Link> and approved hours are sent automatically.
                </p>
              )}
            </>
          )}
        </>
      ) : null}

      <SidePanel
        open={!!open}
        onOpenChange={(o) => { if (!o) setOpen(null); }}
        icon={Clock}
        eyebrow={`${shortDate(range.start)} to ${shortDate(range.end, true)}`}
        title={open?.name ?? ""}
        description={open ? `${plural(open.shifts.length, "approved shift")} · ${duration(open.minutes)} worked` : undefined}
      >
        {open && (
          <ul className="divide-y" style={{ borderColor: BORDER }}>
            {open.shifts.map((s) => <ShiftDetail key={s.shift_id} shift={s} />)}
          </ul>
        )}
      </SidePanel>
    </div>
  );
}
