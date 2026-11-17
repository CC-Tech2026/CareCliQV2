import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, Loader2, Moon } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import {
  LoadError, PageHeader, PillTabs, SearchField, SkeletonBlocks, Surface, ctaClass, outlineClass, rowClass,
} from "@/components/layout/PageKit";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { appTodayKey } from "@/lib/datetime";
import {
  downloadPayrollHours, getPayrollTimesheets, type PayrollPeriodData, type PayrollShift,
} from "@/services/payrollService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const GOOD = "var(--cc-green)";
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
  sent: number;
};

function byWorker(shifts: PayrollShift[]): WorkerHours[] {
  const map = new Map<string, WorkerHours>();
  for (const s of shifts) {
    const key = s.worker_id ?? s.worker_name;
    const row = map.get(key) ?? { key, name: s.worker_name, email: s.worker_email, shifts: [], minutes: 0, sleepovers: 0, late: 0, failed: 0, sent: 0 };
    row.shifts.push(s);
    row.minutes += s.worked_minutes || 0;
    if (s.sleepover) row.sleepovers += 1;
    if (s.over_roster_minutes >= LATE_MINUTES) row.late += 1;
    if (s.payroll?.status === "failed") row.failed += 1;
    if (s.payroll?.status === "sent" || s.payroll?.status === "paid") row.sent += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function notesFor(w: WorkerHours): string {
  return [
    w.sleepovers ? plural(w.sleepovers, "sleepover") : "",
    w.late ? `Stayed late on ${plural(w.late, "shift")}` : "",
  ].filter(Boolean).join(" · ");
}

// ── The two steps ───────────────────────────────────────────────────────────

function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 gap-3 rounded-2xl bg-cc-surface p-5" aria-label={title}>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        style={done ? { background: "var(--cc-status-success-bg, var(--cc-soft))", color: GOOD } : { background: "var(--cc-soft)", color: TEXT }}
        aria-hidden
      >
        {done ? <CheckCircle2 size={18} /> : number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function ApproveStep({ data }: { data: PayrollPeriodData }) {
  const waiting = data.waiting.length;
  if (!waiting) {
    return (
      <Step number={1} title="Approve timesheets" done={data.shifts.length > 0}>
        <p className="text-sm" style={{ color: MUTED }}>
          {data.shifts.length ? "Every finished shift in this period is approved." : "No shifts were worked in this period."}
        </p>
      </Step>
    );
  }
  const names = [...new Set(data.waiting.map((w) => w.worker_name ?? "Unknown"))];
  return (
    <Step number={1} title="Approve timesheets" done={false}>
      <p className="text-sm font-medium" style={{ color: WARN }}>{plural(waiting, "shift")} still to approve</p>
      <p className="text-sm" style={{ color: MUTED }}>
        {names.slice(0, 3).join(", ")}{names.length > 3 ? ` and ${names.length - 3} more` : ""}. They're left out until approved.
      </p>
      <Link href="/coordinator/verification" className={`${ctaClass} w-full sm:w-auto`}>Approve timesheets</Link>
    </Step>
  );
}

function PayrollStep({ data, downloading, onDownload }: {
  data: PayrollPeriodData;
  downloading: "xlsx" | "csv" | null;
  onDownload: (format: "xlsx" | "csv") => void;
}) {
  const { shifts, sent, attention } = data.totals;
  const download = (primary: boolean) => (
    <button
      type="button"
      className={`${primary ? ctaClass : outlineClass} w-full sm:w-auto`}
      onClick={() => onDownload("xlsx")}
      disabled={!!downloading || !shifts}
    >
      {downloading === "xlsx" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download spreadsheet
    </button>
  );
  // Payroll software that imports a CSV (KeyPay, MYOB...) wants that instead.
  const csv = (
    <button
      type="button"
      onClick={() => onDownload("csv")}
      disabled={!!downloading || !shifts}
      className="text-xs font-medium underline disabled:no-underline disabled:opacity-50"
      style={{ color: TEXT }}
    >
      {downloading === "csv" ? "Making the CSV..." : "CSV for payroll software"}
    </button>
  );

  if (data.connected.employment_hero) {
    const done = shifts > 0 && sent === shifts;
    return (
      <Step number={2} title="Send to payroll" done={done}>
        <p className="text-sm" style={{ color: MUTED }}>
          Approved shifts go to Employment Hero by themselves.{" "}
          <span style={{ color: TEXT }}>{sent} of {plural(shifts, "shift")} sent.</span>
        </p>
        {attention > 0 && (
          <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: DANGER }}>
            <CircleAlert size={15} /> {plural(attention, "shift")} couldn't be sent
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {attention > 0 && <Link href={EH_PAGE} className={ctaClass}>Fix in Employment Hero settings</Link>}
          {download(false)}
        </div>
        <p className="text-xs" style={{ color: MUTED }}>Need a different format? {csv}</p>
      </Step>
    );
  }
  return (
    <Step number={2} title="Give the hours to payroll" done={false}>
      <p className="text-sm" style={{ color: MUTED }}>
        Download a spreadsheet of everyone's hours for your payroll software or bookkeeper. Your payroll works out the pay.
      </p>
      {download(true)}
      <p className="text-xs" style={{ color: MUTED }}>
        Importing into payroll software? Use the {csv}.
      </p>
      <p className="text-xs" style={{ color: MUTED }}>
        Use Employment Hero? <Link href={EH_PAGE} className="font-medium underline" style={{ color: TEXT }}>Connect it</Link> and approved hours are sent for you.
      </p>
    </Step>
  );
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

/** Payroll: a pay period's approved hours, in two steps (approve, then get
 *  them to payroll) and a table of hours by worker. CareCliQ doesn't work
 *  out pay; the provider's payroll applies the award. */
export default function PayrollTimesheetsPage() {
  const { toast } = useToast();
  const today = appTodayKey();
  const [frequency, setFrequency] = useState<Frequency>(readFrequency);
  const [offset, setOffset] = useState(-1);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<WorkerHours | null>(null);
  const [downloading, setDownloading] = useState<"xlsx" | "csv" | null>(null);

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

  // The Notes column only when someone has a note, so the table stays tight.
  const hasNotes = workers.some((w) => w.failed || notesFor(w));
  const columns = hasNotes
    ? "sm:grid-cols-[minmax(0,1fr)_5rem_6rem_minmax(0,1fr)_1.25rem]"
    : "sm:grid-cols-[minmax(0,1fr)_5rem_6rem_1.25rem]";

  const when = offset === 0
    ? `This ${frequency === "weekly" ? "week" : "fortnight"} (so far)`
    : offset === -1 ? `Last ${frequency === "weekly" ? "week" : "fortnight"}` : null;

  async function download(format: "xlsx" | "csv") {
    setDownloading(format);
    try {
      await downloadPayrollHours(range.start, range.end, format);
    } catch (err) {
      toast({ title: "Couldn't download the hours", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        eyebrow="Finance"
        title="Payroll"
        description="The hours your staff worked in a pay period, ready for payroll. Workers are paid for the time they worked, clock-in to clock-out, even when the NDIS is billed for less. CareCliQ doesn't work out pay: your payroll software applies the award."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-cc-surface p-1" role="group" aria-label="Pay period">
          <button type="button" aria-label="Previous pay period" onClick={() => setOffset((o) => o - 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cc-soft" style={{ color: TEXT }}>
            <ChevronLeft size={18} />
          </button>
          <p className="min-w-[10.5rem] px-1 text-center leading-tight" aria-live="polite">
            <span className="block text-sm font-semibold tabular-nums" style={{ color: TEXT }}>
              {shortDate(range.start)} to {shortDate(range.end, true)}
            </span>
            {when && <span className="block text-xs" style={{ color: MUTED }}>{when}</span>}
          </p>
          <button type="button" aria-label="Next pay period" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cc-soft disabled:opacity-30" style={{ color: TEXT }}>
            <ChevronRight size={18} />
          </button>
        </div>
        <PillTabs
          label="How often you pay"
          options={[{ key: "weekly", label: "Weekly" }, { key: "fortnightly", label: "Fortnightly" }]}
          value={frequency}
          onChange={(f) => { setFrequency(f); setOffset(-1); }}
        />
      </div>

      {query.isLoading ? (
        <SkeletonBlocks count={2} />
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()}>
          {query.error instanceof Error ? query.error.message : "The hours couldn't be loaded."}
        </LoadError>
      ) : data ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <ApproveStep data={data} />
            <PayrollStep data={data} downloading={downloading} onDownload={(format) => void download(format)} />
          </div>

          {workers.length > 0 && (
            <section className="space-y-3" aria-label="Hours by worker">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: TEXT }}>Hours by worker</h2>
                  <p className="text-sm" style={{ color: MUTED }}>
                    {plural(data.totals.workers, "worker")} · {plural(data.totals.shifts, "approved shift")} ·{" "}
                    {duration(data.totals.hours * 60)} in total. Select someone to see their shifts.
                  </p>
                </div>
                {workers.length > 8 && (
                  <SearchField value={search} onChange={setSearch} label="Find a worker" placeholder="Find a worker" />
                )}
              </div>
              <Surface>
                <div className={`hidden gap-3 border-b px-5 py-2 text-xs font-semibold uppercase tracking-wide sm:grid ${columns}`}
                  style={{ borderColor: BORDER, color: MUTED }}>
                  <span>Worker</span><span className="text-right">Shifts</span><span className="text-right">Hours</span>{hasNotes && <span>Notes</span>}<span />
                </div>
                <ul className="divide-y" style={{ borderColor: BORDER }}>
                  {shown.map((w) => (
                    <li key={w.key}>
                      <button type="button" onClick={() => setOpen(w)} className={`${rowClass} sm:grid ${columns}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{w.name}</span>
                          <span className="block text-xs sm:hidden" style={{ color: MUTED }}>
                            {plural(w.shifts.length, "shift")}{notesFor(w) ? ` · ${notesFor(w)}` : ""}
                          </span>
                        </span>
                        <span className="hidden text-right text-sm tabular-nums sm:block" style={{ color: MUTED }}>{w.shifts.length}</span>
                        <span className="text-right text-sm font-semibold tabular-nums" style={{ color: TEXT }}>{duration(w.minutes)}</span>
                        {hasNotes && (
                          <span className="hidden min-w-0 truncate text-sm sm:block" style={{ color: w.failed ? DANGER : MUTED }}>
                            {w.failed ? `${plural(w.failed, "shift")} not sent` : notesFor(w) || " "}
                          </span>
                        )}
                        <ChevronRight size={16} className="shrink-0" style={{ color: MUTED }} />
                      </button>
                    </li>
                  ))}
                  {shown.length === 0 && <li className="px-5 py-4 text-sm" style={{ color: MUTED }}>No one matches "{search}".</li>}
                </ul>
              </Surface>
            </section>
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
