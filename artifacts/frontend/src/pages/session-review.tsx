import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2, ChevronDown, ChevronUp, Flag, Loader2,
  MessageSquare, Send, ShieldCheck, X, AlertTriangle,
  ClipboardList, ThumbsUp,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  getCoordinatorFlaggedSessions,
  approveSession,
  flagSessionForReview,
  type FlaggedSession,
} from "@/services/coordinatorService";
import { jsonFetch } from "@/services/http";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const T1     = "#111827";
const T2     = "#374151";
const T3     = "#6B7280";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

function safeDate(v?: string | null, fmt = "d MMM yyyy") {
  if (!v) return "—";
  try { return format(v.includes("T") ? parseISO(v) : new Date(v + "T00:00:00"), fmt); }
  catch { return v; }
}

function useComplianceTone(score?: number | null) {
  const { translate, translateParams } = useAccessibility();
  if (score == null) return { label: translate("sessions.review.severity.draft"), color: T3, bg: `${PLUM}0A` };
  if (score >= 85) return { label: translateParams("sessions.review.severity.compliant", { score: String(score) }), color: "#16A34A", bg: "rgba(22,163,74,0.07)" };
  if (score >= 60) return { label: translateParams("sessions.review.severity.atRisk", { score: String(score) }), color: "#D97706", bg: "rgba(245,158,11,0.07)" };
  return { label: translateParams("sessions.review.severity.nonCompliant", { score: String(score) }), color: "#DC2626", bg: "rgba(239,68,68,0.07)" };
}

type RuleResult = { rule: string; passed: boolean; warning?: boolean; message?: string };

function RuleIcon({ passed, warning }: { passed: boolean; warning?: boolean }) {
  if (passed) return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (warning) return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  return <X size={14} className="text-red-500 shrink-0" />;
}

function useAiSuggestions(sessionId: string, enabled: boolean) {
  return useOrgQuery(["ai-compliance-explain", sessionId], {
    queryFn: () =>
      jsonFetch<{ explanation: string; suggestions: string[] }>(
        `/api/ai/explain-compliance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        }
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function useSessionDetail(sessionId: string, enabled: boolean) {
  return useOrgQuery(["session-detail-review", sessionId], {
    queryFn: () => jsonFetch<Record<string, unknown>>(`/api/sessions/${sessionId}`),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

interface SendBackModalProps {
  sessionId: string;
  onClose: () => void;
  onSent: () => void;
}
function SendBackModal({ sessionId, onClose, onSent }: SendBackModalProps) {
  const { translate } = useAccessibility();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  async function handleSend() {
    if (!note.trim()) return;
    setLoading(true);
    try {
      await flagSessionForReview(sessionId, true, note.trim());
      qc.invalidateQueries({ queryKey: [orgId, "coordinator-flagged-sessions"] });
      toast({ title: translate("sessions.review.toast.sentBack"), description: translate("sessions.review.toast.sentBackDesc") });
      onSent();
    } catch {
      toast({ title: translate("sessions.review.toast.sendBackFailed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white shadow-xl" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <h3 className="text-base font-black" style={{ color: T1 }}>{translate("sessions.review.sendBackTitle")}</h3>
          <button onClick={onClose} title={translate("common.close")} className="rounded-lg p-1 hover:bg-gray-100">
            <X size={16} style={{ color: T3 }} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm font-medium" style={{ color: T2 }}>
            {translate("sessions.review.sendBackBody")}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={translate("sessions.review.sendBackPlaceholder")}
            rows={4}
            className="w-full rounded-lg border px-3 py-2.5 text-sm font-medium resize-none focus:outline-none focus:ring-2"
            style={{ borderColor: BORDER, color: T1, "--tw-ring-color": PLUM } as React.CSSProperties}
          />
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: BORDER }}>
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold transition hover:bg-gray-50" style={{ borderColor: BORDER, color: T2 }}>
            {translate("common.cancel")}
          </button>
          <button
            onClick={handleSend}
            disabled={!note.trim() || loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-black text-white disabled:opacity-50"
            style={{ background: CORAL }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {translate("sessions.review.sendBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SessionCardProps {
  session: FlaggedSession;
  selected: boolean;
  onToggle: () => void;
  onApproved: () => void;
}
function SessionCard({ session, selected, onToggle, onApproved }: SessionCardProps) {
  const { translate } = useAccessibility();
  const [expanded, setExpanded]       = useState(false);
  const [showAi, setShowAi]           = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [approving, setApproving]     = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: detail }     = useSessionDetail(session.id, expanded);
  const { data: aiData, isFetching: aiFetching } = useAiSuggestions(session.id, showAi);

  const tone = useComplianceTone(session.compliance_score);

  const rulesRaw = useMemo(() => {
    if (!detail) return [];
    const insights = detail.ai_insights as Record<string, unknown> | null;
    if (!insights) return [];
    const rules = (insights as Record<string, unknown>)?.rules_result as Record<string, unknown> | null;
    if (!rules) return [];
    return Object.entries(rules)
      .filter(([key]) => key !== "rp_flags")
      .map(([key, val]): RuleResult => {
        if (typeof val === "boolean") return { rule: key, passed: val };
        if (typeof val === "object" && val !== null) {
          const v = val as Record<string, unknown>;
          return {
            rule: key,
            passed: Boolean(v.passed ?? v.pass),
            warning: Boolean(v.warning),
            message: typeof v.message === "string" ? v.message : undefined,
          };
        }
        return { rule: key, passed: false };
      });
  }, [detail]);

  const notes = (detail?.notes as string) || (detail?.legal_record_text as string) || session.review_note || "—";

  async function handleApprove() {
    setApproving(true);
    try {
      await approveSession(session.id);
      qc.invalidateQueries({ queryKey: [orgId, "coordinator-flagged-sessions"] });
      toast({ title: translate("sessions.review.toast.approved"), description: translate("sessions.review.toast.approvedDesc") });
      onApproved();
    } catch {
      toast({ title: translate("sessions.review.toast.approvalFailed"), variant: "destructive" });
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      <div
        className={`rounded-xl border bg-white shadow-sm transition-all ${selected ? "border-[#3730A3]" : ""}`}
        style={{ borderColor: selected ? PLUM : BORDER }}
      >
        {/* ── Card header ── */}
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={translate("sessions.review.selectAll")} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Flag size={13} className="text-[#BE185D] shrink-0" />
              <span className="text-[13px] font-black" style={{ color: T1 }}>
                {session.participant_name || translate("common.participant")}
              </span>
              <span className="text-[11px] font-medium" style={{ color: T3 }}>
                {safeDate(session.session_date)} · {(session.session_type || "session").replace(/_/g, " ")}
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: tone.bg, color: tone.color }}
              >
                <ShieldCheck size={9} /> {tone.label}
              </span>
            </div>

            {session.review_note && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
                style={{ background: "#FFF8E1", color: "#92400E" }}>
                <MessageSquare size={12} className="shrink-0 mt-0.5" />
                <span>{session.review_note}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleApprove}
              disabled={approving}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "#059669" }}
            >
              {approving ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
              {translate("sessions.review.approve")}
            </button>
            <button
              onClick={() => setSendBackOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black transition hover:bg-gray-50"
              style={{ borderColor: CORAL, color: CORAL }}
            >
              <Send size={12} />
              {translate("sessions.review.sendBack")}
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border p-1.5 transition hover:bg-gray-50"
              style={{ borderColor: BORDER, color: T3 }}
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </div>

        {/* ── Expanded detail ── */}
        {expanded && (
          <div className="border-t px-5 py-4 space-y-4" style={{ borderColor: BORDER }}>
            {/* Notes preview */}
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: T3 }}>
                {translate("sessions.review.sessionNotes")}
              </p>
              <div className="rounded-lg border px-3 py-2.5 text-sm font-medium whitespace-pre-wrap max-h-36 overflow-y-auto"
                style={{ borderColor: BORDER, color: T2, background: SOFT }}>
                {notes}
              </div>
            </div>

            {/* Compliance rules */}
            {rulesRaw.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: T3 }}>
                  {translate("sessions.review.complianceRules")}
                </p>
                <div className="space-y-1.5">
                  {rulesRaw.map((r) => (
                    <div key={r.rule} className="flex items-start gap-2">
                      <RuleIcon passed={r.passed} warning={r.warning} />
                      <div className="min-w-0">
                        <span className="text-xs font-bold capitalize" style={{ color: T1 }}>
                          {r.rule.replace(/_/g, " ")}
                        </span>
                        {r.message && (
                          <span className="ml-1.5 text-xs font-medium" style={{ color: T3 }}>— {r.message}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI suggestions */}
            <div>
              <button
                onClick={() => setShowAi((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-bold transition hover:opacity-80"
                style={{ color: PLUM }}
              >
                {aiFetching ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}
                {showAi ? translate("sessions.review.hideAi") : translate("sessions.review.loadAi")}
              </button>
              {showAi && aiData && (
                <div className="mt-2 rounded-lg border px-4 py-3 space-y-2"
                  style={{ borderColor: `${PLUM}30`, background: `${PLUM}06` }}>
                  {aiData.explanation && (
                    <p className="text-xs font-medium" style={{ color: T2 }}>{aiData.explanation}</p>
                  )}
                  {aiData.suggestions?.length > 0 && (
                    <ul className="space-y-1 text-xs font-medium list-disc list-inside" style={{ color: T2 }}>
                      {aiData.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Link href={`/sessions/${session.id}`}>
                <button className="text-xs font-bold transition hover:opacity-80" style={{ color: PLUM }}>
                  {translate("sessions.review.openFull")}
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>

      {sendBackOpen && (
        <SendBackModal
          sessionId={session.id}
          onClose={() => setSendBackOpen(false)}
          onSent={() => setSendBackOpen(false)}
        />
      )}
    </>
  );
}

export default function SessionReview() {
  const { translate, translateParams } = useAccessibility();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: sessions = [], isLoading, refetch } = useOrgQuery(["coordinator-flagged-sessions"], {
    queryFn: getCoordinatorFlaggedSessions,
    staleTime: 30_000,
  });

  const allSelected = sessions.length > 0 && sessions.every((s) => selected.has(s.id));
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sessions.map((s) => s.id)));
  }

  function handleApproved() {
    refetch();
  }

  async function handleBulkApprove() {
    if (!someSelected) return;
    setBulkApproving(true);
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map((id) => approveSession(id)));
      qc.invalidateQueries({ queryKey: [orgId, "coordinator-flagged-sessions"] });
      toast({
        title: translateParams(ids.length > 1 ? "sessions.review.toast.bulkApprovedPlural" : "sessions.review.toast.bulkApproved", { count: String(ids.length) }),
        description: translate("sessions.review.toast.approvedDesc"),
      });
      setSelected(new Set());
    } catch {
      toast({ title: translate("sessions.review.toast.bulkFailed"), variant: "destructive" });
    } finally {
      setBulkApproving(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="hidden" style={{ color: CORAL }}>
            Quality & Safety
          </p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
            {translate("sessions.review.title")}
          </h1>
          <p className="mt-1 text-sm font-medium" style={{ color: T3 }}>
            {isLoading
              ? translate("sessions.review.loading")
              : translateParams(sessions.length !== 1 ? "sessions.review.awaitingPlural" : "sessions.review.awaiting", { count: String(sessions.length) })}
          </p>
        </div>

        {someSelected && (
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproving}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95 disabled:opacity-60"
            style={{ background: "#059669" }}
          >
            {bulkApproving
              ? <Loader2 size={16} className="animate-spin" />
              : <CheckCircle2 size={16} strokeWidth={2.5} />}
            {translateParams("sessions.review.bulkApprove", { count: String(selected.size) })}
          </button>
        )}
      </div>

      {/* Toolbar */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-white px-4 py-2.5 shadow-sm" style={{ borderColor: BORDER }}>
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            aria-label={translate("sessions.review.selectAll")}
          />
          <span className="text-xs font-bold" style={{ color: T3 }}>
            {someSelected ? translateParams("sessions.review.selectedOf", { selected: String(selected.size), total: String(sessions.length) }) : translate("sessions.review.selectAllLabel")}
          </span>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-white p-5 shadow-sm animate-pulse" style={{ borderColor: BORDER }}>
              <div className="flex gap-3">
                <div className="h-4 w-4 rounded bg-[#E5E7EB]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-[#E5E7EB]" />
                  <div className="h-3 w-32 rounded bg-[#E5E7EB]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-white py-20 text-center shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: SOFT }}>
            <CheckCircle2 size={32} style={{ color: PLUM }} />
          </div>
          <h2 className="text-xl font-black" style={{ color: T1 }}>{translate("sessions.review.allClear")}</h2>
          <p className="mt-2 max-w-xs text-sm font-medium" style={{ color: T3 }}>
            {translate("sessions.review.empty")}
          </p>
          <Link href="/sessions">
            <button
              className="mt-6 rounded-full px-5 py-2.5 text-sm font-black text-white"
              style={{ background: PLUM }}
            >
              {translate("sessions.review.viewAll")}
            </button>
          </Link>
        </div>
      )}

      {/* Session cards */}
      {!isLoading && sessions.length > 0 && (
        <div className="space-y-4">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              selected={selected.has(session.id)}
              onToggle={() => toggle(session.id)}
              onApproved={handleApproved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
