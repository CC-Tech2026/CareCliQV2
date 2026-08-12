import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
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
  type WorkerStats,
  type NdisGoal,
  type ParticipantTask,
  type GoalsAndTasksValidation,
  type AssignShiftResult,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
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

  // Hard gate: a worker who hasn't finished onboarding can't be rostered yet.
  const assignableWorkers = workers.filter((w) => w.onboarding_completed !== false);
  const onboardingPendingCount = workers.length - assignableWorkers.length;

  const [selectedWorkerId,      setSelectedWorkerId]      = useState(worker?.id ?? "");
  const [selectedParticipantId, setSelectedParticipantId] = useState(initialParticipantId ?? "");
  const [scheduledStart,        setScheduledStart]        = useState("");
  const [scheduledEnd,          setScheduledEnd]          = useState("");
  const [shiftType,             setShiftType]             = useState("standard_support");
  const [selectedTaskIds,       setSelectedTaskIds]       = useState<string[]>([]);

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

  const assignMut = useMutation({
    mutationFn: async (): Promise<AssignShiftResult> => {
      const payload = {
        participant_id: selectedParticipantId,
        scheduled_start: datetimeLocalValueToUtcIso(scheduledStart),
        scheduled_end: scheduledEnd ? datetimeLocalValueToUtcIso(scheduledEnd) : undefined,
        shift_type: shiftType,
        selected_task_ids: selectedTaskIds.length > 0 ? selectedTaskIds : undefined,
      };
      if (selectedWorkerId) {
        return assignShift({ ...payload, worker_id: selectedWorkerId });
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
  };

  const handleQuickEnd = () => {
    if (!scheduledStart) return;
    try {
      const startUtc = datetimeLocalValueToUtcIso(scheduledStart);
      const endUtc = new Date(new Date(startUtc).getTime() + 4 * 60 * 60 * 1000).toISOString();
      setScheduledEnd(utcIsoToDatetimeLocalValue(endUtc));
    } catch {}
  };

  const selectedWorkerData  = workers.find((w) => w.id === selectedWorkerId);
  const workerAlerts        = (credAlertsQuery.data?.alerts ?? []).filter((a) => a.user_id === selectedWorkerId);
  const credStatus          = credStatusQuery.data?.credential_status;
  const hasExpired          = workerAlerts.some((a) => a.status === "expired");
  const hasExpiring         = workerAlerts.some((a) => a.status === "expiring");
  const hasBlock            = selectedWorkerId ? (credStatus ? !credStatus.valid : hasExpired) : false;
  const participantList     = (participants.data as Array<{ id: string; full_name: string }> | undefined) ?? [];
  const selectedParticipant = participantList.find((p) => p.id === selectedParticipantId);

  const goalsTasksValid = goalsTasksCheckQuery.data?.has_valid ?? false;
  const hasGoalsTasksError = !goalsTasksCheckQuery.isLoading && selectedParticipantId && !goalsTasksValid;

  const canSubmit = Boolean(
    selectedParticipantId &&
    scheduledStart &&
    (!selectedWorkerId || !hasBlock) &&
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg rounded-2xl p-0 overflow-hidden gap-0"
        style={{ borderColor: BORDER }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <h2 className="text-[18px] font-black" style={{ color: PLUM }}>{translate("coordinator.shiftAssign.title")}</h2>
          <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
            {translate("coordinator.shiftAssign.subtitle")}
          </p>
        </div>

        {/* Scrollable body */}
        <div className="max-h-[68vh] overflow-y-auto px-6 py-5 space-y-5">
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
                  ...assignableWorkers.map((w) => ({
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
                    <span className="flex items-center gap-2">
                      <User2 size={12} />
                      {option.label}
                      {w?.avg_compliance != null && (
                        <span className="text-[11px]" style={{ color: MUTED }}>
                          {w.avg_compliance.toFixed(0)}%
                        </span>
                      )}
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
          </div>

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

          {/* Date & time */}
          {!hasGoalsTasksError && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.start")}</label>
                <Input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(e) => setScheduledStart(e.target.value)}
                  className="rounded-xl"
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.shiftAssign.end")}</label>
                  {scheduledStart && !scheduledEnd && (
                    <button type="button" onClick={handleQuickEnd} className="text-[11px] font-bold" style={{ color: PLUM }}>
                      +4 hrs
                    </button>
                  )}
                </div>
                <Input
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={(e) => setScheduledEnd(e.target.value)}
                  className="rounded-xl"
                  style={{ borderColor: BORDER }}
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
                  [translate("coordinator.shiftAssign.start"),       `${format(new Date(datetimeLocalValueToUtcIso(scheduledStart)), "d MMM yyyy")} ${formatAppTime(datetimeLocalValueToUtcIso(scheduledStart))}`],
                  ...(scheduledEnd ? [[translate("coordinator.shiftAssign.end"), `${format(new Date(datetimeLocalValueToUtcIso(scheduledEnd)), "d MMM yyyy")} ${formatAppTime(datetimeLocalValueToUtcIso(scheduledEnd))}`] as [string, string]] : []),
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
          className="flex items-center justify-end gap-3 px-6 py-4"
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
      </DialogContent>
    </Dialog>
  );
}
