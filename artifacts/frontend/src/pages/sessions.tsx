import React, { useState, useMemo } from "react";
import {
  parse, format, parseISO, isAfter, isBefore, isEqual,
  startOfDay, endOfDay, startOfWeek, startOfMonth, isToday, isThisWeek, isThisMonth,
} from "date-fns";
import { Link, useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { flagSessionForReview } from "@/services/coordinatorService";
import { SectionInfo } from "@/components/ui/section-info";
import {
  Search, Calendar, Clock, ShieldCheck, ChevronDown,
  ChevronRight, FileDown, Loader2, X, ArrowUpDown, Users,
  AlertTriangle, Plus, Flag,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { exportBulkSessionsPDF } from "@/lib/pdf-export";
import { useGetSessions, useGetParticipants } from "@workspace/api-client-react";
import type { Session as ApiSession, Participant as ApiParticipant } from "@workspace/api-client-react";

// -- Design tokens � aligned with Dashboard -------------------------------------
const PLUM        = "#E8457A";
const CORAL       = "var(--cc-coral)";
const T1          = "#1A1A2E";
const T2          = "#374151";
const T3          = "#6A6A77";
const BORDER      = "#E8E8EA";
const SOFT        = "#F4EDE6";

// -- Sort options ---------------------------------------------------------------
type SortKey = "date_desc" | "date_asc" | "severity" | "participant" | "status" | "activity";
const SORT_I18N: Record<SortKey, string> = {
  date_desc:   "sessions.sort.dateDesc",
  date_asc:    "sessions.sort.dateAsc",
  severity:    "sessions.sort.severity",
  participant: "sessions.sort.participant",
  status:      "sessions.sort.status",
  activity:    "sessions.sort.activity",
};

// -- Chronological group labels -------------------------------------------------
type GroupKey = "today" | "thisWeek" | "thisMonth" | "earlier";
const GROUP_I18N: Record<GroupKey, string> = {
  today: "sessions.group.today",
  thisWeek: "sessions.group.thisWeek",
  thisMonth: "sessions.group.thisMonth",
  earlier: "sessions.group.earlier",
};

function getGroup(dateStr: string): GroupKey {
  try {
    const d = dateStr.includes("T")
      ? parseISO(dateStr)
      : parse(dateStr, "yyyy-MM-dd", new Date());
    if (isToday(d))      return "today";
    if (isThisWeek(d, { weekStartsOn: 1 }))  return "thisWeek";
    if (isThisMonth(d))  return "thisMonth";
    return "earlier";
  } catch {
    return "earlier";
  }
}

const GROUP_ORDER: GroupKey[] = ["today", "thisWeek", "thisMonth", "earlier"];

// -- Safe date parser -----------------------------------------------------------
function safeParseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  try {
    return dateStr.includes("T")
      ? parseISO(dateStr)
      : parse(dateStr, "yyyy-MM-dd", new Date());
  } catch {
    return null;
  }
}

function safeFormat(dateStr: string | null | undefined, fmt: string, fallback = "N/A"): string {
  const d = safeParseDate(dateStr);
  return d ? format(d, fmt) : fallback;
}

// -- Field wrapper --------------------------------------------------------------
function Field({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center w-full">
      {icon && (
        <span className="absolute left-3 pointer-events-none z-10 flex items-center justify-center" style={{ color: T3 }}>
          {icon}
        </span>
      )}
      {children}
    </div>
  );
}

// -- Skeleton row ---------------------------------------------------------------
function SkeletonRow() {
  return (
    <div className="px-5 py-4 flex items-center gap-4 animate-pulse">
      <div className="w-4 h-4 rounded bg-[#E8E8EA]" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 rounded bg-[#E8E8EA]" />
        <div className="h-3 w-32 rounded bg-[#E8E8EA]" />
      </div>
      <div className="h-6 w-28 rounded-full bg-[#E8E8EA]" />
    </div>
  );
}

// -- Session stat card � matches Dashboard DashboardStatCard --------------------
function SessionStatCard({
  label, value, caption, icon: Icon, valueColor,
}: {
  label: string;
  value: number | string;
  caption: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  valueColor?: string;
}) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: T3 }}>{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight" style={{ color: valueColor ?? T1 }}>{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: SOFT, color: PLUM }}>
          <Icon size={20} strokeWidth={2.5} />
        </div>
      </div>
      <p className="mt-3 text-sm font-medium" style={{ color: T3 }}>{caption}</p>
    </section>
  );
}

// -- Main component -------------------------------------------------------------
export default function Sessions() {
  const { translate, translateParams } = useAccessibility();

  function severityConfig(score: number | null | undefined, status?: string) {
    const s = status?.toLowerCase();
    if (s === "draft" || score == null) {
      return { label: translate("sessions.severity.draft"), color: T3, bg: `${PLUM}08`, bar: 0 };
    }
    if (s === "in_progress") {
      return { label: translate("sessions.severity.inProgress"), color: T3, bg: "rgba(106,106,119,0.06)", bar: 0 };
    }
    if (score >= 85) return { label: translateParams("sessions.severity.compliant", { score: String(score) }), color: "#16A34A", bg: "rgba(22,163,74,0.07)", bar: score };
    if (score >= 60) return { label: translateParams("sessions.severity.atRisk", { score: String(score) }), color: "#D97706", bg: "rgba(245,158,11,0.07)", bar: score };
    return { label: translateParams("sessions.severity.nonCompliant", { score: String(score) }), color: "#DC2626", bg: "rgba(239,68,68,0.07)", bar: score };
  }

  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [participantFilter, setParticipantFilter] = useState("all");
  const [sortBy, setSortBy]             = useState<SortKey>("date_desc");
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [exportProgress, setExportProgress]   = useState<{ done: number; total: number } | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const qc = useQueryClient();

  // -- Data fetching ------------------------------------------------------------
  const { data: rawSessions = [], isLoading: sessionsLoading } = useGetSessions({ limit: 200 });
  const { data: participants = [], isLoading: participantsLoading } = useGetParticipants();
  const isLoading = sessionsLoading || participantsLoading;

  const participantMap = useMemo(() => {
    const m = new Map<string, string>();
    (participants as ApiParticipant[]).forEach((p) => {
      if (p.id) m.set(p.id, p.full_name ?? translate("sessions.unknown"));
    });
    return m;
  }, [participants]);

  const sessions = useMemo(() =>
    (rawSessions as ApiSession[]).map((s) => ({
      ...s,
      _participantName:
        s.participants?.full_name ||
        participantMap.get(s.participant_id) ||
        translate("sessions.unknownParticipant"),
    })),
  [rawSessions, participantMap]);

  const participantOptions = useMemo(() => {
    const seen = new Map<string, string>();
    sessions.forEach((s) => seen.set(s.participant_id, s._participantName));
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions]);

  // -- Filtering ----------------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sessions.filter((s) => {
      if (!s) return false;
      if (q && !s._participantName.toLowerCase().includes(q) && !s.session_type?.toLowerCase().includes(q))
        return false;
      if (statusFilter !== "all" && s.status?.toLowerCase() !== statusFilter)
        return false;
      if (participantFilter !== "all" && s.participant_id !== participantFilter)
        return false;

      if (dateFrom && s.session_date) {
        try {
          const from = startOfDay(parse(dateFrom, "yyyy-MM-dd", new Date()));
          const d    = startOfDay(safeParseDate(s.session_date)!);
          if (isBefore(d, from) && !isEqual(d, from)) return false;
        } catch { return false; }
      }
      if (dateTo && s.session_date) {
        try {
          const to = endOfDay(parse(dateTo, "yyyy-MM-dd", new Date()));
          const d   = safeParseDate(s.session_date)!;
          if (isAfter(d, to)) return false;
        } catch { return false; }
      }
      return true;
    });
  }, [sessions, search, statusFilter, participantFilter, dateFrom, dateTo]);

  // -- Sorting ------------------------------------------------------------------
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "date_desc":
        return arr.sort((a, b) => (b.session_date ?? "").localeCompare(a.session_date ?? ""));
      case "date_asc":
        return arr.sort((a, b) => (a.session_date ?? "").localeCompare(b.session_date ?? ""));
      case "severity":
        return arr.sort((a, b) => {
          const sa = a.compliance_score ?? 101;
          const sb = b.compliance_score ?? 101;
          return sa - sb;
        });
      case "participant":
        return arr.sort((a, b) => a._participantName.localeCompare(b._participantName));
      case "status": {
        const order: Record<string, number> = { in_progress: 0, draft: 1, completed: 2 };
        return arr.sort((a, b) => (order[a.status ?? ""] ?? 9) - (order[b.status ?? ""] ?? 9));
      }
      case "activity":
        return arr.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      default:
        return arr;
    }
  }, [filtered, sortBy]);

  // -- Chronological grouping ---------------------------------------------------
  const grouped = useMemo(() => {
    if (sortBy !== "date_desc" && sortBy !== "date_asc") return null;
    const map = new Map<GroupKey, typeof sorted>();
    GROUP_ORDER.forEach((g) => map.set(g, []));
    sorted.forEach((s) => {
      const g = getGroup(s.session_date);
      map.get(g)!.push(s);
    });
    GROUP_ORDER.forEach((g) => { if (!map.get(g)!.length) map.delete(g); });
    return map;
  }, [sorted, sortBy]);

  // -- Selection helpers ---------------------------------------------------------
  const allFilteredIds = useMemo(() => sorted.map((s) => s.id), [sorted]);
  const allSelected    = sorted.length > 0 && sorted.every((s) => selectedIds.has(s.id));
  const someSelected   = selectedIds.size > 0;

  const toggleSession = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      allSelected ? allFilteredIds.forEach((id) => n.delete(id)) : allFilteredIds.forEach((id) => n.add(id));
      return n;
    });

  const clearSelection = () => setSelectedIds(new Set());

  // -- Bulk export ---------------------------------------------------------------
  const handleBulkExport = async () => {
    if (!selectedIds.size) return;
    setIsBulkExporting(true);
    setExportProgress({ done: 0, total: selectedIds.size });
    try {
      await exportBulkSessionsPDF(Array.from(selectedIds), (done, total) => setExportProgress({ done, total }));
      toast({ title: translate("sessions.toast.exported"), description: translateParams("sessions.toast.exportedDesc", { count: String(selectedIds.size) }) });
      clearSelection();
    } catch (err) {
      toast({ title: translate("sessions.toast.exportFailed"), description: err instanceof Error ? err.message : translate("common.error"), variant: "destructive" });
    } finally {
      setIsBulkExporting(false);
      setExportProgress(null);
    }
  };

  const hasDateFilter  = dateFrom || dateTo;
  const hasAnyFilter   = search || statusFilter !== "all" || participantFilter !== "all" || hasDateFilter;

  // -- Stat calculations ------------------------------------------------------
  const thisWeekCount = useMemo(() =>
    sessions.filter((s) => { const d = safeParseDate(s.session_date); return d ? isThisWeek(d, { weekStartsOn: 1 }) : false; }).length,
  [sessions]);
  const inProgressCount = sessions.filter((s) => s.status === "in_progress").length;
  const scoredSessions  = sessions.filter((s) => s.compliance_score != null);
  const avgCompliance   = scoredSessions.length
    ? `${Math.round(scoredSessions.reduce((sum, s) => sum + Number(s.compliance_score), 0) / scoredSessions.length)}%`
    : "N/A";

  // -- Flag Button (coordinator only, renders inside SessionRow) -----------------
  function FlagButton({ sessionId, flagged, qc: _qc, toast: _toast }: {
    sessionId: string; flagged: boolean;
    qc: ReturnType<typeof useQueryClient>;
    toast: ReturnType<typeof useToast>["toast"];
  }) {
    const [loading, setLoading] = useState(false);
    async function toggle(e: React.MouseEvent) {
      e.stopPropagation();
      setLoading(true);
      try {
        await flagSessionForReview(sessionId, !flagged, !flagged ? "Flagged from sessions list" : undefined);
        _qc.invalidateQueries({ queryKey: ["getSessions"] });
        _toast({ title: flagged ? translate("sessions.toast.flagRemoved") : translate("sessions.toast.flagged") });
      } catch {
        _toast({ title: translate("sessions.toast.flagFailed"), variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }
    return (
      <button
        className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-all shrink-0 ${
          flagged
            ? "bg-[#7C3AED]/10 border-[#7C3AED]/30 text-[#7C3AED]"
            : "bg-white border-slate-200 text-slate-300 hover:text-[#7C3AED] hover:border-[#7C3AED]/30"
        }`}
        onClick={toggle}
        disabled={loading}
        title={flagged ? translate("sessions.flag.remove") : translate("sessions.flag.add")}
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} strokeWidth={2.5} />}
      </button>
    );
  }

  // -- Session row ---------------------------------------------------------------
  function SessionRow({ session }: { session: typeof sorted[number] }) {
    const sev = severityConfig(session.compliance_score, session.status);
    const isSelected = selectedIds.has(session.id);

    return (
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-3.5 transition-colors duration-150 group border-l-[3px] ${
          isSelected ? "border-l-[#E8457A]" : "border-l-transparent hover:border-l-[#7C3AED]/30 hover:bg-[#F4EDE6]/50"
        }`}
        style={isSelected ? { background: `${PLUM}06` } : {}}
      >
        {/* Left Section: Checkbox + Info */}
        <div className="flex items-start gap-3.5 flex-1 min-w-0">
          <div className="shrink-0 pt-1" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSession(session.id)}
              aria-label={translateParams("sessions.selectFor", { name: session._participantName })}
            />
          </div>

          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/sessions/${session.id}`)}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1">
              <span className="text-[14px] font-bold group-hover:text-[#E8457A] transition-colors truncate" style={{ color: T1 }}>
                {session._participantName}
              </span>
              <span className="hidden sm:inline text-slate-300 text-xs">�</span>
              <span className="text-[12px] font-medium capitalize truncate" style={{ color: T2 }}>
                {session.session_type?.replace(/_/g, " ") ?? translate("sessions.general")}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1 text-[11px]" style={{ color: T3 }}>
                <Calendar size={11} className="opacity-70" />
                {safeFormat(session.session_date, "EEE d MMM yyyy")}
              </span>
              <span className="flex items-center gap-1 text-[11px]" style={{ color: T3 }}>
                <Clock size={11} className="opacity-70" />
                {session.duration_minutes ? translateParams("sessions.durationMin", { minutes: String(session.duration_minutes) }) : translate("common.emDash")}
              </span>
              {session.tags && session.tags.length > 0 && (
                <div className="flex gap-1 items-center">
                  <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium border"
                    style={{ background: `${PLUM}08`, borderColor: `${PLUM}20`, color: PLUM }}>
                    {session.tags[0]}
                  </span>
                  {session.tags.length > 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono" style={{ color: T3, borderColor: BORDER }}>
                      +{session.tags.length - 1}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Section: Status pills + Actions */}
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end min-w-[110px]">
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
                style={{ background: sev.bg, color: sev.color }}
              >
                <ShieldCheck size={10} />
                {sev.label}
              </span>
              {sev.bar > 0 && (
                <div className="mt-1 w-full h-1 rounded-full overflow-hidden" style={{ background: `${BORDER}` }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${sev.bar}%`,
                      background: sev.bar >= 85 ? "#16A34A" : sev.bar >= 60 ? "#D97706" : "#DC2626",
                    }}
                  />
                </div>
              )}
            </div>

            {session.restrictive_practice_detected && (
              <span
                className="flex items-center gap-1 px-2 py-1 h-[22px] rounded text-[10px] font-bold border uppercase tracking-wide shrink-0"
                style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)", color: "#DC2626" }}
                title={translate("sessions.restrictivePractice")}
              >
                <AlertTriangle size={9} strokeWidth={2.5} /> RP
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {isCoordinator && (
              <FlagButton sessionId={session.id} flagged={!!(session as unknown as { review_flag?: boolean }).review_flag} qc={qc} toast={toast} />
            )}
            <button
              className="w-7 h-7 rounded-lg flex items-center justify-center border bg-white text-slate-400 transition-all hover:text-slate-700 shrink-0"
              style={{ borderColor: BORDER }}
              onClick={() => navigate(`/sessions/${session.id}`)}
              title={translate("sessions.viewDetail")}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -- Group heading --------------------------------------------------------------
  function GroupHeading({ label, count }: { label: string; count: number }) {
    return (
      <div
        className="px-5 py-2 flex items-center gap-2 sticky top-0 z-10"
        style={{ background: "rgba(246,244,251,0.95)", borderBottom: `1px solid ${BORDER}` }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T3 }}>{label}</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: `${PLUM}10`, color: PLUM }}>
          {count}
        </span>
      </div>
    );
  }

  // -- Render ---------------------------------------------------------------------
  return (
    <div className="space-y-6 pb-10">

      {/* Page header � matches Dashboard pattern */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Clinical Records</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
            {translate("sessions.title")}
            <SectionInfo text="Clinical documentation for every support session: notes, outcomes, and progress toward goals." />
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: T3 }}>
            {isLoading ? translate("sessions.subtitleLoading") : translateParams("sessions.subtitleCount", { total: String(sessions.length), filtered: String(filtered.length) })}
          </p>
        </div>
        <Link href="/sessions/new">
          <button
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95 active:scale-[0.99]"
            style={{ background: "var(--cc-cta)" }}
          >
            <Plus size={16} strokeWidth={2.5} />
            {translate("sessions.newSession")}
          </button>
        </Link>
      </div>

      {/* Stat cards � matches Dashboard grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SessionStatCard label={translate("sessions.stat.total")}  value={sessions.length}   caption={translate("sessions.stat.totalCaption")}        icon={Calendar}      />
        <SessionStatCard label={translate("sessions.stat.thisWeek")}        value={thisWeekCount}     caption={translate("sessions.stat.thisWeekCaption")}     icon={Clock}         />
        <SessionStatCard label={translate("sessions.stat.avgCompliance")}   value={avgCompliance}     caption={translate("sessions.stat.avgComplianceCaption")}    icon={ShieldCheck}   valueColor={PLUM} />
        <SessionStatCard label={translate("sessions.stat.inProgress")}      value={inProgressCount}   caption={translate("sessions.stat.inProgressCaption")}    icon={AlertTriangle} valueColor={inProgressCount > 0 ? "#D97706" : T1} />
      </div>

      {/* Filter + session list � dashboard card style */}
      <section className="rounded-lg border bg-white shadow-sm overflow-hidden" style={{ borderColor: BORDER }}>

        {/* Filter bar */}
        <div className="p-5 border-b space-y-4" style={{ borderColor: BORDER }}>

          {/* Row 1: search + status + participant */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6 lg:col-span-7 flex w-full">
              <Field icon={<Search size={14} />}>
                <input
                  placeholder={translate("sessions.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-[38px] rounded-lg text-[13px] pl-9 outline-none pr-3 border bg-white"
                  style={{ borderColor: BORDER, color: T1 }}
                />
              </Field>
            </div>

            <div className="md:col-span-3 lg:col-span-2 w-full">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-[38px] rounded-lg text-[13px] w-full bg-white" style={{ borderColor: BORDER, color: T2 }}>
                  <SelectValue placeholder={translate("sessions.filter.allStatusesPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{translate("sessions.filter.allStatuses")}</SelectItem>
                  <SelectItem value="completed">{translate("sessions.filter.completed")}</SelectItem>
                  <SelectItem value="in_progress">{translate("sessions.filter.inProgress")}</SelectItem>
                  <SelectItem value="draft">{translate("sessions.filter.draft")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-3 lg:col-span-3 w-full">
              <Select value={participantFilter} onValueChange={setParticipantFilter}>
                <SelectTrigger className="h-[38px] rounded-lg text-[13px] w-full bg-white flex items-center" style={{ borderColor: BORDER, color: T2 }}>
                  <div className="flex items-center truncate">
                    <Users size={13} className="mr-1.5 opacity-60 shrink-0" />
                    <SelectValue placeholder={translate("sessions.filter.allParticipantsPlaceholder")} />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{translate("sessions.filter.allParticipants")}</SelectItem>
                  {participantOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: date range + sort */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <span className="flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap" style={{ color: T3 }}>
                <Calendar size={13} /> {translate("sessions.dateRange")}
              </span>
              <input
                type="date"
                className="flex-1 sm:flex-initial h-[38px] min-w-[130px] rounded-lg text-[13px] px-3 outline-none border bg-white"
                style={{ borderColor: BORDER, color: T1 }}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label={translate("sessions.dateFrom")}
              />
              <span className="text-[12px]" style={{ color: T3 }}>{translate("sessions.dateToLabel")}</span>
              <input
                type="date"
                className="flex-1 sm:flex-initial h-[38px] min-w-[130px] rounded-lg text-[13px] px-3 outline-none border bg-white"
                style={{ borderColor: BORDER, color: T1 }}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label={translate("sessions.dateTo")}
              />

              {hasDateFilter && (
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors hover:bg-[#F4EDE6]"
                  style={{ color: T3 }}
                >
                  <X size={12} /> {translate("sessions.clearDates")}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end lg:self-auto w-full sm:w-auto justify-end">
              <ArrowUpDown size={13} style={{ color: T3 }} className="shrink-0" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="h-[34px] rounded-lg text-[12px] w-full sm:w-48 bg-white" style={{ borderColor: BORDER, color: T2 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(SORT_I18N) as [SortKey, string][]).map(([k, i18nKey]) => (
                    <SelectItem key={k} value={k}>{translate(i18nKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active filter pills */}
          {hasAnyFilter && !isLoading && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-dashed" style={{ borderColor: BORDER }}>
              <span className="text-[11px] font-medium" style={{ color: T3 }}>{translate("sessions.filters")}</span>
              {search && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
                  style={{ background: `${PLUM}08`, borderColor: `${PLUM}20`, color: PLUM }}>
                  "{search}" <X size={10} className="cursor-pointer" onClick={() => setSearch("")} />
                </span>
              )}
              {statusFilter !== "all" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
                  style={{ background: `${PLUM}08`, borderColor: `${PLUM}20`, color: PLUM }}>
                  {statusFilter} <X size={10} className="cursor-pointer" onClick={() => setStatusFilter("all")} />
                </span>
              )}
              {participantFilter !== "all" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
                  style={{ background: `${PLUM}08`, borderColor: `${PLUM}20`, color: PLUM }}>
                  {participantMap.get(participantFilter) ?? participantFilter}
                  <X size={10} className="cursor-pointer" onClick={() => setParticipantFilter("all")} />
                </span>
              )}
              <button onClick={() => { setSearch(""); setStatusFilter("all"); setParticipantFilter("all"); setDateFrom(""); setDateTo(""); }}
                className="text-[11px] font-medium underline underline-offset-2 ml-1" style={{ color: T3 }}>
                {translate("sessions.clearAll")}
              </button>
            </div>
          )}
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div
            className="px-5 py-2.5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            style={{ background: `${PLUM}08`, borderColor: BORDER }}
          >
            <span className="text-[13px] font-semibold" style={{ color: PLUM }}>
              {translateParams(selectedIds.size === 1 ? "sessions.selected" : "sessions.selectedPlural", { count: String(selectedIds.size) })}
              {exportProgress && (
                <span className="font-normal ml-2" style={{ color: T3 }}>
                  {translateParams("sessions.generating", { done: String(exportProgress.done), total: String(exportProgress.total) })}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                data-testid="button-bulk-export-pdf"
                onClick={handleBulkExport}
                disabled={isBulkExporting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border bg-white text-[12px] font-semibold transition-all hover:bg-[#F4EDE6] disabled:opacity-50 shadow-sm"
                style={{ borderColor: `${PLUM}35`, color: PLUM }}
              >
                {isBulkExporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                {isBulkExporting ? translate("sessions.exporting") : translate("sessions.exportPdf")}
              </button>
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors hover:bg-[#F4EDE6]"
                style={{ color: T3 }}
              >
                <X size={12} /> {translate("sessions.deselect")}
              </button>
            </div>
          </div>
        )}

        {/* Select-all row */}
        {!isLoading && sorted.length > 0 && (
          <div
            className="px-5 py-2.5 flex items-center gap-3 border-b"
            style={{ background: SOFT, borderColor: BORDER }}
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleSelectAll}
              aria-label={translate("sessions.selectAll")}
              data-testid="checkbox-select-all"
            />
            <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: T3 }}>
              {allSelected
                ? translateParams("sessions.deselectAll", { count: String(sorted.length) })
                : translateParams(sorted.length === 1 ? "sessions.selectAllRecords" : "sessions.selectAllRecordsPlural", { count: String(sorted.length) })}
            </span>
          </div>
        )}

        {/* Session list */}
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {isLoading ? (
            Array(5).fill(0).map((_, i) => <SkeletonRow key={i} />)
          ) : sorted.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center px-8">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: SOFT }}>
                <Calendar size={20} style={{ color: PLUM }} />
              </div>
              <p className="text-[15px] font-semibold" style={{ color: T1 }}>{translate("sessions.empty.title")}</p>
              <p className="text-[13px] mt-1" style={{ color: T3 }}>
                {hasAnyFilter ? translate("sessions.empty.filtered") : translate("sessions.empty.noFilter")}
              </p>
            </div>
          ) : grouped ? (
            Array.from(grouped.entries()).map(([groupKey, items]) => (
              <React.Fragment key={groupKey}>
                <GroupHeading label={translate(GROUP_I18N[groupKey])} count={items.length} />
                {items.map((s) => <SessionRow key={s.id} session={s} />)}
              </React.Fragment>
            ))
          ) : (
            sorted.map((s) => <SessionRow key={s.id} session={s} />)
          )}
        </div>

        {/* Footer count */}
        {!isLoading && sorted.length > 0 && (
          <div className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: BORDER, background: SOFT }}>
            <span className="text-[11px]" style={{ color: T3 }}>
              {translateParams(sessions.length === 1 ? "sessions.footer.showing" : "sessions.footer.showingPlural", { shown: String(sorted.length), total: String(sessions.length) })}
            </span>
            {sessions.length > sorted.length && (
              <button
                className="text-[11px] font-semibold"
                style={{ color: PLUM }}
                onClick={() => { setSearch(""); setStatusFilter("all"); setParticipantFilter("all"); setDateFrom(""); setDateTo(""); }}
              >
                {translate("sessions.footer.clearFilters")}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
