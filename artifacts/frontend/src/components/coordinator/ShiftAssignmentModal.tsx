import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addHours } from "date-fns";
import { Link } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  assignShift,
  getCoordinatorCredentialAlerts,
  getCoordinatorWorkerCredentialStatus,
  checkParticipantGoalsAndTasks,
  getNdisGoals,
  getParticipantTasks,
  getTaskTemplates,
  getShiftSuggestions,
  type WorkerStats,
  type NdisGoal,
  type ParticipantTask,
  type GoalsAndTasksValidation,
  type TaskTemplate,
  type TaskTemplatesResponse,
  type ShiftAnalytics,
} from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  CheckCircle2, AlertTriangle, Loader2, User2,
  CalendarClock, ShieldCheck, CheckSquare, ChevronDown,
  Zap, Link2, Brain, Lightbulb,
} from "lucide-react";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const SHIFT_TYPE_LABELS: Record<string, string> = {
  standard_support: "Standard Support",
  community_access: "Community Access",
  allied_health:    "Allied Health Session",
  respite_care:     "Respite Care",
};

interface ShiftAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker?: WorkerStats | null;
  workers?: WorkerStats[];
}

export function ShiftAssignmentModal({
  open,
  onOpenChange,
  worker,
  workers = [],
}: ShiftAssignmentModalProps) {
  const { toast } = useToast();
  const qc   = useQueryClient();
  const auth = useAuth();
  const user = auth?.user;
  const orgId = user?.organizationId ?? "__no_org__";

  const [selectedWorkerId,      setSelectedWorkerId]      = useState(worker?.id ?? "");
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [scheduledStart,        setScheduledStart]        = useState("");
  const [scheduledEnd,          setScheduledEnd]          = useState("");
  const [shiftType,             setShiftType]             = useState("standard_support");
  const [selectedTaskIds,       setSelectedTaskIds]       = useState<string[]>([]);
  const [showAiSuggestions,     setShowAiSuggestions]     = useState(false);

  useEffect(() => {
    if (worker?.id) setSelectedWorkerId(worker.id);
  }, [worker?.id, open]);

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

  // Fetch task templates to show preview of matching tasks
  const taskTemplatesQuery = useOrgQuery<TaskTemplatesResponse>(
    [orgId, "shift-task-templates", selectedParticipantId],
    {
      queryFn: () => getTaskTemplates(selectedParticipantId),
      enabled: !!selectedParticipantId && goalsTasksCheckQuery.data?.has_valid,
    }
  );

  // Fetch AI suggestions when user requests them
  const aiSuggestionsQuery = useOrgQuery<ShiftAnalytics>(
    [orgId, "shift-ai-suggestions", selectedParticipantId, selectedWorkerId, shiftType],
    {
      queryFn: () =>
        getShiftSuggestions({
          participant_id: selectedParticipantId,
          worker_id: selectedWorkerId || "unassigned",
          shift_type: shiftType,
          goal_ids: goalsQuery.data?.map((g) => g.id) || [],
        }),
      staleTime: 2 * 60_000,  // Cache for 2 min
      enabled: showAiSuggestions && !!selectedParticipantId && goalsTasksCheckQuery.data?.has_valid,
    }
  );

  // Filter templates by shift type to show preview
  const matchingTemplates = (templates: TaskTemplate[]) => {
    return templates.filter((t) => {
      if (!t.primary_shift_type) return false;
      if (t.primary_shift_type === shiftType) return true;
      if ((t.additional_shift_types ?? []).includes(shiftType)) return true;
      return false;
    });
  };

  const allTemplates = [
    ...(taskTemplatesQuery.data?.default_tasks ?? []),
    ...(taskTemplatesQuery.data?.custom_tasks ?? []),
  ];
  const previewMatching = matchingTemplates(allTemplates);

  const assignMut = useMutation({
    mutationFn: () =>
      assignShift({
        worker_id:       selectedWorkerId || undefined,
        participant_id:  selectedParticipantId,
        scheduled_start: scheduledStart,
        scheduled_end:   scheduledEnd || undefined,
        shift_type:      shiftType,
        selected_task_ids: selectedTaskIds.length > 0 ? selectedTaskIds : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({
        title: selectedWorkerId ? "Shift assigned" : "Shift created",
        description: selectedWorkerId
          ? "Worker has been notified of the new shift."
          : "Unassigned shift added to the roster.",
      });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to assign shift",
        description: error.message || "Please check the details and try again.",
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
      const end = addHours(new Date(scheduledStart), 4);
      setScheduledEnd(end.toISOString().slice(0, 16));
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
    ? "Checking credentials…"
    : hasBlock   ? "Credentials invalid — cannot assign"
    : hasExpiring ? "Credentials expiring soon"
    : "Credentials valid";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg rounded-2xl p-0 overflow-hidden gap-0"
        style={{ borderColor: BORDER }}
      >
        {/* Header — Required for accessibility */}
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <DialogTitle className="text-[18px] font-black" style={{ color: PLUM }}>
            Create Shift
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
            Schedule a new shift. Assign a worker now or leave unassigned for later.
          </DialogDescription>
        </div>

        {/* Scrollable body */}
        <div className="max-h-[68vh] overflow-y-auto px-6 py-5 space-y-5">
          {/* Worker */}
          <div className="space-y-2">
            <label className="text-[12px] font-black flex items-center gap-2" style={{ color: TEXT }}>
              Support Worker
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>optional</span>
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
                        {worker.avg_compliance.toFixed(0)}% compliance
                      </p>
                    )}
                  </div>
                </div>
                <ShieldCheck size={16} style={{ color: "#16A34A" }} />
              </div>
            ) : (
              <Select
                value={selectedWorkerId || "__unassigned__"}
                onValueChange={(val) => setSelectedWorkerId(val === "__unassigned__" ? "" : val)}
              >
                <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">
                    <span className="flex items-center gap-2" style={{ color: MUTED }}>
                      <User2 size={12} />
                      Unassigned
                    </span>
                  </SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="flex items-center gap-2">
                        <User2 size={12} />
                        {w.full_name}
                        {w.avg_compliance != null && (
                          <span className="text-[11px]" style={{ color: MUTED }}>
                            {w.avg_compliance.toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Participant */}
          <div className="space-y-2">
            <label className="text-[12px] font-black" style={{ color: TEXT }}>Participant</label>
            <Select value={selectedParticipantId} onValueChange={setSelectedParticipantId}>
              <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                <SelectValue placeholder="Select a participant…" />
              </SelectTrigger>
              <SelectContent>
                {participantList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                      ? "Checking goals & tasks…"
                      : hasGoalsTasksError
                      ? "No NDIS goals or tasks set up"
                      : "Goals & tasks configured"}
                  </p>
                  {hasGoalsTasksError && (
                    <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                      This participant needs at least one NDIS goal with at least one task before creating a shift.{" "}
                      <Link href="/coordinator-goals" className="font-bold underline" style={{ color: PLUM }}>
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
              <label className="text-[12px] font-black" style={{ color: TEXT }}>Shift Type</label>
              <Select value={shiftType} onValueChange={setShiftType}>
                <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SHIFT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Task Preview — shows which recurring tasks will auto-attach */}
          {!hasGoalsTasksError && shiftType && taskTemplatesQuery.data && (
            <div className="rounded-xl border p-3.5" style={{ borderColor: BORDER, background: SOFT }}>
              <div className="flex items-start gap-2.5">
                <Zap size={14} className="mt-1 shrink-0" style={{ color: PLUM }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-black" style={{ color: TEXT }}>
                    {previewMatching.length === 0 ? "No tasks will attach" : `${previewMatching.length} task${previewMatching.length !== 1 ? "s" : ""} will attach to this shift`}
                  </p>
                  {previewMatching.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      {previewMatching.map((template) => {
                        const linkedGoalIds = template.linked_goal_ids ?? (template.linked_goal_id ? [template.linked_goal_id] : []);
                        const linkedGoalNames = linkedGoalIds
                          .map((gid) => goalsQuery.data?.find((g) => g.id === gid)?.name)
                          .filter(Boolean);
                        return (
                          <div key={template.id} className="text-[11px]">
                            <div className="flex items-start gap-1.5">
                              <CheckCircle2 size={12} className="mt-0.5 shrink-0" style={{ color: "#16A34A" }} />
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold" style={{ color: TEXT }}>{template.name}</p>
                                {linkedGoalNames.length > 0 && (
                                  <p className="text-[10px] mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: MUTED }}>
                                    <Link2 size={10} />
                                    {linkedGoalNames.join(", ")}
                                  </p>
                                )}
                                {template.is_mandatory && (
                                  <p className="text-[10px] mt-0.5" style={{ color: CORAL }}>🔴 Mandatory</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] mt-2.5" style={{ color: MUTED }}>Based on recurring task templates for {selectedParticipant?.full_name}</p>
                </div>
              </div>
            </div>
          )}

          {/* AI Suggestions — powered by RAG + historical data */}
          {!hasGoalsTasksError && selectedParticipantId && (
            <div className="rounded-xl border p-3.5" style={{ borderColor: BORDER, background: SOFT }}>
              <button
                type="button"
                onClick={() => setShowAiSuggestions(!showAiSuggestions)}
                className="w-full flex items-start gap-2.5 hover:opacity-80 transition-opacity"
              >
                <Brain size={14} className="mt-1 shrink-0" style={{ color: "#8B5CF6" }} />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[12px] font-black" style={{ color: TEXT }}>
                    AI Shift Suggestions
                    <span className="ml-2 text-[10px] font-normal" style={{ color: MUTED }}>
                      {aiSuggestionsQuery.isLoading ? "Loading…" : showAiSuggestions ? "Hide" : "View"}
                    </span>
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>
                    Recommendations based on past shifts and goals for this participant
                  </p>
                </div>
                <ChevronDown size={14} className="mt-1 shrink-0" style={{ transform: showAiSuggestions ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
              </button>

              {/* Suggestions Panel */}
              {showAiSuggestions && (
                <div className="mt-3.5 space-y-3 pt-3.5 border-t" style={{ borderColor: BORDER }}>
                  {aiSuggestionsQuery.isLoading && (
                    <div className="flex items-center justify-center gap-2 py-4">
                      <Loader2 size={14} className="animate-spin" style={{ color: PLUM }} />
                      <p className="text-[11px]" style={{ color: MUTED }}>Analyzing shift patterns…</p>
                    </div>
                  )}

                  {aiSuggestionsQuery.isError && (
                    <p className="text-[11px]" style={{ color: CORAL }}>Could not load suggestions. Please try again.</p>
                  )}

                  {aiSuggestionsQuery.data && !aiSuggestionsQuery.isLoading && (
                    <>
                      {/* Recommended Tasks */}
                      {aiSuggestionsQuery.data.recommended_tasks && aiSuggestionsQuery.data.recommended_tasks.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold" style={{ color: TEXT }}>📋 Recommended Tasks</p>
                          <div className="space-y-1.5">
                            {aiSuggestionsQuery.data.recommended_tasks.map((task: any, idx: number) => (
                              <div key={idx} className="text-[10px] p-2 rounded-lg" style={{ background: "rgba(139, 92, 246, 0.1)" }}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold" style={{ color: TEXT }}>{task.task_name}</p>
                                    <p className="text-[9px] mt-0.5" style={{ color: MUTED }}>{task.reason}</p>
                                  </div>
                                  <span className="text-[11px] font-black px-2 py-0.5 rounded bg-white" style={{ color: "#8B5CF6" }}>
                                    {Math.round(task.confidence * 100)}%
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Goal Focus Areas */}
                      {aiSuggestionsQuery.data.goal_focus_areas && aiSuggestionsQuery.data.goal_focus_areas.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold" style={{ color: TEXT }}>🎯 Focus Areas</p>
                          <div className="space-y-1">
                            {aiSuggestionsQuery.data.goal_focus_areas.map((area: any, idx: number) => (
                              <div key={idx} className="text-[10px]">
                                <p className="font-semibold" style={{ color: TEXT }}>{area.goal_name}</p>
                                <p className="text-[9px]" style={{ color: MUTED }}>{area.rationale}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Shift Insights */}
                      {aiSuggestionsQuery.data.shift_insights && (
                        <div className="text-[10px] p-2 rounded-lg" style={{ background: "rgba(34, 197, 94, 0.1)", borderLeft: `3px solid #16A34A` }}>
                          <p style={{ color: "#166534" }}>{aiSuggestionsQuery.data.shift_insights}</p>
                        </div>
                      )}

                      {/* Risk Flags */}
                      {aiSuggestionsQuery.data.risk_flags && aiSuggestionsQuery.data.risk_flags.length > 0 && (
                        <div className="space-y-1 pt-2 border-t" style={{ borderColor: BORDER }}>
                          <p className="text-[11px] font-semibold flex items-center gap-1" style={{ color: CORAL }}>
                            <AlertTriangle size={12} />
                            Alerts
                          </p>
                          <div className="space-y-1">
                            {aiSuggestionsQuery.data.risk_flags.map((flag: string, idx: number) => (
                              <p key={idx} className="text-[10px]" style={{ color: MUTED }}>• {flag}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Date & time */}
          {!hasGoalsTasksError && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>Start</label>
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
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>End</label>
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
              <label className="text-[12px] font-black" style={{ color: TEXT }}>Tasks to work on (optional)</label>
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
                          {a.title || a.credential_type || "Credential"} – {a.status}
                          {a.expiry_date ? ` (expires ${a.expiry_date})` : ""}
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
              <p className="text-[11px] font-black uppercase tracking-widest mb-2.5" style={{ color: MUTED }}>Shift Summary</p>
              <div className="space-y-1.5 text-[12px]">
                {([
                  ["Worker",      selectedWorkerData?.full_name ?? "Unassigned"],
                  ["Participant", selectedParticipant.full_name],
                  ["Type",        SHIFT_TYPE_LABELS[shiftType] || shiftType],
                  ["Start",       format(new Date(scheduledStart), "d MMM yyyy h:mm a")],
                  ...(scheduledEnd ? [["End", format(new Date(scheduledEnd), "d MMM yyyy h:mm a")] as [string, string]] : []),
                  ...(selectedTaskIds.length > 0 ? [["Tasks", `${selectedTaskIds.length} selected`] as [string, string]] : []),
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
              <><Loader2 className="h-4 w-4 animate-spin" /> {selectedWorkerId ? "Assigning…" : "Creating…"}</>
            ) : hasGoalsTasksError ? (
              <><AlertTriangle size={14} /> Set Up Goals First</>
            ) : hasBlock ? (
              <><AlertTriangle size={14} /> Credentials Required</>
            ) : selectedWorkerId ? (
              <><CalendarClock size={14} /> Assign Shift</>
            ) : (
              <><CalendarClock size={14} /> Create Unassigned Shift</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
