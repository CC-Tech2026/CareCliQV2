import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { INPUT } from "@/components/participants/recordUi";

type CleanSegment = { segment_id?: string; speaker_name?: string; text: string; start?: string };
type RawSegment = { segment_id?: string; speaker_label?: string; text: string; start?: string };

/** Whisper gives every segment "00:00:00" when it has no timing; don't show it. */
function showTime(start?: string): string | null {
  if (!start || /^0{1,2}:0{2}(:0{2})?$/.test(start)) return null;
  return start.replace(/^00:(\d{2}:\d{2})$/, "$1");
}

/**
 * Who said what, as plain turns. A search box narrows long meetings, and a
 * suggestion's "See where this was said" scrolls to and marks its lines.
 */
export function MeetingTranscript({
  cleanTranscript = [],
  rawTranscript = [],
  highlightIds = [],
}: {
  cleanTranscript?: CleanSegment[];
  rawTranscript?: RawSegment[];
  highlightIds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const turns = useMemo(
    () => cleanTranscript.map((seg, i) => ({ ...seg, key: seg.segment_id ?? `t${i}`, speaker: seg.speaker_name || "Unknown speaker" })),
    [cleanTranscript],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? turns.filter((t) => t.text.toLowerCase().includes(q) || t.speaker.toLowerCase().includes(q)) : turns;

  const highlightKey = highlightIds.join(",");
  useEffect(() => {
    if (!highlightKey) return;
    setQuery("");
    // After the cleared search has rendered every turn again.
    const id = requestAnimationFrame(() => {
      const first = highlightKey.split(",")[0];
      const el = listRef.current?.querySelector(`[data-segment="${CSS.escape(first)}"]`);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightKey]);

  if (turns.length === 0) {
    return <p className="py-6 text-sm text-cc-muted">There's no transcript for this meeting.</p>;
  }

  return (
    <div className="space-y-3">
      {turns.length > 6 && (
        <label className="relative block">
          <span className="sr-only">Search the transcript</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cc-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the transcript"
            className={`${INPUT} pl-9`}
          />
        </label>
      )}

      {shown.length === 0 ? (
        <p className="py-4 text-sm text-cc-muted">Nothing in the transcript matches "{query.trim()}".</p>
      ) : (
        <ol ref={listRef} className="divide-y divide-cc-border">
          {shown.map((t) => {
            const marked = !!t.segment_id && highlightIds.includes(t.segment_id);
            const time = showTime(t.start);
            return (
              <li
                key={t.key}
                data-segment={t.segment_id}
                className={`py-3 ${marked ? "-mx-3 rounded-lg bg-[var(--cc-amber-tint)] px-3" : ""}`}
              >
                <p className="text-sm font-medium text-cc-text">
                  {t.speaker}
                  {time && <span className="ml-2 font-normal tabular-nums text-cc-muted">{time}</span>}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-cc-text">{t.text}</p>
              </li>
            );
          })}
        </ol>
      )}

      {rawTranscript.length > 0 && (
        <div className="border-t border-cc-border pt-3">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            aria-expanded={showOriginal}
            className="text-sm font-medium text-cc-plum hover:underline"
          >
            {showOriginal ? "Hide the transcript before names were added" : "See the transcript before names were added"}
          </button>
          {showOriginal && (
            <ol className="mt-2 space-y-1.5">
              {rawTranscript.map((seg, i) => (
                <li key={seg.segment_id ?? i} className="text-sm text-cc-text">
                  <span className="text-cc-muted">{seg.speaker_label || "Speaker"}:</span> {seg.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
