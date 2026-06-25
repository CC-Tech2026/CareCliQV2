import { CheckCircle2, FileText, PenLine } from "lucide-react";
import type { ShiftCompletionSummary as Summary, WorkerShift } from "@/services/shiftService";
import type { ShiftSignature } from "@/services/complianceService";
import { BORDER, MUTED, TEXT, formatElapsedTimer } from "@/lib/shift-utils";

type Props = {
  shift: WorkerShift;
  summary?: Summary;
};

export function ShiftCompletionSummary({ shift, summary }: Props) {
  const elapsed =
    shift.clocked_in_at && shift.clocked_out_at
      ? formatElapsedTimer(shift.clocked_in_at, new Date(shift.clocked_out_at).getTime())
      : null;

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-slate-300 bg-slate-50 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-slate-700">
        <CheckCircle2 size={22} className="text-slate-500" />
        <h2 className="text-lg font-black">Shift completed</h2>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {elapsed && (
          <div className="rounded-xl bg-white p-3">
            <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              Time on site
            </dt>
            <dd className="mt-1 font-mono text-sm font-black" style={{ color: TEXT }}>
              {elapsed}
            </dd>
          </div>
        )}
        {summary && (
          <>
            <div className="rounded-xl bg-white p-3">
              <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Tasks completed
              </dt>
              <dd className="mt-1 text-sm font-black" style={{ color: TEXT }}>
                {summary.tasks_completed}/{summary.tasks_total}
                {summary.mandatory_total > 0 && (
                  <span className="ml-1 text-xs font-bold text-emerald-600">
                    ({summary.mandatory_completed}/{summary.mandatory_total} mandatory)
                  </span>
                )}
              </dd>
            </div>
            <div className="rounded-xl bg-white p-3">
              <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Progress notes
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm font-bold" style={{ color: TEXT }}>
                <FileText size={14} />
                {summary.notes_submitted ? "Submitted" : "Not submitted"}
              </dd>
            </div>
          </>
        )}
        {shift.risks_acknowledged_at && (
          <div className="rounded-xl bg-white p-3 sm:col-span-2">
            <dt className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              Safety acknowledgement
            </dt>
            <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>
              {new Date(shift.risks_acknowledged_at).toLocaleString()}
              {shift.risks_acknowledged_by_name ? ` · ${shift.risks_acknowledged_by_name}` : ""}
            </dd>
          </div>
        )}
        {(shift.shift_signature as ShiftSignature | undefined) && (
          <div className="rounded-xl bg-white p-3 sm:col-span-2">
            <dt className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
              <PenLine size={12} /> Digital signature
            </dt>
            <dd>
              {(shift.shift_signature as ShiftSignature).signature_png_url && (
                <img
                  src={(shift.shift_signature as ShiftSignature).signature_png_url}
                  alt="Shift signature"
                  className="mb-2 max-h-16 rounded border border-slate-200 bg-white p-1"
                />
              )}
              <p className="text-sm font-bold" style={{ color: TEXT }}>
                Signed by {(shift.shift_signature as ShiftSignature).signer_name ?? "worker"} on{" "}
                {new Date((shift.shift_signature as ShiftSignature).signed_at).toLocaleString()}
              </p>
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-4 text-xs font-semibold" style={{ color: MUTED }}>
        This shift is read-only. Contact your coordinator if you need to amend documentation.
      </p>
    </section>
  );
}
