import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CORAL, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  evidenceScore: number;
  onBackToTasks: () => void;
  onEndAnyway: () => void;
  busy?: boolean;
};

export function MandatoryTasksAlert({ evidenceScore, onBackToTasks, onEndAnyway, busy }: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-red-200 bg-red-50/50 p-4 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-black text-red-700">
        <AlertTriangle size={18} className="shrink-0" />
        Mandatory Tasks Incomplete
      </p>

      <div className="mt-3 rounded-xl border border-red-200 bg-red-100/80 px-3 py-2.5">
        <p className="flex items-center gap-2 text-sm font-bold text-red-800">
          <span className="text-base">⚠️</span>
          Low Evidence Score ({evidenceScore}%)
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          className="h-12 flex-1 rounded-2xl border-0 text-sm font-black text-white"
          style={{ background: PLUM }}
          disabled={busy}
          onClick={onBackToTasks}
        >
          Back to Tasks
        </Button>
        <Button
          variant="outline"
          className="h-12 shrink-0 rounded-2xl border-2 px-4 text-sm font-black"
          style={{ borderColor: CORAL, color: CORAL }}
          disabled={busy}
          onClick={onEndAnyway}
        >
          End Anyway
        </Button>
      </div>

      <p className="mt-2 text-center text-[11px] font-semibold" style={{ color: TEXT }}>
        Complete mandatory tasks for a stronger compliance record.
      </p>
    </section>
  );
}
