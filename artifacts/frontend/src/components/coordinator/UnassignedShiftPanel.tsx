import { PersonPreview } from "./PersonPreview";
import { detailIfShared, sharedNames } from "@/lib/person-identity";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Phone, Mail, Target, CalendarClock, Ban, UserSearch, Repeat } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { zonedDate } from "@/lib/datetime";
import { ShiftZoneNote } from "@/components/branches/ShiftZoneNote";
import { ZoneLabel } from "@/components/branches/ZoneLabel";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, outlineClass } from "@/components/layout/PageKit";
import { ShiftTimeEditor } from "@/components/coordinator/ShiftTimeEditor";
import { isOpenShift } from "@/components/coordinator/rosterShared";
import { ConflictModal, type PendingDrop } from "@/components/coordinator/ConflictModal";
import { WorkerMatchBadge } from "@/components/coordinator/WorkerMatchBadge";
import { ContactLink } from "@/components/team/WorkerDetail";
import {
  getAvailableWorkers,
  getNdisGoals,
  getParticipantTasks,
  assignExistingShift,
  sendShiftOffer,
  rescheduleShift,
  getWorkerConflicts,
  cancelShift,
  type CoordinatorShiftRecord,
  type WorkerStats,
  type AvailableWorker,
  type NdisGoal,
  type ParticipantTask,
} from "@/services/coordinatorService";

export interface UnassignedShiftPanelProps {
  shift: CoordinatorShiftRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: WorkerStats[];
  onAssigned?: () => void;
  /** The shift came from a regular schedule: change it and the rest of the
   *  schedule from its day (the panel's own buttons change just this one). */
  onChangeSeries?: (shift: CoordinatorShiftRecord) => void;
}

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const DANGER = "var(--cc-danger-text)";

/** Opens from clicking an unassigned shift card on the roster — shift and
 * participant context, that participant's goals/tasks, and ranked worker
 * suggestions with contact details so a coordinator can call and assign
 * directly. Assigning reuses the exact same mutation + conflict-confirm flow
 * RosterBoard's drag-drop path already uses (ConflictModal, assignExistingShift),
 * so this is a second entry point into the same behaviour, not a second one
 * that quietly works differently. */
export function UnassignedShiftPanel({ shift, open, onOpenChange, workers, onAssigned, onChangeSeries }: UnassignedShiftPanelProps) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const auth = useAuth();
  const orgId = auth?.user?.organizationId ?? "__no_org__";
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  // A clash for the assigned worker at the new time, shown in the editor.
  const [timeProblem, setTimeProblem] = useState<string | null>(null);
  const sameWorkerNames = sharedNames((workers ?? []).map((w) => w.full_name));

  const participantId = shift?.participant_id;

  // Leaving the reschedule form open across a shift switch (or the panel
  // closing and reopening on a different card) would silently apply edits
  // meant for a different shift.
  useEffect(() => {
    setRescheduling(false);
  }, [shift?.id]);

  const goalsQuery = useOrgQuery<NdisGoal[]>([orgId, "shift-panel-goals", participantId], {
    queryFn: () => getNdisGoals({ participant_id: participantId! }),
    enabled: !!participantId,
  });
  const tasksQuery = useOrgQuery<ParticipantTask[]>([orgId, "shift-panel-tasks", participantId], {
    queryFn: () => getParticipantTasks(participantId!),
    enabled: !!participantId,
  });

  const availableWorkersQuery = useOrgQuery(
    [orgId, "coordinator-available-workers", participantId, shift?.scheduled_start, shift?.scheduled_end, shift?.is_sleepover],
    {
      queryFn: () => getAvailableWorkers({
        shiftStart: shift!.scheduled_start!,
        shiftEnd: shift!.scheduled_end || shift!.scheduled_start!,
        participantId,
        isSleepover: shift?.is_sleepover,
      }),
      enabled: !!shift?.scheduled_start,
      staleTime: 30_000,
    }
  );

  const assignMut = useMutation({
    mutationFn: ({ workerId, confirm }: { workerId: string; confirm: boolean }) =>
      assignExistingShift(shift!.id, { worker_id: workerId, confirm_conflicts: confirm }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({ title: translate("coordinator.dnd.shiftAssigned"), description: translate("coordinator.dnd.workerNotified") });
      setPendingDrop(null);
      onOpenChange(false);
      onAssigned?.();
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.dnd.assignmentFailed"), description: err.message, variant: "destructive" });
      setPendingDrop(null);
    },
  });

  const handleAssign = (worker: AvailableWorker) => {
    if (!shift) return;
    const allIssues = [...worker.conflicts, ...worker.skill_warnings];
    if (allIssues.length > 0) {
      setPendingDrop({
        shift, workerId: worker.id, workerName: worker.full_name,
        conflicts: worker.conflicts, skillWarnings: worker.skill_warnings,
      });
    } else {
      assignMut.mutate({ workerId: worker.id, confirm: false });
    }
  };

  const offerMut = useMutation({
    mutationFn: ({ workerId, candidateQueue }: { workerId: string; candidateQueue: string[] }) =>
      sendShiftOffer(shift!.id, { workerId, candidateQueue }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({ title: translate("coordinator.shiftAssign.offerSent"), description: translate("coordinator.shiftAssign.offerSentDesc") });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.shiftAssign.offerFailed"), description: err.message, variant: "destructive" });
    },
  });

  const handleSendOffer = (worker: AvailableWorker) => {
    const suggestions = availableWorkersQuery.data ?? [];
    const index = suggestions.findIndex((w) => w.id === worker.id);
    const candidateQueue = index >= 0 ? suggestions.slice(index + 1).map((w) => w.id) : [];
    offerMut.mutate({ workerId: worker.id, candidateQueue });
  };

  const rescheduleMut = useMutation({
    mutationFn: async (payload: { scheduled_start: string; scheduled_end: string }) => {
      let warning: string | undefined;
      if (shift && !isOpenShift(shift) && shift.worker_id) {
        const check = await getWorkerConflicts(shift.worker_id, payload.scheduled_start, payload.scheduled_end, {
          participantId: shift.participant_id ?? undefined,
          excludeShiftId: shift.id,
        });
        const hard = check.conflicts.find((c) => c.severity === "error");
        if (hard) {
          setTimeProblem(hard.message);
          return { blocked: true as const };
        }
        warning = [...check.conflicts, ...check.skill_warnings][0]?.message;
      }
      await rescheduleShift(shift!.id, payload);
      return { blocked: false as const, warning };
    },
    onSuccess: (result) => {
      if (result.blocked) return;
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({
        title: translate("coordinator.shiftAssign.rescheduled"),
        description:
          result.warning ??
          (shift && !isOpenShift(shift) ? `${shift.worker_name ?? "The worker"} has been told.` : undefined),
      });
      setRescheduling(false);
      onAssigned?.();
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.shiftAssign.rescheduleFailed"), description: err.message, variant: "destructive" });
    },
  });

  const openReschedule = () => {
    setTimeProblem(null);
    setRescheduling(true);
  };

  const cancelMut = useMutation({
    mutationFn: () => cancelShift(shift!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({ title: translate("coordinator.shiftAssign.cancelled") });
      onOpenChange(false);
      onAssigned?.();
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.shiftAssign.cancelFailed"), description: err.message, variant: "destructive" });
    },
  });

  const handleCancelShift = () => {
    if (!window.confirm(translate("coordinator.shiftAssign.cancelShiftConfirm"))) return;
    cancelMut.mutate();
  };

  // Shown on the shift's own clock, whatever zone the viewer is in.
  const start = shift?.scheduled_start ? zonedDate(shift.scheduled_start, shift.timezone) : null;
  const end = shift?.scheduled_end ? zonedDate(shift.scheduled_end, shift.timezone) : null;
  const goalsWithTasks = (goalsQuery.data ?? [])
    .map((goal) => ({ goal, tasks: (tasksQuery.data ?? []).filter((t) => t.goal_id === goal.id) }))
    .filter(({ tasks }) => tasks.length > 0);

  return (
    <>
      <SidePanel
        open={open}
        onOpenChange={onOpenChange}
        icon={UserSearch}
        title={shift?.participant_name || translate("common.participant")}
        description={
          <>
            {start && format(start, "EEE d MMM, h:mm a")}{end ? ` – ${format(end, "h:mm a")}` : ""}
            {shift?.scheduled_start && <ZoneLabel tz={shift.timezone} at={shift.scheduled_start} className="ml-1" />}
            {shift?.shift_type ? ` · ${shift.shift_type.replace(/_/g, " ")}` : ""}
          </>
        }
      >
        {shift ? (
          <dl className="grid gap-3 rounded-xl border border-cc-border p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-cc-muted">Participant</dt>
              <dd><PersonPreview id={shift.participant_id} name={shift.participant_name || "Participant"} kind="participant" className="text-sm font-semibold" /></dd>
            </div>
            <div>
              <dt className="text-xs text-cc-muted">Assigned worker</dt>
              {/* An unfilled shift can carry a placeholder worker name with no worker behind it. */}
              <dd>
                {shift.worker_id && shift.worker_id !== "00000000-0000-0000-0000-000000000000" ? (
                  <PersonPreview id={shift.worker_id} name={shift.worker_name || workers.find(w => w.id === shift.worker_id)?.full_name || "Unassigned"} kind="worker" worker={workers.find(w => w.id === shift.worker_id)} className="text-sm font-semibold" />
                ) : (
                  <span className="text-sm" style={{ color: MUTED }}>Not assigned yet</span>
                )}
              </dd>
            </div>
          </dl>
        ) : null}

        {/* Made by a regular schedule: the buttons below change just this
            shift; this changes it and the rest of the schedule from its day. */}
        {shift?.series_id && onChangeSeries && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cc-border px-4 py-3">
            <p className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
              <Repeat size={15} aria-hidden style={{ color: MUTED }} /> Part of a regular schedule
            </p>
            <button type="button" onClick={() => onChangeSeries(shift)} className={outlineClass}>
              Change this and future shifts
            </button>
          </div>
        )}

        {/* Change the time or cancel. A new time for an assigned shift is
            checked against the worker's other shifts and leave first. */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={openReschedule} disabled={rescheduling || cancelMut.isPending} className={outlineClass}>
            <CalendarClock size={15} /> {translate("coordinator.shiftAssign.reschedule")}
          </button>
          <button
            type="button"
            onClick={handleCancelShift}
            disabled={rescheduling || cancelMut.isPending}
            className={`${outlineClass} hover:bg-[var(--cc-status-danger-bg)]`}
            style={{ color: DANGER }}
          >
            <Ban size={15} /> {translate("coordinator.shiftAssign.cancelShift")}
          </button>
        </div>

        {rescheduling && shift?.scheduled_start && shift?.scheduled_end && (
          <div className="space-y-2">
            {/* Times are on the shift's own clock (its participant's branch). */}
            <ShiftTimeEditor
              startIso={shift.scheduled_start}
              endIso={shift.scheduled_end}
              timezone={shift.timezone}
              saving={rescheduleMut.isPending}
              problem={timeProblem}
              onSave={(startIso, endIso) => {
                setTimeProblem(null);
                rescheduleMut.mutate({ scheduled_start: startIso, scheduled_end: endIso });
              }}
              onCancel={() => setRescheduling(false)}
            />
            <ShiftZoneNote tz={shift.timezone} sampleIso={shift.scheduled_start} />
          </div>
        )}

        {shift?.cannot_attend_reason && (
          <div className="rounded-xl p-4" style={{ background: "var(--cc-status-danger-bg)" }}>
            <p className="text-xs font-semibold" style={{ color: DANGER }}>
              {translate("coordinator.shiftAssign.cannotAttendReason")}
            </p>
            <p className="mt-1 text-sm" style={{ color: TEXT }}>
              {shift.cannot_attend_reason}
            </p>
          </div>
        )}

        {goalsWithTasks.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: TEXT }}>
              <Target size={15} className="text-[var(--cc-brand-purple)]" /> {translate("coordinator.shiftAssign.tasksOptional")}
            </h3>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-cc-border p-3">
              {goalsWithTasks.map(({ goal, tasks }) => (
                <div key={goal.id}>
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{goal.name}</p>
                  <p className="text-xs" style={{ color: MUTED }}>{tasks.map((t) => t.name).join(", ")}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: TEXT }}>
            {translate("coordinator.shiftAssign.supportWorker")}
          </h3>
          {availableWorkersQuery.isLoading && (
            <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>
          )}
          {availableWorkersQuery.isError && (
            <p className="text-sm" style={{ color: DANGER }}>
              {(availableWorkersQuery.error as Error)?.message || translate("common.error")}
            </p>
          )}
          <div className="space-y-2">
            {(availableWorkersQuery.data ?? []).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-cc-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>{w.full_name}</p>
                  {detailIfShared(w, sameWorkerNames) && (
                    <p className="text-xs" style={{ color: MUTED }}>{detailIfShared(w, sameWorkerNames)}</p>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" style={{ color: MUTED }}>
                    {w.phone && <ContactLink icon={Phone} value={w.phone} href={`tel:${w.phone.replace(/\s/g, "")}`} />}
                    {w.email && <ContactLink icon={Mail} value={w.email} href={`mailto:${w.email}`} />}
                  </div>
                  <div className="mt-1"><WorkerMatchBadge worker={w} /></div>
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAssign(w)}
                    disabled={assignMut.isPending || offerMut.isPending}
                    className={`${ctaClass} !min-h-9 !px-4`}
                  >
                    {translate("common.assign")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendOffer(w)}
                    disabled={assignMut.isPending || offerMut.isPending}
                    className={`${outlineClass} !min-h-9`}
                  >
                    {translate("coordinator.shiftAssign.sendOffer")}
                  </button>
                </div>
              </div>
            ))}
            {!availableWorkersQuery.isLoading && (availableWorkersQuery.data ?? []).length === 0 && (
              <p className="text-sm" style={{ color: MUTED }}>{translate("common.noResults")}</p>
            )}
          </div>
        </section>
      </SidePanel>

      {pendingDrop && (
        <ConflictModal
          pending={pendingDrop}
          confirming={assignMut.isPending}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => assignMut.mutate({ workerId: pendingDrop.workerId, confirm: true })}
        />
      )}
    </>
  );
}
