import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CORAL, PLUM } from "@/lib/shift-utils";
import type { ShiftTask } from "@/services/shiftService";

type Props = {
  tasks: ShiftTask[];
  onBackToTasks: () => void;
  onEndAnyway: () => void;
  busy?: boolean;
};

export function MandatoryTasksAlert({ tasks, onBackToTasks, onEndAnyway, busy }: Props) {
  const { translate } = useAccessibility();

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-red-200 bg-red-50/60 p-4 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-black text-red-700">
        <AlertTriangle size={18} className="shrink-0" />
        {translate("tasks.mandatoryIncomplete")}
      </p>

      <ul className="mt-3 space-y-2">
        {tasks.map((task) => (
          <li
            key={task.task_id}
            className="flex items-center gap-2.5 text-sm font-bold text-red-800"
          >
            <X size={16} className="shrink-0 text-red-600" strokeWidth={3} />
            <span>{task.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex gap-2">
        <Button
          className="touch-target h-12 flex-1 rounded-2xl border-0 text-sm font-black text-white"
          style={{ background: PLUM }}
          disabled={busy}
          onClick={onBackToTasks}
        >
          {translate("tasks.backToTasks")}
        </Button>
        <Button
          variant="outline"
          className="touch-target h-12 shrink-0 rounded-2xl border-2 px-4 text-sm font-black"
          style={{ borderColor: CORAL, color: CORAL }}
          disabled={busy}
          onClick={onEndAnyway}
        >
          {translate("validation.endAnyway")}
        </Button>
      </div>
    </section>
  );
}
