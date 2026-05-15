import React, { useState, useMemo } from "react";
import { format, parseISO, isAfter, isBefore, isEqual, startOfDay, endOfDay } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  Search, Plus, Calendar, Clock, ShieldCheck,
  ChevronRight, Play, FileDown, Loader2, X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { exportBulkSessionsPDF } from "@/lib/pdf-export";

// ── Types & Interfaces ────────────────────────────────────────────────────────
interface Participant {
  full_name: string;
}

interface Session {
  id: string;
  session_type: string;
  session_date: string; // ISO String
  duration_minutes: number;
  status: "completed" | "in_progress" | "draft" | string;
  compliance_score: number | null;
  restrictive_practice_detected: boolean;
  tags?: string[];
  participants?: Participant | null;
}

interface SessionsProps {
  /** Expects dynamic data and state from your data-fetching layer (e.g., React Query or Context) */
  sessions?: Session[] | undefined;
  isLoading?: boolean;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM  = "#542269";
const CORAL = "#F1738A";
const T1    = "#1C1626";
const T2    = "#4A3D5A";
const T3    = "#7A6A8A";
const BORDER = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

// ── Styled input container ────────────────────────────────────────────────────
function Field({
  icon, children,
}: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center w-full">
      {icon && (
        <span className="absolute left-3 pointer-events-none z-10" style={{ color: T3 }}>
          {icon}
        </span>
      )}
      {children}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ score, status }: { score?: number | null; status?: string }) {
  if (status === "draft" || (!score && !status)) {
    return (
      <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
        style={{ background: "rgba(84,34,105,0.06)", color: T3 }}>Draft</span>
    );
  }
  if (score != null) {
    const cfg = score >= 85
      ? { bg: "rgba(22,163,74,0.08)", color: "#16A34A", label: "Compliant" }
      : score >= 60
      ? { bg: "rgba(245,158,11,0.08)", color: "#D97706", label: "At Risk" }
      : { bg: "rgba(239,68,68,0.08)", color: "#DC2626", label: "Non-Compliant" };
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
        style={{ background: cfg.bg, color: cfg.color }}>
        <ShieldCheck size={10} />
        {cfg.label} · {score}%
      </span>
    );
  }
  return null;
}

export default function Sessions({ sessions = [], isLoading = false }: SessionsProps) {
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [exportProgress, setExportProgress]   = useState<{ done: number; total: number } | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Optimized Filtering Engine
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchesSearch =
        (s.participants?.full_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
        s.session_type.toLowerCase().includes(search.toLowerCase());

      const matchesStatus = statusFilter === "all" || s.status === statusFilter;

      let matchesDateFrom = true;
      let matchesDateTo   = true;

      if (dateFrom) {
        const from = startOfDay(parseISO(dateFrom));
        const sessionDate = startOfDay(parseISO(s.session_date));
        matchesDateFrom = isAfter(sessionDate, from) || isEqual(sessionDate, from);
      }
      if (dateTo) {
        const to = endOfDay(parseISO(dateTo));
        const sessionDate = startOfDay(parseISO(s.session_date));
        matchesDateTo = isBefore(sessionDate, to) || isEqual(sessionDate, to);
      }

      return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
    });
  }, [sessions, search, statusFilter, dateFrom, dateTo]);

  const allFilteredIds = useMemo(() => filteredSessions.map((s) => s.id), [filteredSessions]);
  const allSelected  = filteredSessions.length > 0 && filteredSessions.every((s) => selectedIds.has(s.id));
  const someSelected = selectedIds.size > 0;

  const toggleSession = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const n = new Set(prev);
        allFilteredIds.forEach(id => n.delete(id));
        return n;
      });
    } else {
      setSelectedIds(prev => {
        const n = new Set(prev);
        allFilteredIds.forEach(id => n.add(id));
        return n;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkExport = async () => {
    if (!selectedIds.size) return;
    setIsBulkExporting(true);
    setExportProgress({ done: 0, total: selectedIds.size });
    try {
      await exportBulkSessionsPDF(Array.from(selectedIds), (done, total) => setExportProgress({ done, total }));
      toast({ title: "PDF exported", description: `Audit report for ${selectedIds.size} session(s) downloaded.` });
      clearSelection();
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsBulkExporting(false);
      setExportProgress(null);
    }
  };

  const hasDateFilter = dateFrom || dateTo;

  const inputStyle = {
    background: "white",
    border: `1px solid ${BORDER}`,
    color: T1,
    borderRadius: 12,
    height: 38,
    fontSize: 13,
    outline: "none",
    padding: "0 12px",
  } as const;

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-8">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight" style={{ color: T1 }}>
            Clinical Sessions
          </h1>
          <p className="text-[14px] mt-1" style={{ color: T2 }}>
            Manage your clinical notes and compliance records.
          </p>
        </div>
        <Link href="/sessions/new">
          <button
            data-testid="button-new-session"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all duration-200 hover:opacity-90 shrink-0 shadow-sm"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            <Plus size={14} strokeWidth={2.5} /> New Session
          </button>
        </Link>
      </div>

      {/* ── Filter card ── */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>

        {/* Filter bar */}
        <div className="p-4 border-b flex flex-col gap-4" style={{ borderColor: "rgba(232,213,232,0.35)" }}>
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <Field icon={<Search size={14} />}>
              <input
                placeholder="Search participant or session type…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 36 }}
                className="w-full flex-1"
              />
            </Field>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="h-[38px] rounded-xl text-[13px] w-full sm:w-48 bg-white"
                style={{ borderColor: BORDER, color: T2 }}
              >
                <SelectValue placeholder="All sessions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap" style={{ color: T3 }}>
              <Calendar size={13} /> Date range
            </span>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="date"
                style={inputStyle}
                className="w-full sm:w-[148px]"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="text-[12px]" style={{ color: T3 }}>to</span>
              <input
                type="date"
                style={inputStyle}
                className="w-full sm:w-[148px]"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                aria-label="To date"
              />
            </div>
            {hasDateFilter && (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors hover:bg-[#F6F4FB]"
                style={{ color: T3 }}
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div
            className="px-5 py-2.5 border-b flex flex-col sm:flex-row sm:items-center gap-3 transition-all duration-200"
            style={{ background: `${PLUM}08`, borderColor: "rgba(232,213,232,0.35)" }}
          >
            <span className="text-[13px] font-semibold flex-1" style={{ color: PLUM }}>
              {selectedIds.size} session{selectedIds.size !== 1 ? "s" : ""} selected
              {exportProgress && (
                <span className="font-normal ml-2" style={{ color: T3 }}>
                  — generating {exportProgress.done}/{exportProgress.total}…
                </span>
              )}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                data-testid="button-bulk-export-pdf"
                onClick={handleBulkExport}
                disabled={isBulkExporting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border bg-white text-[12px] font-semibold transition-all duration-150 hover:bg-slate-50 disabled:opacity-50 shadow-sm"
                style={{ borderColor: `${PLUM}35`, color: PLUM }}
              >
                {isBulkExporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                {isBulkExporting ? "Exporting…" : "Export PDF"}
              </button>
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors hover:bg-[#F6F4FB]"
                style={{ color: T3 }}
              >
                <X size={12} /> Deselect
              </button>
            </div>
          </div>
        )}

        {/* Select-all row */}
        {!isLoading && filteredSessions.length > 0 && (
          <div
            className="px-5 py-2.5 flex items-center gap-3"
            style={{ background: "rgba(246,244,251,0.6)", borderBottom: `1px solid rgba(232,213,232,0.3)` }}
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all sessions"
              data-testid="checkbox-select-all"
            />
            <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: T3 }}>
              {allSelected
                ? "Deselect all records"
                : `Select all ${filteredSessions.length} listed item${filteredSessions.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        )}

        {/* Session rows */}
        <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.3)" }}>
          {isLoading ? (
            Array(5).fill(0).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                <div className="w-4 h-4 rounded bg-[#EDE3ED]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-[#EDE3ED]" />
                  <div className="h-3 w-32 rounded bg-[#EDE3ED]" />
                </div>
                <div className="h-6 w-24 rounded-full bg-[#EDE3ED]" />
              </div>
            ))
          ) : filteredSessions.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center px-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: `${PLUM}0A` }}>
                <Calendar size={20} style={{ color: PLUM }} />
              </div>
              <p className="text-[15px] font-semibold" style={{ color: T1 }}>No sessions found</p>
              <p className="text-[13px] mt-1" style={{ color: T3 }}>
                Try adjusting your filters or create a new session record.
              </p>
            </div>
          ) : (
            filteredSessions.map(session => (
              <div
                key={session.id}
                className={`flex flex-col md:flex-row md:items-center justify-between gap-4 px-5 py-4 transition-colors duration-150 group border-l-2 ${
                  selectedIds.has(session.id) 
                    ? "border-l-[#542269]" 
                    : "border-l-transparent hover:bg-[#F6F4FB]/40"
                }`}
                style={selectedIds.has(session.id) ? { background: `${PLUM}04` } : {}}
              >
                {/* Left Side: Checkbox + Interactive Meta Container */}
                <div
                  className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                >
                  <div className="shrink-0" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(session.id)}
                      onCheckedChange={() => toggleSession(session.id)}
                      aria-label={`Select session for ${session.participants?.full_name ?? "participant"}`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[14px] font-bold truncate transition-colors duration-150 group-hover:text-[#542269]"
                        style={{ color: T1 }}>
                        {session.participants?.full_name || "Unknown Participant"}
                      </span>
                      <span className="text-slate-300 hidden sm:inline">·</span>
                      <span className="text-[13px] font-medium truncate" style={{ color: T2 }}>
                        {session.session_type}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
                      <span className="flex items-center gap-1 text-[12px] font-medium" style={{ color: T3 }}>
                        <Calendar size={12} className="opacity-70" />
                        {format(parseISO(session.session_date), "MMM d, yyyy · h:mm a")}
                      </span>
                      <span className="flex items-center gap-1 text-[12px] font-medium" style={{ color: T3 }}>
                        <Clock size={12} className="opacity-70" />
                        {session.duration_minutes} min
                      </span>
                      {session.tags && session.tags.length > 0 && (
                        <div className="flex gap-1 items-center">
                          <span className="text-[10px] bg-slate-100 border text-slate-600 px-1.5 py-0.5 rounded font-medium uppercase tracking-wider">
                            {session.tags[0]}
                          </span>
                          {session.tags.length > 1 && (
                            <span className="text-[10px] bg-slate-50 border text-slate-500 px-1.5 py-0.5 rounded font-mono">
                              +{session.tags.length - 1}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side: Status Metrics & Primary Actions */}
                <div
                  className="flex flex-wrap items-center gap-3 shrink-0 justify-end md:justify-start"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge score={session.compliance_score} status={session.status} />

                    {session.restrictive_practice_detected && (
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold border border-red-200 uppercase tracking-wide"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#DC2626" }}
                        title="Restrictive Practice Detected"
                      >
                        ⚠ RP Alert
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold border transition-all duration-150 hover:bg-[#F1738A]/10"
                      style={{ borderColor: `${CORAL}40`, color: CORAL, background: `${CORAL}08` }}
                      onClick={() => navigate(`/sessions/${session.id}/live`)}
                    >
                      <Play size={11} fill={CORAL} /> Live
                    </button>

                    <button
                      className="w-8 h-8 rounded-xl flex items-center justify-center border bg-white text-slate-400 transition-all duration-150 hover:text-slate-700"
                      style={{ borderColor: BORDER }}
                      onClick={() => navigate(`/sessions/${session.id}`)}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}