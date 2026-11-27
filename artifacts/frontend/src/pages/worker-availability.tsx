import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { appNow, displayDate } from "@/lib/datetime";
import { Link } from "wouter";
import { Check, Loader2, Star, Trash2, X, type LucideIcon } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, SkeletonBlocks, ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import {
  getWorkerAvailability,
  setEmergencyAvailabilityOverride,
  updateAvailabilityBlackouts,
  updateAvailabilityPreferences,
  updateAvailabilitySlots,
  type AvailabilitySlot,
  type BlackoutDate,
  type SlotStatus,
  type TimeSlot,
} from "@/services/workerAvailabilityService";

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];

// Matches SLOT_HOURS in worker_availability_service.py.
const SLOT_HOURS: Record<TimeSlot, string> = {
  morning: "6am–12pm",
  afternoon: "12pm–5pm",
  evening: "5pm–9pm",
};

const SLOT_KEYS: Record<TimeSlot, string> = {
  morning: "availability.slot.morning",
  afternoon: "availability.slot.afternoon",
  evening: "availability.slot.evening",
};

const DAY_KEYS = [
  "scheduleRequests.days.mon",
  "scheduleRequests.days.tue",
  "scheduleRequests.days.wed",
  "scheduleRequests.days.thu",
  "scheduleRequests.days.fri",
  "scheduleRequests.days.sat",
  "scheduleRequests.days.sun",
] as const;

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const STATUS_ORDER: SlotStatus[] = ["available", "preferred", "unavailable"];

const STATUS_LOOK: Record<SlotStatus, { key: string; icon: LucideIcon; cell: string; iconColor: string }> = {
  available: {
    key: "availability.status.available",
    icon: Check,
    cell: "bg-[var(--cc-status-success-bg)] border-[color-mix(in_srgb,var(--cc-green)_25%,transparent)]",
    iconColor: "var(--cc-green)",
  },
  preferred: {
    key: "availability.status.preferred",
    icon: Star,
    cell: "bg-[var(--cc-plum-soft)] border-[var(--cc-plum-medium)]",
    iconColor: "var(--cc-plum)",
  },
  unavailable: {
    key: "availability.status.unavailable",
    icon: X,
    cell: "bg-cc-soft border-transparent",
    iconColor: "var(--cc-muted)",
  },
};

/** Every day and time, so a cell the server never stored can still be changed. */
function fullGrid(stored: AvailabilitySlot[] | undefined): AvailabilitySlot[] {
  const grid: AvailabilitySlot[] = [];
  for (let day = 1; day <= 7; day++) {
    for (const time_slot of SLOTS) {
      const found = stored?.find((s) => s.day_of_week === day && s.time_slot === time_slot);
      grid.push({ day_of_week: day, time_slot, status: found?.status ?? "available" });
    }
  }
  return grid;
}

function sameBlackouts(a: BlackoutDate[], b: BlackoutDate[]) {
  const key = (x: BlackoutDate) => `${x.start_date}|${x.end_date}|${x.reason ?? ""}`;
  return a.length === b.length && a.every((x, i) => key(x) === key(b[i]));
}

function formatRange(start: string, end: string) {
  const s = parseISO(start);
  const e = parseISO(end);
  if (start === end) return format(s, "EEE d MMM yyyy");
  const startFmt = s.getFullYear() === e.getFullYear() ? "EEE d MMM" : "EEE d MMM yyyy";
  return `${format(s, startFmt)} to ${format(e, "EEE d MMM yyyy")}`;
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-cc-border bg-cc-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold text-cc-text">{title}</h2>
      {hint && <p className="mt-1 text-sm leading-6 text-cc-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function WorkerAvailabilityPage() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const queryClient = useQueryClient();
  const { data, isLoading } = useOrgQuery(["worker", "availability"], {
    queryFn: getWorkerAvailability,
  });

  const serverSlots = useMemo(() => fullGrid(data?.slots), [data]);
  const serverMax = data?.preferences.max_shifts_per_week ?? 5;
  const serverBlackouts = useMemo(() => data?.blackout_dates ?? [], [data]);

  const [slots, setSlots] = useState<AvailabilitySlot[]>(() => fullGrid(undefined));
  const [maxShifts, setMaxShifts] = useState(5);
  const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
  const [paint, setPaint] = useState<SlotStatus>("unavailable");
  const [newBlackout, setNewBlackout] = useState({ start_date: "", end_date: "", reason: "" });
  const [blackoutError, setBlackoutError] = useState("");

  const reset = () => {
    setSlots(serverSlots);
    setMaxShifts(serverMax);
    setBlackouts(serverBlackouts);
  };

  useEffect(() => {
    if (!data) return;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const slotsDirty = slots.some((s, i) => s.status !== serverSlots[i]?.status);
  const maxDirty = maxShifts !== serverMax;
  const blackoutsDirty = !sameBlackouts(blackouts, serverBlackouts);
  const dirty = Boolean(data) && (slotsDirty || maxDirty || blackoutsDirty);

  // useOrgQuery scopes this under [orgId, "worker", "availability"], so
  // invalidation needs the orgId prefix too or it silently matches nothing.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [orgId, "worker", "availability"] });

  // One save for everything changed on the page, so nothing is left behind
  // because it had its own button further down.
  const saveMut = useMutation({
    mutationFn: async () => {
      if (slotsDirty) await updateAvailabilitySlots(slots);
      if (maxDirty) await updateAvailabilityPreferences(maxShifts);
      if (blackoutsDirty) await updateAvailabilityBlackouts(blackouts);
    },
    onSuccess: async () => {
      toast({ title: translate("availability.saved") });
      await invalidate();
    },
    onError: (e: Error) => {
      toast({ title: translate("common.error"), description: e.message, variant: "destructive" });
      void invalidate();
    },
  });

  const emergencyMut = useMutation({
    mutationFn: (date: string) => setEmergencyAvailabilityOverride(date),
    onSuccess: () => { toast({ title: translate("availability.emergencyActive") }); void invalidate(); },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const setCell = (day: number, time_slot: TimeSlot) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.day_of_week !== day || s.time_slot !== time_slot) return s;
        // Tapping a cell that already has the chosen status puts it back to available.
        const status = s.status === paint && paint !== "available" ? "available" : paint;
        return { ...s, status };
      }),
    );
  };

  const setDay = (day: number) => {
    setSlots((prev) => prev.map((s) => (s.day_of_week === day ? { ...s, status: paint } : s)));
  };

  const statusOf = (day: number, time_slot: TimeSlot) =>
    slots.find((s) => s.day_of_week === day && s.time_slot === time_slot)?.status ?? "available";

  const addBlackout = () => {
    setBlackoutError("");
    if (!newBlackout.start_date || !newBlackout.end_date) {
      setBlackoutError(translate("availability.pickBothDates"));
      return;
    }
    if (newBlackout.end_date < newBlackout.start_date) {
      setBlackoutError(translate("availability.endBeforeStart"));
      return;
    }
    if (blackouts.length >= 12) {
      setBlackoutError(translate("availability.maxBlackouts"));
      return;
    }
    setBlackouts((prev) =>
      [...prev, { ...newBlackout, reason: newBlackout.reason.trim() }].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    );
    setNewBlackout({ start_date: "", end_date: "", reason: "" });
  };

  const prefs = data?.preferences;
  const overrideDate = prefs?.emergency_override_expires_at ? prefs.emergency_override_date ?? null : null;
  const today = format(appNow(), "yyyy-MM-dd");
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const paintLabel = translate(STATUS_LOOK[paint].key).toLowerCase();

  return (
    <div className="w-full space-y-5 pb-6">
      <PageHeader
        eyebrow={translate("common.supportWorker")}
        title={translate("availability.title")}
        description="Set the days and times you're available to work, so coordinators can offer you shifts that fit."
        back={
          <Link href="/calendar" className="text-sm font-medium text-cc-plum hover:underline">
            {translate("availability.backToCalendar")}
          </Link>
        }
        actions={
          prefs?.updated_at && !prefs.is_stale ? (
            <span className="text-xs text-cc-muted">
              {translateParams("availability.lastUpdatedDays", { days: String(prefs.days_since_updated ?? 0) })}
            </span>
          ) : undefined
        }
      />

      {prefs?.updated_at && prefs.is_stale && (
        <div role="status" className="rounded-2xl px-5 py-4" style={{ background: "var(--cc-status-warning-bg)" }}>
          <p className="text-sm font-semibold text-cc-text">{translate("availability.checkStillRight")}</p>
          <p className="mt-0.5 text-sm leading-6 text-cc-muted">
            {translateParams("availability.lastUpdatedDays", { days: String(prefs.days_since_updated ?? 0) })}
            {translate("availability.staleSuffix")}
          </p>
        </div>
      )}

      {isLoading ? (
        <SkeletonBlocks count={3} height="h-40" />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title={translate("availability.weekly")} hint={translate("availability.paintHint")}>
            <div role="radiogroup" aria-label={translate("availability.markAs")} className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-cc-muted">{translate("availability.markAs")}</span>
              {STATUS_ORDER.map((status) => {
                const look = STATUS_LOOK[status];
                const Icon = look.icon;
                const selected = paint === status;
                return (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPaint(status)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum",
                      selected ? "border-cc-plum bg-[var(--cc-plum-soft)] font-semibold text-cc-text" : "border-cc-border text-cc-text hover:bg-cc-soft",
                    )}
                  >
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", look.cell)}>
                      <Icon className="h-3.5 w-3.5" style={{ color: look.iconColor }} aria-hidden />
                    </span>
                    {translate(look.key)}
                  </button>
                );
              })}
            </div>

            <div className="-mx-1 mt-4 overflow-x-auto px-1">
              <table className="w-full min-w-[320px] table-fixed border-separate border-spacing-1">
                <caption className="sr-only">{translate("availability.weekly")}</caption>
                <colgroup>
                  <col className="w-[68px] sm:w-[104px]" />
                  {DAY_KEYS.map((k) => <col key={k} />)}
                </colgroup>
                <thead>
                  <tr>
                    <td />
                    {DAY_KEYS.map((key, i) => (
                      <th key={key} scope="col" className="p-0">
                        <button
                          type="button"
                          onClick={() => setDay(i + 1)}
                          title={`Mark all of ${DAY_NAMES[i]} as ${paintLabel}`}
                          aria-label={`${DAY_NAMES[i]}: mark the whole day as ${paintLabel}`}
                          className="min-h-9 w-full rounded-lg text-xs font-semibold text-cc-text transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum sm:text-sm"
                        >
                          {translate(key)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.map((slot) => (
                    <tr key={slot}>
                      <th scope="row" className="pr-1 text-left align-middle font-normal">
                        <span className="block text-xs font-semibold text-cc-text sm:text-sm">{translate(SLOT_KEYS[slot])}</span>
                        <span className="block text-[11px] text-cc-muted sm:text-xs">{SLOT_HOURS[slot]}</span>
                      </th>
                      {DAY_KEYS.map((_, i) => {
                        const day = i + 1;
                        const status = statusOf(day, slot);
                        const look = STATUS_LOOK[status];
                        const Icon = look.icon;
                        const label = translate(look.key);
                        return (
                          <td key={day} className="p-0">
                            <button
                              type="button"
                              onClick={() => setCell(day, slot)}
                              aria-label={`${DAY_NAMES[i]} ${translate(SLOT_KEYS[slot]).toLowerCase()}: ${label}`}
                              title={label}
                              className={cn(
                                "flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg border transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cc-plum dark:hover:brightness-125",
                                look.cell,
                              )}
                            >
                              <Icon className="h-4 w-4" style={{ color: look.iconColor }} aria-hidden />
                              <span className="hidden text-[11px] font-medium text-cc-text xl:block">{label}</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="min-w-0 space-y-5">
            <Panel title={translate("availability.maxShifts")} hint={translate("availability.maxShiftsHint")}>
              <div role="radiogroup" aria-label={translate("availability.maxShifts")} className="grid grid-cols-7 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                  const selected = maxShifts === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMaxShifts(n)}
                      className={cn(
                        "min-h-11 md:min-h-9 rounded-xl border text-sm tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum",
                        selected ? "border-cc-plum bg-[var(--cc-plum-soft)] font-semibold text-cc-text" : "border-cc-border text-cc-text hover:bg-cc-soft",
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel title={translate("availability.blackoutDates")} hint={translate("availability.blackoutHint")}>
              {blackouts.length > 0 ? (
                <ul className="mb-4 divide-y divide-cc-border overflow-hidden rounded-xl border border-cc-border">
                  {blackouts.map((b, i) => (
                    <li key={`${b.start_date}-${b.end_date}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-cc-text">{formatRange(b.start_date, b.end_date)}</p>
                        {b.reason && <p className="truncate text-xs text-cc-muted">{b.reason}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setBlackouts((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label={`${translate("availability.remove")} ${formatRange(b.start_date, b.end_date)}`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-cc-muted transition-colors hover:bg-cc-soft hover:text-[var(--cc-danger-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-sm text-cc-muted">{translate("availability.noTimeOff")}</p>
              )}

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs font-medium text-cc-muted">
                    {translate("availability.from")}
                    <input
                      type="date"
                      min={today}
                      className="cc-field mt-1 min-h-11 md:min-h-9 px-3 text-sm text-cc-text"
                      value={newBlackout.start_date}
                      onChange={(e) =>
                        setNewBlackout((p) => ({
                          ...p,
                          start_date: e.target.value,
                          end_date: p.end_date && p.end_date >= e.target.value ? p.end_date : e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="block text-xs font-medium text-cc-muted">
                    {translate("availability.to")}
                    <input
                      type="date"
                      min={newBlackout.start_date || today}
                      className="cc-field mt-1 min-h-11 md:min-h-9 px-3 text-sm text-cc-text"
                      value={newBlackout.end_date}
                      onChange={(e) => setNewBlackout((p) => ({ ...p, end_date: e.target.value }))}
                    />
                  </label>
                </div>
                <input
                  type="text"
                  placeholder={translate("availability.noteOptional")}
                  aria-label={translate("availability.noteOptional")}
                  className="cc-field min-h-11 md:min-h-9 px-3 text-sm text-cc-text"
                  value={newBlackout.reason}
                  onChange={(e) => setNewBlackout((p) => ({ ...p, reason: e.target.value }))}
                />
                {blackoutError && (
                  <p role="alert" className="text-sm text-[var(--cc-danger-text)]">{blackoutError}</p>
                )}
                <button type="button" onClick={addBlackout} className={cn(outlineClass, "w-full")}>
                  {translate("availability.addRange")}
                </button>
              </div>
            </Panel>

            <Panel title={translate("availability.emergency")} hint={translate("availability.emergencyHint")}>
              {overrideDate && (
                <p className="mb-3 rounded-xl px-3 py-2 text-sm font-medium text-cc-text" style={{ background: "var(--cc-status-warning-bg)" }}>
                  {translateParams("availability.emergencyActiveFor", {
                    date: overrideDate === today ? "today" : overrideDate === tomorrow ? "tomorrow" : format(displayDate(overrideDate), "EEE d MMM"),
                  })}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { date: today, key: "availability.today" },
                  { date: tomorrow, key: "availability.tomorrow" },
                ].map(({ date, key }) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => emergencyMut.mutate(date)}
                    disabled={emergencyMut.isPending || overrideDate === date}
                    aria-pressed={overrideDate === date}
                    className="cc-btn-amber min-h-11 md:min-h-9 cursor-pointer rounded-full px-3 text-sm font-semibold disabled:cursor-default disabled:opacity-60"
                  >
                    {translate(key)}
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {dirty && (
        <div
          role="region"
          aria-label={translate("availability.unsaved")}
          className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cc-border bg-cc-surface px-4 py-3 shadow-[var(--cc-shadow-md)] md:bottom-4"
        >
          <p className="text-sm font-medium text-cc-text">{translate("availability.unsaved")}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} disabled={saveMut.isPending} className={ghostClass}>
              {translate("availability.discard")}
            </button>
            <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className={ctaClass}>
              {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {translate("availability.saveChanges")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
