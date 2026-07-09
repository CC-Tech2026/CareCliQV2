import { useState } from "react";
import { CheckCircle2, FileText, PenLine, Share2 } from "lucide-react";
import type { ShiftCompletionSummary as Summary, WorkerShift } from "@/services/shiftService";
import type { ShiftSignature } from "@/services/complianceService";
import { Button } from "@/components/ui/button";
import { ShiftShareSheet } from "@/components/shifts/ShiftShareSheet";
import { BORDER, MUTED, PLUM, TEXT, formatElapsedTimer } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  shift: WorkerShift;
  summary?: Summary;
};

export function ShiftCompletionSummary({ shift, summary }: Props) {
  const { translate, translateParams } = useAccessibility();
  const [shareOpen, setShareOpen] = useState(false);
  const elapsed =
    shift.clocked_in_at && shift.clocked_out_at
      ? formatElapsedTimer(shift.clocked_in_at, new Date(shift.clocked_out_at).getTime())
      : null;

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-slate-300 bg-slate-50 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-slate-700">
        <CheckCircle2 size={22} className="text-slate-500" />
        <h2 className="text-lg font-black">{translate("shift.completion.title")}</h2>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {elapsed && (
          <div className="rounded-xl bg-card p-3">
            <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              {translate("shift.completion.timeOnSite")}
            </dt>
            <dd className="mt-1 font-mono text-sm font-black" style={{ color: TEXT }}>
              {elapsed}
            </dd>
          </div>
        )}
        {summary && (
          <>
            <div className="rounded-xl bg-card p-3">
              <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                {translate("shift.completion.tasksCompleted")}
              </dt>
              <dd className="mt-1 text-sm font-black" style={{ color: TEXT }}>
                {summary.tasks_completed}/{summary.tasks_total}
                {summary.mandatory_total > 0 && (
                  <span className="ml-1 text-xs font-bold text-emerald-600">
                    {translateParams("shift.completion.mandatoryCount", {
                      completed: String(summary.mandatory_completed),
                      total: String(summary.mandatory_total),
                    })}
                  </span>
                )}
              </dd>
            </div>
            <div className="rounded-xl bg-card p-3">
              <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                {translate("shift.completion.progressNotes")}
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm font-bold" style={{ color: TEXT }}>
                <FileText size={14} />
                {summary.notes_submitted
                  ? translate("shift.completion.submitted")
                  : translate("shift.completion.notSubmitted")}
              </dd>
            </div>
          </>
        )}
        {shift.risks_acknowledged_at && (
          <div className="rounded-xl bg-card p-3 sm:col-span-2">
            <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              {translate("shift.completion.safetyAck")}
            </dt>
            <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>
              {new Date(shift.risks_acknowledged_at).toLocaleString()}
              {shift.risks_acknowledged_by_name ? ` · ${shift.risks_acknowledged_by_name}` : ""}
            </dd>
          </div>
        )}
        {(shift.shift_signature as ShiftSignature | undefined) && (
          <div className="rounded-xl bg-card p-3 sm:col-span-2">
            <dt className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              <PenLine size={12} /> {translate("shift.completion.digitalSignature")}
            </dt>
            <dd>
              {(shift.shift_signature as ShiftSignature).signature_png_url && (
                <img
                  src={(shift.shift_signature as ShiftSignature).signature_png_url}
                  alt={translate("shift.completion.signatureAlt")}
                  className="mb-2 max-h-16 rounded border border-slate-200 bg-card p-1"
                />
              )}
              <p className="text-sm font-bold" style={{ color: TEXT }}>
                {translateParams("shift.completion.signedBy", {
                  name: (shift.shift_signature as ShiftSignature).signer_name ?? translate("shift.completion.workerFallback"),
                  date: new Date((shift.shift_signature as ShiftSignature).signed_at).toLocaleString(),
                })}
              </p>
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-4 text-xs font-semibold" style={{ color: MUTED }}>
        {translate("shift.completion.readOnly")}
      </p>

      <Button
        type="button"
        className="mt-4 min-h-[44px] w-full gap-2 font-black text-white sm:w-auto"
        style={{ background: PLUM }}
        onClick={() => setShareOpen(true)}
      >
        <Share2 size={16} />
        {translate("shift.completion.downloadShare")}
      </Button>

      <ShiftShareSheet shiftId={shift.id} open={shareOpen} onOpenChange={setShareOpen} />
    </section>
  );
}
