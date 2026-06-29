import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Pause, Archive, Loader2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { jsonFetch } from "@/services/http";
import type { TaskTemplate, ShiftType } from "@/types/task";

type Props = {
  participantId: string;
  onCreateNew?: () => void;
  onEditTemplate?: (template: TaskTemplate) => void;
};

export function TaskManagementView({ participantId, onCreateNew, onEditTemplate }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch task templates for participant
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["tasks", "templates", participantId],
    queryFn: async () => {
      return jsonFetch(`/api/tasks/templates/participant/${participantId}`);
    },
  });

  // Pause template mutation
  const pauseMutation = useMutation({
    mutationFn: async (templateId: string) => {
      return jsonFetch(`/api/tasks/templates/${templateId}/pause`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Template paused", description: "No new tasks will be generated." });
      queryClient.invalidateQueries({ queryKey: ["tasks", "templates", participantId] });
    },
    onError: (error: any) => {
      toast({
        title: "Error pausing template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Archive template mutation
  const archiveMutation = useMutation({
    mutationFn: async (templateId: string) => {
      return jsonFetch(`/api/tasks/templates/${templateId}/archive`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Template archived", description: "Template hidden from view." });
      queryClient.invalidateQueries({ queryKey: ["tasks", "templates", participantId] });
    },
    onError: (error: any) => {
      toast({
        title: "Error archiving template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  const activeTemplates = templates.filter((t) => t.status === "active");
  const pausedTemplates = templates.filter((t) => t.status === "paused");
  const archivedTemplates = templates.filter((t) => t.status === "archived");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Task Templates</h3>
        <Button onClick={onCreateNew} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Active Templates */}
      {activeTemplates.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Active</h4>
          <div className="space-y-2">
            {activeTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isExpanded={expandedId === template.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === template.id ? null : template.id)
                }
                onEdit={() => onEditTemplate?.(template)}
                onPause={() => pauseMutation.mutate(template.id)}
                onArchive={() => archiveMutation.mutate(template.id)}
                isPauseLoading={pauseMutation.isPending}
                isArchiveLoading={archiveMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Paused Templates */}
      {pausedTemplates.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-500">Paused</h4>
          <div className="space-y-2 opacity-75">
            {pausedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isExpanded={expandedId === template.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === template.id ? null : template.id)
                }
                onEdit={() => onEditTemplate?.(template)}
                onPause={() => pauseMutation.mutate(template.id)}
                onArchive={() => archiveMutation.mutate(template.id)}
                isPauseLoading={pauseMutation.isPending}
                isArchiveLoading={archiveMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Archived Templates */}
      {archivedTemplates.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-gray-400">Archived</h4>
          <div className="space-y-2 opacity-50">
            {archivedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isExpanded={expandedId === template.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === template.id ? null : template.id)
                }
                onEdit={() => onEditTemplate?.(template)}
                onPause={() => pauseMutation.mutate(template.id)}
                onArchive={() => archiveMutation.mutate(template.id)}
                isPauseLoading={pauseMutation.isPending}
                isArchiveLoading={archiveMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {templates.length === 0 && (
        <div className="rounded bg-gray-50 p-8 text-center">
          <p className="text-sm text-gray-500">No task templates yet.</p>
          <Button onClick={onCreateNew} variant="outline" size="sm" className="mt-4 gap-2">
            <Plus className="h-4 w-4" />
            Create First Template
          </Button>
        </div>
      )}
    </div>
  );
}

type TemplateCardProps = {
  template: TaskTemplate;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onPause: () => void;
  onArchive: () => void;
  isPauseLoading: boolean;
  isArchiveLoading: boolean;
};

function TemplateCard({
  template,
  isExpanded,
  onToggleExpand,
  onEdit,
  onPause,
  onArchive,
  isPauseLoading,
  isArchiveLoading,
}: TemplateCardProps) {
  const getRecurrenceLabel = (): string => {
    if (template.recurrence_type === "one_off") return "One-off";
    if (template.recurrence_frequency === "every_matching_shift") {
      return `Every ${template.primary_shift_type} shift`;
    }
    if (template.recurrence_frequency === "daily_regardless_of_shift") return "Daily";
    if (template.recurrence_frequency === "specific_weekdays") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const selectedDays = (template.recurrence_weekdays || [])
        .map((d) => days[d])
        .join(", ");
      return `On ${selectedDays}`;
    }
    return "Recurring";
  };

  const getShiftTypes = (): ShiftType[] => {
    const types: ShiftType[] = [template.primary_shift_type];
    if (template.additional_shift_types) {
      types.push(...template.additional_shift_types);
    }
    return types;
  };

  return (
    <div className="rounded border border-gray-200 bg-white">
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="flex-1 text-left">
          <h5 className="font-medium text-gray-900">{template.title}</h5>
          <p className="mt-1 text-xs text-gray-500">
            {template.category.replace("_", " ")} • {getRecurrenceLabel()}
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
                  {template.priority.charAt(0).toUpperCase() + template.priority.slice(1)}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Requirement</p>
                <p className="mt-1 text-gray-600">
                  {template.requirement_level.charAt(0).toUpperCase() +
                    template.requirement_level.slice(1)}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Evidence</p>
                <p className="mt-1 text-gray-600">
                  {template.evidence_required === "none"
                    ? "Not required"
                    : template.evidence_required.replace("_", " ")}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Shifts</p>
                <p className="mt-1 text-gray-600">
                  {getShiftTypes()
                    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
                    .join(", ")}
                </p>
              </div>
            </div>

            {template.due_window_start && (
              <div className="mt-3 text-xs">
                <p className="font-medium text-gray-700">Due Window</p>
                <p className="mt-1 text-gray-600">
                  {template.due_window_start} - {template.due_window_end}
                </p>
              </div>
            )}

            {template.notes && (
              <div className="mt-3 text-xs">
                <p className="font-medium text-gray-700">Notes</p>
                <p className="mt-1 text-gray-600">{template.notes}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t border-gray-200 flex gap-2 px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="gap-2 flex-1"
            >
              <Edit2 className="h-4 w-4" />
              Edit
            </Button>
            {template.status === "active" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onPause}
                disabled={isPauseLoading}
                className="gap-2 flex-1"
              >
                {isPauseLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
                Pause
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={onArchive}
              disabled={isArchiveLoading}
              className="gap-2 flex-1"
            >
              {isArchiveLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              Archive
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
