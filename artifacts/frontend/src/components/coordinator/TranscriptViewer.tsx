import { useState } from "react";
import { ChevronDown } from "lucide-react";

const PLUM = "#3730A3";
const BORDER = "#E5E7EB";
const TEXT = "#1F2937";
const MUTED = "#6B7280";
const SOFT = "#F9FAFB";
const GREEN = "#10B981";
const GREEN_BG = "#D1FAE5";

interface TranscriptViewerProps {
  rawTranscript?: Array<{ segment_id?: string; speaker_label?: string; text: string; start?: string }>;
  cleanTranscript?: Array<{ segment_id?: string; speaker_name?: string; text: string; start?: string }>;
}

export function TranscriptViewer({ rawTranscript = [], cleanTranscript = [] }: TranscriptViewerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: BORDER }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-opacity-70 transition-colors"
        style={{ background: SOFT }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-black shrink-0"
            style={{ background: PLUM, color: "#fff" }}
          >
            📝
          </div>
          <div className="text-left">
            <p className="font-semibold text-[13px]" style={{ color: TEXT }}>
              Transcript Review
            </p>
            <p className="text-[11px]" style={{ color: MUTED }}>
              Original vs. AI-Enhanced
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
        <div className="border-t" style={{ borderColor: BORDER }}>
          {/* Raw Transcript */}
          <div className="p-4 border-b" style={{ borderColor: BORDER }}>
            <p className="text-[11px] font-semibold mb-3" style={{ color: MUTED, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Original (Whisper)
            </p>
            <div className="space-y-2">
              {rawTranscript && rawTranscript.length > 0 ? (
                rawTranscript.map((seg, i) => (
                  <div key={i} className="text-[12px] pb-2 border-b" style={{ borderColor: BORDER }}>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: MUTED }}>
                      {seg.speaker_label || `Speaker ${i + 1}`}
                      {seg.start && <span style={{ color: PLUM }}> · {seg.start}</span>}
                    </p>
                    <p style={{ color: TEXT, lineHeight: "1.5" }}>{seg.text}</p>
                  </div>
                ))
              ) : (
                <p style={{ color: MUTED }}>No transcript available</p>
              )}
            </div>
          </div>

          {/* Clean Transcript */}
          <div className="p-4">
            <p className="text-[11px] font-semibold mb-3" style={{ color: MUTED, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              AI-Enhanced (Cleaned & Resolved)
            </p>
            <div className="space-y-2">
              {cleanTranscript && cleanTranscript.length > 0 ? (
                cleanTranscript.map((seg, i) => (
                  <div key={i} className="text-[12px] pb-2 border-b" style={{ borderColor: BORDER }}>
                    <p className="text-[11px] font-semibold mb-1">
                      <span style={{ color: GREEN }}>{seg.speaker_name || `Speaker ${i + 1}`}</span>
                      {seg.start && <span style={{ color: MUTED }}> · {seg.start}</span>}
                    </p>
                    <p style={{ color: TEXT, lineHeight: "1.5" }}>{seg.text}</p>
                  </div>
                ))
              ) : (
                <p style={{ color: MUTED }}>No transcript available</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
