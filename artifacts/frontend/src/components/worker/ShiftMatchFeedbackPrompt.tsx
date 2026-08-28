import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircleHeart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { submitShiftMatchFeedback } from "@/services/workerService";

const BORDER = "var(--cc-border)";
const MUTED = "var(--cc-muted)";
const PLUM = "var(--cc-plum)";

/** Worker-Participant Matching Enhancement, Phase 3 — light-touch, optional
 * reflection prompt on a completed shift. Never mandatory, never blocking:
 * dismissible with no consequence, and doesn't reappear once dismissed or
 * submitted for this session. Independent of the coordinator's own rating -
 * either side can leave feedback first. */
export function ShiftMatchFeedbackPrompt({ shiftId }: { shiftId: string }) {
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState("");

  const submitMutation = useMutation({
    mutationFn: (text: string) => submitShiftMatchFeedback(shiftId, text),
    onSuccess: () => setSubmitted(true),
    onError: (err) => toast({ title: "Could not save your note", description: (err as Error).message, variant: "destructive" }),
  });

  if (dismissed) return null;

  if (submitted) {
    return (
      <div className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
        <p className="text-sm font-bold" style={{ color: PLUM }}>Thanks for the note.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircleHeart size={16} style={{ color: PLUM }} />
          <p className="text-sm font-black" style={{ color: "var(--cc-text)" }}>How did this shift go?</p>
        </div>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: MUTED }}>
        Optional — a quick reflection helps your coordinator suggest better-fitting shifts. Not required.
      </p>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="e.g. We got along well, shared interest in..."
        rows={2}
        className="mt-2 w-full resize-none rounded-xl border p-2.5 text-sm"
        style={{ borderColor: BORDER }}
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!note.trim() || submitMutation.isPending}
          onClick={() => submitMutation.mutate(note.trim())}
          className="rounded-lg text-xs"
          style={{ background: "var(--cc-cta)" }}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}
