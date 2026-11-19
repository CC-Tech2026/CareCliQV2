import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarDays, ChevronDown, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TranslationAuditView } from "@/components/TranslationAuditView";
import { safeFormat, statusBadge, complianceTone } from "@/lib/participant-format";
import { shiftNoteSubtitle, shiftNoteTitle, type ShiftNoteLike } from "@/lib/shift-note-title";
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

/** Every shift with this participant and its progress note, newest first: one
 * list, each row opening in place to the full note. */
export function ParticipantSessionsTab({ sessions, isLoading }: ParticipantSessionsTabProps) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => matchesSearch(s, q));
  }, [sessions, search]);

  return (
    <section aria-labelledby="shifts-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="shifts-heading" className="text-base font-semibold text-cc-text">
            Progress notes
            <span className="ml-2 text-sm font-normal tabular-nums text-cc-muted">
              {filtered.length}{filtered.length !== sessions.length ? ` of ${sessions.length}` : ""}
            </span>
          </h3>
          <p className="mt-0.5 text-sm text-cc-muted">
            Each shift's note, newest first. A shift without a note yet shows on the Summary and the roster.
          </p>
        </div>
        {sessions.length > 0 && (
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search progress notes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-muted" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Worker, date or words in a note"
              className="min-h-10 w-full rounded-full border border-cc-border bg-cc-surface pl-9 pr-4 text-sm text-cc-text placeholder:text-cc-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-plum/40"
            />
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-8 text-center">
          <CalendarDays className="mx-auto mb-2 h-7 w-7 text-cc-muted" aria-hidden />
          <p className="text-sm font-semibold text-cc-text">No progress notes yet</p>
          <p className="mt-1 text-sm text-cc-muted">Each shift's progress note appears here once the worker writes it.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-cc-muted">No progress notes match "{search.trim()}".</p>
      ) : (
        <ul className="divide-y divide-cc-border border-y border-cc-border">
          {filtered.map((session) => {
            const isOpen = expandedId === session.id;
            const notesText = session.translated_english_note || session.compliance_input_text || session.notes;
            const title = shiftNoteTitle(session as ShiftNoteLike, { participant: false });
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : session.id)}
                  aria-expanded={isOpen}
                  className="w-full py-3 text-left transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-cc-text">{title}</p>
                      <p className="mt-0.5 truncate text-xs text-cc-muted">
                        {shiftNoteSubtitle(session as ShiftNoteLike) || `${session.duration_minutes || 0} min`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {session.compliance_score != null && (
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${complianceTone(session.compliance_score)}`}>
                          Note quality {session.compliance_score}%
                        </span>
                      )}
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadge(session.status || "")}`}>
                        {(session.status || "draft").replace(/_/g, " ")}
                      </span>
                      <ChevronDown
                        size={16}
                        aria-hidden
                        className="shrink-0 text-cc-muted transition-transform"
                        style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                      />
                    </div>
                  </div>
                  {!isOpen && notesText && (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-cc-muted">{notesText}</p>
                  )}
                </button>

                {isOpen && (
                  <div className="space-y-3 pb-4">
                    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-cc-muted">Date</dt>
                        <dd className="text-cc-text">{safeFormat(session.session_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-cc-muted">Length</dt>
                        <dd className="tabular-nums text-cc-text">{session.duration_minutes || 0} min</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-cc-muted">Support worker</dt>
                        <dd className="text-cc-text">{session.worker_name || <span className="text-cc-muted">Not recorded</span>}</dd>
                      </div>
                    </dl>

                    {notesText ? (
                      <div>
                        <p className="text-xs text-cc-muted">Progress note</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-cc-text">{notesText}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-cc-muted">No progress note written for this shift.</p>
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

                    <Link
                      href={`/sessions/${session.id}`}
                      className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-cc-plum hover:underline"
                    >
                      Open the full shift record <ArrowRight size={14} aria-hidden />
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
