import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DeactivationReason } from "@/services/coordinatorService";

const REASON_OPTIONS: { value: DeactivationReason; label: string; hint: string }[] = [
  {
    value: "credentials",
    label: "Credentials incomplete",
    hint: "The worker keeps access to their Credentials page to fix this. Everything else is locked.",
  },
  {
    value: "training",
    label: "Training incomplete",
    hint: "The worker keeps access to their Training page to fix this. Everything else is locked.",
  },
  {
    value: "credentials_training",
    label: "Credentials and training incomplete",
    hint: "The worker keeps access to both pages to fix this. Everything else is locked.",
  },
  {
    value: "manual",
    label: "Other reason (performance, conduct, etc.)",
    hint: "The worker sees a locked account screen with no self-service page - only an admin can reactivate.",
  },
];

interface DeactivateWorkerPanelProps {
  workerName: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: DeactivationReason, note: string) => void;
}

/** Shared reason-picker used by both team.tsx (coordinator) and md/staff.tsx
 * (MD) - deactivation always needs a reason now, since the worker's own
 * locked-down portal experience depends on it (see ProtectedRoute.tsx and
 * account-deactivated.tsx). A plain confirm without a reason isn't enough
 * information for the worker to know what's going on or how to fix it. */
export function DeactivateWorkerPanel({ workerName, pending, onCancel, onConfirm }: DeactivateWorkerPanelProps) {
  const [reason, setReason] = useState<DeactivationReason | "">("");
  const [note, setNote] = useState("");
  const requiresNote = reason === "manual";
  const canConfirm = reason !== "" && (!requiresNote || note.trim().length > 0);
  const selected = REASON_OPTIONS.find((o) => o.value === reason);

  return (
    <section
      className="space-y-3 rounded-2xl border p-5"
      style={{ borderColor: "var(--cc-status-danger)", background: "var(--cc-status-danger-bg)" }}
    >
      <h3 className="text-base font-black" style={{ color: "var(--cc-status-danger)" }}>
        Deactivate {workerName}?
      </h3>
      <p className="text-sm" style={{ color: "var(--cc-status-danger)" }}>
        They'll keep the ability to log in, but their portal will be locked down. Choose why, so they see the
        right explanation and, if it's fixable, the right page to resolve it.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--cc-status-danger)" }}>
          Reason
        </label>
        <Select value={reason} onValueChange={(v) => setReason(v as DeactivationReason)}>
          <SelectTrigger className="bg-white"><SelectValue placeholder="Choose a reason..." /></SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <p className="text-xs" style={{ color: "var(--cc-status-danger)" }}>{selected.hint}</p>
        )}
      </div>

      {requiresNote && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--cc-status-danger)" }}>
            Note for the worker (required)
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explain why, so the worker knows what's going on..."
            className="bg-white"
            rows={3}
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          className="bg-red-600 text-white hover:bg-red-700"
          onClick={() => reason && onConfirm(reason, note.trim())}
          disabled={!canConfirm || pending}
        >
          {pending ? "Deactivating..." : "Yes, deactivate"}
        </Button>
      </div>
    </section>
  );
}
