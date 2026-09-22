import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
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
  getNdisGoals,
  getParticipantTasks,
  getAvailableWorkers,
  getParticipantPriceItemOptions,
  type WorkerStats,
  type NdisGoal,
  type ParticipantTask,
  type GoalsAndTasksValidation,
  type AssignShiftResult,
  type AvailableWorker,
  type AvailabilityStatus,
  type ShiftPriceItemOption,
} from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  datetimeLocalValueToUtcIso,
  formatAppTime,
  utcIsoToDatetimeLocalValue,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { DurationQuickPicks } from "@/components/ui/duration-quick-picks";
import { WorkerMatchBadge } from "@/components/coordinator/WorkerMatchBadge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Check, CheckCircle2, AlertTriangle, Loader2, User2,
  CalendarClock, ShieldCheck, CheckSquare, ChevronDown,
} from "lucide-react";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

type SearchableOption = {
  value: string;
  label: string;
  keywords?: string;
};

function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  renderTrigger,
  renderOption,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  renderTrigger?: (selected: SearchableOption | undefined) => ReactNode;
  renderOption?: (option: SearchableOption, selected: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-xl border bg-cc-surface px-3 py-2 text-sm text-cc-text shadow-sm outline-none focus:ring-1 focus:ring-ring"
          style={{ borderColor: BORDER }}
        >
          <span className={cn("truncate", !selected && "text-cc-muted")}>
            {renderTrigger
              ? renderTrigger(selected)
              : selected?.label ?? placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        style={{ borderColor: BORDER }}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.keywords ?? option.label}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                      {renderOption
                        ? renderOption(option, isSelected)
                        : option.label}
                    </span>
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const SHIFT_TYPE_KEYS: Record<string, string> = {
  standard_support: "coordinator.bulkShift.shiftType.standardSupport",
  community_access: "coordinator.bulkShift.shiftType.communityAccess",
  allied_health:    "coordinator.bulkShift.shiftType.alliedHealth",
  respite_care:     "coordinator.bulkShift.shiftType.respiteCare",
};

interface ShiftAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker?: WorkerStats | null;
  workers?: WorkerStats[];
  initialParticipantId?: string;
  initialDate?: string; // "YYYY-MM-DD" — pre-fills the start time to 08:00 on that date
}

export function ShiftAssignmentModal({
  open,
  onOpenChange,
  worker,
  workers = [],
  initialParticipantId,
  initialDate,
}: ShiftAssignmentModalProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc   = useQueryClient();
  const auth = useAuth();
  const user = auth?.user;
  const orgId = user?.organizationId ?? "__no_org__";

  // Hard gate: a worker who hasn't finished onboarding, or who has overdue
  // mandatory training, can't be rostered yet.
  const assignableWorkers = workers.filter((w) => w.onboarding_completed !== false && !w.training_overdue);
  const onboardingPendingCount = workers.filter((w) => w.onboarding_completed === false).length;
  const trainingOverdueCount = workers.filter((w) => w.onboarding_completed !== false && w.training_overdue).length;

  const [selectedWorkerId,      setSelectedWorkerId]      = useState(worker?.id ?? "");
  const [selectedParticipantId, setSelectedParticipantId] = useState(initialParticipantId ?? "");
  const [scheduledStart,        setScheduledStart]        = useState("");
  const [scheduledEnd,          setScheduledEnd]          = useState("");
  const [shiftType,             setShiftType]             = useState("standard_support");
  const [dutyType,              setDutyType]              = useState("disability_services");
  const [isSleepover,           setIsSleepover]           = useState(false);
  const [sleepoverStart,        setSleepoverStart]        = useState("");
  const [sleepoverEnd,          setSleepoverEnd]          = useState("");
  const [selectedTaskIds,       setSelectedTaskIds]       = useState<string[]>([]);
  const [isShadowShift,         setIsShadowShift]         = useState(false);
  const [shadowOfWorkerId,      setShadowOfWorkerId]      = useState("");
  const [expectedPriceItemCode, setExpectedPriceItemCode] = useState("");

  useEffect(() => {
    if (worker?.id) setSelectedWorkerId(worker.id);
  }, [worker?.id, open]);

  useEffect(() => {
    if (initialParticipantId) setSelectedParticipantId(initialParticipantId);
  }, [initialParticipantId, open]);

  useEffect(() => {
    if (open) setScheduledStart(initialDate ? `${initialDate}T08:00` : "");
  }, [initialDate, open]);

  const participants   = useGetParticipants();
  const { zoneFor }    = useBranches();
  const participantList     = (participants.data as Array<{ id: string; full_name: string; branch_id?: string | null }> | undefined) ?? [];
  // Times the coordinator types are wall-clock in the *participant's*
  // office, which may not be the coordinator's own (Adelaide HQ rostering
  // a Melbourne participant). Undefined → the coordinator's zone.
  const participantZone = zoneFor(participantList.find((p) => p.id === selectedParticipantId)?.branch_id);
  const credAlertsQuery = useOrgQuery([orgId, "coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
    staleTime: 5 * 60_000,
  });
  const credStatusQuery = useOrgQuery(
    [orgId, "coordinator-worker-credential-status", selectedWorkerId, shiftType],
    {
      queryFn: () => getCoordinatorWorkerCredentialStatus(selectedWorkerId, shiftType),
      staleTime: 60_000,
      enabled: Boolean(selectedWorkerId),
    }
  );

  // Ranked suggestions for the worker picker — sorts/badges by required-skill
  // coverage and availability, never a hard filter (every team member still
  // shows up). Needs at least a start time to say anything meaningful.
  const availableWorkersQuery = useOrgQuery<AvailableWorker[]>(
    [orgId, "coordinator-available-workers", selectedParticipantId, scheduledStart, scheduledEnd, isSleepover],
    {
      queryFn: () => getAvailableWorkers({
        shiftStart: datetimeLocalValueToUtcIso(scheduledStart, participantZone),
        shiftEnd: datetimeLocalValueToUtcIso(scheduledEnd || scheduledStart, participantZone),
        participantId: selectedParticipantId || undefined,
        isSleepover,
      }),
      enabled: !!scheduledStart,
      staleTime: 30_000,
    }
  );
  const workerMatchById = new Map((availableWorkersQuery.data ?? []).map((w) => [w.id, w]));

  // Best matches first: available > warning > unavailable, then preferred
  // availability, then name. Workers with no match data yet (still loading,
  // or no start time set) rank between available/warning — original order,
  // no visible reshuffle until real signal arrives.
  const matchStatusRank: Record<AvailabilityStatus, number> = { available: 0, warning: 1, unavailable: 2 };
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
    }
  );

  // Get goals and tasks for display
  const goalsQuery = useOrgQuery<NdisGoal[]>(
    [orgId, "shift-goals", selectedParticipantId],
    {
      queryFn: () => getNdisGoals({ participant_id: selectedParticipantId }),
      enabled: !!selectedParticipantId && goalsTasksCheckQuery.data?.has_valid,
    }
  );

  const tasksQuery = useOrgQuery<ParticipantTask[]>(
    [orgId, "shift-tasks", selectedParticipantId],
    {
      queryFn: () => getParticipantTasks(selectedParticipantId),
      enabled: !!selectedParticipantId && goalsTasksCheckQuery.data?.has_valid,
    }
  );

  const priceItemsQuery = useOrgQuery<ShiftPriceItemOption[]>(
    [orgId, "participant-price-items", selectedParticipantId],
    {
      queryFn: () => getParticipantPriceItemOptions(selectedParticipantId),
      enabled: !!selectedParticipantId,
      staleTime: 60_000,
    }
  );

  const assignMut = useMutation({
    mutationFn: async (): Promise<AssignShiftResult> => {
      const payload = {
        participant_id: selectedParticipantId,
        scheduled_start: datetimeLocalValueToUtcIso(scheduledStart, participantZone),
        scheduled_end: scheduledEnd ? datetimeLocalValueToUtcIso(scheduledEnd, participantZone) : undefined,
        shift_type: shiftType,
        duty_type: dutyType,
        is_sleepover: isSleepover,
        sleepover_start: isSleepover && sleepoverStart ? datetimeLocalValueToUtcIso(sleepoverStart, participantZone) : undefined,
        sleepover_end: isSleepover && sleepoverEnd ? datetimeLocalValueToUtcIso(sleepoverEnd, participantZone) : undefined,
        selected_task_ids: selectedTaskIds.length > 0 ? selectedTaskIds : undefined,
        expected_price_item_code: expectedPriceItemCode || undefined,
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
        credential_status: { valid: true, missing_credentials: [], warning: null },
        message: "Unassigned shift created",
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({
        title: selectedWorkerId ? translate("coordinator.shiftAssign.assigned") : translate("coordinator.shiftAssign.created"),
        description: selectedWorkerId
          ? translate("coordinator.shiftAssign.workerNotified")
          : translate("coordinator.shiftAssign.unassignedAdded"),
      });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: translate("coordinator.shiftAssign.failed"),
        description: error.message || translate("coordinator.shiftAssign.failedDesc"),
        variant: "destructive",
      });
    },
  });

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
  };

  const handleSetDuration = (hours: number) => {
    if (!scheduledStart) return;
    try {
      const startUtc = datetimeLocalValueToUtcIso(scheduledStart, participantZone);
      const endUtc = new Date(new Date(startUtc).getTime() + hours * 60 * 60 * 1000).toISOString();
      setScheduledEnd(utcIsoToDatetimeLocalValue(endUtc, participantZone));
    } catch {}
  };

  const activeDurationHours = (() => {
    if (!scheduledStart || !scheduledEnd) return null;
    try {
      const startMs = new Date(datetimeLocalValueToUtcIso(scheduledStart, participantZone)).getTime();
      const endMs = new Date(datetimeLocalValueToUtcIso(scheduledEnd, participantZone)).getTime();
      const diffHours = (endMs - startMs) / (60 * 60 * 1000);
      return Number.isInteger(diffHours) && diffHours > 0 ? diffHours : null;
    } catch {
      return null;
    }
  })();

  const selectedWorkerData  = workers.find((w) => w.id === selectedWorkerId);
  const workerAlerts        = (credAlertsQuery.data?.alerts ?? []).filter((a) => a.user_id === selectedWorkerId);
  const credStatus          = credStatusQuery.data?.credential_status;
  const hasExpired          = workerAlerts.some((a) => a.status === "expired");
  const hasExpiring         = workerAlerts.some((a) => a.status === "expiring");
  const hasBlock            = selectedWorkerId ? (credStatus ? !credStatus.valid : hasExpired) : false;
  const selectedParticipant = participantList.find((p) => p.id === selectedParticipantId);

  const goalsTasksValid = goalsTasksCheckQuery.data?.has_valid ?? false;
  const hasGoalsTasksError = !goalsTasksCheckQuery.isLoading && selectedParticipantId && !goalsTasksValid;

  const canSubmit = Boolean(
    selectedParticipantId &&
    scheduledStart &&
    (!selectedWorkerId || !hasBlock) &&
    (!isShadowShift || shadowOfWorkerId) &&
    (!isSleepover || (sleepoverStart && sleepoverEnd)) &&
    goalsTasksValid &&
    !assignMut.isPending
  );

  const credColor = credStatusQuery.isLoading ? MUTED : hasBlock ? "#DC2626" : hasExpiring ? "#D97706" : "#16A34A";
  const credLabel = credStatusQuery.isLoading
    ? translate("coordinator.shiftAssign.checkingCredentials")
    : hasBlock   ? translate("coordinator.shiftAssign.credentialsInvalid")
    : hasExpiring ? translate("coordinator.shiftAssign.credentialsExpiring")
    : translate("coordinator.shiftAssign.credentialsValid");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0 gap-0"
        style={{ borderColor: BORDER }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <SheetTitle className="text-[18px] font-black" style={{ color: PLUM }}>{translate("coordinator.shiftAssign.title")}</SheetTitle>
          <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
            {translate("coordinator.shiftAssign.subtitle")}
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Worker */}
          <div className="space-y-2">
            <label className="text-[12px] font-black flex items-center gap-2" style={{ color: TEXT }}>
              {translate("coordinator.shiftAssign.supportWorker")}
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>{translate("common.optional")}</span>
            </label>
            {worker ? (
              <div
                className="flex items-center justify-between rounded-xl border px-4 py-3"
                style={{ borderColor: BORDER, background: SOFT }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-9 w-9 rounded-full flex items-center justify-center text-[13px] font-black text-white"
                    style={{ background: PLUM }}
                  >
                    {worker.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-[13px] font-black" style={{ color: TEXT }}>{worker.full_name}</p>
                    {worker.avg_compliance != null && (
                      <p className="text-[11px]" style={{
                        color: worker.avg_compliance >= 85 ? "#16A34A" : worker.avg_compliance >= 60 ? "#D97706" : "#DC2626"
                      }}>
                        {translateParams("coordinator.shiftAssign.compliancePct", { pct: worker.avg_compliance.toFixed(0) })}
                      </p>
                    )}
                  </div>
                </div>
                <ShieldCheck size={16} style={{ color: "#16A34A" }} />
              </div>
            ) : (
              <SearchableSelect
                value={selectedWorkerId || "__unassigned__"}
                onValueChange={(val) => setSelectedWorkerId(val === "__unassigned__" ? "" : val)}
                placeholder={translate("coordinator.shiftAssign.unassigned")}
                searchPlaceholder={translate("coordinator.shiftAssign.searchWorker")}
                emptyText={translate("common.noResults")}
                options={[
                  {
                    value: "__unassigned__",
                    label: translate("coordinator.shiftAssign.unassigned"),
                    keywords: translate("coordinator.shiftAssign.unassigned"),
                  },
                  ...sortedAssignableWorkers.map((w) => ({
                    value: w.id,
                    label: w.full_name,
                    keywords: `${w.full_name} ${w.avg_compliance != null ? w.avg_compliance.toFixed(0) : ""}`,
                  })),
                ]}
                renderTrigger={(selected) => {
                  if (!selected || selected.value === "__unassigned__") {
                    return (
                      <span className="flex items-center gap-2" style={{ color: MUTED }}>
                        <User2 size={12} />
                        {translate("coordinator.shiftAssign.unassigned")}
                      </span>
                    );
                  }
                  const w = assignableWorkers.find((worker) => worker.id === selected.value);
                  return (
                    <span className="flex items-center gap-2">
                      <User2 size={12} />
                      {selected.label}
                      {w?.avg_compliance != null && (
                        <span className="text-[11px]" style={{ color: MUTED }}>
                          {w.avg_compliance.toFixed(0)}%
                        </span>
                      )}
                    </span>
                  );
                }}
                renderOption={(option) => {
                  if (option.value === "__unassigned__") {
                    return (
                      <span className="flex items-center gap-2" style={{ color: MUTED }}>
                        <User2 size={12} />
                        {option.label}
                      </span>
                    );
                  }
                  const w = assignableWorkers.find((worker) => worker.id === option.value);
                  return (
                    <span className="flex items-center justify-between gap-2 w-full">
                      <span className="flex items-center gap-2">
                        <User2 size={12} />
                        {option.label}
                        {w?.avg_compliance != null && (
                          <span className="text-[11px]" style={{ color: MUTED }}>
                            {w.avg_compliance.toFixed(0)}%
                          </span>
                        )}
                      </span>
                      <WorkerMatchBadge worker={workerMatchById.get(option.value)} />
                    </span>
                  );
                }}
              />
            )}
            {onboardingPendingCount > 0 && (
              <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
                {onboardingPendingCount === 1
                  ? translate("coordinator.shiftAssign.onboardingPendingOne")
                  : translateParams("coordinator.shiftAssign.onboardingPendingMany", { count: String(onboardingPendingCount) })}
              </p>
            )}
            {trainingOverdueCount > 0 && (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--cc-status-warning)" }}>
                {trainingOverdueCount === 1
                  ? translate("coordinator.shiftAssign.trainingOverdueOne")
                  : translateParams("coordinator.shiftAssign.trainingOverdueMany", { count: String(trainingOverdueCount) })}
              </p>
            )}
          </div>

          {/* Shadow shift — worker still does the shift themselves (same
              credential/training gates apply above); this just pairs them
              with a senior worker for support and marks it as supervised. */}
          {selectedWorkerId && (
            <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: BORDER }}>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-black" style={{ color: TEXT }}>
                <input
                  type="checkbox"
                  checked={isShadowShift}
                  onChange={(e) => {
                    setIsShadowShift(e.target.checked);
                    if (!e.target.checked) setShadowOfWorkerId("");
                  }}
                  className="h-4 w-4 rounded"
                />
                Shadow shift — pair with a senior worker
              </label>
              {isShadowShift && (
                <Select value={shadowOfWorkerId} onValueChange={setShadowOfWorkerId}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder="Who are they shadowing?" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableWorkers
                      .filter((w) => w.id !== selectedWorkerId)
                      .map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Sleepover - a continuous overnight stay is priced differently
              under SCHADS (a flat allowance plus overtime-rate call-outs,
              not ordinary continuous work) - see schads_engine.py. */}
          {selectedWorkerId && (
            <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: BORDER }}>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-black" style={{ color: TEXT }}>
                <input
                  type="checkbox"
                  checked={isSleepover}
                  onChange={(e) => setIsSleepover(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                {translate("coordinator.shiftAssign.sleepover")}
              </label>
              {isSleepover && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.sleepoverStart")}</label>
                    <DateTimePicker value={sleepoverStart} onChange={setSleepoverStart} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.sleepoverEnd")}</label>
                    <DateTimePicker value={sleepoverEnd} onChange={setSleepoverEnd} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Participant */}
          <div className="space-y-2">
            <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("common.participant")}</label>
            <SearchableSelect
              value={selectedParticipantId}
              onValueChange={setSelectedParticipantId}
              placeholder={translate("coordinator.shiftAssign.selectParticipant")}
              searchPlaceholder={translate("coordinator.shiftAssign.searchParticipant")}
              emptyText={translate("common.noResults")}
              options={participantList.map((p) => ({
                value: p.id,
                label: p.full_name,
              }))}
            />
          </div>

          {/* Goals & Tasks validation */}
          {selectedParticipantId && (
            <div
              className="rounded-xl border p-3.5"
              style={{
                borderColor: hasGoalsTasksError ? "#FECACA" : "#BBF7D0",
                background: hasGoalsTasksError ? "#FFF1F1" : "#F0FDF4",
              }}
            >
              <div className="flex items-start gap-2.5">
                {goalsTasksCheckQuery.isLoading ? (
                  <Loader2 size={14} className="mt-0.5 animate-spin" style={{ color: MUTED }} />
                ) : hasGoalsTasksError ? (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#DC2626" }} />
                ) : (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: "#16A34A" }} />
                )}
                <div className="flex-1">
                  <p
                    className="text-[12px] font-black"
                    style={{
                      color: hasGoalsTasksError ? "#DC2626" : "#16A34A",
                    }}
                  >
                    {goalsTasksCheckQuery.isLoading
                      ? translate("coordinator.shiftAssign.checkingGoals")
                      : hasGoalsTasksError
                      ? translate("coordinator.shiftAssign.noGoalsTasks")
                      : translate("coordinator.shiftAssign.goalsConfigured")}
                  </p>
                  {hasGoalsTasksError && (
                    <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                      This participant needs at least one NDIS goal with at least one task before creating a shift.{" "}
                      <Link href="/patients" className="font-bold underline" style={{ color: PLUM }}>
                        Set up goals now →
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Shift type */}
          {!hasGoalsTasksError && (
            <div className="space-y-2">
              <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.shiftType")}</label>
              <Select value={shiftType} onValueChange={setShiftType}>
                <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(SHIFT_TYPE_KEYS).map((value) => (
                    <SelectItem key={value} value={value}>{translate(SHIFT_TYPE_KEYS[value])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* SCHADS duty type - drives minimum-engagement pay rules, separate
              from the NDIS-facing shift type above. */}
          {!hasGoalsTasksError && (
            <div className="space-y-2">
              <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.dutyType")}</label>
              <Select value={dutyType} onValueChange={setDutyType}>
                <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disability_services">{translate("coordinator.shiftAssign.dutyType.disabilityServices")}</SelectItem>
                  <SelectItem value="general_sacs">{translate("coordinator.shiftAssign.dutyType.generalSacs")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date & time */}
          {!hasGoalsTasksError && (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>
                  {translate("coordinator.shiftAssign.start")} <ZoneLabel tz={participantZone} className="ml-1" />
                </label>
                <DateTimePicker
                  value={scheduledStart}
                  onChange={setScheduledStart}
                />
              </div>
              <DurationQuickPicks
                onSelect={handleSetDuration}
                activeHours={activeDurationHours}
                disabled={!scheduledStart}
              />
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.end")}</label>
                <DateTimePicker
                  value={scheduledEnd}
                  onChange={setScheduledEnd}
                />
              </div>
            </div>
          )}

          {/* Task selection */}
          {!hasGoalsTasksError && goalsTasksValid && (tasksQuery.data ?? []).length > 0 && (
            <div className="space-y-2">
              <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.tasksOptional")}</label>
              <p className="text-[11px]" style={{ color: MUTED }}>
                Select tasks for the worker to complete during this shift
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(goalsQuery.data ?? []).map((goal) => {
                  const goalTasks = (tasksQuery.data ?? []).filter((t) => t.goal_id === goal.id);
                  if (goalTasks.length === 0) return null;
                  return (
                    <div key={goal.id} className="space-y-1.5">
                      <p className="text-[11px] font-bold" style={{ color: TEXT }}>
                        {goal.name}
                      </p>
                      {goalTasks.map((task) => (
                        <label key={task.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.includes(task.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTaskIds((ids) => [...ids, task.id]);
                              } else {
                                setSelectedTaskIds((ids) => ids.filter((id) => id !== task.id));
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-[12px]" style={{ color: TEXT }}>
                            {task.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Expected NDIS item — recorded now, cross-checked against
              whatever's actually picked when the coordinator verifies this
              shift later (a mismatch warns but doesn't block). */}
          {!hasGoalsTasksError && selectedParticipantId && (
            <div className="space-y-2">
              <label className="text-[12px] font-black flex items-center gap-2" style={{ color: TEXT }}>
                Expected NDIS item
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>{translate("common.optional")}</span>
              </label>
              <Select
                value={expectedPriceItemCode || "__none__"}
                onValueChange={(val) => setExpectedPriceItemCode(val === "__none__" ? "" : val)}
                disabled={priceItemsQuery.isLoading}
              >
                <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue placeholder={priceItemsQuery.isLoading ? "Loading price items…" : "None recorded"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None recorded</SelectItem>
                  {(priceItemsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.item_code} value={p.item_code}>
                      {p.item_code}: {p.name || p.support_purpose || "Unnamed item"}
                      {p.price_national != null
                        ? p.unit === "E"
                          ? ` ($${p.price_national.toFixed(2)} flat)`
                          : ` ($${p.price_national.toFixed(2)}/hr)`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const selected = (priceItemsQuery.data ?? []).find((p) => p.item_code === expectedPriceItemCode);
                if (!selected || selected.price_national == null) return null;
                const isFlat = selected.unit === "E";
                const estimate = isFlat
                  ? selected.price_national
                  : activeDurationHours != null
                  ? selected.price_national * activeDurationHours
                  : null;
                return (
                  <p className="text-[12px] font-bold" style={{ color: TEXT }}>
                    Estimated cost: {estimate != null ? `$${estimate.toFixed(2)}` : "—"}
                    <span className="ml-1 font-normal" style={{ color: MUTED }}>
                      {isFlat
                        ? "(flat fee, not affected by shift duration)"
                        : activeDurationHours != null
                        ? `(${activeDurationHours}h × $${selected.price_national.toFixed(2)}/hr)`
                        : "(set start and end time to estimate)"}
                    </span>
                  </p>
                );
              })()}
              <p className="text-[11px]" style={{ color: MUTED }}>
                What this shift should be billed under. If a different item is picked at verification, the coordinator sees a warning — it won't block them.
              </p>
            </div>
          )}

          {/* Credential status */}
          {selectedWorkerId && !hasGoalsTasksError && (
            <div
              className="rounded-xl border p-3.5"
              style={{
                borderColor: hasBlock ? "#FECACA" : hasExpiring ? "#FDE68A" : "#BBF7D0",
                background:  hasBlock ? "#FFF1F1" : hasExpiring ? "#FFFBEB" : "#F0FDF4",
              }}
            >
              <div className="flex items-start gap-2.5">
                {credStatusQuery.isLoading ? (
                  <Loader2 size={14} className="mt-0.5 animate-spin" style={{ color: MUTED }} />
                ) : hasBlock ? (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#DC2626" }} />
                ) : (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: credColor }} />
                )}
                <div>
                  <p className="text-[12px] font-black" style={{ color: credColor }}>{credLabel}</p>
                  {credStatus?.warning && (
                    <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{credStatus.warning}</p>
                  )}
                  {(credStatus?.missing_credentials ?? []).length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {credStatus!.missing_credentials.slice(0, 4).map((c) => (
                        <p key={c} className="text-[11px] font-medium" style={{ color: "#991B1B" }}>✗ {c}</p>
                      ))}
                    </div>
                  )}
                  {workerAlerts.length > 0 && !hasBlock && (
                    <div className="mt-2 space-y-0.5">
                      {workerAlerts.slice(0, 3).map((a) => (
                        <p key={`${a.credential_id ?? a.credential_type}`} className="text-[11px]" style={{ color: "#92400E" }}>
                          {a.title || a.credential_type || translate("coordinator.shiftAssign.credential")} ({a.status})
                          {a.expiry_date ? ` (${translateParams("coordinator.shiftAssign.expires", { date: a.expiry_date })})` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Summary */}
          {selectedParticipant && scheduledStart && !hasGoalsTasksError && (
            <div className="rounded-xl border p-3.5" style={{ borderColor: BORDER, background: SOFT }}>
              <p className="text-[11px] font-black uppercase tracking-widest mb-2.5" style={{ color: MUTED }}>{translate("coordinator.shiftAssign.shiftSummary")}</p>
              <div className="space-y-1.5 text-[12px]">
                {([
                  [translate("common.worker"),      selectedWorkerData?.full_name ?? translate("coordinator.shiftAssign.unassigned")],
                  [translate("common.participant"), selectedParticipant.full_name],
                  [translate("coordinator.shiftAssign.type"),        translate(SHIFT_TYPE_KEYS[shiftType] ?? shiftType)],
                  [translate("coordinator.shiftAssign.start"),       `${format(new Date(datetimeLocalValueToUtcIso(scheduledStart, participantZone)), "d MMM yyyy")} ${formatAppTime(datetimeLocalValueToUtcIso(scheduledStart, participantZone), participantZone)}`],
                  ...(scheduledEnd ? [[translate("coordinator.shiftAssign.end"), `${format(new Date(datetimeLocalValueToUtcIso(scheduledEnd, participantZone)), "d MMM yyyy")} ${formatAppTime(datetimeLocalValueToUtcIso(scheduledEnd, participantZone), participantZone)}`] as [string, string]] : []),
                  ...(selectedTaskIds.length > 0
                    ? [[
                        translate("coordinator.shiftAssign.tasksOptional").split(" (")[0],
                        translateParams("coordinator.shiftAssign.tasksSelected", { count: String(selectedTaskIds.length) }),
                      ]]
                    : []),
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4">
                    <span style={{ color: MUTED }}>{label}</span>
                    <span
                      className="font-bold text-right"
                      style={{ color: label === "Worker" && !selectedWorkerData ? MUTED : TEXT }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 shrink-0"
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={assignMut.isPending}
            className="rounded-full"
          >
            Cancel
          </Button>
          <Button
            onClick={() => assignMut.mutate()}
            disabled={!canSubmit}
            className="rounded-full text-white flex items-center gap-2"
            style={{ background: canSubmit ? PLUM : MUTED }}
          >
            {assignMut.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {selectedWorkerId ? translate("coordinator.shiftAssign.assigning") : translate("coordinator.shiftAssign.creating")}</>
            ) : hasGoalsTasksError ? (
              <><AlertTriangle size={14} /> {translate("coordinator.shiftAssign.setupGoalsFirst")}</>
            ) : hasBlock ? (
              <><AlertTriangle size={14} /> {translate("coordinator.shiftAssign.credentialsRequired")}</>
            ) : selectedWorkerId ? (
              <><CalendarClock size={14} /> {translate("coordinator.shiftAssign.assignShift")}</>
            ) : (
              <><CalendarClock size={14} /> {translate("coordinator.shiftAssign.createUnassigned")}</>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
