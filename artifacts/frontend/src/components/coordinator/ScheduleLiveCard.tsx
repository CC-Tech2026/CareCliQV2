import { Link } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { formatAppTimeWithZone } from "@/lib/datetime";
import type { LiveShift } from "@/services/coordinatorService";

export function shiftStage(
  shift: Pick<
    LiveShift,
    "clocked_out_at" | "clocked_in_at" | "status" | "scheduled_start"
  >,
  now = Date.now(),
) {
  if (shift.clocked_out_at || shift.status === "completed") return "completed";
  if (shift.clocked_in_at) return "active";
  if (shift.scheduled_start && new Date(shift.scheduled_start).getTime() < now)
    return "late";
  return "scheduled";
}
export function ScheduleStatusPill({
  stage,
}: {
  stage: ReturnType<typeof shiftStage> | "review" | "verified";
}) {
  const { translate } = useAccessibility();
  const colours = {
    active: "bg-emerald-50 text-emerald-800",
    scheduled: "bg-pink-50 text-pink-800",
    completed: "bg-blue-50 text-blue-800",
    late: "bg-red-50 text-red-800",
    review: "bg-amber-50 text-amber-800",
    verified: "bg-emerald-50 text-emerald-800",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${colours[stage]}`}
    >
      {translate(`schedule.status.${stage}`)}
    </span>
  );
}
export function ScheduleLiveCard({
  shift,
  highlighted = false,
  onOpen,
  readOnly,
}: {
  highlighted?: boolean;
  shift: LiveShift;
  onOpen: () => void;
  readOnly?: boolean;
}) {
  const { translate, translateParams } = useAccessibility();
  const stage = shiftStage(shift);
  const time = (value?: string | null) =>
    value
      ? formatAppTimeWithZone(value, shift.timezone)
      : translate("schedule.notRecorded");
  const total = shift.task_counts.total;
  const done = shift.task_counts.completed;
  return (
    <article
      className={`min-w-0 overflow-hidden rounded-xl border bg-cc-surface ${stage === "late" ? "border-red-400" : highlighted ? "border-emerald-500 ring-1 ring-emerald-500 motion-reduce:transition-none" : "border-cc-border"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full space-y-4 p-4 text-left focus-visible:outline-2 focus-visible:outline-cc-plum"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words text-sm font-bold text-cc-text">
              {shift.worker_name ||
                translate("coordinator.shiftAssign.unassigned")}
            </p>
            <p className="mt-1 break-words text-sm text-cc-plum">
              {shift.participant_name}
            </p>
          </div>
          <ScheduleStatusPill stage={stage} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          {[
            ["start", shift.scheduled_start],
            ["end", shift.scheduled_end],
            ["clockIn", shift.clocked_in_at],
            ["clockOut", shift.clocked_out_at],
          ].map(([key, value]) => (
            <div key={key}>
              <dt className="text-cc-muted">{translate(`schedule.${key}`)}</dt>
              <dd className="mt-1 font-semibold text-cc-text">{time(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-cc-muted">
          <span>{translate("coordinator.live.shiftDetail")}</span>
          <span>
            {translateParams("schedule.taskCount", {
              done: String(done),
              total: String(total),
            })}
          </span>
        </div>
      </button>
      {stage === "completed" && !readOnly && (
        <Link
          href={`/coordinator/verification?shiftId=${encodeURIComponent(shift.id)}`}
          className="mx-4 mb-4 flex min-h-11 items-center justify-center rounded-full bg-cc-plum px-4 text-sm font-bold text-white"
        >
          {translate("schedule.reviewShift")}
        </Link>
      )}
      {shift.clock_in_verified && shift.clock_in_method === "gps" && (
        <p className="px-4 pb-3 text-xs text-emerald-700">
          {translate("schedule.gpsVerified")}
        </p>
      )}
      <div
        role="progressbar"
        aria-label={translate("schedule.tasks")}
        aria-valuemin={0}
        aria-valuemax={total || 1}
        aria-valuenow={Math.min(done, total)}
        className="h-1 bg-cc-soft"
      >
        <div
          className={
            stage === "completed"
              ? "h-full bg-blue-500"
              : "h-full bg-emerald-500"
          }
          style={{
            width: `${total ? Math.min(100, (done / total) * 100) : 0}%`,
          }}
        />
      </div>
    </article>
  );
}
