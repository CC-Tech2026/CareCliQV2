import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  MessageSquare,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import CoordinatorLivePage from "@/pages/coordinator-live";
import { MonthGrid } from "@/pages/coordinator-rostering";
import { RosterBoard } from "@/components/coordinator/RosterBoard";
import { SectionInfo } from "@/components/ui/section-info";
import {
  getCoordinatorWorkerStats,
  getShiftDetail,
  getWorkerAvailability,
  listCoordinatorShifts,
  type BlackoutDate,
  type CoordinatorShiftRecord,
  type ShiftDetail,
  type WorkerAvailability,
  type WorkerStats,
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

const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

type Bucket = "active" | "scheduled" | "completed" | "cancelled" | "unassigned";
type ViewMode = "week" | "month" | "list" | "live";
type AvailabilityMap = Record<
  string,
  WorkerAvailability & { blackout_dates?: BlackoutDate[] }
>;

const STATUS_STYLE: Record<
  Bucket,
  { label: string; color: string; bg: string }
> = {
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

const VIEW_TABS: Array<{ id: ViewMode; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" },
  { id: "live", label: "Live" },
];

// Matches RosterBoard's palette so a worker's avatar colour reads the same
// wherever they show up across the app.
const AVATAR_PALETTE = [
  { bg: "#F3E8FF", fg: "#7C3AED" },
  { bg: "#FCE3EB", fg: "#DB2777" },
  { bg: "#DBEAFE", fg: "#1D4ED8" },
  { bg: "#DCFCE7", fg: "#15803D" },
  { bg: "#FEF3C7", fg: "#B45309" },
  { bg: "#E0F2FE", fg: "#0369A1" },
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initials(name: string) {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}
function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const c = avatarColor(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.fg,
        fontSize: size * 0.4,
      }}
    >
      {initials(name)}
    </span>
  );
}

function bucketOf(shift: CoordinatorShiftRecord): Bucket {
  if (
    !shift.worker_id ||
    shift.worker_id === UNASSIGNED_PLACEHOLDER_ID ||
    shift.status === "unassigned"
  )
    return "unassigned";
  if (shift.status === "in_progress" || shift.status === "clocked_in")
    return "active";
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

function matchesSearch(shift: CoordinatorShiftRecord, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (shift.participant_name ?? "").toLowerCase().includes(q) ||
    (shift.worker_name ?? "").toLowerCase().includes(q)
  );
}

/** Quotes/escapes a CSV field per RFC 4180. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadWeekCsv(shifts: CoordinatorShiftRecord[], rangeLabel: string) {
  const header = ["Date", "Start", "End", "Participant", "Worker", "Status"];
  const rows = shifts
    .slice()
    .sort((a, b) =>
      (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
    )
    .map((s) => [
      s.scheduled_start
        ? format(new Date(s.scheduled_start), "yyyy-MM-dd")
        : "",
      formatTime(s.scheduled_start),
      formatTime(s.scheduled_end),
      s.participant_name || "",
      s.worker_name || "Unassigned",
      STATUS_STYLE[bucketOf(s)].label,
    ]);
  const csv = [header, ...rows]
    .map((r) => r.map((v) => csvCell(String(v))).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `master-schedule-${rangeLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function MDSchedulePage() {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(max-width: 767px)").matches
      ? "list"
      : "week",
  );
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [search, setSearch] = useState("");
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [availMap, setAvailMap] = useState<AvailabilityMap>({});
  const [loadingAvail, setLoadingAvail] = useState(false);

  const weekEnd = useMemo(
    () => endOfWeek(weekStart, { weekStartsOn: 1 }),
    [weekStart],
  );
  const days = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekStart, weekEnd],
  );

  // Month view spans a wider range than the week board, so the query range
  // follows whichever period is actually on screen — same approach as the
  // coordinator's own rostering page.
  const rangeStart =
    viewMode === "month" ? startOfMonth(currentMonth) : weekStart;
  const rangeEnd = viewMode === "month" ? endOfMonth(currentMonth) : weekEnd;
  const startKey = format(rangeStart, "yyyy-MM-dd");
  const endKey = format(rangeEnd, "yyyy-MM-dd");

  // Polls every 30s so an MD watching this page sees clock-ins/outs and
  // status changes as they happen, not just when they change weeks.
  const {
    data: shifts = null,
    isError,
    dataUpdatedAt,
    refetch,
    isFetching,
  } = useOrgQuery<CoordinatorShiftRecord[]>(["md-schedule", startKey, endKey], {
    queryFn: () =>
      listCoordinatorShifts({
        start_date: startKey,
        end_date: endKey,
        limit: 1000,
      }),
    refetchInterval: LIVE_REFRESH_MS,
    refetchOnWindowFocus: true,
    enabled: viewMode !== "live",
  });
  const error = isError;

  const workersQuery = useOrgQuery<WorkerStats[]>(
    ["md-schedule", "worker-stats"],
    {
      queryFn: getCoordinatorWorkerStats,
      staleTime: 60_000,
      enabled: viewMode === "week",
    },
  );
  const workers = workersQuery.data ?? [];

  // Availability shading for RosterBoard — only needed in week view, where
  // the drag-and-drop board is shown.
  useEffect(() => {
    if (viewMode !== "week" || workers.length === 0) return;
    let cancelled = false;
    setLoadingAvail(true);
    (async () => {
      const map: AvailabilityMap = {};
      for (const w of workers) {
        try {
          const data = await getWorkerAvailability(w.id);
          map[w.id] = {
            ...data.availability,
            blackout_dates: data.blackout_dates,
          };
        } catch {
          /* skip unavailable */
        }
      }
      if (!cancelled) {
        setAvailMap(map);
        setLoadingAvail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, workers]);

  const searchedShifts = useMemo(
    () => (shifts ?? []).filter((s) => matchesSearch(s, search)),
    [shifts, search],
  );

  const stats = useMemo(() => {
    const list = searchedShifts;
    const counts: Record<Bucket, number> = {
      active: 0,
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      unassigned: 0,
    };
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
    const cancellationRate =
      settled > 0 ? Math.round((counts.cancelled / settled) * 100) : null;
    const busiestCount = Math.max(0, ...Array.from(perDay.values()));
    return { total, counts, perDay, cancellationRate, busiestCount };
  }, [searchedShifts, days]);

  const periodWord = viewMode === "month" ? "this month" : "this week";

  const attentionItems = useMemo(() => {
    if (shifts === null) return [];
    const items: { key: string; text: string }[] = [];
    if (stats.counts.unassigned > 0) {
      items.push({
        key: "unassigned",
        text: `${stats.counts.unassigned} shift${stats.counts.unassigned === 1 ? "" : "s"} ${periodWord} ${stats.counts.unassigned === 1 ? "has" : "have"} no worker assigned.`,
      });
    }
    if (stats.cancellationRate !== null && stats.cancellationRate >= 15) {
      items.push({
        key: "cancellation",
        text: `Cancellation rate is elevated at ${stats.cancellationRate}% ${periodWord}.`,
      });
    }
    return items;
  }, [shifts, stats, periodWord]);

  // Ranked by hours so an MD can spot who's carrying the week's load, or
  // who's barely rostered, at a glance — a per-shift board doesn't surface
  // this on its own.
  const workload = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; hours: number }
    >();
    for (const s of searchedShifts) {
      if (!s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID) continue;
      const entry = map.get(s.worker_id) ?? {
        name: s.worker_name || "Worker",
        count: 0,
        hours: 0,
      };
      entry.count += 1;
      if (s.scheduled_start && s.scheduled_end) {
        const hrs =
          (new Date(s.scheduled_end).getTime() -
            new Date(s.scheduled_start).getTime()) /
          3_600_000;
        if (Number.isFinite(hrs)) entry.hours += Math.max(hrs, 0);
      }
      map.set(s.worker_id, entry);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.hours - a.hours);
  }, [searchedShifts]);
  const busiestHours = Math.max(0, ...workload.map((w) => w.hours));

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const day of days) map.set(format(day, "yyyy-MM-dd"), []);
    for (const s of searchedShifts) {
      if (!s.scheduled_start) continue;
      if (filter !== "all" && bucketOf(s) !== filter) continue;
      const key = format(new Date(s.scheduled_start), "yyyy-MM-dd");
      if (!map.has(key)) continue;
      map.get(key)!.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
      );
    }
    return map;
  }, [days, searchedShifts, filter]);

  const filteredShiftList = useMemo(() => {
    return searchedShifts
      .filter((s) => filter === "all" || bucketOf(s) === filter)
      .slice()
      .sort((a, b) =>
        (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
      );
  }, [searchedShifts, filter]);

  const monthDayShifts = useMemo(
    () =>
      filteredShiftList.filter(
        (s) =>
          s.scheduled_start &&
          isSameDay(parseISO(s.scheduled_start), selectedDay),
      ),
    [filteredShiftList, selectedDay],
  );

  const activityLog = useMemo(() => {
    return searchedShifts
      .filter((s) => bucketOf(s) === "cancelled" || bucketOf(s) === "active")
      .sort((a, b) =>
        (b.scheduled_start ?? "").localeCompare(a.scheduled_start ?? ""),
      );
  }, [searchedShifts]);

  const periodLabel =
    viewMode === "month"
      ? format(currentMonth, "MMMM yyyy")
      : `${format(weekStart, "d MMM")} - ${format(weekEnd, "d MMM")}`;

  const handlePrev = () => {
    if (viewMode === "month") {
      const next = subMonths(currentMonth, 1);
      setCurrentMonth(next);
      setSelectedDay(startOfMonth(next));
    } else {
      const next = addDays(weekStart, -7);
      setWeekStart(next);
      setSelectedDay(next);
    }
  };
  const handleNext = () => {
    if (viewMode === "month") {
      const next = addMonths(currentMonth, 1);
      setCurrentMonth(next);
      setSelectedDay(startOfMonth(next));
    } else {
      const next = addDays(weekStart, 7);
      setWeekStart(next);
      setSelectedDay(next);
    }
  };

  return (
    <HubLayout>
      <div className="min-w-0 space-y-5 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="flex items-center gap-2 text-2xl font-semibold tracking-tight"
              style={{ color: TEXT }}
            >
              Master Schedule
              <SectionInfo text="Org-wide shift oversight. Reassigning and unassigning shifts is available here; creating new shifts stays with coordinators." />
            </h1>
            <p className="mt-1 text-sm text-cc-muted">
              Review coverage, find shifts and monitor your organisation.
            </p>
            <p
              className="mt-2 flex items-center gap-1.5 text-[12px] font-medium"
              style={{ color: MUTED }}
            >
              {shifts !== null && !error && viewMode !== "live" && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Radio size={11} style={{ color: GREEN }} />
                  <span style={{ color: GREEN }}>Live</span>
                  {dataUpdatedAt > 0 && (
                    <span>
                      · updated{" "}
                      {format(
                        new Date(dataUpdatedAt),
                        "h:mm:ssaaa",
                      ).toLowerCase()}
                    </span>
                  )}
                </span>
              )}
            </p>
          </div>

          <div className="flex w-full min-w-0 flex-wrap items-center gap-3 rounded-xl border border-cc-border bg-cc-card p-3">
            {(viewMode === "week" || viewMode === "list") &&
              shifts !== null && (
                <span
                  className="hidden rounded-full px-3 py-1.5 text-[11px] font-semibold sm:block"
                  style={{
                    background:
                      stats.counts.unassigned > 0 ? AMBER_SOFT : GREEN_SOFT,
                    color: stats.counts.unassigned > 0 ? AMBER : GREEN,
                  }}
                >
                  {stats.counts.unassigned > 0
                    ? `${stats.counts.unassigned} unassigned this week`
                    : "Fully staffed this week"}
                </span>
              )}

            {viewMode !== "live" && (
              <div className="relative min-w-0 flex-1 basis-56">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: MUTED }}
                />
                <input
                  aria-label="Search schedule"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search worker or participant"
                  className="h-11 w-full rounded-lg border pl-8 pr-3 text-sm font-semibold outline-none"
                  style={{
                    borderColor: BORDER,
                    background: SURFACE,
                    color: TEXT,
                  }}
                />
              </div>
            )}

            {viewMode !== "live" && shifts !== null && shifts.length > 0 && (
              <button
                onClick={() =>
                  downloadWeekCsv(
                    filteredShiftList,
                    viewMode === "month"
                      ? format(currentMonth, "yyyy-MM")
                      : startKey,
                  )
                }
                className="flex h-11 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition-colors hover:bg-cc-soft"
                style={{
                  borderColor: BORDER,
                  color: TEXT,
                  background: SURFACE,
                }}
              >
                <Download size={15} />
                <span className="sr-only sm:not-sr-only">Export</span>
              </button>
            )}

            {/* View mode tabs */}
            <div
              className="flex w-full items-center gap-0.5 rounded-xl p-1 sm:w-auto"
              style={{
                borderColor: BORDER,
                background: SOFT,
                border: `1px solid ${BORDER}`,
              }}
            >
              {VIEW_TABS.map((v) => (
                <button
                  key={v.id}
                  aria-pressed={viewMode === v.id}
                  onClick={() => {
                    setViewMode(v.id);
                    if (v.id === "month") setCurrentMonth(selectedDay);
                    else if (viewMode === "month")
                      setWeekStart(
                        startOfWeek(selectedDay, { weekStartsOn: 1 }),
                      );
                  }}
                  className="min-h-11 flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:flex-none sm:px-3 sm:text-sm"
                  style={{
                    background: viewMode === v.id ? PLUM : "transparent",
                    color: viewMode === v.id ? "#fff" : MUTED,
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {viewMode !== "live" && (
              <div
                className="flex w-full min-w-0 items-center gap-1 rounded-lg border p-1 sm:w-auto"
                style={{ borderColor: BORDER, background: SURFACE }}
              >
                <button
                  onClick={handlePrev}
                  className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-cc-soft"
                  aria-label="Previous period"
                >
                  <ChevronLeft size={15} style={{ color: MUTED }} />
                </button>
                <span
                  className="min-w-0 flex-1 px-1 text-center text-xs font-semibold"
                  style={{ color: TEXT }}
                >
                  {periodLabel}
                </span>
                <button
                  onClick={handleNext}
                  className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-cc-soft"
                  aria-label="Next period"
                >
                  <ChevronRight size={15} style={{ color: MUTED }} />
                </button>
                <button
                  onClick={() => {
                    const today = new Date();
                    setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
                    setCurrentMonth(today);
                    setSelectedDay(today);
                  }}
                  className="min-h-11 rounded-lg px-3 text-sm font-medium text-cc-plum"
                >
                  Today
                </button>
              </div>
            )}
          </div>
        </div>

        {viewMode === "live" && <CoordinatorLivePage readOnly embedded />}

        {viewMode !== "live" && (
          <>
            {/* Needs attention — the specific roster issues on this page that
            want a coordinator's action, not just a status readout. */}
            {attentionItems.length > 0 && (
              <div
                className="rounded-2xl border p-4"
                style={{ borderColor: DANGER, background: DANGER_SOFT }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle size={16} style={{ color: DANGER }} />
                    <p
                      className="text-[12px] font-semibold"
                      style={{ color: DANGER }}
                    >
                      Needs attention
                    </p>
                    <SectionInfo
                      text={`Roster issues on this page that need action ${periodWord} — shifts with no worker assigned, and a cancellation rate running high.`}
                    />
                  </div>
                  <button
                    onClick={() => {
                      setFilter(
                        stats.counts.unassigned > 0
                          ? "unassigned"
                          : "cancelled",
                      );
                    }}
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: DANGER }}
                  >
                    {stats.counts.unassigned > 0
                      ? "Review unassigned"
                      : "Review cancellations"}
                  </button>
                </div>
                <ul className="mt-2.5 space-y-1">
                  {attentionItems.map((item) => (
                    <li
                      key={item.key}
                      className="text-[11.5px] font-semibold"
                      style={{ color: TEXT }}
                    >
                      • {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stat strip — one bordered row with internal dividers instead of a
            grid of near-identical boxes, so six numbers don't read as six
            repeated card components. */}
            <div
              className="grid grid-cols-3 overflow-hidden rounded-xl border sm:grid-cols-6"
              style={{ borderColor: BORDER, background: SURFACE }}
            >
              {(
                [
                  { label: "Total shifts", value: stats.total, color: TEXT },
                  {
                    label: "Active now",
                    value: stats.counts.active,
                    color: BLUE,
                  },
                  {
                    label: "Completed",
                    value: stats.counts.completed,
                    color: GREEN,
                  },
                  {
                    label: "Cancelled",
                    value: stats.counts.cancelled,
                    color: SLATE,
                  },
                  {
                    label: "Unassigned",
                    value: stats.counts.unassigned,
                    color: AMBER,
                  },
                  {
                    label: "Cancellation rate",
                    value:
                      stats.cancellationRate === null
                        ? "—"
                        : `${stats.cancellationRate}%`,
                    color:
                      stats.cancellationRate !== null &&
                      stats.cancellationRate >= 15
                        ? DANGER
                        : TEXT,
                  },
                ] as const
              ).map((tile, i) => (
                <div
                  key={tile.label}
                  className={`min-w-0 px-3 py-3 ${["Total shifts", "Active now", "Unassigned"].includes(tile.label) ? "" : "hidden sm:block"}`}
                  style={
                    i > 0 ? { borderLeft: `1px solid ${BORDER}` } : undefined
                  }
                >
                  <p
                    className="text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: MUTED }}
                  >
                    {tile.label}
                  </p>
                  <p
                    className="mt-1 text-lg font-semibold"
                    style={{ color: tile.color }}
                  >
                    {shifts === null ? "—" : tile.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {/* Status filter */}
              <select
                aria-label="Filter schedule status"
                value={filter}
                onChange={(e) => setFilter(e.target.value as Bucket | "all")}
                className="h-11 w-full rounded-lg border border-cc-border bg-transparent px-3 text-sm text-cc-text sm:hidden"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} (
                    {f.key === "all" ? stats.total : stats.counts[f.key]})
                  </option>
                ))}
              </select>
              <div className="hidden flex-wrap gap-1.5 sm:flex">
                {STATUS_FILTERS.map((f) => {
                  const active = filter === f.key;
                  const count =
                    f.key === "all"
                      ? stats.total
                      : stats.counts[f.key as Bucket];
                  return (
                    <button
                      key={f.key}
                      aria-pressed={active}
                      onClick={() => setFilter(f.key)}
                      className="min-h-11 rounded-lg border px-3 py-2 text-xs font-bold transition-colors"
                      style={{
                        borderColor: active ? PLUM : BORDER,
                        background: active ? PLUM : SURFACE,
                        color: active ? "#fff" : TEXT,
                      }}
                    >
                      {f.label}
                      {shifts !== null ? ` (${count})` : ""}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-cc-muted">
                <span role="status">
                  {shifts === null
                    ? error
                      ? "Schedule unavailable"
                      : "Loading shifts..."
                    : `${filteredShiftList.length} matching shift${filteredShiftList.length === 1 ? "" : "s"}`}
                </span>
                <div className="flex flex-wrap gap-2">
                  {(search || filter !== "all") && (
                    <button
                      className="min-h-11 px-3 font-medium text-cc-plum"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                  <button
                    disabled={isFetching}
                    onClick={() => void refetch()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cc-border px-3 disabled:opacity-50"
                  >
                    <RefreshCw
                      size={15}
                      className={isFetching ? "animate-spin" : ""}
                    />{" "}
                    Refresh
                  </button>
                </div>
              </div>
              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-cc-border bg-cc-card p-4"
                >
                  <p className="font-semibold text-cc-text">
                    Couldn't refresh the schedule.
                  </p>
                  <p className="mt-1">
                    {shifts
                      ? "Showing the last loaded shifts. Refresh to try again."
                      : "Use Refresh to try loading the schedule again."}
                  </p>
                </div>
              )}
            </div>
            {viewMode === "week" && (!error || shifts !== null) && (
              <>
                <details className="rounded-xl border border-cc-border bg-cc-card p-4">
                  <summary className="cursor-pointer text-sm font-medium text-cc-text">
                    Workload insights
                  </summary>
                  <div className="mt-4 space-y-4">
                    {/* Daily load pattern */}
                    {shifts !== null && stats.total > 0 && (
                      <div
                        className="rounded-2xl border p-4"
                        style={{ borderColor: BORDER, background: SURFACE }}
                      >
                        <div className="flex items-center gap-1.5">
                          <p
                            className="text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: MUTED }}
                          >
                            Rostering pattern this week
                          </p>
                          <SectionInfo text="How shifts are spread across the week. Taller bars mean more shifts scheduled that day; the busiest day is highlighted." />
                        </div>
                        <div className="mt-3 grid grid-cols-7 gap-2">
                          {days.map((day) => {
                            const key = format(day, "yyyy-MM-dd");
                            const count = stats.perDay.get(key) ?? 0;
                            const heightPct =
                              stats.busiestCount > 0
                                ? Math.max(
                                    8,
                                    (count / stats.busiestCount) * 100,
                                  )
                                : 8;
                            return (
                              <div
                                key={key}
                                className="flex flex-col items-center gap-1.5"
                              >
                                <div
                                  className="flex h-16 w-full items-end justify-center rounded-lg"
                                  style={{ background: SOFT }}
                                >
                                  <div
                                    className="w-full rounded-lg"
                                    style={{
                                      height: `${heightPct}%`,
                                      background:
                                        count === stats.busiestCount &&
                                        count > 0
                                          ? PLUM
                                          : BLUE,
                                      opacity: count === 0 ? 0 : 1,
                                    }}
                                  />
                                </div>
                                <p
                                  className="text-[9px] font-semibold uppercase"
                                  style={{ color: isToday(day) ? PLUM : MUTED }}
                                >
                                  {format(day, "EEE")}
                                </p>
                                <p
                                  className="text-[10px] font-bold"
                                  style={{ color: TEXT }}
                                >
                                  {count}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Worker workload — who's carrying this week, ranked by hours. */}
                    {workload.length > 0 && (
                      <div
                        className="rounded-2xl border"
                        style={{ borderColor: BORDER, background: SURFACE }}
                      >
                        <div
                          className="flex items-center gap-1.5 border-b px-4 py-3"
                          style={{ borderColor: BORDER }}
                        >
                          <p
                            className="text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: MUTED }}
                          >
                            Worker workload this week
                          </p>
                          <SectionInfo text="Rostered hours per worker this week, busiest first — a quick read on who's overloaded or under-rostered." />
                        </div>
                        <div
                          className="max-h-64 divide-y overflow-y-auto"
                          style={{ borderColor: BORDER }}
                        >
                          {workload.map((w) => (
                            <div
                              key={w.id}
                              className="flex items-center gap-3 px-4 py-2.5"
                            >
                              <Avatar name={w.name} />
                              <p
                                className="min-w-0 flex-1 truncate text-[12px] font-bold"
                                style={{ color: TEXT }}
                              >
                                {w.name}
                              </p>
                              <div
                                className="h-1.5 w-24 overflow-hidden rounded-full"
                                style={{ background: SOFT }}
                              >
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${busiestHours > 0 ? Math.max(4, (w.hours / busiestHours) * 100) : 0}%`,
                                    background: PLUM,
                                  }}
                                />
                              </div>
                              <p
                                className="w-24 shrink-0 text-right text-[11px] font-bold"
                                style={{ color: MUTED }}
                              >
                                {w.hours.toFixed(1)}h · {w.count} shift
                                {w.count === 1 ? "" : "s"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
                {shifts === null ? (
                  <div className="grid gap-3 lg:grid-cols-7">
                    {days.map((day) => (
                      <div
                        key={format(day, "yyyy-MM-dd")}
                        className="space-y-2 rounded-2xl border p-2"
                        style={{ borderColor: BORDER, background: SURFACE }}
                      >
                        <div
                          className="h-10 animate-pulse rounded-lg"
                          style={{ background: SOFT }}
                        />
                        <div
                          className="h-10 animate-pulse rounded-lg"
                          style={{ background: SOFT }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <p
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: MUTED }}
                      >
                        Weekly board
                      </p>
                      <SectionInfo text="Drag a shift onto a different worker's row to reassign it, or drag it to the Unassigned tray to remove the worker. Click a shift for full detail." />
                    </div>
                    <RosterBoard
                      weekStart={weekStart}
                      shifts={
                        filter === "all" ? searchedShifts : filteredShiftList
                      }
                      workers={workers}
                      availMap={availMap}
                      loadingAvail={loadingAvail}
                      onCellClick={() => {
                        /* Creating new shifts stays with coordinators. */
                      }}
                      onRefresh={() => {
                        /* useOrgQuery invalidation inside RosterBoard already refetches. */
                      }}
                    />
                  </>
                )}
              </>
            )}

            {viewMode === "month" && (!error || shifts !== null) && (
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                {shifts === null ? (
                  <div
                    className="h-96 animate-pulse rounded-2xl"
                    style={{ background: SOFT }}
                  />
                ) : (
                  <MonthGrid
                    month={currentMonth}
                    shifts={filteredShiftList}
                    selectedDay={selectedDay}
                    onSelectDay={setSelectedDay}
                  />
                )}
                <div
                  className="rounded-2xl border"
                  style={{ borderColor: BORDER, background: SURFACE }}
                >
                  <div
                    className="border-b px-4 py-3"
                    style={{ borderColor: BORDER }}
                  >
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: MUTED }}
                    >
                      {format(selectedDay, "EEEE")}
                    </p>
                    <p
                      className="text-[15px] font-semibold"
                      style={{ color: isToday(selectedDay) ? PLUM : TEXT }}
                    >
                      {format(selectedDay, "d MMMM yyyy")}
                    </p>
                  </div>
                  <div className="max-h-[480px] space-y-1.5 overflow-y-auto p-2.5">
                    {monthDayShifts.length === 0 ? (
                      <p
                        className="p-2 text-[11px] font-medium"
                        style={{ color: MUTED }}
                      >
                        {shifts === null
                          ? "Loading shifts..."
                          : "No matching shifts this day"}
                      </p>
                    ) : (
                      monthDayShifts
                        .slice()
                        .sort((a, b) =>
                          (a.scheduled_start ?? "").localeCompare(
                            b.scheduled_start ?? "",
                          ),
                        )
                        .map((s) => {
                          const st = STATUS_STYLE[bucketOf(s)];
                          return (
                            <button
                              key={s.id}
                              onClick={() => setActiveShiftId(s.id)}
                              className="w-full rounded-lg p-2 text-left transition-transform hover:scale-[1.02]"
                              style={{ background: st.bg }}
                            >
                              <p
                                className="text-[10px] font-semibold"
                                style={{ color: st.color }}
                              >
                                {formatTime(s.scheduled_start)}
                              </p>
                              <p
                                className="mt-0.5 truncate text-[11px] font-bold"
                                style={{ color: TEXT }}
                              >
                                {s.participant_name || "Participant"}
                              </p>
                              <div className="mt-1 flex items-center gap-1.5">
                                {s.worker_name && (
                                  <Avatar name={s.worker_name} size={16} />
                                )}
                                <p
                                  className="truncate text-[10px] font-medium"
                                  style={{
                                    color:
                                      bucketOf(s) === "unassigned"
                                        ? AMBER
                                        : MUTED,
                                  }}
                                >
                                  {bucketOf(s) === "unassigned"
                                    ? "Unassigned"
                                    : s.worker_name || "Worker"}
                                </p>
                              </div>
                            </button>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            )}

            {viewMode === "list" && (!error || shifts !== null) && (
              <div
                className="overflow-hidden rounded-2xl border"
                style={{ borderColor: BORDER, background: SURFACE }}
              >
                {shifts === null ? (
                  <div className="space-y-2 p-3">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-12 animate-pulse rounded-lg"
                        style={{ background: SOFT }}
                      />
                    ))}
                  </div>
                ) : filteredShiftList.length === 0 ? (
                  <p
                    className="p-8 text-center text-[12px] font-medium"
                    style={{ color: MUTED }}
                  >
                    No shifts match this filter.
                  </p>
                ) : (
                  <div className="divide-y" style={{ borderColor: BORDER }}>
                    {filteredShiftList.map((s) => {
                      const st = STATUS_STYLE[bucketOf(s)];
                      return (
                        <button
                          key={s.id}
                          onClick={() => setActiveShiftId(s.id)}
                          className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-cc-soft lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]"
                        >
                          <span
                            className="col-start-1 row-start-2 text-xs font-medium lg:col-auto lg:row-auto"
                            style={{ color: TEXT }}
                          >
                            {formatDateTime(s.scheduled_start)}
                          </span>
                          <p
                            className="col-start-1 row-start-1 min-w-0 break-words text-sm font-semibold lg:col-auto lg:row-auto"
                            style={{ color: TEXT }}
                          >
                            {s.participant_name || "Participant"}
                          </p>
                          <div className="col-span-2 flex min-w-0 items-center gap-1.5 lg:col-span-1">
                            {s.worker_name && (
                              <Avatar name={s.worker_name} size={18} />
                            )}
                            <p
                              className="truncate text-[11px] font-semibold"
                              style={{
                                color:
                                  bucketOf(s) === "unassigned" ? AMBER : MUTED,
                              }}
                            >
                              {bucketOf(s) === "unassigned"
                                ? "Unassigned"
                                : s.worker_name || "Worker"}
                            </p>
                          </div>
                          <span
                            className="col-start-2 row-start-1 rounded-md px-2.5 py-1 text-xs font-medium lg:col-auto lg:row-auto"
                            style={{ background: st.bg, color: st.color }}
                          >
                            {st.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Activity log: cancellations + shifts in progress right now */}
            {viewMode === "week" &&
              shifts !== null &&
              activityLog.length > 0 && (
                <div
                  className="rounded-2xl border"
                  style={{ borderColor: BORDER, background: SURFACE }}
                >
                  <div
                    className="flex items-center gap-1.5 border-b px-4 py-3"
                    style={{ borderColor: BORDER }}
                  >
                    <p
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: MUTED }}
                    >
                      Activity log — active shifts &amp; cancellations this week
                    </p>
                    <SectionInfo text="Shifts currently in progress and shifts cancelled this week, most recent first — a quick read on what's happening right now." />
                  </div>
                  <div
                    className="max-h-72 divide-y overflow-y-auto"
                    style={{ borderColor: BORDER }}
                  >
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
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: st.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-[12px] font-bold"
                              style={{ color: TEXT }}
                            >
                              {s.participant_name || "Participant"} ·{" "}
                              {s.worker_name || "Unassigned"}
                            </p>
                            <p
                              className="text-[10px] font-medium"
                              style={{ color: MUTED }}
                            >
                              {bucket === "active" &&
                              elapsedSince(s.clocked_in_at)
                                ? `Clocked in ${formatTime(s.clocked_in_at)} · active ${elapsedSince(s.clocked_in_at)}`
                                : formatDateTime(s.scheduled_start)}
                            </p>
                          </div>
                          <span
                            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold"
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

      <ShiftDetailSheet
        shiftId={activeShiftId}
        onClose={() => setActiveShiftId(null)}
      />
    </HubLayout>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
      <div>
        <p
          className="text-[10px] font-bold uppercase tracking-wide"
          style={{ color: MUTED }}
        >
          {label}
        </p>
        <p className="text-[12px] font-semibold" style={{ color: TEXT }}>
          {value}
        </p>
      </div>
    </div>
  );
}

function ShiftDetailSheet({
  shiftId,
  onClose,
}: {
  shiftId: string | null;
  onClose: () => void;
}) {
  // Polls while open so a shift being actively worked (task ticks, clock-out)
  // updates live rather than needing the sheet closed and reopened.
  const {
    data: detail = null,
    isLoading: loading,
    isError: error,
  } = useOrgQuery<ShiftDetail>(["md-schedule-shift-detail", shiftId], {
    queryFn: () => getShiftDetail(shiftId!),
    enabled: !!shiftId,
    refetchInterval: (query) =>
      query.state.data && bucketOf(query.state.data) === "active"
        ? LIVE_REFRESH_MS
        : false,
  });

  const bucket = detail ? bucketOf(detail) : null;
  const st = bucket ? STATUS_STYLE[bucket] : null;
  const tasks = detail?.tasks ?? [];
  const completedTasks = tasks.filter((t) => t.completed).length;

  return (
    <Sheet open={!!shiftId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-4 pt-12 sm:max-w-xl sm:p-6 sm:pt-12"
        style={{ background: "var(--cc-bg)" }}
      >
        <SheetTitle className="sr-only">Shift details</SheetTitle>
        {loading || !detail ? (
          <div className="space-y-3 pt-8">
            {error ? (
              <p className="text-[12px] font-bold" style={{ color: MUTED }}>
                Couldn't load this shift.
              </p>
            ) : (
              <>
                <div
                  className="h-6 w-2/3 animate-pulse rounded-lg"
                  style={{ background: SOFT }}
                />
                <div
                  className="h-20 animate-pulse rounded-2xl"
                  style={{ background: SOFT }}
                />
                <div
                  className="h-32 animate-pulse rounded-2xl"
                  style={{ background: SOFT }}
                />
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5 pt-6">
            <div>
              <div className="flex items-center gap-2">
                {st && (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                    style={{ background: st.bg, color: st.color }}
                  >
                    {st.label}
                  </span>
                )}
                <span
                  className="text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: MUTED }}
                >
                  {(detail.shift_type || "standard_support").replace(/_/g, " ")}
                </span>
              </div>
              <h2
                className="mt-2 text-lg font-semibold"
                style={{ color: TEXT }}
              >
                {detail.participant_name || "Participant"}
              </h2>
              <p
                className="flex items-center gap-1.5 text-[12px] font-semibold"
                style={{ color: MUTED }}
              >
                {detail.worker_name && (
                  <Avatar name={detail.worker_name} size={18} />
                )}
                Worker: {detail.worker_name || "Unassigned"}
              </p>
            </div>

            <div
              className="grid grid-cols-2 gap-3 rounded-2xl border p-4"
              style={{ borderColor: BORDER, background: SURFACE }}
            >
              <DetailRow
                icon={CalendarClock}
                label="Scheduled start"
                value={formatDateTime(detail.scheduled_start)}
              />
              <DetailRow
                icon={CalendarClock}
                label="Scheduled end"
                value={formatDateTime(detail.scheduled_end)}
              />
              <DetailRow
                icon={Clock}
                label="Clocked in"
                value={
                  detail.clocked_in_at
                    ? formatDateTime(detail.clocked_in_at)
                    : "Not clocked in"
                }
              />
              <DetailRow
                icon={Clock}
                label="Clocked out"
                value={
                  detail.clocked_out_at
                    ? formatDateTime(detail.clocked_out_at)
                    : "Not clocked out"
                }
              />
            </div>

            {tasks.length > 0 && (
              <div
                className="rounded-2xl border p-4"
                style={{ borderColor: BORDER, background: SURFACE }}
              >
                <div className="flex items-center justify-between">
                  <p
                    className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: MUTED }}
                  >
                    <ClipboardList size={13} /> Shift tasks
                  </p>
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: TEXT }}
                  >
                    {completedTasks}/{tasks.length} done
                  </span>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  {tasks.map((t, i) => (
                    <div key={t.id ?? i} className="flex items-center gap-2">
                      <CheckCircle2
                        size={13}
                        style={{ color: t.completed ? GREEN : BORDER }}
                      />
                      <p
                        className="truncate text-[12px] font-medium"
                        style={{ color: t.completed ? TEXT : MUTED }}
                      >
                        {t.label || t.title || "Task"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(detail.coordinator_notes ||
              detail.visit_notes ||
              detail.session_notes) && (
              <div
                className="rounded-2xl border p-4"
                style={{ borderColor: BORDER, background: SURFACE }}
              >
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: MUTED }}
                >
                  Notes on file
                </p>
                <div className="mt-2 space-y-2">
                  {detail.coordinator_notes && (
                    <p
                      className="text-[12px] font-medium"
                      style={{ color: TEXT }}
                    >
                      <span className="font-bold">Coordinator: </span>
                      {detail.coordinator_notes}
                    </p>
                  )}
                  {detail.visit_notes && (
                    <p
                      className="text-[12px] font-medium"
                      style={{ color: TEXT }}
                    >
                      <span className="font-bold">Visit: </span>
                      {detail.visit_notes}
                    </p>
                  )}
                  {detail.session_notes && (
                    <p
                      className="text-[12px] font-medium"
                      style={{ color: TEXT }}
                    >
                      <span className="font-bold">Session: </span>
                      {detail.session_notes}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {detail.has_risk_alerts && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: AMBER_SOFT, color: AMBER }}
                >
                  <AlertTriangle size={12} /> Risk alerts on file
                </span>
              )}
              {detail.risks_acknowledged && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: GREEN_SOFT, color: GREEN }}
                >
                  <ShieldCheck size={12} /> Risks acknowledged
                </span>
              )}
              {detail.conversation_id && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: BLUE_SOFT, color: BLUE }}
                >
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
