import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  format, isSameDay, parseISO, startOfMonth, endOfMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
  eachDayOfInterval, isToday, isSameMonth, addDays, differenceInCalendarDays,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock3, Loader2,
  Plus, Users2, User2, AlertCircle, AlertTriangle, LayoutGrid, Settings2,
  Activity, Search, RefreshCw,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useGetParticipants } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { SectionInfo } from "@/components/ui/section-info";
import { StatCard, StatCardGroup } from "@/components/ui/stat-card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  getCoordinatorWorkerStats,
  listCoordinatorShifts,
  getWorkerAvailability,
  getOverdueUnassignedShifts,
  type CoordinatorShiftRecord,
  type WorkerStats,
  type WorkerAvailability,
  type BlackoutDate,
  type OverdueUnassignedShift,
} from "@/services/coordinatorService";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { RosterBoard }           from "@/components/coordinator/RosterBoard";
import { BulkShiftModal }         from "@/components/coordinator/BulkShiftModal";
import { WorkerAvailabilityPanel } from "@/components/coordinator/WorkerAvailabilityPanel";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { appLocalDateKey } from "@/lib/datetime";
import CoordinatorLivePage from "./coordinator-live";
import CoordinatorMonitorPage from "./coordinator-monitor";

type ScheduleTab = "roster" | "live";
const SCHEDULE_TABS: { id: ScheduleTab; label: string; icon: typeof CalendarDays }[] = [
  { id: "roster", label: "Roster",       icon: CalendarDays },
  { id: "live",   label: "Live Monitor", icon: Activity },
];

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

type ViewMode = "roster" | "month";

const STATUS_CFG: Record<string, { labelKey: string; bg: string; color: string }> = {
  scheduled:   { labelKey: "coordinator.rostering.status.scheduled", bg: "#FCE3EB", color: "#E8457A" },
  in_progress: { labelKey: "coordinator.rostering.status.active",    bg: "#DBEAFE", color: "#1D4ED8" },
  clocked_in:  { labelKey: "coordinator.rostering.status.active",    bg: "#DBEAFE", color: "#1D4ED8" },
  completed:   { labelKey: "coordinator.rostering.status.completed", bg: "#DCFCE7", color: "#166534" },
  cancelled:   { labelKey: "coordinator.rostering.status.cancelled", bg: "#F1F5F9", color: "#64748B" },
};

function statusCfg(s: string | null | undefined, translate: (key: string) => string) {
  const cfg = STATUS_CFG[s ?? ""] ?? STATUS_CFG.scheduled;
  return { ...cfg, label: translate(cfg.labelKey) };
}

function parseStart(s: CoordinatorShiftRecord): Date | null {
  if (!s.scheduled_start) return null;
  try { return parseISO(s.scheduled_start); } catch { return null; }
}

function ShiftChip({ shift }: { shift: CoordinatorShiftRecord }) {
  const { translate, translateParams } = useAccessibility();
  const cfg = statusCfg(shift.status, translate);
  const d   = parseStart(shift);
  const participant = shift.participant_name || translate("common.participant");
  const worker = shift.worker_name || translate("common.worker");
  const timeSuffix = d ? ` @ ${format(d, "HH:mm")}` : "";
  return (
    <div
      className="truncate rounded px-1.5 py-0.5 text-[10px] font-bold leading-tight cursor-default"
      style={{ background: cfg.bg, color: cfg.color }}
      title={translateParams("coordinator.rostering.shiftChipTitle", { participant, worker, time: timeSuffix })}
    >
      {shift.participant_name?.split(" ")[0] || "N/A"}
      {d ? ` ${format(d, "HH:mm")}` : ""}
    </div>
  );
}

export function MonthGrid({
  month, shifts, selectedDay, onSelectDay,
}: {
  month: Date;
  shifts: CoordinatorShiftRecord[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const dayLabels = [
    translate("coordinator.rostering.day.mon"),
    translate("coordinator.rostering.day.tue"),
    translate("coordinator.rostering.day.wed"),
    translate("coordinator.rostering.day.thu"),
    translate("coordinator.rostering.day.fri"),
    translate("coordinator.rostering.day.sat"),
    translate("coordinator.rostering.day.sun"),
  ];
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd   = endOfWeek(endOfMonth(month),     { weekStartsOn: 1 });
  const days      = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts) {
      const d = parseStart(s);
      if (!d) continue;
      const key = format(d, "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [shifts]);

  return (
    <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: BORDER }}>
      <div className="grid grid-cols-7" style={{ borderBottom: `1px solid ${BORDER}`, background: SOFT }}>
        {dayLabels.map((d) => (
          <div key={d} className="py-2.5 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key       = format(day, "yyyy-MM-dd");
          const dayShifts = (shiftsByDay.get(key) ?? []).sort((a, b) =>
            (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? "")
          );
          const isSelected = isSameDay(day, selectedDay);
          const today      = isToday(day);
          const inMonth    = isSameMonth(day, month);
          return (
            <div
              key={key}
              onClick={() => onSelectDay(day)}
              className="min-h-[88px] cursor-pointer p-1.5 transition-colors hover:bg-[#F8F6FE]"
              style={{
                borderBottom: `1px solid ${BORDER}`,
                borderRight:  `1px solid ${BORDER}`,
                background:   isSelected ? "#F0ECFF" : "var(--cc-bg)",
                opacity:      inMonth ? 1 : 0.38,
              }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-black"
                  style={{
                    background: today ? "var(--cc-text)" : "transparent",
                    color: today ? "white" : isSelected ? PLUM : inMonth ? TEXT : MUTED,
                  }}
                >
                  {format(day, "d")}
                </span>
                {dayShifts.length > 0 && (
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: SOFT, color: PLUM }}>
                    {dayShifts.length}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {dayShifts.slice(0, 2).map((s) => <ShiftChip key={s.id} shift={s} />)}
                {dayShifts.length > 2 && (
                  <p className="pl-1 text-[10px] font-bold" style={{ color: PLUM }}>
                    {translateParams("coordinator.rostering.moreShifts", { count: String(dayShifts.length - 2) })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type AvailabilityMap = Record<string, WorkerAvailability & { blackout_dates?: BlackoutDate[] }>;


function DayPanel({
  day, shifts, workers, onAssign,
}: {
  day: Date;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  onAssign: () => void;
}) {
  const { translate } = useAccessibility();
  const dayShifts = useMemo(
    () =>
      shifts
        .filter((s) => { const d = parseStart(s); return !!d && isSameDay(d, day); })
        .sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? "")),
    [shifts, day]
  );

  return (
    <div className="flex flex-col rounded-2xl border bg-white" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>{format(day, "EEEE")}</p>
          <p className="text-xl font-black" style={{ color: isToday(day) ? PLUM : TEXT }}>{format(day, "d MMMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-black" style={{ background: SOFT, color: PLUM }}>
            {dayShifts.length} {dayShifts.length === 1 ? translate("coordinator.rostering.shift") : translate("coordinator.rostering.shifts")}
          </span>
          <Button
            size="sm"
            onClick={onAssign}
            className="flex items-center gap-1.5 rounded-full text-white text-xs"
            style={{ background: "var(--cc-cta)" }}
          >
            <Plus size={12} /> {translate("coordinator.rostering.assign")}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[560px] px-3 py-3 space-y-2">
        {dayShifts.length === 0 ? (
          <div className="py-14 text-center">
            <CalendarDays className="mx-auto mb-2" size={22} style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>{translate("coordinator.rostering.noShiftsDay")}</p>
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>{translate("coordinator.rostering.noShiftsDayHint")}</p>
          </div>
        ) : (
          dayShifts.map((shift) => {
            const cfg   = statusCfg(shift.status, translate);
            const start = parseStart(shift);
            const end   = shift.scheduled_end ? parseISO(shift.scheduled_end) : null;
            const durMs = start && end ? end.getTime() - start.getTime() : null;
            const durH  = durMs != null ? (durMs / 3600000).toFixed(1) : null;
            return (
              <div key={shift.id} className="rounded-xl border p-3.5" style={{ borderColor: BORDER, borderLeftWidth: 3, borderLeftColor: cfg.color }}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase" style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <Clock3 size={11} />
                    {start ? format(start, "h:mm a") : "N/A"}
                    {end ? ` – ${format(end, "h:mm a")}` : ""}
                    {durH ? ` · ${durH}h` : ""}
                  </span>
                </div>
                <p className="text-[14px] font-black" style={{ color: TEXT }}>{shift.participant_name || translate("common.participant")}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                    <User2 size={11} /> {shift.worker_name || workers.find((w) => w.id === shift.worker_id)?.full_name || translate("common.worker")}
                  </span>
                  {shift.shift_type && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase" style={{ background: SOFT, color: MUTED }}>
                      {shift.shift_type.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Overdue unassigned shifts silently fall out of view once a coordinator
// navigates the week/month-scoped roster board away from wherever the shift
// was scheduled - there's no other alert, escalation, or KPI for this
// anywhere in the app (confirmed gap, Aug 2026). Surfaced via a stat card in
// the page's existing stat strip (only rendered when count > 0), not a
// standing banner - see overdueUnassignedShifts below.

export default function CoordinatorRosteringPage() {
  const { translate, translateParams } = useAccessibility();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const liveOrgId = currentUser?.organizationId ?? "__no_org__";
  const [liveSearch, setLiveSearch] = useState("");
  const [pageTab,      setPageTab]      = useState<ScheduleTab>("roster");
  const [viewMode,     setViewMode]     = useState<ViewMode>("roster");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [weekStart,    setWeekStart]    = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay,  setSelectedDay]  = useState(new Date());
  const [statusFilter, setStatusFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [assignOpen,   setAssignOpen]   = useState(false);
  const [bulkOpen,     setBulkOpen]     = useState(false);
  const [availWorker,  setAvailWorker]  = useState<WorkerStats | null>(null);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ worker: WorkerStats; date: string } | null>(null);
  const [availMap,     setAvailMap]     = useState<AvailabilityMap>({});
  const [loadingAvail, setLoadingAvail] = useState(false);

  const participantsQuery = useGetParticipants();
  const participantList   = (participantsQuery.data as Array<{ id: string; full_name: string }> | undefined) ?? [];

  const rangeStart = viewMode === "roster"
    ? format(weekStart, "yyyy-MM-dd")
    : format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const rangeEnd = viewMode === "roster"
    ? format(addDays(weekStart, 6), "yyyy-MM-dd")
    : format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const workersQuery = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
    staleTime: 60_000,
  });

  const shiftsQuery = useOrgQuery(
    ["coordinator", "roster-shifts", rangeStart, rangeEnd, workerFilter, statusFilter],
    {
      queryFn: () =>
        listCoordinatorShifts({
          start_date: `${rangeStart}T00:00:00Z`,
          end_date:   `${rangeEnd}T23:59:59Z`,
          worker_id:  workerFilter === "all" ? undefined : workerFilter,
          status:     statusFilter === "all" ? undefined : statusFilter,
          limit: 2000,
        }),
    }
  );

  // Independent of rangeStart/rangeEnd on purpose - shiftsQuery above only
  // covers the currently-viewed week/month, so an unassigned shift whose
  // time has passed silently falls out of view once the coordinator moves
  // on. This stays visible regardless of what's currently shown.
  const overdueUnassignedQuery = useOrgQuery(
    ["coordinator", "overdue-unassigned-shifts"],
    { queryFn: getOverdueUnassignedShifts, refetchInterval: 5 * 60_000 }
  );

  const workers = workersQuery.data ?? [];
  const shifts  = shiftsQuery.data  ?? [];
  const overdueUnassignedShifts = overdueUnassignedQuery.data ?? [];

  // Load availability for all workers when the list changes
  useEffect(() => {
    if (workers.length === 0) return;
    let cancelled = false;
    setLoadingAvail(true);
    (async () => {
      const map: AvailabilityMap = {};
      for (const w of workers) {
        try {
          const data = await getWorkerAvailability(w.id);
          map[w.id] = { ...data.availability, blackout_dates: data.blackout_dates };
        } catch { /* skip unavailable */ }
      }
      if (!cancelled) { setAvailMap(map); setLoadingAvail(false); }
    })();
    return () => { cancelled = true; };
  }, [workers]);

  const todayKey       = appLocalDateKey(new Date().toISOString());
  const shiftsToday    = shifts.filter((s) => s.scheduled_start && appLocalDateKey(s.scheduled_start) === todayKey);
  const activeShifts   = shifts.filter((s) => s.status === "in_progress" || s.status === "clocked_in");
  const scheduledCount = shifts.filter((s) => s.status === "scheduled").length;

  const handlePrev = () => {
    if (viewMode === "month") setCurrentMonth((m) => subMonths(m, 1));
    else setWeekStart((w) => addDays(w, -7));
  };
  const handleNext = () => {
    if (viewMode === "month") setCurrentMonth((m) => addMonths(m, 1));
    else setWeekStart((w) => addDays(w, 7));
  };
  const handleToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setWeekStart(startOfWeek(now, { weekStartsOn: 1 }));
    setSelectedDay(now);
  };

  const handleJumpToOverdueShift = (shift: OverdueUnassignedShift) => {
    setPageTab("roster");
    setViewMode("roster");
    const target = parseISO(shift.scheduled_start);
    setCurrentMonth(target);
    setWeekStart(startOfWeek(target, { weekStartsOn: 1 }));
    setSelectedDay(target);
  };

  const assignWorker   = workers.find((w) => w.id === workerFilter) ?? null;
  const periodLabel    = viewMode === "month"
    ? format(currentMonth, "MMMM yyyy")
    : `${format(weekStart, "d MMM")} – ${format(addDays(weekStart, 6), "d MMM yyyy")}`;

  return (
    <div className="space-y-4 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--cc-coral)" }}>Schedule</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-black tracking-tight" style={{ color: TEXT }}>
            {translate("coordinator.rostering.title")}
            <SectionInfo text="Build and adjust the shift roster for your team, week by week or month by month." />
          </h1>
        </div>
        {pageTab === "roster" ? (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setTeamPanelOpen(true)}
            variant="outline"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            <Users2 size={14} /> {translate("coordinator.rostering.team")}
          </Button>
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            <LayoutGrid size={14} /> {translate("coordinator.rostering.recurring")}
          </Button>
          <Button
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white"
            style={{ background: "var(--cc-cta)" }}
          >
            <Plus size={15} /> {translate("coordinator.rostering.createShift")}
          </Button>
        </div>
        ) : pageTab === "live" ? (
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: MUTED }} />
            <input
              value={liveSearch}
              onChange={(e) => setLiveSearch(e.target.value)}
              placeholder="Search worker or participant…"
              className="h-9 pl-8 pr-3 rounded-xl border text-[13px] outline-none w-56 focus:w-72 transition-all"
              style={{ borderColor: BORDER, color: TEXT, background: "var(--cc-bg)" }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5 h-9"
            style={{ borderColor: BORDER }}
            onClick={() => queryClient.invalidateQueries({ queryKey: [liveOrgId, "live-shifts", liveOrgId] })}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
        ) : null}
      </div>

      {/* Page-level tabs: Roster | Live Monitor - same raised-pill language as
          the onboarding area switcher (OnboardingAreaSwitcher: rounded-top
          active tab flush with the panel below, circular icon badge, flat
          unelevated inactive tab), adapted to local state instead of a route
          change since both live on this one page.

          Tabs + panel are wrapped together in one div rather than left as
          two siblings of the page's space-y-4 container - that utility puts
          a margin between every child, which put a visible gap between the
          tab and the panel it's supposed to sit flush against, breaking the
          "one continuous shape" illusion (the rounded-top-only tab looked
          like an isolated, oddly-clipped shape floating on its own instead
          of merging into the panel below). */}
      <div>
      <div role="tablist" className="flex items-end gap-3">
        {SCHEDULE_TABS.map((tab) => {
          const active = pageTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active ? "true" : "false"}
              onClick={() => setPageTab(tab.id)}
              className="relative flex items-center gap-2 px-6 py-3 text-[14px] font-black transition-opacity"
              style={{
                borderRadius: active ? "14px 14px 0 0" : "0",
                background: active ? "var(--cc-surface)" : "transparent",
                color: TEXT,
                opacity: active ? 1 : 0.75,
              }}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ background: PLUM }}
              >
                <Icon size={13} style={{ color: "#fff" }} />
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl rounded-tl-none" style={{ background: "var(--cc-surface)", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {pageTab === "live" && <CoordinatorLivePage embedded externalSearch={liveSearch} />}

      {pageTab === "roster" && (
      <>
      {/* Flat inline stat strip, not a repeated card grid */}
      <StatCardGroup fill>
        <StatCard label={translate("coordinator.rostering.today")} value={shiftsToday.length} icon={<CalendarDays size={16} />} />
        <StatCard label={translate("coordinator.rostering.activeNow")} value={activeShifts.length} tone="info" icon={<Activity size={16} />} />
        <StatCard label={translate("coordinator.rostering.upcoming")} value={scheduledCount} tone="brand" icon={<Clock3 size={16} />} />
        <StatCard
          label={workersQuery.isLoading ? translate("coordinator.rostering.loadingTeam") : translate("coordinator.rostering.teamMembers")}
          value={workers.length}
          icon={<Users2 size={16} />}
        />
        {/* Only appears when something needs attention - an unassigned shift
            whose start time has already passed, possibly outside the week/
            month currently in view. Was previously a standing red banner
            pinned above the page; folded into this existing stat strip
            instead so it doesn't compete for space when there's nothing to
            flag, and stays proportionate (a number, not a list) when there is. */}
        {overdueUnassignedShifts.length > 0 && (
          <StatCard
            label={translate("coordinator.rostering.overdueUnassigned")}
            value={overdueUnassignedShifts.length}
            tone="danger"
            icon={<AlertTriangle size={16} />}
            role="button"
            tabIndex={0}
            onClick={() => handleJumpToOverdueShift(overdueUnassignedShifts[0])}
            onKeyDown={(e) => { if (e.key === "Enter") handleJumpToOverdueShift(overdueUnassignedShifts[0]); }}
            className="cursor-pointer"
          />
        )}
      </StatCardGroup>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white px-4 py-3" style={{ borderColor: BORDER }}>
        <div className="flex overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
          {(["roster", "month"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className="px-4 py-2 text-[12px] font-bold capitalize transition-colors"
              style={{ background: viewMode === mode ? "var(--cc-cta)" : "var(--cc-bg)", color: viewMode === mode ? "white" : MUTED }}
            >
              {translate(`coordinator.rostering.view.${mode}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            title={translate("coordinator.rostering.previousPeriod")}
            onClick={handlePrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
            style={{ borderColor: BORDER }}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[160px] text-center text-[13px] font-black" style={{ color: TEXT }}>{periodLabel}</span>
          <button
            title={translate("coordinator.rostering.nextPeriod")}
            onClick={handleNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[#F8F6FE]"
            style={{ borderColor: BORDER }}
          >
            <ChevronRight size={15} />
          </button>
          <button
            onClick={handleToday}
            className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors hover:bg-[#F8F6FE]"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            {translate("coordinator.rostering.todayBtn")}
          </button>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger className="h-8 flex-1 sm:w-[170px] rounded-lg text-[12px]" style={{ borderColor: BORDER }}>
              <SelectValue placeholder={translate("coordinator.rostering.allWorkers")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{translate("coordinator.rostering.allWorkers")}</SelectItem>
              {workers.map((w) => <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 flex-1 sm:w-[145px] rounded-lg text-[12px]" style={{ borderColor: BORDER }}>
              <SelectValue placeholder={translate("coordinator.rostering.allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{translate("coordinator.rostering.allStatuses")}</SelectItem>
              <SelectItem value="scheduled">{translate("coordinator.rostering.status.scheduled")}</SelectItem>
              <SelectItem value="in_progress">{translate("coordinator.rostering.status.active")}</SelectItem>
              <SelectItem value="completed">{translate("coordinator.rostering.status.completed")}</SelectItem>
              <SelectItem value="cancelled">{translate("coordinator.rostering.status.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {shiftsQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} />}
      </div>

      {shiftsQuery.error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertCircle size={15} className="shrink-0" />
          {translate("coordinator.rostering.loadError")}
        </div>
      )}

      {viewMode === "month" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <MonthGrid month={currentMonth} shifts={shifts} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
          <DayPanel day={selectedDay} shifts={shifts} workers={workers} onAssign={() => setAssignOpen(true)} />
        </div>
      )}

      {viewMode === "roster" && (
        <RosterBoard
          weekStart={weekStart}
          shifts={shifts}
          workers={workers}
          availMap={availMap}
          loadingAvail={loadingAvail}
          onCellClick={(worker, date) => {
            setAssignTarget({ worker, date });
            setAssignOpen(true);
          }}
          onRefresh={() => shiftsQuery.refetch?.()}
        />
      )}

      {/* -- Team availability & skills side panel --------------------------- */}
      <Sheet open={teamPanelOpen} onOpenChange={(open) => { setTeamPanelOpen(open); if (!open) setAvailWorker(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{translate("coordinator.rostering.workerAvailability")}</SheetTitle>
            <SheetDescription>{translate("coordinator.rostering.teamPanelDesc")}</SheetDescription>
          </SheetHeader>

          <div className="mt-4">
            {availWorker ? (
              <div className="space-y-3">
                <button
                  onClick={() => setAvailWorker(null)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold"
                  style={{ color: PLUM }}
                >
                  <ChevronLeft size={14} /> {translate("coordinator.rostering.allWorkers")}
                </button>
                <WorkerAvailabilityPanel worker={availWorker} onClose={() => setAvailWorker(null)} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {workers.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setAvailWorker(w)}
                    className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-[#ECECEC]"
                    style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
                  >
                    <div
                      className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                      style={{ background: "var(--cc-cta)" }}
                    >
                      {w.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold" style={{ color: PLUM }}>{w.full_name.split(" ")[0]}</p>
                      <p className="text-[10px] flex items-center gap-1" style={{ color: MUTED }}>
                        <Settings2 size={9} /> {translate("common.settings")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ShiftAssignmentModal
        open={assignOpen}
        onOpenChange={(open) => { setAssignOpen(open); if (!open) setAssignTarget(null); }}
        worker={assignTarget?.worker ?? assignWorker}
        workers={workers}
        initialDate={assignTarget?.date}
      />

      {/* -- Bulk/Recurring shift modal ------------------------------------- */}
      <BulkShiftModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        participants={participantList}
        workers={workers}
      />
      </>
      )}
      </div>
      </div>
    </div>
  );
}
