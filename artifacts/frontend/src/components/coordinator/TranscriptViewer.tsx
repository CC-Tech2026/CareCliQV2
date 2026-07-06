import { useMemo, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";

const PLUM = "#3730A3";
const BORDER = "#E5E7EB";
const TEXT = "#1F2937";
const MUTED = "#6B7280";
const SOFT = "#F9FAFB";

const SPEAKER_COLORS = ["#3730A3", "#166534", "#BE185D", "#0369A1", "#B45309"];

function speakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

interface TranscriptViewerProps {
  rawTranscript?: Array<{ segment_id?: string; speaker_label?: string; text: string; start?: string }>;
  cleanTranscript?: Array<{ segment_id?: string; speaker_name?: string; text: string; start?: string }>;
  defaultExpanded?: boolean;
}

export function TranscriptViewer({ rawTranscript = [], cleanTranscript = [], defaultExpanded = false }: TranscriptViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showOriginal, setShowOriginal] = useState(false);

  const turns = useMemo(
    () => cleanTranscript.map((seg, i) => ({ ...seg, speaker_name: seg.speaker_name || `Speaker ${i + 1}` })),
    [cleanTranscript],
  );

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: BORDER }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-opacity-70 transition-colors"
        style={{ background: SOFT }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: PLUM, color: "#fff" }}
          >
            <FileText size={16} />
          </div>
          <div className="text-left">
            <p className="font-semibold text-[13px]" style={{ color: TEXT }}>
              Transcript
            </p>
            <p className="text-[11px]" style={{ color: MUTED }}>
              Who said what
            </p>
          </div>
        </div>
        <ChevronDown
          size={16}
          style={{ color: PLUM, transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
        />
      </button>

      {/* Content */}
      {expanded && (
        <div className="border-t p-4 space-y-2" style={{ borderColor: BORDER }}>
          {turns.length > 0 ? (
            turns.map((seg, i) => {
              const color = speakerColor(seg.speaker_name);
              return (
                <div
                  key={seg.segment_id ?? i}
                  className="rounded-lg p-3"
                  style={{ background: SOFT, border: `1px solid ${BORDER}` }}
                >
                  <p className="text-[11px] font-black mb-1" style={{ color }}>
                    {seg.speaker_name}
                    {seg.start && <span className="font-normal" style={{ color: MUTED }}> · {seg.start}</span>}
                  </p>
                  <p className="text-[12px]" style={{ color: TEXT, lineHeight: "1.5" }}>{seg.text}</p>
                </div>
              );
            })
          ) : (
            <p className="text-[12px]" style={{ color: MUTED }}>No transcript available</p>
          )}

          {rawTranscript.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                className="text-[11px] font-semibold hover:opacity-70 transition-opacity"
                style={{ color: PLUM }}
              >
                {showOriginal ? "Hide original transcript" : "View original transcript"}
              </button>

              {showOriginal && (
                <div className="mt-2 space-y-1.5">
                  {rawTranscript.map((seg, i) => (
                    <div key={seg.segment_id ?? i} className="text-[11px] pb-1.5 border-b" style={{ borderColor: BORDER }}>
                      <span className="font-semibold" style={{ color: MUTED }}>
                        {seg.speaker_label || `Speaker ${i + 1}`}
                        {seg.start && ` · ${seg.start}`}:
                      </span>{" "}
                      <span style={{ color: TEXT }}>{seg.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
