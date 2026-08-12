import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getParticipantTasks,
  type ParticipantTask,
} from "@/services/coordinatorService";

type Props = {
  participantId: string;
  onCreateNew?: () => void;
  onEditTemplate?: (_template: never) => void;
};

export function TaskManagementView({ participantId, onCreateNew, onEditTemplate }: Props) {
  void onEditTemplate;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery<ParticipantTask[]>({
    queryKey: ["participant-tasks", participantId],
    queryFn: () => getParticipantTasks(participantId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  const activeTasks = tasks.filter((task) => task.status !== "completed");
  const completedTasks = tasks.filter((task) => task.status === "completed");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Tasks</h3>
        <Button onClick={onCreateNew} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Task
        </Button>
      </div>

      {/* Active Tasks */}
      {activeTasks.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Active</h4>
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isExpanded={expandedId === task.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === task.id ? null : task.id)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-500">Completed</h4>
          <div className="space-y-2 opacity-75">
            {completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isExpanded={expandedId === task.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === task.id ? null : task.id)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="rounded bg-gray-50 p-8 text-center">
          <p className="text-sm text-gray-500">No tasks yet.</p>
          <Button onClick={onCreateNew} variant="outline" size="sm" className="mt-4 gap-2">
            <Plus className="h-4 w-4" />
            Create First Task
          </Button>
        </div>
      )}
    </div>
  );
}

type TaskCardProps = {
  task: ParticipantTask;
  isExpanded: boolean;
  onToggleExpand: () => void;
};

function TaskCard({ task, isExpanded, onToggleExpand }: TaskCardProps) {
  const getRecurrenceLabel = (): string => {
    if (!task.is_recurring) return "One-off";
    if (task.frequency_pattern === "specific_days_of_week") return "Specific days";
    if (task.frequency_pattern === "daily_all_shifts") return "Daily";
    if (task.frequency_pattern?.startsWith("every_")) {
      return task.frequency_pattern.replaceAll("_", " ");
    }
    return "Recurring";
  };

  return (
    <div className="rounded border border-gray-200 bg-white">
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="flex-1 text-left">
          <h5 className="font-medium text-gray-900">{task.name}</h5>
          <p className="mt-1 text-xs text-gray-500">
            {(task.category || "other").replaceAll("_", " ")} • {getRecurrenceLabel()}
          </p>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {/* Details */}
      {isExpanded && (
        <>
          <div className="border-t border-gray-200 px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-medium text-gray-700">Priority</p>
                <p className="mt-1 text-gray-600">
                  {(task.priority || "medium").charAt(0).toUpperCase() + (task.priority || "medium").slice(1)}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Requirement</p>
                <p className="mt-1 text-gray-600">
                  {task.is_mandatory ? "Mandatory" : "Optional"}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Evidence</p>
                <p className="mt-1 text-gray-600">
                  {(task.evidence_required || "none") === "none"
                    ? "Not required"
                    : (task.evidence_required || "none").replaceAll("_", " ")}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Shifts</p>
                <p className="mt-1 text-gray-600">
                  {task.shift_type
                    ? task.shift_type.charAt(0).toUpperCase() + task.shift_type.slice(1)
                    : "Any"}
                </p>
              </div>
            </div>

            {task.goal_name && (
              <div className="mt-3 text-xs">
                <p className="font-medium text-gray-700">Goal</p>
                <p className="mt-1 text-gray-600">{task.goal_name}</p>
              </div>
            )}

            {task.description && (
              <div className="mt-3 text-xs">
                <p className="font-medium text-gray-700">Description</p>
                <p className="mt-1 text-gray-600">{task.description}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
