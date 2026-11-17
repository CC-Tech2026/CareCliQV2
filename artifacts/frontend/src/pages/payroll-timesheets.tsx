import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CalendarRange, Download, Loader2 } from "lucide-react";
import {
  EmptyState, LoadError, Notice, PageHeader, PillTabs, RowList, SearchField, SkeletonBlocks, StatusText,
  SummaryStrip, Surface, ctaClass, outlineClass, type SummaryItem, type Tone,
} from "@/components/layout/PageKit";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { appTodayKey } from "@/lib/datetime";
import { downloadPayrollCsv, getPayrollTimesheets, type PayrollShift } from "@/services/payrollService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

type PeriodKey = "this_week" | "last_week" | "last_fortnight" | "custom";

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "last_fortnight", label: "Last fortnight" },
  { key: "custom", label: "Choose dates" },
];

// ── Dates ("YYYY-MM-DD", the organisation's local calendar) ────────────────

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(key: string, days: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toKey(d);
}

/** Pay weeks run Monday to Sunday: the SCHADS default in payroll systems. */
export function periodFor(choice: Exclude<PeriodKey, "custom">, today: string): { start: string; end: string } {
  const weekday = (parseKey(today).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -weekday);
  if (choice === "this_week") return { start: monday, end: addDays(monday, 6) };
  if (choice === "last_week") return { start: addDays(monday, -7), end: addDays(monday, -1) };
  return { start: addDays(monday, -14), end: addDays(monday, -1) };
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

const PAYROLL_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "In Employment Hero", tone: "good" },
  paid: { label: "Paid in Employment Hero", tone: "good" },
  failed: { label: "Needs attention", tone: "danger" },
  removed: { label: "Removed from Employment Hero", tone: "neutral" },
  waiting: { label: "Waiting to send", tone: "warning" },
};

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warning" | "info" }) {
  const bg = tone === "warning" ? "var(--cc-status-warning-bg)" : tone === "info" ? "var(--cc-status-info-bg)" : "var(--cc-soft)";
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: bg, color: TEXT }}>
      {children}
    </span>
  );
}

function ShiftRow({ shift }: { shift: PayrollShift }) {
  const status = shift.payroll ? PAYROLL_STATUS[shift.payroll.status] : null;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5" style={{ borderColor: BORDER }}>
      <div className="w-28 shrink-0">
        <p className="text-sm font-medium" style={{ color: TEXT }}>{dayLabel(shift.date)}</p>
        <p className="text-xs" style={{ color: MUTED }}>{shift.participant || "No participant"}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm tabular-nums" style={{ color: TEXT }}>
          {clock(shift.start.slice(11, 16))} to {clock(shift.end.slice(11, 16))}
          <span className="ml-2 font-semibold">{duration(shift.worked_minutes)}</span>
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {shift.sleepover && <Tag tone="info">Sleepover</Tag>}
          {/* A few minutes either side is normal; a real overrun stands out. */}
          {shift.over_roster_minutes >= 1 && (
            <Tag tone={shift.over_roster_minutes >= 15 ? "warning" : "neutral"}>{duration(shift.over_roster_minutes)} over roster</Tag>
          )}
          {shift.source === "roster" && <Tag tone="warning">Rostered times, no clock-in</Tag>}
          {shift.break_minutes > 0 && <Tag>Break {duration(shift.break_minutes)}</Tag>}
          {shift.travel_km > 0 && <Tag>{shift.travel_km} km</Tag>}
        </div>
        {shift.payroll?.status === "failed" && shift.payroll.error && (
          <p className="mt-1 text-xs" style={{ color: "var(--cc-danger-text)" }}>{shift.payroll.error}</p>
        )}
      </div>
      {status && <StatusText tone={status.tone}>{status.label}</StatusText>}
    </li>
  );
}

/** Timesheets for payroll: a pay period's approved shifts with the time each
 *  worker worked (not the billed time), and a CSV for any payroll system. */
export default function PayrollTimesheetsPage() {
  const { toast } = useToast();
  const today = appTodayKey();
  const [choice, setChoice] = useState<PeriodKey>("last_week");
  const [custom, setCustom] = useState(() => periodFor("last_week", today));
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  const range = choice === "custom" ? custom : periodFor(choice, today);
  const rangeOk = !!range.start && !!range.end && range.start <= range.end;
  const query = useOrgQuery(["payroll-timesheets", range.start, range.end], {
    queryFn: () => getPayrollTimesheets(range.start, range.end),
    enabled: rangeOk,
  });
  const data = query.data;

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const shown = (data?.shifts ?? []).filter((s) =>
      !needle || [s.worker_name, s.worker_email, s.participant].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
    const byWorker = new Map<string, PayrollShift[]>();
    for (const s of shown) {
      const key = s.worker_id ?? s.worker_name;
      byWorker.set(key, [...(byWorker.get(key) ?? []), s]);
    }
    return [...byWorker.values()].sort((a, b) => a[0].worker_name.localeCompare(b[0].worker_name));
  }, [data, search]);

  async function download() {
    setDownloading(true);
    try {
      await downloadPayrollCsv(range.start, range.end);
    } catch (err) {
      toast({ title: "Couldn't download the CSV", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  const totals = data?.totals;
  const chips: SummaryItem[] = totals
    ? [
        { value: totals.shifts, label: totals.shifts === 1 ? "approved shift" : "approved shifts" },
        { value: totals.hours.toLocaleString("en-AU", { maximumFractionDigits: 2 }), label: "hours worked" },
        { value: totals.workers, label: totals.workers === 1 ? "worker" : "workers" },
        ...(data?.connected.employment_hero
          ? [
              { value: totals.sent, label: "in Employment Hero", tone: "good" as Tone },
              ...(totals.attention ? [{ value: totals.attention, label: "need attention", tone: "danger" as Tone }] : []),
            ]
          : []),
      ]
    : [];

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        eyebrow="Finance"
        title="Payroll timesheets"
        description="Approved shifts for a pay period, with the time each worker worked: clock-in to clock-out, including any time over the roster. CareCliQ doesn't calculate pay. Your payroll system applies the award. Download the CSV for your payroll, or connect Employment Hero to send them automatically."
        actions={
          <button type="button" className={ctaClass} onClick={() => void download()} disabled={!rangeOk || downloading || !totals?.shifts}>
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download CSV
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PillTabs label="Pay period" options={PERIOD_OPTIONS} value={choice} onChange={(key) => {
          if (key === "custom" && choice !== "custom") setCustom(range);
          setChoice(key);
        }} />
        {choice === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: MUTED }}>
            <input type="date" aria-label="Period start" value={custom.start} max={custom.end || undefined}
              onChange={(e) => setCustom({ ...custom, start: e.target.value })}
              className="h-10 rounded-full border bg-cc-surface px-3 text-sm" style={{ borderColor: BORDER, color: TEXT }} />
            to
            <input type="date" aria-label="Period end" value={custom.end} min={custom.start || undefined}
              onChange={(e) => setCustom({ ...custom, end: e.target.value })}
              className="h-10 rounded-full border bg-cc-surface px-3 text-sm" style={{ borderColor: BORDER, color: TEXT }} />
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-sm" style={{ color: MUTED }}>
            <CalendarRange size={15} /> {dayLabel(range.start)} to {dayLabel(range.end)}
          </p>
        )}
      </div>

      {!rangeOk ? (
        <LoadError>Choose a start date on or before the end date.</LoadError>
      ) : query.isLoading ? (
        <SkeletonBlocks count={3} />
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()}>
          {query.error instanceof Error ? query.error.message : "The timesheets couldn't be loaded."}
        </LoadError>
      ) : data ? (
        <>
          <SummaryStrip items={chips} />

          {data.waiting.length > 0 && (
            <Notice
              tone="warning"
              icon={AlertTriangle}
              title={`${data.waiting.length} finished ${data.waiting.length === 1 ? "shift isn't" : "shifts aren't"} approved yet`}
              action={<Link href="/coordinator/verification" className={outlineClass}>Review timesheets</Link>}
            >
              {data.waiting.length === 1 ? "It isn't" : "They aren't"} in the CSV or sent to payroll until approved
              {": "}
              {data.waiting.slice(0, 4).map((w) => `${w.worker_name ?? "Unknown"} on ${dayLabel(w.date)}`).join(", ")}
              {data.waiting.length > 4 ? `, and ${data.waiting.length - 4} more.` : "."}
            </Notice>
          )}

          {data.shifts.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="No approved shifts in this period"
              body="Shifts appear here once a coordinator approves their timesheet."
            />
          ) : (
            <>
              <SearchField value={search} onChange={setSearch} label="Search timesheets" placeholder="Search by worker or participant" />
              {groups.length === 0 ? (
                <p className="text-sm" style={{ color: MUTED }}>No one matches "{search}".</p>
              ) : (
                groups.map((shifts) => {
                  const minutes = shifts.reduce((sum, s) => sum + (s.worked_minutes || 0), 0);
                  const first = shifts[0];
                  return (
                    <Surface key={first.worker_id ?? first.worker_name}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-5" style={{ borderColor: BORDER }}>
                        <div className="min-w-0">
                          <h2 className="text-base font-semibold" style={{ color: TEXT }}>{first.worker_name}</h2>
                          {first.worker_email && <p className="truncate text-xs" style={{ color: MUTED }}>{first.worker_email}</p>}
                        </div>
                        <p className="text-sm tabular-nums" style={{ color: MUTED }}>
                          {shifts.length} {shifts.length === 1 ? "shift" : "shifts"} · <span className="font-semibold" style={{ color: TEXT }}>{duration(minutes)}</span>
                        </p>
                      </div>
                      <RowList>
                        {shifts.map((s) => <ShiftRow key={s.shift_id} shift={s} />)}
                      </RowList>
                    </Surface>
                  );
                })
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
