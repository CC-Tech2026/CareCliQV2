import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { unlockPageInteraction } from "@/lib/unlock-page-interaction";
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
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { listSessionNotes } from "@/services/sessionNotesService";
import { evaluateWorkerCompliance } from "@/lib/worker-compliance-engine";
import { loadFiledNoteIds } from "@/lib/session-incident-reports";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: ShiftTask[];
  sessionId?: string | null;
  participantFirstName?: string;
  busy?: boolean;
  tutorialDemo?: boolean;
  onCancel: () => void;
  onAddEvidence: (taskId: string) => void;
  onMarkNa: (taskId: string, reason: NaReason) => void;
  onEndAnyway: () => void;
  onEndShift: () => void;
};

const NA_FIELD_SELECT =
  "flex h-8 min-w-0 flex-1 rounded-md border border-cc-border bg-card px-2 text-xs text-cc-text shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

const NA_REASON_KEYS: Record<NaReason, string> = {
  not_needed: "validation.naReason.notNeeded",
  refused: "validation.naReason.refused",
  medical: "validation.naReason.medical",
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
  translateParams,
}: {
  label: string;
  count: number;
  total: number;
  tone?: "warn" | "muted" | "ok";
  translateParams: (key: string, params: Record<string, string>) => string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl border px-3 py-2 text-sm",
        tone === "warn" && "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
        tone === "ok" && "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
        !tone && "border-cc-border bg-card",
      )}
    >
      <span className="font-semibold" style={{ color: TEXT }}>
        {label}
      </span>
      <span className="font-black" style={{ color: tone === "warn" ? "#B45309" : TEXT }}>
        {translateParams("validation.statCount", {
          count: String(count),
          total: String(total),
          pct: pct(count, total),
        })}
      </span>
    </div>
  );
}

function complianceBadge(score: number, translate: (key: string) => string) {
  if (score >= 80) return { label: translate("validation.high"), className: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30" };
  if (score >= 50) return { label: translate("validation.medium"), className: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30" };
  return { label: translate("validation.low"), className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30" };
}

type BodyProps = Omit<Props, "open" | "onOpenChange">;

function EndShiftValidationBody({
  tasks,
  sessionId,
  participantFirstName,
  busy,
  tutorialDemo,
  onCancel,
  onAddEvidence,
  onMarkNa,
  onEndAnyway,
  onEndShift,
}: BodyProps) {
  const { translate, translateParams } = useAccessibility();
  const validation: ShiftValidationResult = computeShiftValidation(tasks ?? []);
  const taskFlags = taskFlagsOnly(validation);
  const [naTaskId, setNaTaskId] = useState<string | null>(null);
  const [naReason, setNaReason] = useState<NaReason>("not_needed");
  const [sessionNotes, setSessionNotes] = useState<Array<{ note_id: string; content: string; task_id?: string | null }>>([]);

  const complianceTasks = useMemo(
    () =>
      (tasks ?? []).map((t) => ({
        task_id: t.task_id,
        label: t.label ?? "",
        completed: t.completed,
        marked_na: t.marked_na,
        goal_title: t.goal_title,
      })),
    [tasks],
  );

  const filedNoteIds = useMemo(
    () => (sessionId ? loadFiledNoteIds(sessionId) : new Set<string>()),
    [sessionId, sessionNotes],
  );

  useEffect(() => {
    if (!sessionId || tutorialDemo) {
      setSessionNotes([]);
      return;
    }
    let cancelled = false;
    void listSessionNotes(sessionId)
      .then((rows) => {
        if (cancelled) return;
        setSessionNotes(
          (rows ?? []).map((n) => ({
            note_id: n.note_id,
            content: n.content ?? "",
            task_id: n.task_id,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setSessionNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, tutorialDemo]);

  const compliance = useMemo(
    () =>
      evaluateWorkerCompliance({
        notes: sessionNotes,
        tasks: complianceTasks,
        participantFirstName,
        incidentReportFiledNoteIds: filedNoteIds,
        includeSubmitWarnings: true,
      }),
    [sessionNotes, complianceTasks, participantFirstName, filedNoteIds],
  );

  const noteComplianceScore = compliance.score;
  const badge = complianceBadge(noteComplianceScore, translate);
  const hasFailRules = compliance.rules.some((r) => r.status === "fail");
  const hasWarnings = taskFlags.length > 0 || noteComplianceScore < 50 || hasFailRules;
  const firstEvidenceTask = taskFlags.find((f) => f.flag_type === "no_evidence")?.task_id;
  const firstFlaggedTask = taskFlags[0]?.task_id;

  useEffect(() => {
    if (!firstFlaggedTask) return;
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `[data-validation-task-id="${firstFlaggedTask}"]`,
      );
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      row?.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
    });
  }, [firstFlaggedTask, sessionNotes.length]);

  return (
    <>
      <div className="space-y-1.5 text-center sm:text-left">
        <h2 id="end-shift-validation-title" className="text-lg font-semibold leading-none tracking-tight">
          {translate("validation.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {tutorialDemo ? translate("validation.tutorialDesc") : translate("validation.desc")}
        </p>
      </div>

      <div className="space-y-2">
        <StatRow
          label={translate("validation.completed")}
          count={validation.tasks_completed}
          total={validation.tasks_total}
          tone="ok"
          translateParams={translateParams}
        />
        <StatRow
          label={translate("validation.withEvidence")}
          count={validation.tasks_with_evidence}
          total={validation.tasks_total}
          tone="ok"
          translateParams={translateParams}
        />
        <StatRow
          label={translate("validation.withoutEvidence")}
          count={validation.tasks_without_evidence}
          total={validation.tasks_total}
          tone={validation.tasks_without_evidence > 0 ? "warn" : undefined}
          translateParams={translateParams}
        />
        <StatRow
          label={translate("validation.notCompleted")}
          count={validation.tasks_not_completed}
          total={validation.tasks_total}
          tone={validation.tasks_not_completed > 0 ? "warn" : undefined}
          translateParams={translateParams}
        />
      </div>

      <div
        className={cn("flex items-center justify-between rounded-xl border px-3 py-2.5", badge.className)}
      >
        <span className="text-sm font-bold">{translate("validation.complianceScore")}</span>
        <span className="text-lg font-black">
          {noteComplianceScore}% · {badge.label}
        </span>
      </div>

      {!hasWarnings && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 size={18} />
          {translate("validation.allGood")}
        </div>
      )}

      {hasWarnings && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-black text-amber-800 dark:text-amber-300">
            <AlertTriangle size={16} />
            {taskFlags.length > 0
              ? translateParams("validation.flaggedTasks", { count: String(taskFlags.length) })
              : translate("validation.lowCompliance")}
          </p>
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {taskFlags.map((flag) => (
              <li
                key={`${flag.task_id}-${flag.flag_type}`}
                data-validation-task-id={flag.task_id ?? undefined}
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  flag.flag_type === "incomplete"
                    ? "border-slate-200 bg-slate-50 opacity-90 dark:border-cc-border dark:bg-cc-soft"
                    : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
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
                      className="h-8 rounded-lg text-xs font-bold text-white"
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
                      className="h-8 rounded-lg text-xs font-bold"
                      onClick={() => setNaTaskId(flag.task_id!)}
                    >
                      {translate("validation.markNa")}
                    </Button>
                  )}
                </div>
                {naTaskId === flag.task_id && (
                  <div className="mt-2 flex gap-2">
                    <select
                      value={naReason}
                      onChange={(e) => setNaReason(e.target.value as NaReason)}
                      className={NA_FIELD_SELECT}
                      aria-label={translate("validation.markNa")}
                    >
                      {NA_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {translate(NA_REASON_KEYS[r.value])}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-lg text-xs font-bold"
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

      <div className="flex flex-col gap-2">
        {firstEvidenceTask && (
          <Button
            type="button"
            className="h-11 w-full rounded-xl font-bold text-white"
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
            className="h-11 w-full rounded-xl border-2 font-bold"
            style={{ borderColor: CORAL, color: CORAL }}
            disabled={busy}
            onClick={onEndAnyway}
          >
            {translate("validation.endAnyway")}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-11 w-full rounded-xl font-bold text-white"
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
          className="h-10 w-full rounded-xl text-sm font-bold"
          style={{ color: MUTED, background: SOFT }}
          disabled={busy}
          onClick={onCancel}
        >
          {translate("common.cancel")}
        </Button>
      </div>
    </>
  );
}

export function EndShiftValidationModal({
  open,
  onOpenChange,
  tutorialDemo,
  ...bodyProps
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !tutorialDemo) onOpenChange(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
      unlockPageInteraction();
    };
  }, [open, onOpenChange, tutorialDemo]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-shift-validation-title"
      data-tutorial="end-shift-review"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/80"
        aria-label="Close"
        onClick={() => {
          if (!tutorialDemo) onOpenChange(false);
        }}
      />
      <div className="relative z-10 grid max-h-[90vh] w-full max-w-md gap-4 overflow-y-auto rounded-lg border border-cc-border bg-card p-6 text-cc-text shadow-lg">
        {!tutorialDemo && (
          <button
            type="button"
            className="absolute right-4 top-4 rounded-sm opacity-70 transition hover:opacity-100"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <EndShiftValidationBody tutorialDemo={tutorialDemo} {...bodyProps} />
      </div>
    </div>,
    document.body,
  );
}
