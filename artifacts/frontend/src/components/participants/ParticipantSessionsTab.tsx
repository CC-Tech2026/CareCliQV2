import { useState } from "react";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TranslationAuditView } from "@/components/TranslationAuditView";
import SessionDetail from "@/pages/session-detail";
import { safeFormat, statusBadge, complianceTone } from "@/lib/participant-format";
import type { SessionRecord } from "@/pages/patients";

interface ParticipantSessionsTabProps {
  sessions: SessionRecord[];
  isLoading: boolean;
  sessionPanelId: string | null;
  onSessionPanelIdChange: (id: string | null) => void;
}

/** "Shift History" facet of the participant Detail archetype. */
export function ParticipantSessionsTab({
  sessions,
  isLoading,
  sessionPanelId,
  onSessionPanelIdChange,
}: ParticipantSessionsTabProps) {
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);

  return (
    <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
      {sessionPanelId ? (
        /* ── In-context session detail ───────────────────────────── */
        <>
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => onSessionPanelIdChange(null)}
              className="flex items-center gap-1.5 text-[12px] font-bold hover:opacity-75 transition-opacity"
              style={{ color: "var(--cc-plum)" }}
            >
              <ArrowLeft size={14} strokeWidth={2.5} />
              Back to shift history
            </button>
          </div>
          <SessionDetail id={sessionPanelId} />
        </>
      ) : (
      <div className="space-y-3"><div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5 text-[#E8457A]" />
          <h4 className="text-[13px] font-black text-[#1A1A2E]">Shift History</h4>
          <span className="rounded-full bg-[#EDE3FC] px-2.5 py-0.5 text-[10px] font-black text-[#E8457A]">
            {sessions.length}
          </span>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl bg-white border border-purple-100/60 p-6 text-center">
          <CalendarDays className="h-8 w-8 text-[#6A6A77] opacity-30 mx-auto mb-2" />
          <p className="text-[13px] font-semibold text-[#1A1A2E]">No shifts yet</p>
          <p className="text-[11px] text-[#6A6A77] mt-1">Shifts with this participant will appear here.</p>
        </div>
      ) : selectedSession ? (
        /* ── Split-pane: compact list + inline detail ── */
        <div className="flex gap-3 items-start">
          {/* Left: compact session list — hidden on mobile when detail is open */}
          <div className="hidden sm:flex w-[195px] shrink-0 flex-col gap-1.5 max-h-[520px] overflow-y-auto">
            {sessions.map((session) => {
              const isActive = selectedSession.id === session.id;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedSession(session)}
                  className="w-full text-left rounded-xl px-3 py-2.5 border transition-colors"
                  style={{
                    background: isActive ? "var(--cc-active-bg)" : "white",
                    borderColor: isActive ? "rgba(55,48,163,0.2)" : "rgba(221,214,254,0.5)",
                    boxShadow: isActive ? "inset 3px 0 0 var(--cc-plum)" : "none",
                  }}
                >
                  <p className="text-[12px] font-bold text-[#1A1A2E] capitalize truncate">
                    {(session.session_type || "session").replace(/_/g, " ")}
                  </p>
                  <p className="text-[10px] text-[#6A6A77] mt-0.5">{safeFormat(session.session_date)}</p>
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {session.compliance_score != null && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-black ${complianceTone(session.compliance_score)}`}>
                        {session.compliance_score}%
                      </span>
                    )}
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize ${statusBadge(session.status || "")}`}>
                      {session.status || "draft"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: shift detail panel */}
          <div className="flex-1 min-w-0 rounded-xl border border-purple-100/60 bg-white overflow-hidden">
            {/* Detail header */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--cc-border)" }}>
              <div className="flex items-center gap-2 min-w-0">
                {/* Mobile back button */}
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="sm:hidden flex items-center gap-1 text-[12px] font-bold shrink-0"
                  style={{ color: "var(--cc-plum)" }}
                >
                  <ChevronLeft size={14} /> Back
                </button>
                <CalendarDays className="hidden sm:block h-3.5 w-3.5 text-[#E8457A] shrink-0" />
                <p className="text-[13px] font-black text-[#1A1A2E] capitalize truncate">
                  {(selectedSession.session_type || "Session").replace(/_/g, " ")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onSessionPanelIdChange(selectedSession.id)}
                  className="flex items-center gap-1 text-[11px] font-bold hover:underline"
                  style={{ color: "var(--cc-plum)" }}
                >
                  <ExternalLink size={11} /> Full details
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  aria-label="Close shift detail"
                  className="hidden sm:flex h-6 w-6 rounded-full items-center justify-center hover:bg-purple-50 text-[#6A6A77]"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Detail body */}
            <div className="p-4 space-y-3">
              {/* Date + Duration */}
              <div className="flex gap-2">
                <div className="rounded-lg border border-purple-100/60 bg-[#F4EDE6] px-3 py-2 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77]">Date</p>
                  <p className="text-[13px] font-bold text-[#1A1A2E] mt-0.5">{safeFormat(selectedSession.session_date)}</p>
                </div>
                <div className="rounded-lg border border-purple-100/60 bg-[#F4EDE6] px-3 py-2 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77]">Duration</p>
                  <p className="text-[13px] font-bold text-[#1A1A2E] mt-0.5">{selectedSession.duration_minutes || 0} min</p>
                </div>
              </div>

              {/* Status + Compliance */}
              <div className="flex gap-2">
                <div className="rounded-lg border border-purple-100/60 bg-[#F4EDE6] px-3 py-2 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] mb-1.5">Status</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${statusBadge(selectedSession.status || "")}`}>
                    {selectedSession.status || "draft"}
                  </span>
                </div>
                {selectedSession.compliance_score != null && (
                  <div className="rounded-lg border border-purple-100/60 bg-[#F4EDE6] px-3 py-2 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] mb-1.5">Compliance</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${complianceTone(selectedSession.compliance_score)}`}>
                      {selectedSession.compliance_score}%
                    </span>
                  </div>
                )}
              </div>

              {/* Notes */}
              {(selectedSession.translated_english_note || selectedSession.compliance_input_text || selectedSession.notes) && (
                <div className="rounded-lg border border-purple-100/60 bg-[#F4EDE6] px-3 py-2.5">
                  <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] mb-1.5">Notes</p>
                  <p className="text-[12px] text-[#1A1A2E] leading-relaxed">
                    {selectedSession.translated_english_note || selectedSession.compliance_input_text || selectedSession.notes}
                  </p>
                </div>
              )}

              {/* Translation audit */}
              {(selectedSession.original_language_input || selectedSession.translated_english_note) && (
                <TranslationAuditView
                  originalLanguageInput={selectedSession.original_language_input ?? undefined}
                  translatedEnglishNote={selectedSession.translated_english_note ?? undefined}
                  translationMetadata={selectedSession.translation_metadata ?? null}
                  translationStatus={selectedSession.translation_status ?? undefined}
                  translationProvider={selectedSession.translation_provider ?? undefined}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Full-width list (no session selected) ── */
        <div className="space-y-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setSelectedSession(session)}
              className="w-full text-left rounded-xl bg-white border border-purple-100/60 px-3 py-3 hover:border-[#E8457A]/30 hover:bg-[#F4EDE6] transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#1A1A2E] capitalize truncate">
                    {(session.session_type || "session").replace(/_/g, " ")}
                  </p>
                  <p className="text-[11px] text-[#6A6A77] mt-0.5">
                    {safeFormat(session.session_date)} · {session.duration_minutes || 0} min
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {session.compliance_score != null && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${complianceTone(session.compliance_score)}`}>
                      {session.compliance_score}%
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${statusBadge(session.status || "")}`}>
                    {session.status || "draft"}
                  </span>
                  <ChevronRight size={14} className="text-[#6A6A77] opacity-40 shrink-0" />
                </div>
              </div>
              {(session.translated_english_note || session.compliance_input_text || session.notes) && (
                <p className="mt-1.5 text-[11px] text-[#6A6A77] line-clamp-2 leading-relaxed">
                  {session.translated_english_note || session.compliance_input_text || session.notes}
                </p>
              )}
              {(session.original_language_input || session.translated_english_note) && (
                <div className="mt-2">
                  <TranslationAuditView
                    originalLanguageInput={session.original_language_input ?? undefined}
                    translatedEnglishNote={session.translated_english_note ?? undefined}
                    translationMetadata={session.translation_metadata ?? null}
                    translationStatus={session.translation_status ?? undefined}
                    translationProvider={session.translation_provider ?? undefined}
                  />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      </div>
      )}
    </section>
  );
}
