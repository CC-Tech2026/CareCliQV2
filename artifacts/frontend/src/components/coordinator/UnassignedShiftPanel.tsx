import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Phone, Mail, Target } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { ConflictModal, type PendingDrop } from "@/components/coordinator/ConflictModal";
import { WorkerMatchBadge } from "@/components/coordinator/WorkerMatchBadge";
import { ContactLink } from "@/components/team/WorkerDetail";
import {
  getAvailableWorkers,
  getNdisGoals,
  getParticipantTasks,
  assignExistingShift,
  sendShiftOffer,
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
}

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";

/** Opens from clicking an unassigned shift card on the roster — shift and
 * participant context, that participant's goals/tasks, and ranked worker
 * suggestions with contact details so a coordinator can call and assign
 * directly. Assigning reuses the exact same mutation + conflict-confirm flow
 * RosterBoard's drag-drop path already uses (ConflictModal, assignExistingShift),
 * so this is a second entry point into the same behaviour, not a second one
 * that quietly works differently. */
export function UnassignedShiftPanel({ shift, open, onOpenChange, workers, onAssigned }: UnassignedShiftPanelProps) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const auth = useAuth();
  const orgId = auth?.user?.organizationId ?? "__no_org__";
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const participantId = shift?.participant_id;

  const goalsQuery = useOrgQuery<NdisGoal[]>([orgId, "shift-panel-goals", participantId], {
    queryFn: () => getNdisGoals({ participant_id: participantId! }),
    enabled: !!participantId,
  });
  const tasksQuery = useOrgQuery<ParticipantTask[]>([orgId, "shift-panel-tasks", participantId], {
    queryFn: () => getParticipantTasks(participantId!),
    enabled: !!participantId,
  });

  const availableWorkersQuery = useOrgQuery(
    [orgId, "coordinator-available-workers", participantId, shift?.scheduled_start, shift?.scheduled_end],
    {
      queryFn: () => getAvailableWorkers({
        shiftStart: shift!.scheduled_start!,
        shiftEnd: shift!.scheduled_end || shift!.scheduled_start!,
        participantId,
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

  const start = shift?.scheduled_start ? parseISO(shift.scheduled_start) : null;
  const end = shift?.scheduled_end ? parseISO(shift.scheduled_end) : null;
  const goalsWithTasks = (goalsQuery.data ?? [])
    .map((goal) => ({ goal, tasks: (tasksQuery.data ?? []).filter((t) => t.goal_id === goal.id) }))
    .filter(({ tasks }) => tasks.length > 0);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{shift?.participant_name || translate("common.participant")}</SheetTitle>
            <SheetDescription>
              {start && format(start, "EEE d MMM, h:mm a")}{end ? ` – ${format(end, "h:mm a")}` : ""}
              {shift?.shift_type ? ` · ${shift.shift_type.replace(/_/g, " ")}` : ""}
            </SheetDescription>
          </SheetHeader>

          {shift?.cannot_attend_reason && (
            <div
              className="mt-4 rounded-xl border p-3"
              style={{ borderColor: "#FCA5A5", background: "#FEF2F2" }}
            >
              <p className="text-[11px] font-black uppercase" style={{ color: "#DC2626" }}>
                {translate("coordinator.shiftAssign.cannotAttendReason")}
              </p>
              <p className="mt-1 text-[12px]" style={{ color: TEXT }}>
                {shift.cannot_attend_reason}
              </p>
            </div>
          )}

          {goalsWithTasks.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="flex items-center gap-1.5 text-[12px] font-black" style={{ color: TEXT }}>
                <Target size={13} /> {translate("coordinator.shiftAssign.tasksOptional")}
              </p>
              <div className="space-y-2 max-h-40 overflow-y-auto rounded-xl border p-3" style={{ borderColor: BORDER }}>
                {goalsWithTasks.map(({ goal, tasks }) => (
                  <div key={goal.id}>
                    <p className="text-[11px] font-bold" style={{ color: TEXT }}>{goal.name}</p>
                    <p className="text-[11px]" style={{ color: MUTED }}>{tasks.map((t) => t.name).join(", ")}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 space-y-2">
            <p className="text-[12px] font-black" style={{ color: TEXT }}>
              {translate("coordinator.shiftAssign.supportWorker")}
            </p>
            {availableWorkersQuery.isLoading && (
              <p className="text-[12px]" style={{ color: MUTED }}>{translate("common.loading")}</p>
            )}
            {availableWorkersQuery.isError && (
              <p className="text-[12px]" style={{ color: "#DC2626" }}>
                {(availableWorkersQuery.error as Error)?.message || translate("common.error")}
              </p>
            )}
            <div className="space-y-2">
              {(availableWorkersQuery.data ?? []).map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                  style={{ borderColor: BORDER }}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-black" style={{ color: TEXT }}>{w.full_name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: MUTED }}>
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
                      className="rounded-full px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                      style={{ background: PLUM }}
                    >
                      {translate("common.assign")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendOffer(w)}
                      disabled={assignMut.isPending || offerMut.isPending}
                      className="rounded-full border px-3.5 py-1.5 text-[12px] font-bold disabled:opacity-50"
                      style={{ borderColor: PLUM, color: PLUM }}
                    >
                      {translate("coordinator.shiftAssign.sendOffer")}
                    </button>
                  </div>
                </div>
              ))}
              {!availableWorkersQuery.isLoading && (availableWorkersQuery.data ?? []).length === 0 && (
                <p className="text-[12px]" style={{ color: MUTED }}>{translate("common.noResults")}</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
