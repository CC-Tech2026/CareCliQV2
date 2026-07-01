import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, ChevronDown, ChevronUp, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  createParticipantTask,
  updateParticipantTask,
  deleteParticipantTask,
  type ParticipantTask,
  type NdisGoal,
} from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  pending:     { color: "#D97706", bg: "#FFFBEB" },
  in_progress: { color: "#2563EB", bg: "#EFF6FF" },
  completed:   { color: "#059669", bg: "#ECFDF5" },
};

interface TaskFormModalProps {
  goal: NdisGoal;
  task: ParticipantTask | null;
  onClose: () => void;
  onSaved: () => void;
}

function TaskFormModal({ goal, task, onClose, onSaved }: TaskFormModalProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: task?.name ?? "",
    description: task?.description ?? "",
    frequency: task?.frequency ?? "",
    status: task?.status ?? ("pending" as const),
  });

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        goal_id: goal.id,
        goal_name: goal.name,
        name: form.name,
        description: form.description || undefined,
        frequency: form.frequency || undefined,
        status: form.status,
      };
      return task
        ? updateParticipantTask(task.id, payload)
        : createParticipantTask(goal.participant_id, payload);
    },
    onSuccess: () => {
      toast({ title: task ? translate("coordinator.taskMgmt.updated") : translate("coordinator.taskMgmt.created") });
      onSaved();
      onClose();
    },
    onError: () => toast({ variant: "destructive", title: translate("coordinator.taskMgmt.saveFailed") }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,24,39,0.35)" }}>
      <div className="w-full max-w-lg rounded-3xl p-6 space-y-4 overflow-y-auto bg-white" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-black text-[16px]" style={{ color: TEXT }}>
            {task ? translate("coordinator.taskMgmt.editTask") : translate("coordinator.taskMgmt.newTask")}
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" title={translate("common.close")}>
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translateParams("coordinator.taskTemplate.goalLabel", { name: goal.name })}</Label>
          <p className="text-[12px]" style={{ color: MUTED }}>{goal.description}</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskMgmt.taskName")}</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={translate("coordinator.taskMgmt.taskNamePlaceholder")}
            className="rounded-xl h-9 text-[13px]"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.description")}</Label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            placeholder={translate("coordinator.taskTemplate.descriptionPlaceholder")}
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskMgmt.frequency")}</Label>
          <Input
            value={form.frequency}
            onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
            placeholder={translate("coordinator.taskMgmt.frequencyPlaceholder")}
            className="rounded-xl h-9 text-[13px]"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskMgmt.status")}</Label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
            className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            aria-label={translate("coordinator.taskMgmt.status")}
          >
            <option value="pending">{translate("coordinator.taskMgmt.status.pending")}</option>
            <option value="in_progress">{translate("coordinator.taskMgmt.status.inProgress")}</option>
            <option value="completed">{translate("coordinator.taskMgmt.status.completed")}</option>
          </select>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1 rounded-xl" style={{ borderColor: BORDER }} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl"
            style={{ background: PLUM, color: "#fff" }}
            disabled={!form.name.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? translate("common.saving") : task ? translate("coordinator.taskMgmt.updateTask") : translate("coordinator.taskMgmt.createTask")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface GoalTasksAccordionProps {
  goal: NdisGoal;
  tasks: ParticipantTask[];
  onTasksChanged: () => void;
}

function GoalTasksAccordion({ goal, tasks, onTasksChanged }: GoalTasksAccordionProps) {
  const { translate, translateParams } = useAccessibility();
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<ParticipantTask | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const goalTasks = tasks.filter((t) => t.goal_id === goal.id);
  const completedCount = goalTasks.filter((t) => t.status === "completed").length;
  const progress = goalTasks.length > 0 ? Math.round((completedCount / goalTasks.length) * 100) : 0;

  const deleteMut = useMutation({
    mutationFn: deleteParticipantTask,
    onSuccess: () => {
      toast({ title: translate("coordinator.taskMgmt.deleted") });
      onTasksChanged();
    },
    onError: () => toast({ variant: "destructive", title: translate("coordinator.taskMgmt.deleteFailed") }),
  });

  return (
    <div className="rounded-xl border" style={{ borderColor: BORDER }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50"
      >
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-bold text-[13px]" style={{ color: TEXT }}>
              {goal.name}
            </p>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: SOFT, color: PLUM }}>
              {goalTasks.length === 1 ? translateParams("coordinator.taskMgmt.taskCount", { count: String(goalTasks.length) }) : translateParams("coordinator.taskMgmt.taskCountPlural", { count: String(goalTasks.length) })}
            </span>
          </div>
          {goalTasks.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER, width: 60 }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress}%`,
                    background: progress === 100 ? "#059669" : progress >= 50 ? "#3B82F6" : "#D97706",
                  }}
                />
              </div>
              <span style={{ color: MUTED }}>
                {translateParams("coordinator.taskMgmt.doneProgress", { done: String(completedCount), total: String(goalTasks.length) })}
              </span>
            </div>
          )}
        </div>
        {open ? (
          <ChevronUp size={16} style={{ color: MUTED }} className="ml-2 shrink-0" />
        ) : (
          <ChevronDown size={16} style={{ color: MUTED }} className="ml-2 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t p-4 space-y-3" style={{ borderColor: BORDER }}>
          {goalTasks.length === 0 ? (
            <p className="text-center text-[12px]" style={{ color: MUTED }}>
              No tasks yet
            </p>
          ) : (
            goalTasks.map((task) => {
              const statusMeta = STATUS_COLORS[task.status] ?? STATUS_COLORS.pending;
              return (
                <div
                  key={task.id}
                  className="flex items-start justify-between rounded-lg p-3"
                  style={{ background: SOFT }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-[13px]" style={{ color: TEXT }}>
                        {task.name}
                      </p>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
                        style={{ background: statusMeta.bg, color: statusMeta.color }}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-[11px]" style={{ color: MUTED }}>
                        {task.description}
                      </p>
                    )}
                    {task.frequency && (
                      <p className="text-[10px] mt-1" style={{ color: MUTED }}>
                        {translateParams("coordinator.taskMgmt.frequencyLabel", { value: task.frequency })}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <button
                      className="p-1.5 rounded-lg hover:bg-white transition-colors"
                      onClick={() => {
                        setEditTask(task);
                        setFormOpen(true);
                      }}
                      title={translate("common.edit")}
                    >
                      <Edit2 size={12} style={{ color: MUTED }} />
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-white transition-colors"
                      onClick={() => deleteMut.mutate(task.id)}
                      title={translate("common.delete")}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 size={12} style={{ color: CORAL }} />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <Button
            size="sm"
            variant="outline"
            className="w-full rounded-lg text-xs gap-1 mt-2"
            style={{ borderColor: BORDER, color: PLUM }}
            onClick={() => {
              setEditTask(null);
              setFormOpen(true);
            }}
          >
            <Plus size={13} /> {translate("coordinator.taskMgmt.addTask")}
          </Button>

          {formOpen && (
            <TaskFormModal
              goal={goal}
              task={editTask}
              onClose={() => {
                setFormOpen(false);
                setEditTask(null);
              }}
              onSaved={onTasksChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface TaskManagementPanelProps {
  goal: NdisGoal;
  tasks: ParticipantTask[];
  onTasksChanged: () => void;
}

export function TaskManagementPanel({
  goal,
  tasks,
  onTasksChanged,
}: TaskManagementPanelProps) {
  return (
    <GoalTasksAccordion goal={goal} tasks={tasks} onTasksChanged={onTasksChanged} />
  );
}
