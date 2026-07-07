import { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import type { ComplianceEvaluation } from "@/lib/worker-compliance-engine";
import type { ShiftTask, ShiftHealthAlert } from "@/services/shiftService";
import type { SessionNoteRecord } from "@/services/sessionNotesService";
import { ComplianceScoreBar } from "./ComplianceScoreBar";
import { WorkerMobileNoteBubble } from "./WorkerMobileNoteBubble";
import { WorkerMobileParticipantStrip } from "./WorkerMobileParticipantStrip";
import { WorkerMobileRiskStrip } from "./WorkerMobileRiskStrip";

type Props = {
  participantName: string;
  healthAlerts?: ShiftHealthAlert[];
  tasks: ShiftTask[];
  notes: SessionNoteRecord[];
  compliance: ComplianceEvaluation;
  busy?: boolean;
  onSaveNote: (noteId: string, content: string) => void;
  onAddMissingNote: (taskId: string, content: string) => void;
  onSubmit: () => void;
  onViewComplianceReport: () => void;
  onOpenIncidentReport?: (noteId: string, content: string) => void;
};

function medicationTask(tasks: ShiftTask[]) {
  return tasks.find((t) => !t.marked_na && /medication|medicine|meds/i.test(t.label));
}

function hasMedicationNote(medTask: ShiftTask | undefined, notes: SessionNoteRecord[]) {
  if (!medTask) return true;
  return notes.some(
    (n) =>
      n.task_id === medTask.task_id ||
      /medication|medicine|meds/i.test(n.content ?? ""),
  );
}

export function WorkerMobileReviewScreen({
  participantName,
  healthAlerts = [],
  tasks,
  notes,
  compliance,
  busy,
  onSaveNote,
  onAddMissingNote,
  onSubmit,
  onViewComplianceReport,
  onOpenIncidentReport,
}: Props) {
  const medTask = medicationTask(tasks);
  const medMissing = Boolean(medTask && !hasMedicationNote(medTask, notes));

  const incompleteWithoutNote = tasks.filter(
    (t) =>
      !t.marked_na &&
      !t.completed &&
      !notes.some((n) => n.task_id === t.task_id && n.content?.trim()),
  );
  const otherIncomplete = incompleteWithoutNote.filter(
    (t) => !medTask || t.task_id !== medTask.task_id,
  );
  const missingRowRef = useRef<HTMLDivElement>(null);
  const [addingMed, setAddingMed] = useState(false);
  const [medDraft, setMedDraft] = useState("");
  const [highlightMissing, setHighlightMissing] = useState(false);

  const completedChips = tasks.filter((t) => !t.marked_na && t.completed);
  const doneCount = completedChips.length;
  const totalCount = tasks.filter((t) => !t.marked_na).length;

  const scrollToMissing = () => {
    missingRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightMissing(true);
    setAddingMed(true);
    window.setTimeout(() => setHighlightMissing(false), 1800);
  };

  const taskLabel = (taskId?: string | null) =>
    tasks.find((t) => t.task_id === taskId)?.label ?? undefined;

  const goalTitle = (taskId?: string | null) =>
    tasks.find((t) => t.task_id === taskId)?.goal_title ?? undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkerMobileParticipantStrip participantName={participantName} />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <WorkerMobileRiskStrip alerts={healthAlerts} />

        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-[13px] font-semibold" style={{ color: WM.text }}>
            Completed tasks
          </p>
          <span className="text-[12px] font-medium" style={{ color: WM.muted }}>
            {doneCount} of {totalCount}
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto px-3 pb-2 scrollbar-none">
          {completedChips.map((t) => (
            <span
              key={t.task_id}
              className="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
              style={{
                background: WM.chipGreenBg,
                borderColor: WM.chipGreenBorder,
                color: WM.clockedInText,
              }}
            >
              ✓ {t.label}
            </span>
          ))}
        </div>

        <ComplianceScoreBar
          score={compliance.score}
          label="Note quality"
          onViewReport={onViewComplianceReport}
        />

        {otherIncomplete.length > 0 && (
          <div
            className="mx-3 mb-2 flex items-center gap-2 rounded-xl border px-3 py-2.5"
            style={{ background: WM.warnBg, borderColor: WM.warnBorder }}
          >
            <AlertTriangle size={16} style={{ color: WM.warnText }} />
            <div className="flex-1">
              <p className="text-[13px] font-semibold" style={{ color: WM.warnTitle }}>
                {otherIncomplete.length} task{otherIncomplete.length === 1 ? "" : "s"} not completed
              </p>
              <p className="text-[12px]" style={{ color: WM.warnText }}>
                Add notes or complete remaining tasks before submitting
              </p>
            </div>
          </div>
        )}

        {medMissing && (
          <button
            type="button"
            onClick={scrollToMissing}
            className="mx-3 mb-2 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left"
            style={{ background: WM.warnBg, borderColor: WM.warnBorder }}
          >
            <AlertTriangle size={16} style={{ color: WM.warnText }} />
            <div className="flex-1">
              <p className="text-[13px] font-semibold" style={{ color: WM.warnTitle }}>
                Medication note missing
              </p>
              <p className="text-[12px]" style={{ color: WM.warnText }}>
                Tap to add. Required before submitting
              </p>
            </div>
            <ChevronDown size={16} style={{ color: WM.warnText }} />
          </button>
        )}

        <div className="space-y-3 px-3">
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: WM.muted }}
          >
            Notes this session
          </p>

          {medMissing && medTask && (
            <div
              ref={missingRowRef}
              className="rounded-xl border-l-[3px] p-3"
              style={{
                background: WM.missingBg,
                borderLeftColor: WM.amber,
                outline: highlightMissing ? `2px solid ${WM.amber}` : undefined,
              }}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: WM.warnText }}>
                <AlertTriangle size={12} /> {medTask.label}
                {medTask.goal_title ? ` · ${medTask.goal_title}` : " · Health management"}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed" style={{ color: WM.warnText }}>
                No note recorded for medication. NDIS requires documentation for medication administered.
              </p>
              {!addingMed ? (
                <button
                  type="button"
                  onClick={() => setAddingMed(true)}
                  className="mt-2 h-9 rounded-lg px-3 text-[12px] font-semibold text-white"
                  style={{ background: WM.amber }}
                >
                  + Add note now
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={medDraft}
                    onChange={(e) => setMedDraft(e.target.value)}
                    rows={3}
                    placeholder="Describe medication support provided…"
                    className="w-full resize-none rounded-lg border px-3 py-2 text-[14px] outline-none"
                    style={{ borderColor: WM.warnBorder, background: WM.surface, color: WM.text }}
                  />
                  <button
                    type="button"
                    disabled={!medDraft.trim() || busy}
                    onClick={() => {
                      onAddMissingNote(medTask.task_id, medDraft);
                      setAddingMed(false);
                      setMedDraft("");
                    }}
                    className="h-8 rounded-lg px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                    style={{ background: WM.amber }}
                  >
                    Save note
                  </button>
                </div>
              )}
            </div>
          )}

          {notes.map((note) => {
            const flag = compliance.noteFlags.find((f) => f.noteId === note.note_id);
            return (
              <WorkerMobileNoteBubble
                key={note.note_id}
                note={note}
                taskLabel={taskLabel(note.task_id)}
                goalTitle={goalTitle(note.task_id)}
                flag={flag}
                editable
                onSave={onSaveNote}
                onIncidentReport={onOpenIncidentReport}
              />
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t p-3" style={{ borderColor: WM.border, background: WM.surface }}>
        <button
          type="button"
          disabled={busy || (medMissing && !hasMedicationNote(medTask, notes))}
          onClick={onSubmit}
          className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white disabled:opacity-50"
          style={{ background: WM.pink }}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "→ Submit notes"}
        </button>
      </div>
    </div>
  );
}
