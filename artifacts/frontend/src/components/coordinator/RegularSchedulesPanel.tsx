/**
 * Regular schedules: each participant's standing arrangements (days, hours,
 * worker), with what's coming up, and ways to change or stop one from a
 * date. Changing one moves the shifts it made from that date; shifts someone
 * changed by hand, and anything already started or done, stay as they are.
 */
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Loader2, Plus, Repeat } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TimePicker } from "@/components/ui/time-picker";
import { Button } from "@/components/ui/button";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { detailIfShared, matchesPerson, sharedNames, workerDetail, workerSearchText } from "@/lib/person-identity";
import { appTodayKey, displayDate, formatAppTime, isOtherBranchZone, zoneAbbreviation, zonedDate } from "@/lib/datetime";
import {
  changeShiftSeries,
  endShiftSeries,
  listShiftSeries,
  type SeriesOpened,
  type SeriesSkipped,
  type ShiftSeries,
  type ShiftSeriesChange,
  type WorkerStats,
} from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Today in the user's business location, not wherever the computer is.
const today = () => appTodayKey();
const hhmm = (t: string) => t.slice(0, 5);
const dayText = (iso: string) => format(displayDate(iso), "EEE d MMM");

/** What happened, after a schedule is started or changed. */
export function SeriesOutcome({
  summary, made = 0, changed = 0, removed = 0, leftAlone = 0, opened, skipped,
}: {
  summary?: string;
  made?: number;
  changed?: number;
  removed?: number;
  leftAlone?: number;
  opened: SeriesOpened[];
  skipped: SeriesSkipped[];
}) {
  const lines = [
    changed ? `${changed} shift${changed === 1 ? "" : "s"} changed` : null,
    made ? `${made} shift${made === 1 ? "" : "s"} made` : null,
    removed ? `${removed} removed` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3" role="status">
      <div className="rounded-xl border p-4" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
        {summary && <p className="text-[13px] font-semibold" style={{ color: TEXT }}>{summary}</p>}
        <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
          {lines.length ? lines.join(", ") : "No shifts needed changing"}. New shifts keep being made eight weeks ahead.
        </p>
        {leftAlone > 0 && (
          <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
            {leftAlone} shift{leftAlone === 1 ? "" : "s"} someone had changed by hand {leftAlone === 1 ? "was" : "were"} left as {leftAlone === 1 ? "it is" : "they are"}.
          </p>
        )}
      </div>
      {opened.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-[12px] font-semibold text-amber-900">
            {opened.length} day{opened.length === 1 ? "" : "s"} the worker can't do {opened.length === 1 ? "is an open shift" : "are open shifts"} to fill
          </p>
          {opened.slice(0, 6).map((o) => (
            <p key={o.shift_id} className="text-[12px] text-amber-800">{dayText(o.date)}: {o.reason ?? "Not free"}</p>
          ))}
          {opened.length > 6 && <p className="text-[12px] text-amber-800">and {opened.length - 6} more</p>}
        </div>
      )}
      {skipped.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="mb-1 text-[12px] font-semibold text-red-900">Not made</p>
          {skipped.slice(0, 6).map((s) => (
            <p key={s.date} className="text-[12px] text-red-800">{dayText(s.date)}: {s.reason}</p>
          ))}
          {skipped.length > 6 && <p className="text-[12px] text-red-800">and {skipped.length - 6} more</p>}
        </div>
      )}
    </div>
  );
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
      {DAYS.map((label, d) => {
        const on = value.includes(d);
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b))}
            className="h-8 w-11 rounded-lg border text-[12px] font-semibold transition-colors"
            style={on ? { background: "var(--cc-cta)", color: "white", borderColor: "var(--cc-cta)" } : { borderColor: BORDER, color: MUTED }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const field = "w-full rounded-xl border bg-transparent px-3 py-2 text-[13px] outline-none";

function SeriesEditor({
  series, workers, initialFrom, onDone, onCancel,
}: {
  series: ShiftSeries;
  workers: WorkerStats[];
  initialFrom?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();
  const { toast } = useToast();
  const shared = useMemo(() => sharedNames(workers.map((w) => w.full_name)), [workers]);
  const [from, setFrom] = useState(initialFrom && initialFrom > today() ? initialFrom : today());
  const [days, setDays] = useState<number[]>(series.days_of_week);
  const [start, setStart] = useState(hhmm(series.start_time));
  const [end, setEnd] = useState(hhmm(series.end_time));
  const [every, setEvery] = useState(series.interval_weeks);
  const [workerId, setWorkerId] = useState(series.worker_id ?? "");
  const [hasEnd, setHasEnd] = useState(!!series.end_date);
  const [endsOn, setEndsOn] = useState(series.end_date ?? "");
  const [done, setDone] = useState<Awaited<ReturnType<typeof changeShiftSeries>> | null>(null);

  const change: ShiftSeriesChange = { from_date: from };
  if (days.join() !== series.days_of_week.join()) change.days_of_week = days;
  if (start !== hhmm(series.start_time)) change.start_time = start;
  if (end !== hhmm(series.end_time)) change.end_time = end;
  if (every !== series.interval_weeks) change.interval_weeks = every;
  if ((workerId || null) !== (series.worker_id ?? null)) change.worker_id = workerId || null;
  const endDate = hasEnd && endsOn ? endsOn : null;
  if (endDate !== (series.end_date ?? null)) change.end_date = endDate;
  const changes = Object.keys(change).length - 1;
  const valid = days.length > 0 && start !== end && !(hasEnd && !endsOn);

  const save = useMutation({
    mutationFn: () => changeShiftSeries(series.id, change),
    onSuccess: (res) => {
      setDone(res);
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      qc.invalidateQueries({ queryKey: [orgId, "shift-series"] });
    },
    onError: (err: Error) => toast({ title: "Couldn't change the schedule", description: err.message, variant: "destructive" }),
  });

  if (done) {
    return (
      <div className="space-y-4">
        <SeriesOutcome
          summary={`${series.participant_name}, from ${dayText(from)}`}
          changed={done.updated_count}
          made={done.created_count}
          removed={done.removed_count}
          leftAlone={done.left_alone_count}
          opened={done.opened}
          skipped={done.skipped}
        />
        <Button onClick={onDone} className="rounded-full text-white" style={{ background: "var(--cc-cta)" }}>Done</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-semibold" style={{ color: TEXT }}>{series.participant_name}</p>
        <p className="text-[12px]" style={{ color: MUTED }}>Now: {series.summary}</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Change from</span>
        <input type="date" value={from} min={today()} onChange={(e) => setFrom(e.target.value || today())} className={field} style={{ borderColor: BORDER }} />
        <span className="block text-[11px]" style={{ color: MUTED }}>Shifts before this day stay as they are.</span>
      </label>
      <div className="space-y-1.5">
        <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Days</span>
        <DayPicker value={days} onChange={setDays} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Starts</span>
          <TimePicker value={start} onChange={setStart} className="rounded-xl px-3 py-2 text-[13px]" style={{ borderColor: BORDER }} />
        </label>
        <label className="space-y-1.5">
          <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Ends</span>
          <TimePicker value={end} onChange={setEnd} className="rounded-xl px-3 py-2 text-[13px]" style={{ borderColor: BORDER }} />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Repeats</span>
        <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className={field} style={{ borderColor: BORDER }}>
          <option value={1}>Every week</option>
          <option value={2}>Every 2 weeks</option>
          <option value={3}>Every 3 weeks</option>
          <option value={4}>Every 4 weeks</option>
        </select>
      </label>
      <div className="space-y-1.5">
        <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Worker</span>
        <SearchableSelect
          value={workerId || "__open__"}
          onValueChange={(v) => setWorkerId(v === "__open__" ? "" : v)}
          placeholder="Choose a worker"
          searchPlaceholder="Name, staff ID or suburb"
          emptyText="No one matches"
          options={[
            { value: "__open__", label: "Open shifts for someone to pick up", keywords: "open none" },
            ...[...workers].sort((a, b) => a.full_name.localeCompare(b.full_name))
              .map((w) => ({ value: w.id, label: w.full_name, keywords: workerSearchText(w) })),
          ]}
          renderTrigger={(selected) => {
            const w = workers.find((x) => x.id === selected?.value);
            const detail = w ? detailIfShared(w, shared) : null;
            return selected ? (detail ? `${selected.label} · ${detail}` : selected.label) : "Choose a worker";
          }}
          renderOption={(option) => {
            const w = workers.find((x) => x.id === option.value);
            const detail = w ? workerDetail(w) : null;
            return (
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {detail && <span className="block truncate text-[11px]" style={{ color: MUTED }}>{detail}</span>}
              </span>
            );
          }}
        />
        {change.worker_id !== undefined && change.worker_id && (
          <span className="block text-[11px]" style={{ color: MUTED }}>Any day they can't do becomes an open shift, and you'll see which.</span>
        )}
      </div>
      <div className="space-y-1.5">
        <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Until</span>
        <div className="flex flex-wrap items-center gap-2">
          {[{ v: false, l: "Keeps going" }, { v: true, l: "A date" }].map((o) => (
            <button
              key={o.l}
              type="button"
              aria-pressed={hasEnd === o.v}
              onClick={() => setHasEnd(o.v)}
              className="h-9 rounded-full border px-3.5 text-[12px] font-semibold"
              style={hasEnd === o.v ? { background: "var(--cc-cta)", color: "white", borderColor: "var(--cc-cta)" } : { borderColor: BORDER, color: MUTED }}
            >
              {o.l}
            </button>
          ))}
          {hasEnd && (
            <input type="date" aria-label="Last day" value={endsOn} min={from} onChange={(e) => setEndsOn(e.target.value)} className="h-9 rounded-xl border bg-transparent px-3 text-[13px]" style={{ borderColor: BORDER }} />
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: BORDER }}>
        <Button variant="outline" onClick={onCancel} className="rounded-full" disabled={save.isPending}>Cancel</Button>
        <Button
          onClick={() => save.mutate()}
          disabled={!valid || changes === 0 || save.isPending}
          className="rounded-full text-white"
          style={{ background: "var(--cc-cta)" }}
        >
          {save.isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          Change from {dayText(from)}
        </Button>
      </div>
    </div>
  );
}

function EndSeries({ series, onDone, onCancel }: { series: ShiftSeries; onDone: () => void; onCancel: () => void }) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState(today());
  const stop = useMutation({
    mutationFn: () => endShiftSeries(series.id, from),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      qc.invalidateQueries({ queryKey: [orgId, "shift-series"] });
      toast({
        title: `${series.participant_name}'s regular shifts stop from ${dayText(from)}`,
        description: `${res.removed_count} coming shift${res.removed_count === 1 ? "" : "s"} removed`
          + (res.left_alone_count ? `; ${res.left_alone_count} changed by hand kept` : "")
          + (series.worker_id ? ". The worker has been told." : "."),
      });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Couldn't stop the schedule", description: err.message, variant: "destructive" }),
  });
  return (
    <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: BORDER }}>
      <label className="block space-y-1.5">
        <span className="text-[12px] font-semibold" style={{ color: TEXT }}>No shifts from</span>
        <input type="date" value={from} min={today()} onChange={(e) => setFrom(e.target.value || today())} className={field} style={{ borderColor: BORDER }} />
      </label>
      <p className="text-[11px]" style={{ color: MUTED }}>Coming shifts it made are removed. Ones changed by hand, and any already started, stay.</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="rounded-full" onClick={onCancel} disabled={stop.isPending}>Keep it</Button>
        <Button size="sm" className="rounded-full text-white" style={{ background: "var(--cc-danger-text, #B91C1C)" }} onClick={() => stop.mutate()} disabled={stop.isPending}>
          {stop.isPending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : null}
          Stop from {dayText(from)}
        </Button>
      </div>
    </div>
  );
}

export function RegularSchedulesPanel({
  open, onOpenChange, workers, onNew, focus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: WorkerStats[];
  /** Start a new one (opens the new regular schedule form). */
  onNew: () => void;
  /** Opened from a shift: go straight to changing its schedule from its day. */
  focus?: { seriesId: string; fromDate?: string } | null;
}) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const seriesQuery = useOrgQuery<ShiftSeries[]>([orgId, "shift-series"], {
    queryFn: () => listShiftSeries(),
    enabled: open,
    staleTime: 15_000,
  });
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; from?: string } | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const shared = useMemo(() => sharedNames(workers.map((w) => w.full_name)), [workers]);
  const byId = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);

  // Opened from a shift: its schedule's editor, once the list is in.
  const target = editing ?? (focus ? { id: focus.seriesId, from: focus.fromDate } : null);
  const all = seriesQuery.data ?? [];
  const editingSeries = target ? all.find((s) => s.id === target.id) : undefined;

  const groups = useMemo(() => {
    const rows = all.filter((s) => {
      const w = s.worker_id ? byId.get(s.worker_id) : undefined;
      return matchesPerson(query, [s.participant_name, s.worker_name, w ? workerSearchText(w) : null, s.summary]);
    });
    const map = new Map<string, ShiftSeries[]>();
    for (const s of rows) map.set(s.participant_name, [...(map.get(s.participant_name) ?? []), s]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all, query, byId]);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) { setEditing(null); setEnding(null); setQuery(""); }
  };
  const backToList = () => { setEditing(null); if (focus) close(false); };

  return (
    <SidePanel
      open={open}
      onOpenChange={close}
      icon={Repeat}
      title={editingSeries ? "Change a regular schedule" : "Regular schedules"}
      description={editingSeries ? undefined : "Each participant's standing shifts. They're kept made eight weeks ahead."}
    >
      {editingSeries ? (
        <SeriesEditor
          key={editingSeries.id}
          series={editingSeries}
          workers={workers}
          initialFrom={target?.from}
          onDone={backToList}
          onCancel={backToList}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Participant, worker or staff ID"
              aria-label="Find a regular schedule"
              className="h-10 md:h-8 min-w-0 flex-1 rounded-full border bg-transparent px-4 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-cc-plum"
              style={{ borderColor: BORDER }}
            />
            <Button onClick={onNew} className="h-10 md:h-8 shrink-0 rounded-full px-4 text-white" style={{ background: "var(--cc-cta)" }}>
              <Plus size={14} className="mr-1" /> New
            </Button>
          </div>

          {seriesQuery.isLoading && (
            <div role="status" className="flex items-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
              <Loader2 size={15} className="animate-spin" /> Loading
            </div>
          )}
          {seriesQuery.isError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              Regular schedules couldn't be loaded. {(seriesQuery.error as Error)?.message}
            </p>
          )}
          {seriesQuery.isSuccess && all.length === 0 && (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center" style={{ borderColor: BORDER }}>
              <CalendarClock size={22} className="mx-auto mb-2" style={{ color: MUTED }} />
              <p className="text-[13px] font-semibold" style={{ color: TEXT }}>No regular schedules yet</p>
              <p className="mt-1 text-[12px]" style={{ color: MUTED }}>Set up the shifts a participant has every week once, and they keep coming.</p>
            </div>
          )}
          {seriesQuery.isSuccess && all.length > 0 && groups.length === 0 && (
            <p className="py-6 text-center text-[13px]" style={{ color: MUTED }}>No one matches "{query.trim()}".</p>
          )}

          {groups.map(([participant, items]) => (
            <section key={participant} aria-label={participant} className="space-y-2">
              <h3 className="pt-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{participant}</h3>
              {items.map((s) => {
                const w = s.worker_id ? byId.get(s.worker_id) : undefined;
                const detail = w ? detailIfShared(w, shared) : null;
                return (
                  <article key={s.id} className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold" style={{ color: TEXT }}>{s.summary}</p>
                        <p className="mt-0.5 truncate text-[12px]" style={{ color: MUTED }}>
                          {s.worker_name ? `${s.worker_name}${detail ? ` · ${detail}` : ""}` : "Open shifts"}
                        </p>
                        <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
                          {s.next_start ? `Next ${format(zonedDate(s.next_start, s.timezone), "EEE d MMM")}, ${formatAppTime(s.next_start, s.timezone)}${isOtherBranchZone(s.timezone) ? ` ${zoneAbbreviation(s.next_start, s.timezone)}` : ""}` : "Nothing coming up"}
                          {" · "}
                          {s.end_date ? `until ${dayText(s.end_date)}` : "keeps going"}
                        </p>
                        {s.upcoming_open > 0 && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}>
                            <AlertTriangle size={11} /> {s.upcoming_open} coming shift{s.upcoming_open === 1 ? " needs" : "s need"} a worker
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => { setEnding(null); setEditing({ id: s.id }); }} aria-label={`Change ${participant}'s ${s.summary}`}>
                          Change
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEnding(ending === s.id ? null : s.id)} aria-label={`Stop ${participant}'s ${s.summary}`}>
                          Stop
                        </Button>
                      </div>
                    </div>
                    {ending === s.id && <EndSeries series={s} onDone={() => setEnding(null)} onCancel={() => setEnding(null)} />}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </SidePanel>
  );
}
