import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { cn } from "@/lib/utils";
import {
  computeShiftValidation,
  NA_REASONS,
  taskFlagsOnly,
  type NaReason,
  type ShiftValidationResult,
} from "@/lib/shift-validation";
import type { ShiftTask } from "@/services/shiftService";
import { CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import { useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: ShiftTask[];
  busy?: boolean;
  tutorialDemo?: boolean;
  onCancel: () => void;
  onAddEvidence: (taskId: string) => void;
  onMarkNa: (taskId: string, reason: NaReason) => void;
  onEndAnyway: () => void;
  onEndShift: () => void;
};

function pct(count: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function StatRow({
  label,
  count,
  total,
  tone,
  countLabel,
}: {
  label: string;
  count: number;
  total: number;
  tone?: "warn" | "muted" | "ok";
  countLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl border px-3 py-2 text-sm",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "ok" && "border-emerald-200 bg-emerald-50",
        !tone && "border-cc-border bg-cc-surface",
      )}
    >
      <span className="font-semibold" style={{ color: TEXT }}>
        {label}
      </span>
      <span className="font-black" style={{ color: tone === "warn" ? "#B45309" : TEXT }}>
        {countLabel}
      </span>
    </div>
  );
}

export function EndShiftValidationModal({
  open,
  onOpenChange,
  tasks,
  busy,
  tutorialDemo,
  onCancel,
  onAddEvidence,
  onMarkNa,
  onEndAnyway,
  onEndShift,
}: Props) {
  const { translate, translateParams } = useAccessibility();
  const validation: ShiftValidationResult = computeShiftValidation(tasks);
  const taskFlags = taskFlagsOnly(validation);
  const hasWarnings = taskFlags.length > 0 || validation.low_compliance;
  const [naTaskId, setNaTaskId] = useState<string | null>(null);
  const [naReason, setNaReason] = useState<NaReason>("not_needed");

  const complianceLabel =
    validation.compliance_score >= 80
      ? translate("validation.high")
      : validation.compliance_score >= 50
        ? translate("validation.medium")
        : translate("validation.low");

  const complianceClassName =
    validation.compliance_score >= 80
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : validation.compliance_score >= 50
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-red-100 text-red-800 border-red-200";

  const statCount = (count: number, total: number) =>
    translateParams("validation.statCount", {
      count: String(count),
      total: String(total),
      pct: pct(count, total),
    });

  const firstEvidenceTask = taskFlags.find((f) => f.flag_type === "no_evidence")?.task_id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md gap-4 overflow-y-auto" data-tutorial="end-shift-review">
        <DialogHeader>
          <DialogTitle>{translate("validation.title")}</DialogTitle>
          <DialogDescription>
            {tutorialDemo ? translate("validation.tutorialDesc") : translate("validation.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <StatRow
            label={translate("validation.completed")}
            count={validation.tasks_completed}
            total={validation.tasks_total}
            tone="ok"
            countLabel={statCount(validation.tasks_completed, validation.tasks_total)}
          />
          <StatRow
            label={translate("validation.withEvidence")}
            count={validation.tasks_with_evidence}
            total={validation.tasks_total}
            tone="ok"
            countLabel={statCount(validation.tasks_with_evidence, validation.tasks_total)}
          />
          <StatRow
            label={translate("validation.withoutEvidence")}
            count={validation.tasks_without_evidence}
            total={validation.tasks_total}
            tone={validation.tasks_without_evidence > 0 ? "warn" : undefined}
            countLabel={statCount(validation.tasks_without_evidence, validation.tasks_total)}
          />
          <StatRow
            label={translate("validation.notCompleted")}
            count={validation.tasks_not_completed}
            total={validation.tasks_total}
            tone={validation.tasks_not_completed > 0 ? "warn" : undefined}
            countLabel={statCount(validation.tasks_not_completed, validation.tasks_total)}
          />
        </div>

        <div className={cn("flex items-center justify-between rounded-xl border px-3 py-2.5", complianceClassName)}>
          <span className="text-sm font-bold">{translate("validation.complianceScore")}</span>
          <span className="text-lg font-black">
            {validation.compliance_score}% · {complianceLabel}
          </span>
        </div>

        {!hasWarnings && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={18} />
            {translate("validation.allGood")}
          </div>
        )}

        {hasWarnings && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-black text-amber-800">
              <AlertTriangle size={16} />
              {taskFlags.length > 0
                ? translateParams("validation.flaggedTasks", { count: String(taskFlags.length) })
                : translate("validation.lowCompliance")}
            </p>
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {taskFlags.map((flag) => (
                <li
                  key={`${flag.task_id}-${flag.flag_type}`}
                  className={cn(
                    "rounded-xl border px-3 py-2.5",
                    flag.flag_type === "incomplete"
                      ? "border-slate-200 bg-slate-50 opacity-90"
                      : "border-amber-200 bg-amber-50",
                  )}
                >
                  <p className="text-sm font-bold" style={{ color: TEXT }}>
                    {flag.label}
                  </p>
                  <p className="text-xs font-semibold capitalize" style={{ color: MUTED }}>
                    {flag.flag_type === "incomplete"
                      ? translate("validation.notCompletedFlag")
                      : translate("validation.noEvidenceFlag")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {flag.flag_type === "no_evidence" && flag.task_id && (
                      <Button
                        type="button"
                        size="sm"
                        className="touch-target h-8 rounded-lg text-xs font-bold text-white"
                        style={{ background: PLUM }}
                        onClick={() => onAddEvidence(flag.task_id!)}
                      >
                        + {translate("validation.addEvidenceNow")}
                      </Button>
                    )}
                    {flag.flag_type === "incomplete" && flag.task_id && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="touch-target h-8 rounded-lg text-xs font-bold"
                        onClick={() => setNaTaskId(flag.task_id!)}
                      >
                        {translate("validation.markNa")}
                      </Button>
                    )}
                  </div>
                  {naTaskId === flag.task_id && (
                    <div className="mt-2 flex gap-2">
                      <Select value={naReason} onValueChange={(v) => setNaReason(v as NaReason)}>
                        <SelectTrigger className="h-8 flex-1 bg-cc-surface text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NA_REASONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        className="touch-target h-8 rounded-lg text-xs font-bold"
                        onClick={() => {
                          onMarkNa(flag.task_id!, naReason);
                          setNaTaskId(null);
                        }}
                      >
                        {translate("validation.confirm")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {firstEvidenceTask && (
            <Button
              type="button"
              className="touch-target h-11 w-full rounded-xl font-bold text-white"
              style={{ background: PLUM }}
              disabled={busy}
              onClick={() => onAddEvidence(firstEvidenceTask)}
            >
              {translate("validation.addEvidence")}
            </Button>
          )}
          {hasWarnings ? (
            <Button
              type="button"
              variant="outline"
              className="touch-target h-11 w-full rounded-xl border-2 font-bold"
              style={{ borderColor: CORAL, color: CORAL }}
              disabled={busy}
              onClick={onEndAnyway}
            >
              {translate("validation.endAnyway")}
            </Button>
          ) : (
            <Button
              type="button"
              className="touch-target h-11 w-full rounded-xl font-bold text-white"
              style={{ background: CORAL }}
              disabled={busy}
              onClick={onEndShift}
            >
              {translate("validation.endShift")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="touch-target h-10 w-full rounded-xl text-sm font-bold"
            style={{ color: MUTED, background: SOFT }}
            disabled={busy}
            onClick={onCancel}
          >
            {translate("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
