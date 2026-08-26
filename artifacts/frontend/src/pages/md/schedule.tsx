import { useMemo, useState } from "react";
import { addDays, eachDayOfInterval, endOfWeek, format, isToday, startOfWeek } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  MessageSquare,
  Radio,
  ShieldCheck,
  Users,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import CoordinatorLivePage from "@/pages/coordinator-live";
import { SectionInfo } from "@/components/ui/section-info";
import {
  getShiftDetail,
  listCoordinatorShifts,
  type CoordinatorShiftRecord,
  type ShiftDetail,
} from "@/services/coordinatorService";

const LIVE_REFRESH_MS = 30_000;

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
// Real safety/roster-risk severity, not the brand's destructive-action purple
// (--cc-status-critical) — this is the one reserved for "something needs a human".
const DANGER = "var(--cc-status-danger)";
const DANGER_SOFT = "var(--cc-status-danger-bg)";

type Bucket = "active" | "scheduled" | "completed" | "cancelled" | "unassigned";

const STATUS_STYLE: Record<Bucket, { label: string; color: string; bg: string }> = {
  scheduled: { label: "Scheduled", color: PLUM, bg: "var(--cc-soft)" },
  active: { label: "Active now", color: BLUE, bg: BLUE_SOFT },
  completed: { label: "Completed", color: GREEN, bg: GREEN_SOFT },
  cancelled: { label: "Cancelled", color: SLATE, bg: SLATE_SOFT },
  unassigned: { label: "Unassigned", color: AMBER, bg: AMBER_SOFT },
};

const STATUS_FILTERS: Array<{ key: Bucket | "all"; label: string }> = [
  { key: "all", label: "All shifts" },
  { key: "active", label: "Active now" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "unassigned", label: "Unassigned" },
];

function bucketOf(shift: CoordinatorShiftRecord): Bucket {
  if (!shift.worker_id || shift.status === "unassigned") return "unassigned";
  if (shift.status === "in_progress" || shift.status === "clocked_in") return "active";
  if (shift.status === "completed") return "completed";
  if (shift.status === "cancelled") return "cancelled";
  return "scheduled";
}

function formatTime(iso?: string | null) {
  if (!iso) return "";
  try {
    return format(new Date(iso), "h:mmaaa").toLowerCase();
  } catch {
    return "";
  }
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  try {
    return format(new Date(iso), "EEE d MMM, h:mmaaa").toLowerCase();
  } catch {
    return "";
  }
}

/** How long a worker has been clocked in, for the real-time "active now" views. */
function elapsedSince(iso?: string | null): string | null {
  if (!iso) return null;
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - started) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}


export default function MDSchedulePage() {
  const [viewMode, setViewMode] = useState<"week" | "live">("week");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  const startKey = format(weekStart, "yyyy-MM-dd");
  const endKey = format(weekEnd, "yyyy-MM-dd");

  // Polls every 30s so an MD watching this page sees clock-ins/outs and
  // status changes as they happen, not just when they change weeks.
  const {
    data: shifts = null,
    isError,
    dataUpdatedAt,
  } = useOrgQuery<CoordinatorShiftRecord[]>(["md-schedule", startKey, endKey], {
    queryFn: () => listCoordinatorShifts({ start_date: startKey, end_date: endKey, limit: 500 }),
    refetchInterval: LIVE_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const error = isError;

  const stats = useMemo(() => {
    const list = shifts ?? [];
    const counts: Record<Bucket, number> = { active: 0, scheduled: 0, completed: 0, cancelled: 0, unassigned: 0 };
    const perDay = new Map<string, number>();
    for (const day of days) perDay.set(format(day, "yyyy-MM-dd"), 0);
    for (const s of list) {
      counts[bucketOf(s)]++;
      if (s.scheduled_start) {
        const key = format(new Date(s.scheduled_start), "yyyy-MM-dd");
        if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
      }
    }
    const total = list.length;
    const settled = counts.completed + counts.cancelled;
    const cancellationRate = settled > 0 ? Math.round((counts.cancelled / settled) * 100) : null;
    const busiestCount = Math.max(0, ...Array.from(perDay.values()));
    return { total, counts, perDay, cancellationRate, busiestCount };
  }, [shifts, days]);

  const attentionItems = useMemo(() => {
    if (shifts === null) return [];
    const items: { key: string; text: string }[] = [];
    if (stats.counts.unassigned > 0) {
      items.push({
        key: "unassigned",
        text: `${stats.counts.unassigned} shift${stats.counts.unassigned === 1 ? "" : "s"} this week ${stats.counts.unassigned === 1 ? "has" : "have"} no worker assigned.`,
      });
    }
    if (stats.cancellationRate !== null && stats.cancellationRate >= 15) {
      items.push({ key: "cancellation", text: `Cancellation rate is elevated at ${stats.cancellationRate}% this week.` });
    }
    return items;
  }, [shifts, stats]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const day of days) map.set(format(day, "yyyy-MM-dd"), []);
    for (const s of shifts ?? []) {
      if (!s.scheduled_start) continue;
      if (filter !== "all" && bucketOf(s) !== filter) continue;
      const key = format(new Date(s.scheduled_start), "yyyy-MM-dd");
      if (!map.has(key)) continue;
      map.get(key)!.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
    }
    return map;
  }, [days, shifts, filter]);

  const activityLog = useMemo(() => {
    return (shifts ?? [])
      .filter((s) => bucketOf(s) === "cancelled" || bucketOf(s) === "active")
      .sort((a, b) => (b.scheduled_start ?? "").localeCompare(a.scheduled_start ?? ""));
  }, [shifts]);

  return (
    <HubLayout>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black" style={{ color: TEXT }}>
              Master Schedule
              <SectionInfo text="Org-wide shift oversight, read-only. Assigning and rescheduling stays with coordinators." />
            </h1>
            <p className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: MUTED }}>
              {shifts !== null && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Radio size={11} style={{ color: GREEN }} />
                  <span style={{ color: GREEN }}>Live</span>
                  {dataUpdatedAt > 0 && (
                    <span>· updated {format(new Date(dataUpdatedAt), "h:mm:ssaaa").toLowerCase()}</span>
                  )}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {viewMode === "week" && shifts !== null && (
              <span
                className="rounded-full px-3 py-1.5 text-[11px] font-black"
                style={{
                  background: stats.counts.unassigned > 0 ? AMBER_SOFT : GREEN_SOFT,
                  color: stats.counts.unassigned > 0 ? AMBER : GREEN,
                }}
              >
                {stats.counts.unassigned > 0 ? `${stats.counts.unassigned} unassigned this week` : "Fully staffed this week"}
              </span>
            )}

            {/* Week / Live toggle */}
            <div className="flex items-center gap-0.5 rounded-xl p-1" style={{ borderColor: BORDER, background: SOFT, border: `1px solid ${BORDER}` }}>
              {([
                { id: "week", label: "Week" },
                { id: "live", label: "Live" },
              ] as const).map((v) => (
                <button
                  key={v.id}
                  onClick={() => setViewMode(v.id)}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors"
                  style={{
                    background: viewMode === v.id ? PLUM : "transparent",
                    color: viewMode === v.id ? "#fff" : MUTED,
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {viewMode === "week" && (
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
            )}
          </div>
        </div>

        {viewMode === "live" && <CoordinatorLivePage readOnly embedded />}

        {viewMode === "week" && (
        <>
        {/* Needs attention — the specific roster issues on this page that
            want a coordinator's action, not just a status readout. */}
        {attentionItems.length > 0 && (
          <div className="rounded-2xl border p-4" style={{ borderColor: DANGER, background: DANGER_SOFT }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={16} style={{ color: DANGER }} />
                <p className="text-[12px] font-black" style={{ color: DANGER }}>Needs attention</p>
                <SectionInfo text="Roster issues on this page that need a coordinator's action this week — shifts with no worker assigned, and a cancellation rate running high." />
              </div>
              <button
                onClick={() => setFilter("unassigned")}
                className="rounded-full px-3 py-1.5 text-[11px] font-black text-white transition-opacity hover:opacity-90"
                style={{ background: DANGER }}
              >
                Resolve unassigned
              </button>
            </div>
            <ul className="mt-2.5 space-y-1">
              {attentionItems.map((item) => (
                <li key={item.key} className="text-[11.5px] font-semibold" style={{ color: TEXT }}>• {item.text}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Rostering pattern strip */}
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>This week at a glance</p>
          <SectionInfo text="Shift counts for the selected week, by status. Unassigned counts shifts with no worker attached; cancellation rate is cancelled ÷ (cancelled + completed)." />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {([
            { label: "Total shifts", value: stats.total, color: TEXT },
            { label: "Active now", value: stats.counts.active, color: BLUE },
            { label: "Completed", value: stats.counts.completed, color: GREEN },
            { label: "Cancelled", value: stats.counts.cancelled, color: SLATE },
            { label: "Unassigned", value: stats.counts.unassigned, color: AMBER },
            {
              label: "Cancellation rate",
              value: stats.cancellationRate === null ? "—" : `${stats.cancellationRate}%`,
              color: stats.cancellationRate !== null && stats.cancellationRate >= 15 ? DANGER : TEXT,
            },
          ] as const).map((tile) => (
            <div key={tile.label} className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{tile.label}</p>
              <p className="mt-1 text-xl font-black" style={{ color: tile.color }}>
                {shifts === null ? "—" : tile.value}
              </p>
            </div>
          ))}
        </div>

        {/* Daily load pattern */}
        {shifts !== null && stats.total > 0 && (
          <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Rostering pattern this week</p>
              <SectionInfo text="How shifts are spread across the week. Taller bars mean more shifts scheduled that day; the busiest day is highlighted." />
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const count = stats.perDay.get(key) ?? 0;
                const heightPct = stats.busiestCount > 0 ? Math.max(8, (count / stats.busiestCount) * 100) : 8;
                return (
                  <div key={key} className="flex flex-col items-center gap-1.5">
                    <div className="flex h-16 w-full items-end justify-center rounded-lg" style={{ background: SOFT }}>
                      <div
                        className="w-full rounded-lg"
                        style={{
                          height: `${heightPct}%`,
                          background: count === stats.busiestCount && count > 0 ? PLUM : BLUE,
                          opacity: count === 0 ? 0 : 1,
                        }}
                      />
                    </div>
                    <p className="text-[9px] font-black uppercase" style={{ color: isToday(day) ? PLUM : MUTED }}>
                      {format(day, "EEE")}
                    </p>
                    <p className="text-[10px] font-bold" style={{ color: TEXT }}>{count}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Status filter */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = filter === f.key;
            const count = f.key === "all" ? stats.total : stats.counts[f.key as Bucket];
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors"
                style={{
                  borderColor: active ? PLUM : BORDER,
                  background: active ? PLUM : SURFACE,
                  color: active ? "#fff" : TEXT,
                }}
              >
                {f.label}{shifts !== null ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[13px] font-black" style={{ color: TEXT }}>Couldn't load the schedule.</p>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Try again shortly.</p>
          </div>
        ) : (
          <>
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Weekly board</p>
            <SectionInfo text="Every shift this week, grouped by day and narrowed by the status filter above. Click a shift for full detail — participant, worker, timing, tasks and notes." />
          </div>
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
                          const bucket = bucketOf(s);
                          const st = STATUS_STYLE[bucket];
                          return (
                            <button
                              key={s.id}
                              onClick={() => setActiveShiftId(s.id)}
                              className="w-full rounded-lg p-2 text-left transition-transform hover:scale-[1.02]"
                              style={{ background: st.bg }}
                            >
                              <div className="flex items-center gap-1.5">
                                <p className="text-[10px] font-black" style={{ color: st.color }}>
                                  {formatTime(s.scheduled_start)}
                                </p>
                                {bucket === "active" && elapsedSince(s.clocked_in_at) && (
                                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: st.color, color: "#fff" }}>
                                    {elapsedSince(s.clocked_in_at)}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-[11px] font-bold" style={{ color: TEXT }}>
                                {s.participant_name || "Participant"}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1">
                                <Users size={10} style={{ color: MUTED }} />
                                <p className="truncate text-[10px] font-medium" style={{ color: bucket === "unassigned" ? AMBER : MUTED }}>
                                  {bucket === "unassigned" ? "Unassigned" : s.worker_name || "Worker"}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}

        {/* Activity log: cancellations + shifts in progress right now */}
        {shifts !== null && activityLog.length > 0 && (
          <div className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
            <div className="flex items-center gap-1.5 border-b px-4 py-3" style={{ borderColor: BORDER }}>
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>
                Activity log — active shifts &amp; cancellations this week
              </p>
              <SectionInfo text="Shifts currently in progress and shifts cancelled this week, most recent first — a quick read on what's happening right now." />
            </div>
            <div className="max-h-72 divide-y overflow-y-auto" style={{ borderColor: BORDER }}>
              {activityLog.map((s) => {
                const bucket = bucketOf(s);
                const st = STATUS_STYLE[bucket];
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveShiftId(s.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-cc-soft"
                    style={{ borderColor: BORDER }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: st.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>
                        {s.participant_name || "Participant"} · {s.worker_name || "Unassigned"}
                      </p>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>
                        {bucket === "active" && elapsedSince(s.clocked_in_at)
                          ? `Clocked in ${formatTime(s.clocked_in_at)} · active ${elapsedSince(s.clocked_in_at)}`
                          : formatDateTime(s.scheduled_start)}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black"
                      style={{ background: st.bg, color: st.color }}
                    >
                      {st.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
      </div>

      <ShiftDetailSheet shiftId={activeShiftId} onClose={() => setActiveShiftId(null)} />
    </HubLayout>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
        <p className="text-[12px] font-semibold" style={{ color: TEXT }}>{value}</p>
      </div>
    </div>
  );
}

function ShiftDetailSheet({ shiftId, onClose }: { shiftId: string | null; onClose: () => void }) {
  // Polls while open so a shift being actively worked (task ticks, clock-out)
  // updates live rather than needing the sheet closed and reopened.
  const {
    data: detail = null,
    isLoading: loading,
    isError: error,
  } = useOrgQuery<ShiftDetail>(["md-schedule-shift-detail", shiftId], {
    queryFn: () => getShiftDetail(shiftId!),
    enabled: !!shiftId,
    refetchInterval: (query) => (query.state.data && bucketOf(query.state.data) === "active" ? LIVE_REFRESH_MS : false),
  });

  const bucket = detail ? bucketOf(detail) : null;
  const st = bucket ? STATUS_STYLE[bucket] : null;
  const tasks = detail?.tasks ?? [];
  const completedTasks = tasks.filter((t) => t.completed).length;

  return (
    <Sheet open={!!shiftId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-6 sm:max-w-lg" style={{ background: "var(--cc-bg)" }}>
        {loading || !detail ? (
          <div className="space-y-3 pt-8">
            {error ? (
              <p className="text-[12px] font-bold" style={{ color: MUTED }}>Couldn't load this shift.</p>
            ) : (
              <>
                <div className="h-6 w-2/3 animate-pulse rounded-lg" style={{ background: SOFT }} />
                <div className="h-20 animate-pulse rounded-2xl" style={{ background: SOFT }} />
                <div className="h-32 animate-pulse rounded-2xl" style={{ background: SOFT }} />
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5 pt-6">
            <div>
              <div className="flex items-center gap-2">
                {st && (
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                )}
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                  {(detail.shift_type || "standard_support").replace(/_/g, " ")}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-black" style={{ color: TEXT }}>{detail.participant_name || "Participant"}</h2>
              <p className="text-[12px] font-semibold" style={{ color: MUTED }}>
                Worker: {detail.worker_name || "Unassigned"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
              <DetailRow icon={CalendarClock} label="Scheduled start" value={formatDateTime(detail.scheduled_start)} />
              <DetailRow icon={CalendarClock} label="Scheduled end" value={formatDateTime(detail.scheduled_end)} />
              <DetailRow icon={Clock} label="Clocked in" value={detail.clocked_in_at ? formatDateTime(detail.clocked_in_at) : "Not clocked in"} />
              <DetailRow icon={Clock} label="Clocked out" value={detail.clocked_out_at ? formatDateTime(detail.clocked_out_at) : "Not clocked out"} />
            </div>

            {tasks.length > 0 && (
              <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>
                    <ClipboardList size={13} /> Shift tasks
                  </p>
                  <span className="text-[11px] font-bold" style={{ color: TEXT }}>{completedTasks}/{tasks.length} done</span>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  {tasks.map((t, i) => (
                    <div key={t.id ?? i} className="flex items-center gap-2">
                      <CheckCircle2 size={13} style={{ color: t.completed ? GREEN : BORDER }} />
                      <p className="truncate text-[12px] font-medium" style={{ color: t.completed ? TEXT : MUTED }}>
                        {t.label || t.title || "Task"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(detail.coordinator_notes || detail.visit_notes || detail.session_notes) && (
              <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
                <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Notes on file</p>
                <div className="mt-2 space-y-2">
                  {detail.coordinator_notes && (
                    <p className="text-[12px] font-medium" style={{ color: TEXT }}>
                      <span className="font-bold">Coordinator: </span>{detail.coordinator_notes}
                    </p>
                  )}
                  {detail.visit_notes && (
                    <p className="text-[12px] font-medium" style={{ color: TEXT }}>
                      <span className="font-bold">Visit: </span>{detail.visit_notes}
                    </p>
                  )}
                  {detail.session_notes && (
                    <p className="text-[12px] font-medium" style={{ color: TEXT }}>
                      <span className="font-bold">Session: </span>{detail.session_notes}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {detail.has_risk_alerts && (
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: AMBER_SOFT, color: AMBER }}>
                  <AlertTriangle size={12} /> Risk alerts on file
                </span>
              )}
              {detail.risks_acknowledged && (
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: GREEN_SOFT, color: GREEN }}>
                  <ShieldCheck size={12} /> Risks acknowledged
                </span>
              )}
              {detail.conversation_id && (
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: BLUE_SOFT, color: BLUE }}>
                  <MessageSquare size={12} /> Shift chat active
                </span>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
