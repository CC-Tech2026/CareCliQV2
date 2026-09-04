import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, ChevronDown, ExternalLink, Search, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { TranslationAuditView } from "@/components/TranslationAuditView";
import { safeFormat, statusBadge, complianceTone } from "@/lib/participant-format";
import type { SessionRecord } from "@/pages/patients";

interface ParticipantSessionsTabProps {
  sessions: SessionRecord[];
  isLoading: boolean;
}

function matchesSearch(session: SessionRecord, query: string): boolean {
  const haystack = [
    session.session_type,
    session.worker_name,
    session.status,
    safeFormat(session.session_date),
    session.translated_english_note || session.compliance_input_text || session.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/** "Shift History" facet of the participant Detail archetype. */
export function ParticipantSessionsTab({ sessions, isLoading }: ParticipantSessionsTabProps) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => matchesSearch(s, q));
  }, [sessions, search]);

  return (
    <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5 text-[#E8457A]" />
          <h4 className="text-[13px] font-black text-[#1A1A2E]">Shift History</h4>
          <span className="rounded-full bg-[#EDE3FC] px-2.5 py-0.5 text-[10px] font-black text-[#E8457A]">
            {filtered.length}{filtered.length !== sessions.length ? ` of ${sessions.length}` : ""}
          </span>
        </div>
        {sessions.length > 0 && (
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6A6A77]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shift, worker, notes…"
              className="h-8 rounded-lg border-purple-100/60 pl-8 text-[12px]"
            />
          </div>
        )}
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
      ) : filtered.length === 0 ? (
        <div className="rounded-xl bg-white border border-purple-100/60 p-6 text-center">
          <Search className="h-8 w-8 text-[#6A6A77] opacity-30 mx-auto mb-2" />
          <p className="text-[13px] font-semibold text-[#1A1A2E]">No shifts match "{search}"</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((session) => {
            const isOpen = expandedId === session.id;
            const notesText = session.translated_english_note || session.compliance_input_text || session.notes;
            return (
              <div
                key={session.id}
                className="rounded-xl bg-white border overflow-hidden transition-colors"
                style={{ borderColor: isOpen ? "rgba(232,69,122,0.35)" : "rgba(221,214,254,0.5)" }}
              >
                {/* Row header — always visible, most relevant info at a glance */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : session.id)}
                  className="w-full text-left px-3 py-3 hover:bg-[#ECECEC]/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-[#1A1A2E] capitalize truncate">
                        {(session.session_type || "session").replace(/_/g, " ")}
                      </p>
                      <p className="text-[11px] text-[#6A6A77] mt-0.5 truncate">
                        {safeFormat(session.session_date)} · {session.duration_minutes || 0} min
                        {session.worker_name ? ` · ${session.worker_name}` : ""}
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
                      <ChevronDown
                        size={14}
                        className="text-[#6A6A77] opacity-50 shrink-0 transition-transform"
                        style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                      />
                    </div>
                  </div>
                  {!isOpen && notesText && (
                    <p className="mt-1.5 text-[11px] text-[#6A6A77] line-clamp-2 leading-relaxed">
                      {notesText}
                    </p>
                  )}
                </button>

                {/* Expanded — most relevant detail inline, full page one click away */}
                {isOpen && (
                  <div className="border-t border-purple-100/60 p-3 space-y-3">
                    <Link
                      href={`/sessions/${session.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors hover:bg-[#FDF0F4]"
                      style={{ color: "var(--cc-plum)", borderColor: "rgba(232,69,122,0.3)" }}
                    >
                      <ExternalLink size={12} /> Open full shift details
                    </Link>

                    <div className="flex flex-wrap gap-2">
                      <div className="rounded-lg border border-purple-100/60 bg-[#ECECEC] px-3 py-2 flex-1 min-w-[110px]">
                        <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77]">Date</p>
                        <p className="text-[13px] font-bold text-[#1A1A2E] mt-0.5">{safeFormat(session.session_date)}</p>
                      </div>
                      <div className="rounded-lg border border-purple-100/60 bg-[#ECECEC] px-3 py-2 flex-1 min-w-[110px]">
                        <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77]">Duration</p>
                        <p className="text-[13px] font-bold text-[#1A1A2E] mt-0.5">{session.duration_minutes || 0} min</p>
                      </div>
                      <div className="rounded-lg border border-purple-100/60 bg-[#ECECEC] px-3 py-2 flex-1 min-w-[110px]">
                        <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] flex items-center gap-1">
                          <User size={9} /> Support Worker
                        </p>
                        <p className="text-[13px] font-bold text-[#1A1A2E] mt-0.5 truncate">
                          {session.worker_name || <span className="italic font-medium text-[#6A6A77]">Not recorded</span>}
                        </p>
                      </div>
                      {session.compliance_score != null && (
                        <div className="rounded-lg border border-purple-100/60 bg-[#ECECEC] px-3 py-2 flex-1 min-w-[110px]">
                          <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] mb-1">Compliance</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${complianceTone(session.compliance_score)}`}>
                            {session.compliance_score}%
                          </span>
                        </div>
                      )}
                    </div>

                    {notesText && (
                      <div className="rounded-lg border border-purple-100/60 bg-[#ECECEC] px-3 py-2.5">
                        <p className="text-[9px] font-black uppercase tracking-wider text-[#6A6A77] mb-1.5">Notes</p>
                        <p className="text-[12px] text-[#1A1A2E] leading-relaxed whitespace-pre-wrap line-clamp-6">
                          {notesText}
                        </p>
                      </div>
                    )}

                    {(session.original_language_input || session.translated_english_note) && (
                      <TranslationAuditView
                        originalLanguageInput={session.original_language_input ?? undefined}
                        translatedEnglishNote={session.translated_english_note ?? undefined}
                        translationMetadata={session.translation_metadata ?? null}
                        translationStatus={session.translation_status ?? undefined}
                        translationProvider={session.translation_provider ?? undefined}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
