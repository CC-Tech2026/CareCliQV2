import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, MapPin } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { formatAppDate, formatAppTime } from "@/lib/datetime";
import type { LiveShift } from "@/services/coordinatorService";

export type ShiftStage = "completed" | "active" | "late" | "scheduled";

export function shiftStage(
  shift: Pick<
    LiveShift,
    "clocked_out_at" | "clocked_in_at" | "status" | "scheduled_start"
  >,
  now = Date.now(),
): ShiftStage {
  if (shift.clocked_out_at || shift.status === "completed") return "completed";
  if (shift.clocked_in_at) return "active";
  if (shift.scheduled_start && new Date(shift.scheduled_start).getTime() < now)
    return "late";
  return "scheduled";
}

const PILL_COLOURS: Record<ShiftStage | "review" | "verified" | "approved", string> = {
  active: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  scheduled: "bg-pink-50 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
  completed: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  late: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  review: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  verified: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  approved: "bg-emerald-600 text-white",
};

export function ScheduleStatusPill({
  stage,
}: {
  stage: ShiftStage | "review" | "verified" | "approved";
}) {
  const { translate } = useAccessibility();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${PILL_COLOURS[stage]}`}
    >
      {translate(`schedule.status.${stage}`)}
    </span>
  );
}

const AVATAR_COLOURS: Record<ShiftStage, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  scheduled: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-100",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  late: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};

export function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function WorkerAvatar({
  name,
  stage,
  size = "md",
}: {
  name?: string | null;
  stage: ShiftStage;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${AVATAR_COLOURS[stage]} ${size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-xs"}`}
    >
      {initials(name)}
    </span>
  );
}

/** When the most recent checklist task was ticked off, if the feed has it. */
function lastTaskCompletedAt(shift: LiveShift) {
  const times = (shift.checklist ?? [])
    .map((task) => task.completed_at)
    .filter((value): value is string => !!value)
    .sort();
  return times.length ? times[times.length - 1] : null;
}

/** One line of what's happening on this shift right now. */
function ShiftFooter({ shift, stage }: { shift: LiveShift; stage: ShiftStage }) {
  const { translate, translateParams } = useAccessibility();
  const time = (value: string) => formatAppTime(value, shift.timezone);
  const gps = shift.clock_in_verified && shift.clock_in_method === "gps";

  if (stage === "scheduled") {
    return (
      <p className="text-xs text-cc-muted">
        {shift.scheduled_start
          ? translateParams("schedule.startsAt", { time: time(shift.scheduled_start) })
          : translate("schedule.status.scheduled")}
      </p>
    );
  }
  if (stage === "late") {
    return shift.alerts?.length ? (
      <p className="flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-300">
        <AlertTriangle size={12} aria-hidden /> {translate("schedule.coordinatorAlerted")}
      </p>
    ) : (
      <p className="text-xs font-semibold text-red-700 dark:text-red-300">
        {shift.scheduled_start
          ? translateParams("schedule.wasDueAt", { time: time(shift.scheduled_start) })
          : translate("schedule.status.late")}
      </p>
    );
  }
  if (stage === "completed") {
    return (
      <p className="flex items-center gap-1 text-xs text-cc-muted">
        <CheckCircle2 size={12} aria-hidden className="text-blue-600" />
        {translate(shift.note_recorded || shift.visit_notes ? "schedule.clockedOutWithNote" : "schedule.clockedOutLabel")}
      </p>
    );
  }
  const lastTask = lastTaskCompletedAt(shift);
  if (lastTask) {
    return (
      <p className="flex items-center gap-1 text-xs text-cc-muted">
        <CheckCircle2 size={12} aria-hidden className="text-emerald-600" />
        {translateParams("schedule.taskCompletedAt", { time: time(lastTask) })}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-cc-muted">
      {gps && <MapPin size={12} aria-hidden className="text-emerald-600" />}
      {translate("schedule.clockIn")}
      {gps && <> · {translate("schedule.gpsVerified")}</>}
    </p>
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
    value ? formatAppTime(value, shift.timezone) : null;
  const total = shift.task_counts?.total ?? 0;
  const done = shift.task_counts?.completed ?? 0;
  const day = shift.scheduled_start
    ? formatAppDate(shift.scheduled_start, shift.timezone, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;
  const border =
    stage === "late"
      ? "border-red-400 dark:border-red-500"
      : highlighted
        ? "border-emerald-500 ring-2 ring-emerald-500/30"
        : "border-cc-border";
  const clockedIn = time(shift.clocked_in_at);
  const clockedOut = time(shift.clocked_out_at);
  const cells: Array<{ key: string; value: string | null; tone?: string }> = [
    { key: "start", value: time(shift.scheduled_start) },
    { key: "end", value: time(shift.scheduled_end) },
    {
      key: "clockIn",
      value: clockedIn,
      tone: clockedIn
        ? "text-emerald-700 dark:text-emerald-300"
        : stage === "late"
          ? "text-red-600 dark:text-red-300"
          : undefined,
    },
    { key: "clockOut", value: clockedOut },
  ];

  return (
    <article
      data-stage={stage}
      className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-cc-surface shadow-sm transition-[border-color,box-shadow] duration-500 motion-reduce:transition-none ${border}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full flex-1 space-y-4 p-4 text-left focus-visible:outline-2 focus-visible:outline-cc-plum"
      >
        <div className="flex items-start gap-3">
          <WorkerAvatar name={shift.worker_name} stage={stage} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-cc-text">
              {shift.worker_name || translate("coordinator.shiftAssign.unassigned")}
            </p>
            <p className="mt-0.5 truncate text-xs text-cc-muted">
              {translateParams("schedule.withParticipant", {
                participant: shift.participant_name || translate("schedule.notRecorded"),
              })}
              {day && <> · {day}</>}
            </p>
          </div>
          <ScheduleStatusPill stage={stage} />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl bg-cc-panel p-3 text-xs">
          {cells.map(({ key, value, tone }) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] text-cc-muted">{translate(`schedule.${key}`)}</dt>
              <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${tone ?? "text-cc-text"}`}>
                {value ?? <span aria-label={translate("schedule.notRecorded")}>—</span>}
              </dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ShiftFooter shift={shift} stage={stage} />
            {total > 0 && (
              <span className="text-xs font-semibold tabular-nums text-cc-muted">
                {translateParams("schedule.taskCount", {
                  done: String(Math.min(done, total)),
                  total: String(total),
                })}
              </span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={translate("schedule.tasks")}
            aria-valuemin={0}
            aria-valuemax={total || 1}
            aria-valuenow={Math.min(done, total)}
            className="h-1.5 overflow-hidden rounded-full bg-cc-soft"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${stage === "completed" ? "bg-blue-500" : "bg-emerald-500"}`}
              style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }}
            />
          </div>
        </div>
      </button>
      {stage === "completed" && !readOnly && (
        shift.verified ? (
          <p className="mx-4 mb-4 flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <CheckCircle2 size={14} aria-hidden /> {translate("schedule.status.verified")}
          </p>
        ) : (
          <Link
            href={`/coordinator/verification?shiftId=${encodeURIComponent(shift.id)}`}
            className="mx-4 mb-4 flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-cc-plum px-4 text-sm font-bold text-white transition hover:opacity-90"
          >
            <ArrowRight size={14} aria-hidden />
            {translate("schedule.reviewShift")}
          </Link>
        )
      )}
    </article>
  );
}
