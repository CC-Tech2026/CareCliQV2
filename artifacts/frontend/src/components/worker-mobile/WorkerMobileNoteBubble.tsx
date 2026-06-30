import { useState } from "react";
import { Pencil } from "lucide-react";
import { Link } from "wouter";
import { WM } from "@/lib/worker-mobile-tokens";
import type { NoteComplianceFlag } from "@/lib/worker-compliance-engine";
import type { SessionNoteRecord } from "@/services/sessionNotesService";
import { inferNoteType, noteTimestamp } from "@/components/shifts/SessionNoteHistoryCard";

type Props = {
  note: SessionNoteRecord;
  taskLabel?: string;
  goalTitle?: string;
  flag?: NoteComplianceFlag;
  editable?: boolean;
  onSave?: (noteId: string, content: string) => void;
  onIncidentReport?: (noteId: string, content: string) => void;
};

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function WorkerMobileNoteBubble({
  note,
  taskLabel,
  goalTitle,
  flag,
  editable,
  onSave,
  onIncidentReport,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const type = inferNoteType(note);
  const ts = noteTimestamp(note);
  const wc = wordCount(note.content);
  const isFlagged = Boolean(flag);
  const isFail = flag?.severity === "fail";
  const isResolved = flag?.severity === "warn" && flag.ruleId === 9;

  const handleSave = () => {
    onSave?.(note.note_id, draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(note.content);
    setEditing(false);
  };

  const categoryLabel = [taskLabel, goalTitle].filter(Boolean).join(" · ");

  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderLeftWidth: isFlagged ? 3 : 0.5,
        borderLeftColor: isFail ? WM.red : isResolved ? WM.amber : isFlagged ? WM.amber : WM.border,
        borderColor: isFail ? WM.alertBorder : isResolved ? WM.warnBorder : WM.border,
        background: isFail ? WM.alertBg : isResolved ? WM.warnBg : WM.surface,
      }}
    >
      {categoryLabel && (
        <p className="mb-1.5 text-[11px] font-semibold" style={{ color: WM.purple }}>
          {categoryLabel}
        </p>
      )}

      {isFlagged && (
        <p className="mb-1.5 text-[10px] font-semibold" style={{ color: isFail ? WM.alertText : WM.warnTitle }}>
          {isFail ? "✗ Compliance flag raised" : "⚠ Incident filed — pending review"}
        </p>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border px-3 py-2 text-[14px] leading-relaxed outline-none"
            style={{ borderColor: WM.infoBorder, background: WM.bg, color: WM.text }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ background: WM.purple }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
              style={{ borderColor: WM.border, color: WM.muted }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {type === "text" || type === "voice" ? (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: WM.text }}>
              {note.content}
            </p>
          ) : (
            <p className="text-[14px] font-medium" style={{ color: WM.text }}>
              {note.file_name ?? note.content}
            </p>
          )}

          {flag && (
            <div
              className="mt-2 rounded-lg border p-2.5"
              style={{ borderColor: WM.alertBorder, background: WM.surface }}
            >
              <p className="text-[11px] font-semibold" style={{ color: WM.alertText }}>
                Rule {flag.ruleId} — {flag.ruleName}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: WM.alertText }}>
                {flag.message}
              </p>
              {flag.actionLabel && (flag.actionHref || onIncidentReport) && (
                onIncidentReport ? (
                  <button
                    type="button"
                    className="mt-2 h-8 rounded-lg px-3 text-[11px] font-semibold text-white"
                    style={{ background: WM.red }}
                    onClick={() => onIncidentReport(note.note_id, note.content)}
                  >
                    {flag.actionLabel}
                  </button>
                ) : (
                  <Link href={flag.actionHref!}>
                    <button
                      type="button"
                      className="mt-2 h-8 rounded-lg px-3 text-[11px] font-semibold text-white"
                      style={{ background: WM.red }}
                    >
                      {flag.actionLabel}
                    </button>
                  </Link>
                )
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium" style={{ color: WM.muted }}>
              {ts} · {type === "voice" ? `voice (${languageLabel(note)})` : type} · {wc} words
              {isFlagged ? " · ✗ flagged" : ""}
            </span>
            {editable && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ml-auto flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: WM.purple }}
              >
                <Pencil size={11} /> Edit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function languageLabel(note: SessionNoteRecord) {
  if (note.note_type === "voice") return "English";
  return "";
}
