import { useEffect, useState } from "react";
import { CheckCircle2, Hourglass, PenLine } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  ChoiceCard,
  Field,
  PanelFooter,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  textareaClass,
} from "@/pages/md/vault/components/PanelKit";

export type ResponseStatus = "open" | "in_review" | "resolved";

export interface ResponseTarget {
  id: string;
  title: string;
  /** Who it's about or who raised it, and when. */
  context: string;
  description: string;
  status: ResponseStatus;
  notes?: string | null;
}

/**
 * Side panel for addressing a complaint or an operational report: move it
 * to In review, or resolve it with a note on what was done. Same panel
 * pieces as the vault's upload and share panels.
 */
export function ResponseSheet({
  target,
  onClose,
  onSave,
  busy,
  noun,
  notesLabel,
  notesPlaceholder,
}: {
  target: ResponseTarget | null;
  onClose: () => void;
  onSave: (status: Exclude<ResponseStatus, "open">, notes: string) => void;
  busy?: boolean;
  /** "complaint" or "report", used in the copy. */
  noun: string;
  notesLabel: string;
  notesPlaceholder: string;
}) {
  const [status, setStatus] = useState<Exclude<ResponseStatus, "open">>("in_review");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!target) return;
    setStatus(target.status === "resolved" ? "resolved" : "in_review");
    setNotes(target.notes ?? "");
  }, [target]);

  // A note is only needed once it's being resolved; In review is just a flag.
  const canSave = status === "in_review" || notes.trim().length > 0;

  return (
    <Sheet open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetTitle className="sr-only">Address {noun}</SheetTitle>
        <SheetDescription className="sr-only">Update the status of this {noun}.</SheetDescription>
        {target && (
          <>
            <PanelHeader icon={PenLine} title={target.title} description={target.context} />
            <form
              id="response-sheet-form"
              className="mt-6 flex-1 space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSave) onSave(status, notes.trim());
              }}
            >
              <p className="rounded-2xl bg-cc-soft px-4 py-3 text-sm leading-6 text-cc-text">{target.description}</p>
              <div className="space-y-2" role="radiogroup" aria-label="Mark as">
                <p className="text-sm font-medium text-cc-text">Mark as</p>
                <ChoiceCard
                  selected={status === "in_review"}
                  onSelect={() => setStatus("in_review")}
                  icon={Hourglass}
                  title="In review"
                  description={`You're looking into this ${noun}.`}
                />
                <ChoiceCard
                  selected={status === "resolved"}
                  onSelect={() => setStatus("resolved")}
                  icon={CheckCircle2}
                  title="Resolved"
                  description="Record what was done so the outcome is on file."
                />
              </div>
              {status === "resolved" && (
                <Field label={notesLabel} htmlFor="response-notes" hint="Kept with the record and shown to anyone reviewing it.">
                  <textarea
                    id="response-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={notesPlaceholder}
                    rows={5}
                    className={textareaClass}
                    style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
                  />
                </Field>
              )}
            </form>
            <PanelFooter>
              <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" form="response-sheet-form" busy={busy} disabled={!canSave}>
                Save
              </PrimaryButton>
            </PanelFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
