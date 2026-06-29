import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Lightbulb, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { jsonFetch } from "@/services/http";
import type {
  TaskCategory,
  TaskPriority,
  ShiftType,
  RecurrenceType,
  RecurrenceFrequency,
  EvidenceRequired,
} from "@/types/task";

type Props = {
  participantId: string;
  isOpen: boolean;
  onClose: () => void;
  linkedGoalId?: string;
};

export function NewTaskModal({ participantId, isOpen, onClose, linkedGoalId }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Form state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TaskCategory>("personal_care");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [primaryShiftType, setPrimaryShiftType] = useState<ShiftType | "">("");
  const [additionalShiftTypes, setAdditionalShiftTypes] = useState<ShiftType[]>([]);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("one_off");
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency | "">("");
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([]);
  const [dueWindowStart, setDueWindowStart] = useState("");
  const [dueWindowEnd, setDueWindowEnd] = useState("");
  const [requirementLevel, setRequirementLevel] = useState<"mandatory" | "optional">("mandatory");
  const [evidenceRequired, setEvidenceRequired] = useState<EvidenceRequired>("none");
  const [notes, setNotes] = useState("");
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  // Validation
  const canSave =
    title.trim() &&
    primaryShiftType &&
    (recurrenceType === "one_off" || recurrenceFrequency);

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        participant_id: participantId,
        title,
        category,
        priority,
        primary_shift_type: primaryShiftType,
        additional_shift_types:
          recurrenceType === "recurring" ? additionalShiftTypes : [],
        recurrence_type: recurrenceType,
        recurrence_frequency: recurrenceType === "recurring" ? recurrenceFrequency : null,
        recurrence_weekdays:
          recurrenceFrequency === "specific_weekdays" ? recurrenceWeekdays : null,
        due_window_start: dueWindowStart || null,
        due_window_end: dueWindowEnd || null,
        requirement_level: requirementLevel,
        evidence_required: evidenceRequired,
        notes: notes || null,
        linked_goal_id: linkedGoalId || null,
      };

      return jsonFetch("/api/tasks/templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({ title: "Task created", description: "Task template created successfully." });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error creating task",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGetSuggestion = async () => {
    if (!primaryShiftType || !category) {
      toast({
        title: "Cannot get suggestion",
        description: "Select shift type and category first.",
      });
      return;
    }

    setLoadingSuggestion(true);
    try {
      const suggestion = await jsonFetch("/api/tasks/ai/task-suggestion", {
        method: "GET",
        search: {
          participant_id: participantId,
          shift_type: primaryShiftType,
          category,
          lookback_days: 30,
        },
      });

      if (suggestion.suggestion_text) {
        setNotes((prev) => (prev ? `${prev}\n\n${suggestion.suggestion_text}` : suggestion.suggestion_text));
        if (suggestion.evidence_recommendation) {
          setEvidenceRequired(suggestion.evidence_recommendation);
        }
        toast({
          title: "Suggestion applied",
          description: "AI suggestion added to notes.",
        });
      } else {
        toast({
          title: "No suggestion available",
          description: "Not enough historical data for this participant.",
        });
      }
    } catch (error) {
      toast({
        title: "Error fetching suggestion",
        description: "Failed to get AI suggestion.",
        variant: "destructive",
      });
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const handleClose = () => {
    // Reset form
    setTitle("");
    setCategory("personal_care");
    setPriority("medium");
    setPrimaryShiftType("");
    setAdditionalShiftTypes([]);
    setRecurrenceType("one_off");
    setRecurrenceFrequency("");
    setRecurrenceWeekdays([]);
    setDueWindowStart("");
    setDueWindowEnd("");
    setRequirementLevel("mandatory");
    setEvidenceRequired("none");
    setNotes("");
    setShowSuggestion(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div>
            <Label htmlFor="title">Task Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Morning medication"
              className="mt-1"
            />
          </div>

          {/* Category */}
          <div>
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as TaskCategory)}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2"
            >
              <option value="personal_care">Personal Care</option>
              <option value="medication">Medication</option>
              <option value="domestic_assistance">Domestic Assistance</option>
              <option value="community_access">Community Access</option>
              <option value="transport">Transport</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* Primary Shift Type — REQUIRED */}
          <div>
            <Label>Shift Type *</Label>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {["morning", "afternoon", "night", "anytime"].map((type) => (
                <button
                  key={type}
                  onClick={() => setPrimaryShiftType(type as ShiftType)}
                  className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                    primaryShiftType === type
                      ? "bg-blue-600 text-white"
                      : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            {!primaryShiftType && (
              <p className="mt-1 text-xs text-red-600">Shift type required</p>
            )}
          </div>

          {/* Recurrence Type */}
          <div>
            <Label>Recurrence</Label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="one_off"
                  checked={recurrenceType === "one_off"}
                  onChange={(e) => {
                    setRecurrenceType(e.target.value as RecurrenceType);
                    setRecurrenceFrequency("");
                    setAdditionalShiftTypes([]);
                  }}
                  className="rounded"
                />
                One-off
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="recurring"
                  checked={recurrenceType === "recurring"}
                  onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
                  className="rounded"
                />
                Recurring
              </label>
            </div>
          </div>

          {/* Recurrence Frequency — required if recurring */}
          {recurrenceType === "recurring" && (
            <div>
              <Label htmlFor="recurrence-freq">Recurrence Frequency *</Label>
              <select
                id="recurrence-freq"
                value={recurrenceFrequency}
                onChange={(e) => {
                  setRecurrenceFrequency(e.target.value as RecurrenceFrequency);
                  if (e.target.value !== "specific_weekdays") {
                    setRecurrenceWeekdays([]);
                  }
                }}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2"
              >
                <option value="">Select frequency...</option>
                <option value="every_matching_shift">Every matching shift</option>
                <option value="daily_regardless_of_shift">Daily (first shift per day)</option>
                <option value="specific_weekdays">Specific weekdays</option>
              </select>
              {!recurrenceFrequency && (
                <p className="mt-1 text-xs text-red-600">Required for recurring tasks</p>
              )}
            </div>
          )}

          {/* Additional Shift Types — only for recurring */}
          {recurrenceType === "recurring" && (
            <div>
              <Label>Also on these shifts (optional)</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {["morning", "afternoon", "night"].map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setAdditionalShiftTypes((prev) =>
                        prev.includes(type as ShiftType)
                          ? prev.filter((t) => t !== type)
                          : [...prev, type as ShiftType]
                      );
                    }}
                    className={`rounded px-3 py-2 text-sm transition-colors ${
                      additionalShiftTypes.includes(type as ShiftType)
                        ? "bg-blue-100 text-blue-700 ring-2 ring-blue-500"
                        : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Specific Weekdays — only if specific_weekdays frequency */}
          {recurrenceFrequency === "specific_weekdays" && (
            <div>
              <Label>Days of week</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                  (day, index) => (
                    <button
                      key={day}
                      onClick={() => {
                        setRecurrenceWeekdays((prev) =>
                          prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]
                        );
                      }}
                      className={`rounded px-2 py-1 text-sm transition-colors ${
                        recurrenceWeekdays.includes(index)
                          ? "bg-blue-100 text-blue-700 ring-2 ring-blue-500"
                          : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Time Windows */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start-time">Due window start (optional)</Label>
              <Input
                id="start-time"
                type="time"
                value={dueWindowStart}
                onChange={(e) => setDueWindowStart(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="end-time">Due window end (optional)</Label>
              <Input
                id="end-time"
                type="time"
                value={dueWindowEnd}
                onChange={(e) => setDueWindowEnd(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {/* Requirement Level */}
          <div>
            <Label>Requirement Level</Label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="mandatory"
                  checked={requirementLevel === "mandatory"}
                  onChange={(e) => setRequirementLevel(e.target.value as "mandatory" | "optional")}
                  className="rounded"
                />
                Mandatory
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="optional"
                  checked={requirementLevel === "optional"}
                  onChange={(e) => setRequirementLevel(e.target.value as "mandatory" | "optional")}
                  className="rounded"
                />
                Optional
              </label>
            </div>
          </div>

          {/* Evidence Required */}
          <div>
            <Label htmlFor="evidence">Evidence Required</Label>
            <select
              id="evidence"
              value={evidenceRequired}
              onChange={(e) => setEvidenceRequired(e.target.value as EvidenceRequired)}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2"
            >
              <option value="none">None</option>
              <option value="photo">Photo</option>
              <option value="notes">Notes</option>
              <option value="photo_and_notes">Photo & Notes</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="notes">Notes</Label>
              <button
                onClick={handleGetSuggestion}
                disabled={loadingSuggestion}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400"
              >
                {loadingSuggestion ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lightbulb className="h-4 w-4" />
                )}
                Get AI suggestion
              </button>
            </div>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Task instructions, special notes, etc."
              className="mt-1"
              rows={4}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 py-4">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => createTaskMutation.mutate()}
            disabled={!canSave || createTaskMutation.isPending}
          >
            {createTaskMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Create Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
