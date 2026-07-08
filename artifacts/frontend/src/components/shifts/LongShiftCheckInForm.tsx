import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShiftTask } from "@/services/shiftService";
import {
  MOOD_OPTIONS,
  type LongShiftCheckInFormData,
  type ParticipantMood,
} from "@workspace/worker-compliance";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: LongShiftCheckInFormData) => void;
  busy?: boolean;
  tasks?: ShiftTask[];
};

export function LongShiftCheckInForm({ open, onClose, onSubmit, busy, tasks = [] }: Props) {
  const [mood, setMood] = useState<ParticipantMood | null>(null);
  const [hasIncident, setHasIncident] = useState<boolean | null>(null);

  const taskRows = useMemo(
    () => tasks.filter((t) => !t.marked_na).map((t) => ({ id: t.task_id, label: t.label, done: Boolean(t.completed) })),
    [tasks],
  );

  const canSubmit = mood !== null && hasIncident !== null && !busy;

  const handleClose = () => {
    if (busy) return;
    setMood(null);
    setHasIncident(null);
    onClose();
  };

  const handleSubmit = () => {
    if (!canSubmit || mood === null || hasIncident === null) return;
    onSubmit({ mood, hasIncident });
    setMood(null);
    setHasIncident(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl p-0">
        <div className="sticky top-0 z-10 border-b bg-cc-surface px-5 pb-3 pt-5" style={{ borderColor: BORDER }}>
          <DialogHeader className="space-y-1 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-lg font-black">Check-in form</DialogTitle>
                <DialogDescription className="text-xs">
                  Required for shifts longer than 90 minutes
                </DialogDescription>
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:bg-cc-soft"
                onClick={handleClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-5 py-4">
          {taskRows.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: MUTED }}>
                Task progress
              </p>
              <ul className="space-y-2">
                {taskRows.map((task) => (
                  <li key={task.id} className="flex items-center gap-2 text-sm">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PLUM }} />
                    <span className="flex-1 font-medium" style={{ color: "var(--cc-text)" }}>
                      {task.label}
                    </span>
                    {task.done && (
                      <span className="text-xs font-bold" style={{ color: PLUM }}>
                        Done
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className="text-sm font-black" style={{ color: "var(--cc-text)" }}>
              Question 1 of 2
            </p>
            <p className="mb-3 text-xs" style={{ color: MUTED }}>
              What is the current mood of the participant?
            </p>
            <div className="grid grid-cols-3 gap-2">
              {MOOD_OPTIONS.map((opt) => {
                const selected = mood === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setMood(opt.id)}
                    className="flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition"
                    style={{
                      borderColor: selected ? PLUM : BORDER,
                      background: selected ? "var(--cc-active-bg, #ECEEFF)" : "var(--cc-surface)",
                    }}
                  >
                    <span className="text-2xl">{opt.emoji}</span>
                    <span className="text-[11px] font-semibold" style={{ color: "var(--cc-text)" }}>
                      {opt.label}
                    </span>
                    {selected && <Check size={14} style={{ color: PLUM }} />}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="text-sm font-black" style={{ color: "var(--cc-text)" }}>
              Question 2 of 2
            </p>
            <p className="mb-3 text-xs" style={{ color: MUTED }}>
              Any incidents to report on the participant?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setHasIncident(false)}
                className="flex items-center justify-center gap-2 rounded-xl border px-3 py-4 text-sm font-semibold transition"
                style={{
                  borderColor: hasIncident === false ? PLUM : BORDER,
                  background: hasIncident === false ? "var(--cc-active-bg, #ECEEFF)" : "var(--cc-surface)",
                }}
              >
                <Check size={16} style={{ color: PLUM }} />
                No incidents
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setHasIncident(true)}
                className="flex items-center justify-center gap-2 rounded-xl border px-3 py-4 text-sm font-semibold transition"
                style={{
                  borderColor: hasIncident === true ? "#EF4444" : BORDER,
                  background: hasIncident === true ? "#FEF2F2" : "var(--cc-surface)",
                }}
              >
                <span>🚨</span>
                Yes — report
              </button>
            </div>
          </section>

          <p
            className="rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed"
            style={{ borderColor: BORDER, color: MUTED, background: "var(--cc-soft)" }}
          >
            Check-ins are logged in the session record for NDIS audit purposes.
          </p>

          <Button
            type="button"
            className="h-12 w-full rounded-xl text-sm font-black"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Submit check-in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
