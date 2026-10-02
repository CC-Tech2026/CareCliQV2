import { useEffect, useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
import { useBranches } from "@/hooks/useBranches";
import { ZoneLabel } from "@/components/branches/ZoneLabel";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  assignShift,
  createUnassignedShift,
  getCoordinatorCredentialAlerts,
  getCoordinatorWorkerCredentialStatus,
  checkParticipantGoalsAndTasks,
  getParticipantTasks,
  getAvailableWorkers,
  getParticipantPriceItemOptions,
  getParticipantAgreementSupports,
  getShiftPayEstimate,
  type AgreementSupport,
  type WorkerStats,
  type ParticipantTask,
  type GoalsAndTasksValidation,
  type AssignShiftResult,
  type AvailableWorker,
  type AvailabilityStatus,
  type ShiftPriceItemOption,
  type PayEstimate,
} from "@/services/coordinatorService";
import {
  resolveNdisPrice,
  type NdisPriceResolution,
} from "@/services/ndisService";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  datetimeLocalValueToUtcIso,
  utcIsoToDatetimeLocalValue,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { DurationQuickPicks } from "@/components/ui/duration-quick-picks";
import { WorkerMatchBadge } from "@/components/coordinator/WorkerMatchBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  User2,
  ChevronDown,
  MapPin,
  Send,
} from "lucide-react";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

const SHIFT_TYPE_KEYS: Record<string, string> = {
  standard_support: "coordinator.bulkShift.shiftType.standardSupport",
  community_access: "coordinator.bulkShift.shiftType.communityAccess",
  allied_health: "coordinator.bulkShift.shiftType.alliedHealth",
  respite_care: "coordinator.bulkShift.shiftType.respiteCare",
};

interface ShiftAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker?: WorkerStats | null;
  workers?: WorkerStats[];
  initialParticipantId?: string;
  initialWorkerId?: string;
  onAssigned?: (id: string) => void;
  initialDate?: string; // "YYYY-MM-DD" — pre-fills the start time to 08:00 on that date
}

export function ShiftAssignmentModal({
  open,
  onOpenChange,
  worker,
  workers = [],
  initialWorkerId,
  onAssigned,
  initialParticipantId,
  initialDate,
}: ShiftAssignmentModalProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const auth = useAuth();
  const user = auth?.user;
  const orgId = user?.organizationId ?? "__no_org__";

  // Hard gate: a worker who hasn't finished onboarding, or who has overdue
  // mandatory training, can't be rostered yet.
  const assignableWorkers = workers.filter(
    (w) => w.onboarding_completed !== false && !w.training_overdue,
  );
  const onboardingPendingCount = workers.filter(
    (w) => w.onboarding_completed === false,
  ).length;
  const trainingOverdueCount = workers.filter(
    (w) => w.onboarding_completed !== false && w.training_overdue,
  ).length;

  const [assigned, setAssigned] = useState(false);
  const taskDefaultsFor = useRef("");
  const [showAllWorkers, setShowAllWorkers] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState(worker?.id ?? "");
  const [selectedParticipantId, setSelectedParticipantId] = useState(
    initialParticipantId ?? "",
  );
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [shiftType, setShiftType] = useState("standard_support");
  const [dutyType, setDutyType] = useState("disability_services");
  const [isSleepover, setIsSleepover] = useState(false);
  const [sleepoverStart, setSleepoverStart] = useState("");
  const [sleepoverEnd, setSleepoverEnd] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isShadowShift, setIsShadowShift] = useState(false);
  const [shadowOfWorkerId, setShadowOfWorkerId] = useState("");
  const [expectedPriceItemCode, setExpectedPriceItemCode] = useState("");
  const [agreementSupportId, setAgreementSupportId] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedWorkerId(worker?.id ?? initialWorkerId ?? "");
      setAssigned(false);
      taskDefaultsFor.current = "";
    }
  }, [worker?.id, initialWorkerId, open]);

  useEffect(() => {
    if (open) { setSelectedParticipantId(initialParticipantId ?? ""); setSelectedTaskIds([]); setShowAllWorkers(false); setShiftType("standard_support"); }
  }, [initialParticipantId, open]);

  useEffect(() => {
    if (open) {
      setScheduledStart(initialDate ? `${initialDate}T09:00` : "");
      setScheduledEnd(initialDate ? `${initialDate}T13:00` : "");
    }
  }, [initialDate, open]);

  const participants = useGetParticipants();
  const { zoneFor } = useBranches();
  const participantList =
    (participants.data as
      | Array<{ id: string; full_name: string; branch_id?: string | null }>
      | undefined) ?? [];
  // Times the coordinator types are wall-clock in the *participant's*
  // office, which may not be the coordinator's own (Adelaide HQ rostering
  // a Melbourne participant). Undefined → the coordinator's zone.
  const participantZone = zoneFor(
    participantList.find((p) => p.id === selectedParticipantId)?.branch_id,
  );
  const credAlertsQuery = useOrgQuery(
    [orgId, "coordinator-credential-alerts"],
    {
      queryFn: getCoordinatorCredentialAlerts,
      staleTime: 5 * 60_000,
    },
  );
  const credStatusQuery = useOrgQuery(
    [
      orgId,
      "coordinator-worker-credential-status",
      selectedWorkerId,
      shiftType,
    ],
    {
      queryFn: () =>
        getCoordinatorWorkerCredentialStatus(selectedWorkerId, shiftType),
      staleTime: 60_000,
      enabled: Boolean(selectedWorkerId),
    },
  );

  // Ranked suggestions for the worker picker — sorts/badges by required-skill
  // coverage and availability, never a hard filter (every team member still
  // shows up). Needs at least a start time to say anything meaningful.
  const availableWorkersQuery = useOrgQuery<AvailableWorker[]>(
    [
      orgId,
      "coordinator-available-workers",
      selectedParticipantId,
      scheduledStart,
      scheduledEnd,
      isSleepover,
    ],
    {
      queryFn: () =>
        getAvailableWorkers({
          shiftStart: datetimeLocalValueToUtcIso(
            scheduledStart,
            participantZone,
          ),
          shiftEnd: datetimeLocalValueToUtcIso(
            scheduledEnd || scheduledStart,
            participantZone,
          ),
          participantId: selectedParticipantId || undefined,
          isSleepover,
        }),
      enabled: !!scheduledStart,
      staleTime: 30_000,
    },
  );
  const workerMatchById = new Map(
    (availableWorkersQuery.data ?? []).map((w) => [w.id, w]),
  );

  // Best matches first: available > warning > unavailable, then preferred
  // availability, then name. Workers with no match data yet (still loading,
  // or no start time set) rank between available/warning — original order,
  // no visible reshuffle until real signal arrives.
  const matchStatusRank: Record<AvailabilityStatus, number> = {
    available: 0,
    warning: 1,
    unavailable: 2,
  };
  const sortedAssignableWorkers = [...assignableWorkers].sort((a, b) => {
    const ma = workerMatchById.get(a.id);
    const mb = workerMatchById.get(b.id);
    const ra = ma ? matchStatusRank[ma.availability_status] : 0.5;
    const rb = mb ? matchStatusRank[mb.availability_status] : 0.5;
    if (ra !== rb) return ra - rb;
    const pa = ma?.preferred_availability ? 0 : 1;
    const pb = mb?.preferred_availability ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.full_name.localeCompare(b.full_name);
  });

  // Check if participant has valid goals and tasks
  const goalsTasksCheckQuery = useOrgQuery<GoalsAndTasksValidation>(
    [orgId, "goals-tasks-validation", selectedParticipantId],
    {
      queryFn: () => checkParticipantGoalsAndTasks(selectedParticipantId),
      enabled: !!selectedParticipantId,
    },
  );

  const tasksQuery = useOrgQuery<ParticipantTask[]>(
    [orgId, "shift-tasks", selectedParticipantId],
    {
      queryFn: () => getParticipantTasks(selectedParticipantId),
      enabled: !!selectedParticipantId && goalsTasksCheckQuery.data?.has_valid,
    },
  );

  // Every task in the care plan starts ticked once the participant's plan
  // loads; untick what doesn't belong on this shift.
  useEffect(() => {
    if (open && tasksQuery.data && taskDefaultsFor.current !== selectedParticipantId) {
      setSelectedTaskIds(tasksQuery.data.map((task) => task.id));
      taskDefaultsFor.current = selectedParticipantId;
    }
  }, [open, selectedParticipantId, tasksQuery.data]);

  const priceItemsQuery = useOrgQuery<ShiftPriceItemOption[]>(
    [orgId, "participant-price-items", selectedParticipantId],
    {
      queryFn: () => getParticipantPriceItemOptions(selectedParticipantId),
      enabled: !!selectedParticipantId,
      staleTime: 60_000,
    },
  );

  // The supports on the participant's sent or signed agreements, with hours
  // used. Given the shift's times, each line also says what would go wrong
  // (outside the agreement dates, unsigned, over the agreed hours).
  const shiftWindow = (() => {
    if (!scheduledStart || !scheduledEnd) return undefined;
    try {
      return {
        start: datetimeLocalValueToUtcIso(scheduledStart, participantZone),
        end: datetimeLocalValueToUtcIso(scheduledEnd, participantZone),
      };
    } catch {
      return undefined;
    }
  })();
  const agreementSupportsQuery = useOrgQuery<AgreementSupport[]>(
    [orgId, "participant-agreement-supports", selectedParticipantId, shiftWindow?.start, shiftWindow?.end],
    {
      queryFn: () => getParticipantAgreementSupports(selectedParticipantId, shiftWindow),
      enabled: !!selectedParticipantId,
      staleTime: 30_000,
    },
  );
  useEffect(() => {
    setAgreementSupportId("");
  }, [selectedParticipantId]);
  const chooseAgreementSupport = (line: AgreementSupport) => {
    if (agreementSupportId === line.id) {
      setAgreementSupportId("");
      if (expectedPriceItemCode === line.support_item_code) setExpectedPriceItemCode("");
      return;
    }
    setAgreementSupportId(line.id);
    setExpectedPriceItemCode(line.support_item_code);
  };

  const isManagingDirector = user?.role === "managing_director";
  const payEstimateQuery = useOrgQuery<PayEstimate>(
    [
      orgId,
      "shift-pay-estimate",
      selectedWorkerId,
      scheduledStart,
      scheduledEnd,
      dutyType,
      isSleepover,
    ],
    {
      queryFn: () =>
        getShiftPayEstimate({
          workerId: selectedWorkerId,
          scheduledStart: datetimeLocalValueToUtcIso(
            scheduledStart,
            participantZone,
          ),
          scheduledEnd: datetimeLocalValueToUtcIso(
            scheduledEnd,
            participantZone,
          ),
          dutyType,
          isSleepover,
        }),
      enabled:
        isManagingDirector &&
        !!selectedWorkerId &&
        !!scheduledStart &&
        !!scheduledEnd,
      staleTime: 10_000,
    },
  );

  // Resolves the expected item's price the same way verify_shift() will —
  // as-of the shift's own scheduled date — rather than trusting whatever
  // "currently active" price happened to be cached in the dropdown list.
  // Those two agree in the common case, but can drift if the org loads a
  // new price catalogue between now and when this shift is actually
  // verified, which is exactly the kind of quiet mismatch worth avoiding.
  const resolvedExpectedPriceQuery = useOrgQuery<NdisPriceResolution>(
    [orgId, "resolve-ndis-price", expectedPriceItemCode, scheduledStart],
    {
      queryFn: () =>
        resolveNdisPrice(
          expectedPriceItemCode,
          datetimeLocalValueToUtcIso(scheduledStart, participantZone).slice(
            0,
            10,
          ),
        ),
      enabled: !!expectedPriceItemCode && !!scheduledStart,
      staleTime: 10_000,
    },
  );

  const assignMut = useMutation({
    mutationFn: async (): Promise<AssignShiftResult> => {
      const payload = {
        participant_id: selectedParticipantId,
        scheduled_start: datetimeLocalValueToUtcIso(
          scheduledStart,
          participantZone,
        ),
        scheduled_end: scheduledEnd
          ? datetimeLocalValueToUtcIso(scheduledEnd, participantZone)
          : undefined,
        shift_type: shiftType,
        duty_type: dutyType,
        is_sleepover: isSleepover,
        sleepover_start:
          isSleepover && sleepoverStart
            ? datetimeLocalValueToUtcIso(sleepoverStart, participantZone)
            : undefined,
        sleepover_end:
          isSleepover && sleepoverEnd
            ? datetimeLocalValueToUtcIso(sleepoverEnd, participantZone)
            : undefined,
        selected_task_ids:
          selectedTaskIds.length > 0 ? selectedTaskIds : undefined,
        expected_price_item_code: expectedPriceItemCode || undefined,
        service_agreement_support_id: agreementSupportId || undefined,
      };
      if (selectedWorkerId) {
        return assignShift({
          ...payload,
          worker_id: selectedWorkerId,
          is_shadow_shift: isShadowShift,
          shadow_of_worker_id: isShadowShift ? shadowOfWorkerId : undefined,
        });
      }
      const created = await createUnassignedShift(payload);
      return {
        shift_id: created.shift_id,
        shift: created.shift,
        credential_status: {
          valid: true,
          missing_credentials: [],
          warning: null,
        },
        message: "Unassigned shift created",
      };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      qc.invalidateQueries({ queryKey: [orgId, "live-shifts"] });
      toast({
        title: selectedWorkerId
          ? translate("coordinator.shiftAssign.assigned")
          : translate("coordinator.shiftAssign.created"),
        description: selectedWorkerId
          ? translate("coordinator.shiftAssign.workerNotified")
          : translate("coordinator.shiftAssign.unassignedAdded"),
      });
      onAssigned?.(result.shift_id);
      setAssigned(true);
    },
    onError: (error: Error) => {
      toast({
        title: translate("coordinator.shiftAssign.failed"),
        description:
          error.message || translate("coordinator.shiftAssign.failedDesc"),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!assigned || !open) return;
    const timer = setTimeout(() => {
      resetForm();
      onOpenChange(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [assigned, open]);

  const resetForm = () => {
    if (!worker) setSelectedWorkerId("");
    setSelectedParticipantId("");
    setScheduledStart("");
    setScheduledEnd("");
    setShiftType("standard_support");
    setSelectedTaskIds([]);
    setIsShadowShift(false);
    setShadowOfWorkerId("");
    setExpectedPriceItemCode("");
    setAgreementSupportId("");
  };

  const handleSetDuration = (hours: number) => {
    if (!scheduledStart) return;
    try {
      const startUtc = datetimeLocalValueToUtcIso(
        scheduledStart,
        participantZone,
      );
      const endUtc = new Date(
        new Date(startUtc).getTime() + hours * 60 * 60 * 1000,
      ).toISOString();
      setScheduledEnd(utcIsoToDatetimeLocalValue(endUtc, participantZone));
    } catch {}
  };

  const activeDurationHours = (() => {
    if (!scheduledStart || !scheduledEnd) return null;
    try {
      const startMs = new Date(
        datetimeLocalValueToUtcIso(scheduledStart, participantZone),
      ).getTime();
      const endMs = new Date(
        datetimeLocalValueToUtcIso(scheduledEnd, participantZone),
      ).getTime();
      const diffHours = (endMs - startMs) / (60 * 60 * 1000);
      return Number.isInteger(diffHours) && diffHours > 0 ? diffHours : null;
    } catch {
      return null;
    }
  })();

  const selectedWorkerData = workers.find((w) => w.id === selectedWorkerId);
  const workerAlerts = (credAlertsQuery.data?.alerts ?? []).filter(
    (a) => a.user_id === selectedWorkerId,
  );
  const credStatus = credStatusQuery.data?.credential_status;
  const hasExpired = workerAlerts.some((a) => a.status === "expired");
  const hasExpiring = workerAlerts.some((a) => a.status === "expiring");
  const hasBlock = selectedWorkerId
    ? credStatus
      ? !credStatus.valid
      : hasExpired
    : false;
  const selectedParticipant = participantList.find(
    (p) => p.id === selectedParticipantId,
  );

  const goalsTasksValid = goalsTasksCheckQuery.data?.has_valid ?? false;
  // Undefined (older API) means "not checked", not "missing".
  const noActivePlan = Boolean(selectedParticipantId) && goalsTasksCheckQuery.data?.has_active_plan === false;
  const hasGoalsTasksError =
    !goalsTasksCheckQuery.isLoading &&
    selectedParticipantId &&
    !goalsTasksValid;

  const canSubmit = Boolean(
    selectedParticipantId &&
    scheduledStart &&
    scheduledEnd &&
    new Date(scheduledEnd).getTime() > new Date(scheduledStart).getTime() &&
    (!selectedWorkerId || !hasBlock) &&
    (!isShadowShift || shadowOfWorkerId) &&
    (!isSleepover || (sleepoverStart && sleepoverEnd)) &&
    goalsTasksValid &&
    !noActivePlan &&
    !assignMut.isPending &&
    !assigned,
  );

  const credLabel = credStatusQuery.isLoading
    ? translate("coordinator.shiftAssign.checkingCredentials")
    : hasBlock
      ? translate("coordinator.shiftAssign.credentialsInvalid")
      : hasExpiring
        ? translate("coordinator.shiftAssign.credentialsExpiring")
        : translate("coordinator.shiftAssign.credentialsValid");

  // ── Date and times, entered as one date plus start/end times ────────────
  const shiftDate = scheduledStart.slice(0, 10);
  const startTime = scheduledStart.slice(11, 16);
  const endTime = scheduledEnd.slice(11, 16);
  const endFor = (date: string, start: string, end: string) =>
    !date || !end ? "" : `${end <= start ? nextDay(date) : date}T${end}`; // an end before the start is overnight
  const setShiftDate = (date: string) => {
    if (!date) return;
    const start = startTime || "09:00";
    setScheduledStart(`${date}T${start}`);
    setScheduledEnd(endFor(date, start, endTime || "13:00"));
  };
  const setStartTime = (time: string) => {
    if (!shiftDate || !time) return;
    setScheduledStart(`${shiftDate}T${time}`);
    if (endTime) setScheduledEnd(endFor(shiftDate, time, endTime));
  };
  const setEndTime = (time: string) => {
    if (!shiftDate || !time) return;
    setScheduledEnd(endFor(shiftDate, startTime || "09:00", time));
  };
  const durationLabel = (() => {
    if (!scheduledStart || !scheduledEnd) return null;
    const minutes = Math.round((new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()) / 60_000);
    if (!(minutes > 0)) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h ? `${h}h` : ""}${m ? ` ${m}m` : ""}`.trim() + (scheduledEnd.slice(0, 10) !== shiftDate ? " · overnight" : "");
  })();

  // ── Suggested workers ────────────────────────────────────────────────────
  const firstName = selectedParticipant?.full_name.split(" ")[0];
  const participantAddress = (() => {
    const p = selectedParticipant as unknown as Record<string, unknown> | undefined;
    const value = p?.address ?? p?.home_address ?? p?.street_address;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  })();
  const canRank = Boolean(selectedParticipantId && scheduledStart);
  const ranked = (availableWorkersQuery.data ?? [])
    .filter((w) => !w.excluded && w.availability_status !== "unavailable" && assignableWorkers.some((a) => a.id === w.id))
    .sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
  const suggestions = ranked.slice(0, 3);
  // The worker whose row was clicked stays on the list even if they aren't a top match.
  if (selectedWorkerId && !suggestions.some((w) => w.id === selectedWorkerId)) {
    const chosen =
      workerMatchById.get(selectedWorkerId) ?? (workers.find((w) => w.id === selectedWorkerId) as AvailableWorker | undefined);
    if (chosen) suggestions.unshift(chosen);
  }
  const workerNote = (w: AvailableWorker): { text: string; tone: string } | null => {
    const conflict = w.conflicts?.[0]?.message;
    if (conflict) return { text: conflict, tone: "var(--cc-status-danger)" };
    const expiring = (credAlertsQuery.data?.alerts ?? []).find((a) => a.user_id === w.id && a.status !== "valid");
    if (expiring) {
      const label = expiring.title || expiring.credential_type || "A credential";
      if (expiring.status === "expired") return { text: `${label} has expired`, tone: "var(--cc-status-danger)" };
      const days = expiring.expiry_date
        ? Math.max(0, Math.ceil((new Date(`${expiring.expiry_date}T00:00:00`).getTime() - Date.now()) / 86_400_000))
        : null;
      return { text: days != null ? `${label} expires in ${days} day${days === 1 ? "" : "s"}` : `${label} expiring`, tone: "var(--cc-status-warning)" };
    }
    const skill = w.skill_warnings?.[0]?.message;
    if (skill) return { text: skill, tone: "var(--cc-status-warning)" };
    if (w.match_reasons?.[0]) return { text: w.match_reasons[0], tone: "#16A34A" };
    if (w.preferred_availability) return { text: "Preferred availability", tone: "#16A34A" };
    return null;
  };

  // What's stopping the shift being saved, said plainly next to the button.
  const blocker = !selectedParticipantId
    ? "Choose a participant"
    : noActivePlan
      ? "Add an active NDIS plan first"
    : hasGoalsTasksError
      ? "Set up this participant's goals first"
      : !scheduledStart || !scheduledEnd
        ? "Set the date and times"
        : new Date(scheduledEnd).getTime() <= new Date(scheduledStart).getTime()
          ? "The end time must be after the start"
          : selectedWorkerId && hasBlock
            ? `${selectedWorkerData?.full_name ?? "This worker"} is missing a required credential`
            : isShadowShift && !shadowOfWorkerId
              ? "Choose who they're shadowing"
              : isSleepover && !(sleepoverStart && sleepoverEnd)
                ? "Set the sleepover times"
                : null;

  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (open) setMoreOpen(false);
  }, [open]);
  const moreSummary = [
    dutyType === "general_sacs" ? translate("coordinator.shiftAssign.dutyType.generalSacs") : null,
    isShadowShift ? "Shadow shift" : null,
    isSleepover ? "Sleepover" : null,
    expectedPriceItemCode || null,
  ].filter(Boolean);

  const fieldLabel = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em]";
  const field = "h-10 w-full rounded-lg border bg-white px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[#E8457A]/40";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] sm:max-w-[560px] max-h-[92dvh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden"
        style={{ borderColor: BORDER }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 shrink-0">
          <DialogTitle className="text-[18px] font-bold tracking-tight" style={{ color: TEXT }}>
            Create shift
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[13px]">
            Assign a shift to a support worker
          </DialogDescription>
        </div>

        {/* Done */}
        {assigned ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center" role="status">
            <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-status-success-bg)" }}>
              <CheckCircle2 size={24} style={{ color: "var(--cc-status-success)" }} />
            </span>
            <p className="text-[15px] font-bold" style={{ color: TEXT }}>
              {selectedWorkerId ? "Shift assigned" : "Shift created"}
            </p>
            <p className="text-[12px]" style={{ color: MUTED }}>
              {selectedWorkerId
                ? `${selectedWorkerData?.full_name ?? "The worker"} has been notified.`
                : "It's waiting in Unassigned for a worker."}
            </p>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-5 space-y-4">
          {/* Participant */}
          <div>
            <label className={fieldLabel} style={{ color: MUTED }}>{translate("common.participant")}</label>
            <SearchableSelect
              value={selectedParticipantId}
              onValueChange={setSelectedParticipantId}
              placeholder="Select"
              searchPlaceholder={translate("coordinator.shiftAssign.searchParticipant")}
              emptyText={translate("common.noResults")}
              options={participantList.map((p) => ({ value: p.id, label: p.full_name }))}
            />
            {noActivePlan && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" }}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  {firstName ?? "This participant"} has no active NDIS plan, so shifts can't be booked yet.{" "}
                  <Link href={`/patients?id=${encodeURIComponent(selectedParticipantId)}`} className="font-bold underline">Add a plan →</Link>
                </span>
              </p>
            )}
            {hasGoalsTasksError && !noActivePlan && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" }}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  {firstName ?? "This participant"} needs at least one NDIS goal with a task before a shift can be created.{" "}
                  <Link href="/patients" className="font-bold underline">Set up goals →</Link>
                </span>
              </p>
            )}
          </div>

          {/* When */}
          <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2.5">
            <div>
              <label htmlFor="shift-date" className={fieldLabel} style={{ color: MUTED }}>Date</label>
              <input id="shift-date" type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={field} style={{ borderColor: BORDER, color: TEXT }} />
            </div>
            <div>
              <label htmlFor="shift-start" className={fieldLabel} style={{ color: MUTED }}>Start</label>
              <input id="shift-start" type="time" step={300} value={startTime} disabled={!shiftDate} onChange={(e) => setStartTime(e.target.value)} className={field} style={{ borderColor: BORDER, color: TEXT }} />
            </div>
            <div>
              <label htmlFor="shift-end" className={fieldLabel} style={{ color: MUTED }}>
                End {durationLabel && <span className="normal-case tracking-normal font-semibold" style={{ color: TEXT }}>· {durationLabel}</span>}
              </label>
              <input id="shift-end" type="time" step={300} value={endTime} disabled={!shiftDate} onChange={(e) => setEndTime(e.target.value)} className={field} style={{ borderColor: BORDER, color: TEXT }} />
            </div>
          </div>
          <div className="-mt-2 flex flex-wrap items-center gap-1.5">
            <DurationQuickPicks onSelect={handleSetDuration} activeHours={activeDurationHours} disabled={!scheduledStart} />
            <ZoneLabel tz={participantZone} className="ml-auto" />
          </div>

          {/* Type and place */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={fieldLabel} style={{ color: MUTED }}>{translate("coordinator.shiftAssign.shiftType")}</label>
              <Select value={shiftType} onValueChange={setShiftType}>
                <SelectTrigger className="h-10 rounded-lg text-[13px]" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(SHIFT_TYPE_KEYS).map((value) => (
                    <SelectItem key={value} value={value}>{translate(SHIFT_TYPE_KEYS[value])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={fieldLabel} style={{ color: MUTED }}>Location</label>
              <div
                className="flex h-10 items-center gap-1.5 truncate rounded-lg border px-3 text-[13px]"
                style={{ borderColor: BORDER, color: participantAddress ? TEXT : MUTED, background: SOFT }}
                title={participantAddress ? "From the participant's record" : undefined}
              >
                <MapPin size={13} className="shrink-0" style={{ color: MUTED }} />
                <span className="truncate">{participantAddress ?? (selectedParticipantId ? "No address on record" : "Participant's address")}</span>
              </div>
            </div>
          </div>

          {/* Suggested workers */}
          <section aria-label="Suggested workers">
            <p className="mb-2 flex items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: MUTED }}>Suggested workers</span>
              <span className="text-[11px]" style={{ color: MUTED }}>Ranked by availability, skills and fit</span>
            </p>
            {!canRank ? (
              <p className="rounded-xl border border-dashed px-4 py-5 text-center text-[12px]" style={{ borderColor: BORDER, color: MUTED }}>
                Choose a participant and time to see who fits best.
              </p>
            ) : availableWorkersQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-[58px] animate-pulse rounded-xl" style={{ background: SOFT }} />)}
              </div>
            ) : (
              <div className="space-y-2" role="radiogroup" aria-label="Worker">
                {suggestions.map((w) => {
                  const note = workerNote(w);
                  const on = selectedWorkerId === w.id;
                  return (
                    <label
                      key={w.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
                      style={{ borderColor: on ? "#E8457A" : BORDER, background: on ? "rgba(232,69,122,0.05)" : "white", boxShadow: on ? "0 0 0 1px #E8457A" : undefined }}
                    >
                      <input type="radio" name="suggested-worker" className="h-4 w-4 accent-[#E8457A]" checked={on} onChange={() => setSelectedWorkerId(w.id)} />
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: avatarColour(w.full_name) }}>
                        {initialsOf(w.full_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold" style={{ color: TEXT }}>{w.full_name}</span>
                        {note && <span className="block truncate text-[11px] font-medium" style={{ color: note.tone }}>{note.text}</span>}
                      </span>
                      {w.match_score != null && (
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "var(--cc-status-success-bg)", color: "#15803D" }}>
                          {Math.round(w.match_score)}% match
                        </span>
                      )}
                    </label>
                  );
                })}
                {suggestions.length === 0 && (
                  <p className="rounded-xl border border-dashed px-4 py-4 text-center text-[12px]" style={{ borderColor: BORDER, color: MUTED }}>
                    No one is free and suited at this time. Choose someone below, or leave it unassigned.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px]">
                  <button type="button" className="font-semibold" style={{ color: PLUM }} onClick={() => setShowAllWorkers((v) => !v)}>
                    {showAllWorkers ? "Hide other workers" : "Choose another worker"}
                  </button>
                  {selectedWorkerId && (
                    <button type="button" className="font-semibold" style={{ color: MUTED }} onClick={() => setSelectedWorkerId("")}>
                      Leave unassigned
                    </button>
                  )}
                </div>
                {showAllWorkers && (
                  <SearchableSelect
                    value={selectedWorkerId || "__unassigned__"}
                    onValueChange={(val) => setSelectedWorkerId(val === "__unassigned__" ? "" : val)}
                    placeholder={translate("coordinator.shiftAssign.unassigned")}
                    searchPlaceholder={translate("coordinator.shiftAssign.searchWorker")}
                    emptyText={translate("common.noResults")}
                    options={[
                      { value: "__unassigned__", label: translate("coordinator.shiftAssign.unassigned"), keywords: "unassigned" },
                      ...sortedAssignableWorkers.map((w) => ({ value: w.id, label: w.full_name, keywords: w.full_name })),
                    ]}
                    renderOption={(option) =>
                      option.value === "__unassigned__" ? (
                        <span className="flex items-center gap-2" style={{ color: MUTED }}><User2 size={12} />{option.label}</span>
                      ) : (
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="flex items-center gap-2"><User2 size={12} />{option.label}</span>
                          <WorkerMatchBadge worker={workerMatchById.get(option.value)} />
                        </span>
                      )
                    }
                  />
                )}
                {selectedWorkerId && hasBlock && (
                  <p className="flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" }}>
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {credLabel}
                      {(credStatus?.missing_credentials ?? []).length > 0 && `: ${credStatus!.missing_credentials.slice(0, 3).join(", ")}`}
                    </span>
                  </p>
                )}
              </div>
            )}
            {(onboardingPendingCount > 0 || trainingOverdueCount > 0) && (
              <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
                {onboardingPendingCount > 0 &&
                  (onboardingPendingCount === 1
                    ? translate("coordinator.shiftAssign.onboardingPendingOne")
                    : translateParams("coordinator.shiftAssign.onboardingPendingMany", { count: String(onboardingPendingCount) }))}{" "}
                {trainingOverdueCount > 0 &&
                  (trainingOverdueCount === 1
                    ? translate("coordinator.shiftAssign.trainingOverdueOne")
                    : translateParams("coordinator.shiftAssign.trainingOverdueMany", { count: String(trainingOverdueCount) }))}
              </p>
            )}
          </section>

          {/* Agreed support */}
          {selectedParticipantId && agreementSupportsQuery.data && (
            <section aria-label="Agreed support">
              <p className="mb-2 flex items-baseline gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: MUTED }}>Agreed support</span>
                <span className="text-[11px]" style={{ color: MUTED }}>From {firstName ? `${firstName}'s` : "the"} service agreement</span>
              </p>
              {agreementSupportsQuery.data.length === 0 ? (
                <p className="text-[12px]" style={{ color: MUTED }}>
                  No sent or signed service agreement yet. You can still set the NDIS item under More options.
                </p>
              ) : (
                <div className="space-y-2">
                  {agreementSupportsQuery.data.map((line) => {
                    const on = agreementSupportId === line.id;
                    return (
                      <div key={line.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => chooseAgreementSupport(line)}
                          className="flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[12px]"
                          style={{ borderColor: on ? "#16A34A" : BORDER, background: on ? "rgba(22,163,74,0.05)" : "white" }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold" style={{ color: TEXT }}>
                              {line.item_name ?? line.support_item_code}
                            </span>
                            <span className="block text-[11px]" style={{ color: MUTED }}>
                              {line.support_item_code}
                              {line.agreement_number ? ` · ${line.agreement_number}` : ""}
                              {line.agreement_status === "pending_signature" ? " · Not signed yet" : ""}
                              {!line.in_current_catalogue ? " · No longer in the NDIS price guide" : ""}
                            </span>
                          </span>
                          <AgreementHours line={line} />
                        </button>
                        {on && line.warnings.length > 0 && (
                          <ul className="mt-1.5 space-y-1 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" }}>
                            {line.warnings.map((w) => (
                              <li key={w} className="flex items-start gap-1.5">
                                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                <span>{w}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[11px]" style={{ color: MUTED }}>
                    Hours count against the support you choose. Booked shows the next 4 weeks.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Shift tasks */}
          {goalsTasksValid && (tasksQuery.data ?? []).length > 0 && (
            <section aria-label="Shift tasks">
              <p className="mb-2 flex items-baseline gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: MUTED }}>Shift tasks</span>
                <span className="text-[11px]" style={{ color: MUTED }}>From {firstName ? `${firstName}'s` : "the"} care plan</span>
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(tasksQuery.data ?? []).map((task) => {
                  const on = selectedTaskIds.includes(task.id);
                  const when = task.is_mandatory ? "Required" : TASK_TIME_LABELS[task.shift_type ?? ""];
                  return (
                    <label
                      key={task.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[12px]"
                      style={{ borderColor: BORDER, background: on ? "rgba(22,163,74,0.05)" : "white" }}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[#16A34A]"
                        checked={on}
                        onChange={(e) =>
                          setSelectedTaskIds((ids) => (e.target.checked ? [...ids, task.id] : ids.filter((id) => id !== task.id)))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate" style={{ color: TEXT }} title={task.goal_name ?? undefined}>{task.name}</span>
                      {when && <span className="shrink-0 text-[10px]" style={{ color: MUTED }}>{when}</span>}
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Less common settings */}
          <section className="rounded-xl border" style={{ borderColor: BORDER }}>
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[12px] font-semibold"
              style={{ color: TEXT }}
            >
              <span>
                More options
                <span className="ml-2 font-normal" style={{ color: MUTED }}>
                  {moreSummary.length ? moreSummary.join(" · ") : "Pay type, shadow shift, sleepover, NDIS item"}
                </span>
              </span>
              <ChevronDown size={14} className={cn("transition-transform", moreOpen && "rotate-180")} style={{ color: MUTED }} />
            </button>
            {moreOpen && (
              <div className="space-y-4 border-t px-3 py-3" style={{ borderColor: BORDER }}>
                <div>
                  <label className={fieldLabel} style={{ color: MUTED }}>{translate("coordinator.shiftAssign.dutyType")}</label>
                  <Select value={dutyType} onValueChange={setDutyType}>
                    <SelectTrigger className="h-10 rounded-lg text-[13px]" style={{ borderColor: BORDER }}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disability_services">{translate("coordinator.shiftAssign.dutyType.disabilityServices")}</SelectItem>
                      <SelectItem value="general_sacs">{translate("coordinator.shiftAssign.dutyType.generalSacs")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {selectedWorkerId && (
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold" style={{ color: TEXT }}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isShadowShift}
                        onChange={(e) => {
                          setIsShadowShift(e.target.checked);
                          if (!e.target.checked) setShadowOfWorkerId("");
                        }}
                      />
                      Shadow shift — pair with a senior worker
                    </label>
                    {isShadowShift && (
                      <Select value={shadowOfWorkerId} onValueChange={setShadowOfWorkerId}>
                        <SelectTrigger className="h-10 rounded-lg" style={{ borderColor: BORDER }}><SelectValue placeholder="Who are they shadowing?" /></SelectTrigger>
                        <SelectContent>
                          {assignableWorkers.filter((w) => w.id !== selectedWorkerId).map((w) => (
                            <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold" style={{ color: TEXT }}>
                    <input type="checkbox" className="h-4 w-4 rounded" checked={isSleepover} onChange={(e) => setIsSleepover(e.target.checked)} />
                    {translate("coordinator.shiftAssign.sleepover")}
                  </label>
                  {isSleepover && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className={fieldLabel} style={{ color: MUTED }}>{translate("coordinator.shiftAssign.sleepoverStart")}</label>
                        <DateTimePicker value={sleepoverStart} onChange={setSleepoverStart} />
                      </div>
                      <div>
                        <label className={fieldLabel} style={{ color: MUTED }}>{translate("coordinator.shiftAssign.sleepoverEnd")}</label>
                        <DateTimePicker value={sleepoverEnd} onChange={setSleepoverEnd} />
                      </div>
                    </div>
                  )}
                </div>
                {selectedParticipantId && (
                  <div>
                    <label className={fieldLabel} style={{ color: MUTED }}>Expected NDIS item</label>
                    <SearchableSelect
                      value={expectedPriceItemCode || "__none__"}
                      onValueChange={(val) => setExpectedPriceItemCode(val === "__none__" ? "" : val)}
                      placeholder={priceItemsQuery.isLoading ? "Loading price items…" : "None recorded"}
                      searchPlaceholder="Search by name or item code…"
                      emptyText={translate("common.noResults")}
                      disabled={priceItemsQuery.isLoading}
                      options={[
                        { value: "__none__", label: "None recorded", keywords: "none recorded" },
                        ...[...(priceItemsQuery.data ?? [])]
                          .sort((a, b) => (a.category_number ?? "").localeCompare(b.category_number ?? "") || a.item_code.localeCompare(b.item_code))
                          .map((p) => {
                            const name = p.name || p.support_purpose || "Unnamed item";
                            const priceSuffix =
                              p.price_national != null ? (p.unit === "E" ? ` ($${p.price_national.toFixed(2)} flat)` : ` ($${p.price_national.toFixed(2)}/hr)`) : "";
                            return {
                              value: p.item_code,
                              label: `${p.item_code}: ${name}${priceSuffix}`,
                              keywords: `${p.item_code} ${name}`,
                              group: p.category_label ?? (p.category_number ? `Category ${p.category_number}` : "Other"),
                            };
                          }),
                      ]}
                    />
                    <BillingEstimate
                      itemCode={expectedPriceItemCode}
                      scheduledStart={scheduledStart}
                      participantZone={participantZone}
                      resolved={resolvedExpectedPriceQuery.data}
                      resolving={resolvedExpectedPriceQuery.isLoading}
                      hours={activeDurationHours}
                      showPay={isManagingDirector && !!selectedWorkerId}
                      pay={payEstimateQuery.data}
                      payLoading={payEstimateQuery.isLoading}
                    />
                    <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                      What this shift should be billed under. A different item at verification shows a warning; it won't block.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
        )}

        {/* Footer */}
        {!assigned && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-3.5 shrink-0" style={{ borderColor: BORDER }}>
            {blocker && (
              <p className="mr-auto text-[12px]" style={{ color: MUTED }} aria-live="polite">{blocker}</p>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={assignMut.isPending} className="rounded-lg">
              Cancel
            </Button>
            <Button
              onClick={() => assignMut.mutate()}
              disabled={!canSubmit}
              className="gap-2 rounded-lg text-white hover:opacity-90"
              style={{ background: "#E8457A", opacity: canSubmit ? 1 : 0.45 }}
            >
              {assignMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={14} />}
              {assignMut.isPending
                ? selectedWorkerId ? translate("coordinator.shiftAssign.assigning") : translate("coordinator.shiftAssign.creating")
                : selectedWorkerId ? "Assign shift" : "Create unassigned shift"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TASK_TIME_LABELS: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", night: "Night", evening: "Evening" };
const AVATARS = ["#E8457A", "#C7853D", "#3B82F6", "#8B7FD1", "#4E9A76", "#3B4A63"];
function avatarColour(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}
function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

const hoursText = (n: number) => `${Number(n.toFixed(2))}h`;

/** Hours used against an agreement line. Lines billed per unit (transport,
 * consumables) aren't counted in hours, so they say so instead. */
function AgreementHours({ line }: { line: AgreementSupport }) {
  if (!line.counted) {
    return <span className="shrink-0 text-right text-[11px]" style={{ color: MUTED }}>Per {line.unit === "E" ? "item" : "unit"}, not counted in hours</span>;
  }
  const over = line.left_hours != null && line.left_hours < 0;
  return (
    <span className="shrink-0 text-right text-[11px] leading-snug" style={{ color: MUTED }}>
      <span className="block">
        {hoursText(line.delivered_hours)} used · {hoursText(line.booked_soon_hours)} booked
        {line.booked_later_hours > 0 ? ` · ${hoursText(line.booked_later_hours)} later` : ""}
      </span>
      {line.left_hours != null && line.hours_allocated != null ? (
        <span className="block font-semibold" style={{ color: over ? "var(--cc-status-danger)" : TEXT }}>
          {over ? `${hoursText(-line.left_hours)} over` : `${hoursText(line.left_hours)} left`} of {hoursText(line.hours_allocated)}
        </span>
      ) : (
        <span className="block">No hours set</span>
      )}
    </span>
  );
}

/** Estimated NDIS billing for the expected item, and (for the MD) projected
 * pay and margin. NDIS and SCHADS day-types are classified independently, so
 * a mismatch is flagged, never reconciled. */
function BillingEstimate({
  itemCode, scheduledStart, participantZone, resolved, resolving, hours, showPay, pay, payLoading,
}: {
  itemCode: string;
  scheduledStart: string;
  participantZone: string | undefined;
  resolved: NdisPriceResolution | undefined;
  resolving: boolean;
  hours: number | null;
  showPay: boolean;
  pay: PayEstimate | undefined;
  payLoading: boolean;
}) {
  if (!itemCode) return null;
  if (!scheduledStart) return <p className="mt-1.5 text-[12px]" style={{ color: MUTED }}>Set a start time to resolve this item's price as of that date.</p>;
  if (resolving) return <p className="mt-1.5 text-[12px]" style={{ color: MUTED }}>Resolving price…</p>;
  if (!resolved) return null;
  const isFlat = resolved.unit === "E";
  const estimate = isFlat ? resolved.effective_price : hours != null ? resolved.effective_price * hours : null;
  const payDollars = pay?.pay_cents != null ? pay.pay_cents / 100 : null;
  const margin = estimate != null && payDollars != null ? estimate - payDollars : null;
  const payDayTypes = pay?.day_types ?? [];
  const dayTypeMismatch = !!resolved.day_type && payDayTypes.length > 0 && !payDayTypes.includes(resolved.day_type);
  return (
    <div className="mt-1.5 space-y-1 text-[12px]">
      <p className="font-semibold" style={{ color: TEXT }}>
        Estimated NDIS billing: {estimate != null ? `$${estimate.toFixed(2)}` : "—"}
        <span className="ml-1 font-normal" style={{ color: MUTED }}>
          {isFlat
            ? "(flat fee)"
            : hours != null
              ? `(${hours}h × $${resolved.effective_price.toFixed(2)}/hr, as of ${datetimeLocalValueToUtcIso(scheduledStart, participantZone).slice(0, 10)})`
              : "(set start and end to estimate)"}
          {resolved.day_type && ` — billed as ${resolved.day_type}${resolved.time_type ? ` ${resolved.time_type}` : ""}`}
        </span>
      </p>
      {showPay && (
        <p className="font-semibold" style={{ color: TEXT }}>
          {payLoading ? (
            <span className="font-normal" style={{ color: MUTED }}>Loading worker pay estimate…</span>
          ) : pay?.reason ? (
            <span className="font-normal" style={{ color: MUTED }}>Worker pay estimate unavailable ({pay.reason.replace(/_/g, " ")})</span>
          ) : payDollars != null ? (
            <>
              Projected worker pay: ${payDollars.toFixed(2)}
              {payDayTypes.length > 0 && <span className="ml-1 font-normal" style={{ color: MUTED }}>(paid as {payDayTypes.join(" + ")})</span>}
              {margin != null && (
                <span className="ml-1 font-normal" style={{ color: margin < 0 ? "#DC2626" : MUTED }}>
                  (margin: {margin < 0 ? "-" : ""}${Math.abs(margin).toFixed(2)}{margin < 0 ? " — this shift costs more than it bills" : ""})
                </span>
              )}
            </>
          ) : null}
        </p>
      )}
      {showPay && dayTypeMismatch && (
        <p className="flex items-start gap-1 text-[11px]" style={{ color: "#B45309" }}>
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          Billed as {resolved.day_type}, paid as {payDayTypes.join(" + ")} — NDIS and SCHADS day-types are classified independently.
        </p>
      )}
    </div>
  );
}
