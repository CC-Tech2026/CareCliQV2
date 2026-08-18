import { useEffect, useMemo, useState } from "react";
import { addDays, eachDayOfInterval, endOfWeek, format, isToday, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { listCoordinatorShifts, type CoordinatorShiftRecord } from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";
const BLUE = "#2A5C8A";
const BLUE_SOFT = "#EAF1F7";
const GREEN = "#0F7B57";
const GREEN_SOFT = "#E9F5F0";
const SLATE = "#5B655F";
const SLATE_SOFT = "#F0F1EE";

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: "Scheduled", color: PLUM, bg: "var(--cc-soft)" },
  in_progress: { label: "In progress", color: BLUE, bg: BLUE_SOFT },
  clocked_in: { label: "In progress", color: BLUE, bg: BLUE_SOFT },
  completed: { label: "Completed", color: GREEN, bg: GREEN_SOFT },
  cancelled: { label: "Cancelled", color: SLATE, bg: SLATE_SOFT },
  unassigned: { label: "Unassigned", color: AMBER, bg: AMBER_SOFT },
};

function statusStyle(shift: CoordinatorShiftRecord) {
  const isUnassigned = !shift.worker_id || shift.status === "unassigned";
  if (isUnassigned) return STATUS_STYLE.unassigned;
  return STATUS_STYLE[shift.status ?? ""] ?? STATUS_STYLE.scheduled;
}

function formatTime(iso?: string) {
  if (!iso) return "";
  try {
    return format(new Date(iso), "h:mmaaa").toLowerCase();
  } catch {
    return "";
  }
}

export default function MDSchedulePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [shifts, setShifts] = useState<CoordinatorShiftRecord[] | null>(null);
  const [error, setError] = useState(false);

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  useEffect(() => {
    let cancelled = false;
    setShifts(null);
    setError(false);
    listCoordinatorShifts({
      start_date: format(weekStart, "yyyy-MM-dd"),
      end_date: format(weekEnd, "yyyy-MM-dd"),
      limit: 500,
    })
      .then((data) => {
        if (!cancelled) setShifts(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const day of days) map.set(format(day, "yyyy-MM-dd"), []);
    for (const s of shifts ?? []) {
      if (!s.scheduled_start) continue;
      const key = format(new Date(s.scheduled_start), "yyyy-MM-dd");
      if (!map.has(key)) continue;
      map.get(key)!.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
    }
    return map;
  }, [days, shifts]);

  const unassignedCount = (shifts ?? []).filter((s) => !s.worker_id || s.status === "unassigned").length;

  return (
    <HubLayout>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Master Schedule</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>
              Org-wide shift oversight, read-only. Assigning and rescheduling stays with coordinators.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {shifts !== null && (
              <span
                className="rounded-full px-3 py-1.5 text-[11px] font-black"
                style={{ background: unassignedCount > 0 ? AMBER_SOFT : GREEN_SOFT, color: unassignedCount > 0 ? AMBER : GREEN }}
              >
                {unassignedCount > 0 ? `${unassignedCount} unassigned this week` : "Fully staffed this week"}
              </span>
            )}
            <div className="flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: BORDER, background: SURFACE }}>
              <button
                onClick={() => setWeekStart((d) => addDays(d, -7))}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-cc-soft"
                aria-label="Previous week"
              >
                <ChevronLeft size={15} style={{ color: MUTED }} />
              </button>
              <span className="px-2 text-[11px] font-bold" style={{ color: TEXT }}>
                {format(weekStart, "d MMM")} - {format(weekEnd, "d MMM")}
              </span>
              <button
                onClick={() => setWeekStart((d) => addDays(d, 7))}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-cc-soft"
                aria-label="Next week"
              >
                <ChevronRight size={15} style={{ color: MUTED }} />
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[13px] font-black" style={{ color: TEXT }}>Couldn't load the schedule.</p>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Try again shortly.</p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayShifts = shiftsByDay.get(key) ?? [];
              return (
                <div key={key} className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
                  <div
                    className="border-b px-3 py-2.5"
                    style={{ borderColor: BORDER, background: isToday(day) ? "var(--cc-soft)" : undefined }}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: MUTED }}>
                      {format(day, "EEE")}
                    </p>
                    <p className="text-[15px] font-black" style={{ color: isToday(day) ? PLUM : TEXT }}>
                      {format(day, "d MMM")}
                    </p>
                  </div>

                  <div className="min-h-[120px] p-2">
                    {shifts === null ? (
                      <div className="space-y-2 p-1">
                        <div className="h-10 animate-pulse rounded-lg" style={{ background: SOFT }} />
                        <div className="h-10 animate-pulse rounded-lg" style={{ background: SOFT }} />
                      </div>
                    ) : dayShifts.length === 0 ? (
                      <p className="p-2 text-[10px] font-medium" style={{ color: MUTED }}>No shifts</p>
                    ) : (
                      <div className="space-y-1.5">
                        {dayShifts.map((s) => {
                          const st = statusStyle(s);
                          return (
                            <div key={s.id} className="rounded-lg p-2" style={{ background: st.bg }}>
                              <p className="text-[10px] font-black" style={{ color: st.color }}>
                                {formatTime(s.scheduled_start)}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] font-bold" style={{ color: TEXT }}>
                                {s.participant_name || "Participant"}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1">
                                <Users size={10} style={{ color: MUTED }} />
                                <p className="truncate text-[10px] font-medium" style={{ color: st.color === AMBER ? AMBER : MUTED }}>
                                  {st.label === "Unassigned" ? "Unassigned" : s.worker_name || "Worker"}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </HubLayout>
  );
}
