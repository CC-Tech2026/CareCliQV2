import { CalendarPlus, CalendarSearch, UserSearch } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, ghostClass } from "@/components/layout/PageKit";
import { appLocalDateKey, formatAppDate, formatAppTime } from "@/lib/datetime";
import type { CoordinatorShiftRecord } from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

function hoursBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const h = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
  return h > 0 ? `${Number.isInteger(h) ? h : h.toFixed(1)}h` : null;
}

/** Every shift still waiting for a worker, across all weeks, so filling them
 *  doesn't mean paging through the roster. Started ones come first. */
export function OpenShiftsPanel({
  open,
  onOpenChange,
  shifts,
  loading,
  onFindWorker,
  onShowOnRoster,
  onAddOpenShift,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: CoordinatorShiftRecord[];
  loading: boolean;
  onFindWorker: (shift: CoordinatorShiftRecord) => void;
  onShowOnRoster: (shift: CoordinatorShiftRecord) => void;
  onAddOpenShift: () => void;
}) {
  const now = Date.now();
  const sorted = [...shifts].sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
  const started = sorted.filter((s) => s.scheduled_start && new Date(s.scheduled_start).getTime() < now);
  const upcoming = sorted.filter((s) => !started.includes(s));
  const byDay = new Map<string, CoordinatorShiftRecord[]>();
  for (const s of upcoming) {
    const key = s.scheduled_start ? appLocalDateKey(s.scheduled_start, s.timezone) : "";
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }

  const row = (s: CoordinatorShiftRecord, late = false) => (
    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" style={{ color: TEXT }}>{s.participant_name || "Participant"}</p>
        <p className="text-xs" style={{ color: late ? "var(--cc-danger-text)" : MUTED }}>
          {late && s.scheduled_start ? `${formatAppDate(s.scheduled_start, s.timezone, { weekday: "short", day: "numeric", month: "short" })} · ` : ""}
          {s.scheduled_start ? formatAppTime(s.scheduled_start, s.timezone) : ""}
          {s.scheduled_end ? ` to ${formatAppTime(s.scheduled_end, s.timezone)}` : ""}
          {hoursBetween(s.scheduled_start, s.scheduled_end) ? ` · ${hoursBetween(s.scheduled_start, s.scheduled_end)}` : ""}
          {s.shift_type ? ` · ${s.shift_type.replace(/_/g, " ")}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className={`${ghostClass} !min-h-9 !px-3`} onClick={() => onShowOnRoster(s)}>
          <CalendarSearch size={14} /> Show on roster
        </button>
        <button type="button" className={`${ctaClass} !min-h-9 !px-4`} onClick={() => onFindWorker(s)}>
          <UserSearch size={14} /> Find a worker
        </button>
      </div>
    </li>
  );

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      wide
      icon={CalendarPlus}
      title="Open shifts"
      description="Shifts that still need a worker, in every week. Find a worker for one here, or show it on the roster to drag it onto someone."
      footer={
        <button type="button" className={ctaClass} onClick={onAddOpenShift}>
          <CalendarPlus size={15} /> Add an open shift
        </button>
      }
    >
      {loading ? (
        <p className="text-sm" style={{ color: MUTED }}>Loading open shifts...</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl bg-cc-soft p-5 text-sm" style={{ color: TEXT }}>
          No open shifts. Every shift has a worker.
        </div>
      ) : (
        <>
          {started.length > 0 && (
            <section aria-label="Started without a worker" className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--cc-danger-text)" }}>
                Started without a worker ({started.length})
              </h3>
              <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: "var(--cc-border)", background: "var(--cc-status-danger-bg)" }}>
                {started.map((s) => row(s, true))}
              </ul>
            </section>
          )}
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day} aria-label={day} className="space-y-2">
              <h3 className="flex items-baseline justify-between text-sm font-semibold" style={{ color: TEXT }}>
                {list[0].scheduled_start
                  ? formatAppDate(list[0].scheduled_start, list[0].timezone, { weekday: "long", day: "numeric", month: "long" })
                  : "No date"}
                <span className="text-xs font-normal" style={{ color: MUTED }}>{list.length} open</span>
              </h3>
              <ul className="divide-y overflow-hidden rounded-xl border border-cc-border bg-cc-surface" style={{ borderColor: "var(--cc-border)" }}>
                {list.map((s) => row(s))}
              </ul>
            </section>
          ))}
        </>
      )}
    </SidePanel>
  );
}
