import { useSearch } from "wouter";
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
  CalendarX2,
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
  X,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import {
  EmptyState,
  Notice,
  PageHeader,
  RowList,
  StatusText,
  SummaryStrip,
  Surface,
  ghostClass,
  outlineClass,
  rowClass,
} from "@/components/layout/PageKit";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import CoordinatorLivePage from "@/pages/coordinator-live";
import { MonthGrid } from "@/pages/coordinator-rostering";
import { RosterBoard } from "@/components/coordinator/RosterBoard";
import { DayTimeline } from "@/components/coordinator/DayTimeline";
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
const ITEMS_PER_PAGE = 25;

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
const DANGER = "var(--cc-status-danger)";
const DANGER_SOFT = "var(--cc-status-danger-bg)";

const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

type Bucket = "active" | "scheduled" | "completed" | "cancelled" | "unassigned";
type ViewMode = "day" | "week" | "month" | "list" | "live";
type AvailabilityMap = Record<
  string,
  WorkerAvailability & { blackout_dates?: BlackoutDate[] }
>;

const STATUS_STYLE: Record<
  Bucket,
  { label: string; color: string; bg: string }
> = {
  scheduled: { label: "Scheduled", color: PLUM, bg: SOFT },
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
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" },
  { id: "live", label: "Live" },
];

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
  const [page, setPage] = useState(1);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  // The weekly board lists only people with shifts that week; everyone else
  // is one click away (needed to drag a shift onto someone new).
  const [showAllWorkers, setShowAllWorkers] = useState(false);
  const deepLinkShiftId = new URLSearchParams(useSearch()).get("shiftId");

  useEffect(() => {
    if (deepLinkShiftId) setActiveShiftId(deepLinkShiftId);
  }, [deepLinkShiftId]);

  useEffect(() => {
    setPage(1);
  }, [filter, search, viewMode]);

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

  const rangeStart =
    viewMode === "month"
      ? startOfMonth(currentMonth)
      : viewMode === "day"
        ? addDays(selectedDay, -1)
        : weekStart;
  const rangeEnd =
    viewMode === "month"
      ? endOfMonth(currentMonth)
      : viewMode === "day"
        ? addDays(selectedDay, 1)
        : weekEnd;
  const startKey = format(rangeStart, "yyyy-MM-dd");
  const endKey = format(rangeEnd, "yyyy-MM-dd");

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
      enabled: viewMode === "week" || viewMode === "day",
    },
  );
  const workers = workersQuery.data ?? [];

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

  const periodWord =
    viewMode === "month" ? "this month" : viewMode === "day" ? "today" : "this week";

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

  const boardWorkers = useMemo(() => {
    if (showAllWorkers) return workers;
    const rostered = new Set(searchedShifts.map((s) => s.worker_id).filter(Boolean));
    return workers.filter((w) => rostered.has(w.id));
  }, [showAllWorkers, workers, searchedShifts]);

  const noShiftsInPeriod = shifts !== null && !error && (shifts ?? []).length === 0;

  const filteredShiftList = useMemo(() => {
    return searchedShifts
      .filter((s) => filter === "all" || bucketOf(s) === filter)
      .slice()
      .sort((a, b) =>
        (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
      );
  }, [searchedShifts, filter]);

  const totalPages = Math.ceil(filteredShiftList.length / ITEMS_PER_PAGE);
  const paginatedShifts = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredShiftList.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredShiftList, page]);

  // List view: shifts grouped under the day they start.
  const listGroups = useMemo(() => {
    const groups: { key: string; label: string; shifts: CoordinatorShiftRecord[] }[] = [];
    for (const s of paginatedShifts) {
      const key = s.scheduled_start ? format(parseISO(s.scheduled_start), "yyyy-MM-dd") : "none";
      let group = groups.find((g) => g.key === key);
      if (!group) {
        const label = s.scheduled_start
          ? `${isToday(parseISO(s.scheduled_start)) ? "Today, " : ""}${format(parseISO(s.scheduled_start), "EEEE d MMMM")}`
          : "No start time";
        group = { key, label, shifts: [] };
        groups.push(group);
      }
      group.shifts.push(s);
    }
    return groups;
  }, [paginatedShifts]);

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
      : viewMode === "day"
        ? format(selectedDay, "EEE d MMM yyyy")
        : `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`;

  const moveDay = (delta: number) => {
    const next = addDays(selectedDay, delta);
    setSelectedDay(next);
    setWeekStart(startOfWeek(next, { weekStartsOn: 1 }));
    setCurrentMonth(next);
  };
  const handlePrev = () => {
    if (viewMode === "day") return moveDay(-1);
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
    if (viewMode === "day") return moveDay(1);
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
      <div className="min-w-0 space-y-6 pb-12">
        <PageHeader
          eyebrow="Operations & Care"
          title={
            <span className="inline-flex items-center gap-2">
              Master Schedule
              <SectionInfo text="Org-wide shift oversight. Reassigning and unassigning shifts is available here; creating new shifts stays with coordinators." />
            </span>
          }
          description={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Every shift across the organisation, by day, week or month.</span>
              {shifts !== null && !error && viewMode !== "live" && (
                <span className="inline-flex items-center gap-1.5">
                  <Radio size={12} style={{ color: GREEN }} />
                  <span className="font-semibold" style={{ color: GREEN }}>Live</span>
                  {dataUpdatedAt > 0 && <span>· {format(new Date(dataUpdatedAt), "h:mm:ss aaa").toLowerCase()}</span>}
                </span>
              )}
              {(viewMode === "week" || viewMode === "list") && shifts !== null && (
                <StatusText tone={stats.counts.unassigned > 0 ? "warning" : stats.total > 0 ? "good" : "neutral"}>
                  {stats.counts.unassigned > 0
                    ? `${stats.counts.unassigned} unassigned ${periodWord}`
                    : stats.total > 0
                      ? `Fully staffed ${periodWord}`
                      : `No shifts ${periodWord}`}
                </StatusText>
              )}
            </span>
          }
        />

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {viewMode !== "live" && (
              <div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                  style={{ color: MUTED }}
                />
                <input
                  aria-label="Search schedule"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search worker or participant..."
                  className="h-11 w-full rounded-full border border-cc-border bg-cc-surface pl-11 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cc-plum"
                  style={{ color: TEXT }}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5"
                  >
                    <X size={11} style={{ color: MUTED }} />
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 ml-auto">
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
                  className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft"
                  style={{ color: TEXT }}
                >
                  <Download size={15} />
                  <span>Export</span>
                </button>
              )}

              {viewMode !== "live" && (
                <button
                  type="button"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                  className={`${ghostClass} h-10 min-h-10`}
                  aria-label="Refresh the schedule"
                >
                  <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              )}

              <div
                className="flex items-center gap-0.5 rounded-full border bg-cc-surface p-1"
                style={{ borderColor: BORDER }}
              >
                {VIEW_TABS.map((v) => (
                  <button
                    key={v.id}
                    aria-pressed={viewMode === v.id}
                    onClick={() => {
                      setViewMode(v.id);
                      if (v.id === "month") setCurrentMonth(selectedDay);
                      else if (viewMode === "month" || viewMode === "day")
                        setWeekStart(
                          startOfWeek(selectedDay, { weekStartsOn: 1 }),
                        );
                    }}
                    className="h-9 rounded-full px-3.5 text-sm font-medium transition"
                    style={{
                      background: viewMode === v.id ? TEXT : "transparent",
                      color: viewMode === v.id ? "var(--cc-bg)" : MUTED,
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {viewMode !== "live" && (
                <div
                  className="flex items-center gap-1 rounded-full border bg-cc-surface p-1"
                  style={{ borderColor: BORDER }}
                >
                  <button
                    onClick={handlePrev}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-cc-soft"
                    aria-label="Previous period"
                  >
                    <ChevronLeft size={14} style={{ color: MUTED }} />
                  </button>
                  <span
                    className="min-w-[120px] px-1 text-center text-sm font-medium truncate"
                    style={{ color: TEXT }}
                  >
                    {periodLabel}
                  </span>
                  <button
                    onClick={handleNext}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-cc-soft"
                    aria-label="Next period"
                  >
                    <ChevronRight size={14} style={{ color: MUTED }} />
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
                      setCurrentMonth(today);
                      setSelectedDay(today);
                    }}
                    className="h-9 px-3.5 rounded-full text-sm font-medium transition hover:bg-cc-soft"
                    style={{ color: TEXT }}
                  >
                    Today
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {viewMode === "live" && <CoordinatorLivePage readOnly embedded />}

        {viewMode !== "live" && (
          <>
            {attentionItems.length > 0 && (
              <Notice
                tone="danger"
                icon={AlertTriangle}
                title={
                  <span className="inline-flex items-center gap-2">
                    Needs attention
                    <SectionInfo
                      text={`Roster issues on this page that need action ${periodWord} — shifts with no worker assigned, and a cancellation rate running high.`}
                    />
                  </span>
                }
                action={
                  <button
                    onClick={() => {
                      setFilter(
                        stats.counts.unassigned > 0
                          ? "unassigned"
                          : "cancelled",
                      );
                    }}
                    className="inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition hover:bg-cc-surface"
                    style={{ borderColor: BORDER, color: TEXT }}
                  >
                    {stats.counts.unassigned > 0
                      ? "Review unassigned"
                      : "Review cancellations"}
                  </button>
                }
              >
                {attentionItems.map((item) => item.text).join(" ")}
              </Notice>
            )}

            <SummaryStrip
              loading={shifts === null}
              items={[
                { value: stats.total, label: stats.total === 1 ? "shift" : "shifts", onClick: () => setFilter("all"), active: filter === "all" },
                ...(["active", "scheduled", "completed", "cancelled", "unassigned"] as Bucket[]).map((bucket) => ({
                  value: stats.counts[bucket],
                  label: STATUS_STYLE[bucket].label.toLowerCase(),
                  tone:
                    bucket === "unassigned"
                      ? stats.counts.unassigned ? ("warning" as const) : undefined
                      : bucket === "active" && stats.counts.active
                        ? ("info" as const)
                        : bucket === "completed" && stats.counts.completed
                          ? ("good" as const)
                          : undefined,
                  onClick: () => setFilter(filter === bucket ? "all" : bucket),
                  active: filter === bucket,
                })),
                ...(stats.cancellationRate !== null
                  ? [{
                      value: `${stats.cancellationRate}%`,
                      label: "cancellation rate",
                      tone: stats.cancellationRate >= 15 ? ("danger" as const) : undefined,
                    }]
                  : []),
              ]}
            />

            <div className="space-y-4">
              {(search || filter !== "all") && shifts !== null && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{ color: MUTED }} role="status">
                  <span>
                    Showing {filteredShiftList.length} {filter === "all" ? "" : STATUS_STYLE[filter].label.toLowerCase() + " "}
                    shift{filteredShiftList.length === 1 ? "" : "s"}
                    {search ? ` matching "${search}"` : ""}
                  </span>
                  <button
                    type="button"
                    className="font-semibold underline-offset-4 hover:underline"
                    style={{ color: PLUM }}
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="rounded-2xl bg-cc-surface p-6 text-center"
                >
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>
                    Couldn't refresh the schedule.
                  </p>
                  <p className="mt-1 text-xs" style={{ color: MUTED }}>
                    {shifts
                      ? "Showing the last loaded shifts. Refresh to try again."
                      : "Use Refresh to try loading the schedule again."}
                  </p>
                </div>
              )}
            </div>

            {noShiftsInPeriod && viewMode !== "month" && (
              <EmptyState
                icon={CalendarX2}
                title={`No shifts ${viewMode === "day" ? "on this day" : "this week"}`}
                body="Coordinators create shifts in Rostering. Look at another week, or switch to Month to see what's coming up."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={handlePrev} className={outlineClass}>
                      <ChevronLeft size={15} /> {viewMode === "day" ? "Previous day" : "Previous week"}
                    </button>
                    <button type="button" onClick={handleNext} className={outlineClass}>
                      {viewMode === "day" ? "Next day" : "Next week"} <ChevronRight size={15} />
                    </button>
                    <button type="button" onClick={() => setViewMode("month")} className={ghostClass}>
                      Month view
                    </button>
                  </div>
                }
              />
            )}

            {viewMode === "week" && (!error || shifts !== null) && !noShiftsInPeriod && (
              <>
                <details className="group rounded-2xl bg-cc-surface px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-cc-text [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={16} className="shrink-0 transition-transform group-open:rotate-90" style={{ color: MUTED }} />
                    Workload insights
                    <span className="font-normal" style={{ color: MUTED }}>Busiest days and hours per worker</span>
                  </summary>
                  <div className="mt-4 space-y-4">
                    {shifts !== null && stats.total > 0 && (
                      <div
                        className="rounded-2xl border p-4"
                        style={{ borderColor: BORDER, background: SURFACE }}
                      >
                        <div className="flex items-center gap-1.5">
                          <p
                            className="text-xs font-semibold"
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
                                  className="flex h-16 w-full items-end justify-center rounded-xl"
                                  style={{ background: SOFT }}
                                >
                                  <div
                                    className="w-full rounded-xl"
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
                                  className="text-xs font-medium"
                                  style={{ color: isToday(day) ? PLUM : MUTED }}
                                >
                                  {format(day, "EEE")}
                                </p>
                                <p
                                  className="text-sm font-semibold tabular-nums"
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

                    {workload.length > 0 && (
                      <div
                        className="rounded-2xl border overflow-hidden"
                        style={{ borderColor: BORDER, background: SURFACE }}
                      >
                        <div
                          className="flex items-center gap-1.5 border-b px-4 py-3"
                          style={{ borderColor: BORDER }}
                        >
                          <p
                            className="text-xs font-semibold"
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
                              className="flex items-center gap-3 px-4 py-3"
                            >
                              <Avatar name={w.name} />
                              <p
                                className="min-w-0 flex-1 truncate text-sm font-medium"
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
                                className="w-28 shrink-0 text-right text-xs tabular-nums"
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
                        className="space-y-2 rounded-3xl border p-3"
                        style={{ borderColor: BORDER, background: SURFACE }}
                      >
                        <div
                          className="h-10 animate-pulse rounded-xl"
                          style={{ background: SOFT }}
                        />
                        <div
                          className="h-10 animate-pulse rounded-xl"
                          style={{ background: SOFT }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-base font-semibold" style={{ color: TEXT }}>
                          Weekly board
                        </h2>
                        <SectionInfo text="Drag a shift onto a different worker's row to reassign it, or drag it to the Unassigned tray to remove the worker. Click a shift for full detail." />
                        <span className="text-sm" style={{ color: MUTED }}>
                          {boardWorkers.length} of {workers.length} {workers.length === 1 ? "person" : "people"}
                        </span>
                      </div>
                      {workers.length > 0 && (
                        <button
                          type="button"
                          aria-pressed={showAllWorkers}
                          onClick={() => setShowAllWorkers((v) => !v)}
                          className={`${ghostClass} min-h-9`}
                        >
                          {showAllWorkers ? "Only people with shifts" : "Show everyone"}
                        </button>
                      )}
                    </div>
                    <RosterBoard
                      weekStart={weekStart}
                      shifts={
                        filter === "all" ? searchedShifts : filteredShiftList
                      }
                      workers={boardWorkers}
                      availMap={availMap}
                      loadingAvail={loadingAvail}
                      colorBy="worker"
                      allowCreate={false}
                      onCellClick={() => {}}
                      onRefresh={() => {}}
                    />
                  </>
                )}
              </>
            )}

            {viewMode === "day" && (!error || shifts !== null) && !noShiftsInPeriod && (
              shifts === null ? (
                <div className="h-72 animate-pulse rounded-3xl" style={{ background: SOFT }} />
              ) : (
                <DayTimeline
                  dayKey={format(selectedDay, "yyyy-MM-dd")}
                  shifts={filteredShiftList}
                  workers={workers}
                  onSelect={(s) => setActiveShiftId(s.id)}
                />
              )
            )}

            {viewMode === "month" && (!error || shifts !== null) && (
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                {shifts === null ? (
                  <div
                    className="h-96 animate-pulse rounded-3xl"
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
                  className="rounded-2xl overflow-hidden"
                  style={{ borderColor: BORDER, background: SURFACE }}
                >
                  <div
                    className="border-b px-5 py-4"
                    style={{ borderColor: BORDER }}
                  >
                    <p
                      className="text-xs font-semibold"
                      style={{ color: MUTED }}
                    >
                      {format(selectedDay, "EEEE")}
                    </p>
                    <p
                      className="text-base font-semibold tracking-tight"
                      style={{ color: isToday(selectedDay) ? PLUM : TEXT }}
                    >
                      {format(selectedDay, "d MMMM yyyy")}
                    </p>
                  </div>
                  <div className="max-h-[480px] space-y-2 overflow-y-auto p-3">
                    {monthDayShifts.length === 0 ? (
                      <p
                        className="p-3 text-center text-xs font-medium"
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
                              className="w-full rounded-2xl p-3 text-left transition-all hover:bg-cc-soft"
                              style={{ background: st.bg }}
                            >
                              <p
                                className="text-xs font-semibold"
                                style={{ color: st.color }}
                              >
                                {formatTime(s.scheduled_start)}
                              </p>
                              <p
                                className="mt-1 truncate text-sm font-semibold"
                                style={{ color: TEXT }}
                              >
                                {s.participant_name || "Participant"}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                {s.worker_name && (
                                  <Avatar name={s.worker_name} size={18} />
                                )}
                                <p
                                  className="truncate text-xs font-semibold"
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

            {viewMode === "list" && (!error || shifts !== null) && !noShiftsInPeriod && (
              <div className="space-y-4">
                {shifts === null ? (
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-2xl bg-cc-surface" />
                    ))}
                  </div>
                ) : paginatedShifts.length === 0 ? (
                  <EmptyState icon={CalendarX2} title="No shifts match this filter" body="Try another status, or clear the search." />
                ) : (
                  <div className="space-y-5">
                    {listGroups.map((group) => (
                      <section key={group.key} aria-label={group.label}>
                        <h2 className="mb-2 text-sm font-semibold" style={{ color: TEXT }}>
                          {group.label}
                          <span className="ml-2 font-normal" style={{ color: MUTED }}>
                            {group.shifts.length} shift{group.shifts.length === 1 ? "" : "s"}
                          </span>
                        </h2>
                        <Surface>
                          <RowList>
                            {group.shifts.map((s) => {
                              const bucket = bucketOf(s);
                              const st = STATUS_STYLE[bucket];
                              return (
                                <li key={s.id}>
                                  <button type="button" onClick={() => setActiveShiftId(s.id)} className={rowClass}>
                                    <span className="w-28 shrink-0 text-sm tabular-nums" style={{ color: TEXT }}>
                                      {formatTime(s.scheduled_start)}
                                      <span className="block text-xs" style={{ color: MUTED }}>
                                        to {formatTime(s.scheduled_end)}
                                      </span>
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-semibold" style={{ color: TEXT }}>
                                        {s.participant_name || "Participant"}
                                      </span>
                                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs" style={{ color: bucket === "unassigned" ? AMBER : MUTED }}>
                                        {bucket !== "unassigned" && s.worker_name && <Avatar name={s.worker_name} size={16} />}
                                        {bucket === "unassigned" ? "No worker assigned" : s.worker_name || "Worker"}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-xs font-semibold" style={{ color: st.color }}>
                                      {st.label}
                                    </span>
                                    <ChevronRight size={16} className="shrink-0" style={{ color: MUTED }} />
                                  </button>
                                </li>
                              );
                            })}
                          </RowList>
                        </Surface>
                      </section>
                    ))}
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm" style={{ color: MUTED }}>
                      Page {page} of {totalPages} · {filteredShiftList.length} shifts
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={outlineClass}>
                        <ChevronLeft size={15} /> Previous
                      </button>
                      <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={outlineClass}>
                        Next <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {viewMode === "week" &&
              shifts !== null &&
              activityLog.length > 0 && (
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{ borderColor: BORDER, background: SURFACE }}
                >
                  <div
                    className="flex items-center gap-1.5 border-b px-5 py-4"
                    style={{ borderColor: BORDER }}
                  >
                    <h2 className="text-base font-semibold" style={{ color: TEXT }}>
                      Happening now and cancelled this week
                    </h2>
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
                          className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-cc-soft"
                          style={{ borderColor: BORDER }}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: st.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm font-medium"
                              style={{ color: TEXT }}
                            >
                              {s.participant_name || "Participant"} ·{" "}
                              {s.worker_name || "Unassigned"}
                            </p>
                            <p
                              className="mt-0.5 text-[11px] font-medium"
                              style={{ color: MUTED }}
                            >
                              {bucket === "active" &&
                              elapsedSince(s.clocked_in_at)
                                ? `Clocked in ${formatTime(s.clocked_in_at)} · active ${elapsedSince(s.clocked_in_at)}`
                                : formatDateTime(s.scheduled_start)}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-semibold" style={{ color: st.color }}>
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
      <Icon size={15} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
      <div>
        <p
          className="text-xs font-semibold"
          style={{ color: MUTED }}
        >
          {label}
        </p>
        <p className="text-xs font-bold mt-0.5" style={{ color: TEXT }}>
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
        className="w-full overflow-y-auto p-6 pt-10 sm:max-w-lg"
        style={{ background: SURFACE }}
      >
        <SheetTitle className="sr-only">Shift details</SheetTitle>
        {loading || !detail ? (
          <div className="space-y-4 pt-8">
            {error ? (
              <p className="text-xs font-bold" style={{ color: MUTED }}>
                Couldn't load this shift.
              </p>
            ) : (
              <>
                <div
                  className="h-6 w-2/3 animate-pulse rounded-xl"
                  style={{ background: SOFT }}
                />
                <div
                  className="h-24 animate-pulse rounded-2xl"
                  style={{ background: SOFT }}
                />
                <div
                  className="h-36 animate-pulse rounded-2xl"
                  style={{ background: SOFT }}
                />
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5 pt-4">
            <div className="border-b pb-4" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2">
                {st && (
                  <span
                    className="rounded-full px-3 py-1 text-[10px] font-black"
                    style={{ background: st.bg, color: st.color }}
                  >
                    {st.label}
                  </span>
                )}
                <span
                  className="text-xs font-semibold"
                  style={{ color: MUTED }}
                >
                  {(detail.shift_type || "standard_support").replace(/_/g, " ")}
                </span>
              </div>
              <h2
                className="mt-2 text-lg font-black tracking-tight"
                style={{ color: TEXT }}
              >
                {detail.participant_name || "Participant"}
              </h2>
              <p
                className="flex items-center gap-2 mt-1 text-xs font-semibold"
                style={{ color: MUTED }}
              >
                {detail.worker_name && (
                  <Avatar name={detail.worker_name} size={20} />
                )}
                Worker: {detail.worker_name || "Unassigned"}
              </p>
            </div>

            <div
              className="grid grid-cols-2 gap-4 rounded-2xl border p-4"
              style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
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
                style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
              >
                <div className="flex items-center justify-between">
                  <p
                    className="flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: MUTED }}
                  >
                    <ClipboardList size={14} /> Shift tasks
                  </p>
                  <span
                    className="text-xs font-bold"
                    style={{ color: TEXT }}
                  >
                    {completedTasks}/{tasks.length} done
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {tasks.map((t, i) => (
                    <div key={t.id ?? i} className="flex items-center gap-2.5">
                      <CheckCircle2
                        size={15}
                        style={{ color: t.completed ? GREEN : BORDER }}
                      />
                      <p
                        className="truncate text-xs font-medium"
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
                style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
              >
                <p
                  className="text-xs font-semibold"
                  style={{ color: MUTED }}
                >
                  Notes on file
                </p>
                <div className="mt-2.5 space-y-2 text-xs leading-relaxed" style={{ color: TEXT }}>
                  {detail.coordinator_notes && (
                    <p>
                      <span className="font-bold">Coordinator: </span>
                      {detail.coordinator_notes}
                    </p>
                  )}
                  {detail.visit_notes && (
                    <p>
                      <span className="font-bold">Visit: </span>
                      {detail.visit_notes}
                    </p>
                  )}
                  {detail.session_notes && (
                    <p>
                      <span className="font-bold">Session: </span>
                      {detail.session_notes}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {detail.has_risk_alerts && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black"
                  style={{ background: AMBER_SOFT, color: AMBER }}
                >
                  <AlertTriangle size={13} /> Risk alerts on file
                </span>
              )}
              {detail.risks_acknowledged && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black"
                  style={{ background: GREEN_SOFT, color: GREEN }}
                >
                  <ShieldCheck size={13} /> Risks acknowledged
                </span>
              )}
              {detail.conversation_id && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black"
                  style={{ background: BLUE_SOFT, color: BLUE }}
                >
                  <MessageSquare size={13} /> Shift chat active
                </span>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}