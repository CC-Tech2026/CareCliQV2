import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { CoordinatorShiftRecord, ConflictItem } from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

/** Shared by every "assign a worker to a shift" entry point (RosterBoard's
 * drag-drop, UnassignedShiftPanel's direct-assign) so a real conflict or
 * missing-skill warning is confirmed the same way everywhere, not
 * differently depending on how the coordinator got there. */
export interface PendingDrop {
  shift: CoordinatorShiftRecord;
  workerId: string;
  workerName: string;
  conflicts: ConflictItem[];
  skillWarnings: ConflictItem[];
}

export function ConflictModal({
  pending, onConfirm, onCancel, confirming,
}: { pending: PendingDrop; onConfirm: () => void; onCancel: () => void; confirming: boolean }) {
  const { translate, translateParams } = useAccessibility();
  const hard = pending.conflicts.filter((c) => c.severity === "error");
  const soft = [...pending.conflicts.filter((c) => c.severity !== "error"), ...pending.skillWarnings];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white shadow-2xl" style={{ borderColor: BORDER }}>
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle size={18} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-[16px] font-black" style={{ color: TEXT }}>
                {hard.length > 0 ? translate("coordinator.dnd.schedulingConflict") : translate("coordinator.dnd.assignmentWarning")}
              </h2>
              <p className="text-[12px]" style={{ color: MUTED }}>{translateParams("coordinator.dnd.assignTo", { name: pending.workerName })}</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 space-y-3 max-h-64 overflow-y-auto">
          {hard.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-[12px] font-medium text-red-800">{c.message}</p>
            </div>
          ))}
          {soft.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[12px] font-medium text-amber-800">{c.message}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          <button onClick={onCancel} className="rounded-full px-4 py-2 text-[12px] font-bold" style={{ background: SOFT, color: MUTED }}>
            {translate("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold text-white"
            style={{ background: hard.length > 0 ? CORAL : PLUM, opacity: confirming ? 0.65 : 1 }}
          >
            {confirming ? (<><Loader2 size={12} className="animate-spin" /> {translate("coordinator.dnd.assigning")}</>) : (<><ChevronRight size={12} /> {translate("coordinator.dnd.assignAnyway")}</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
