import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Lightbulb, Loader2, Zap } from "lucide-react";
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
  const [loadingAISuggestion, setLoadingAISuggestion] = useState(false);
  const [aiSuggestionApplied, setAiSuggestionApplied] = useState(false);
  const [aiSourceDate, setAiSourceDate] = useState<string | null>(null);

  // Validation
  const canSave =
    title.trim() &&
    primaryShiftType &&
    (recurrenceType === "one_off" || recurrenceFrequency);

  // Auto-fetch AI suggestions when shift type + category are selected
  useEffect(() => {
    if (isOpen && primaryShiftType && category && !aiSuggestionApplied && !title) {
      fetchAISuggestions();
    }
  }, [isOpen, primaryShiftType, category, aiSuggestionApplied, title]);

  const fetchAISuggestions = async () => {
    if (!primaryShiftType || !category) return;

    setLoadingAISuggestion(true);
    try {
      // Get title suggestion
      const titleParams = new URLSearchParams({ participant_id: participantId, shift_type: primaryShiftType, category });
      const titleResponse = await jsonFetch<{ suggestion: string | null }>(`/api/tasks/ai/task-title-suggestion?${titleParams}`, { method: "POST" });

      if (titleResponse.suggestion) {
        setTitle(titleResponse.suggestion);
      }

      // Get metadata suggestions (priority, evidence) with citations
      const metaParams = new URLSearchParams({ participant_id: participantId, shift_type: primaryShiftType, category, lookback_days: "30" });
      const metadataResponse = await jsonFetch<{ suggestion_text: string | null; evidence_recommendation: EvidenceRequired | null; sources: Array<{ shift_date: string }> }>(`/api/tasks/ai/task-suggestion?${metaParams}`);

      if (metadataResponse.evidence_recommendation) {
        setEvidenceRequired(metadataResponse.evidence_recommendation);
      }
      if (metadataResponse.sources?.length) {
        const raw = metadataResponse.sources[0].shift_date;
        const formatted = raw ? new Date(raw).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : null;
        setAiSourceDate(formatted);
      }

      setAiSuggestionApplied(true);
      toast({
        title: "AI suggestion applied",
        description: "Task details populated based on participant history.",
      });
    } catch (error) {
      // Fail silently - AI suggestion is optional
      setLoadingAISuggestion(false);
    } finally {
      setLoadingAISuggestion(false);
    }
  };

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
    setAiSuggestionApplied(false);
    setAiSourceDate(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Create New Task
          </DialogTitle>
        </DialogHeader>

        {/* AI Suggestion Loading State */}
        {loadingAISuggestion && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-sm text-blue-700">AI analyzing participant history...</span>
          </div>
        )}

        <div className="space-y-4 py-4">
          {/* Step 1: Shift Type Selection */}
          <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
            <Label className="block font-semibold text-sm mb-2 text-blue-900">
              Step 1: Select Shift Type *
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {(["morning", "afternoon", "night", "anytime"] as ShiftType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setPrimaryShiftType(type);
                    setAiSuggestionApplied(false); // Reset to re-fetch suggestions
                  }}
                  className={`px-3 py-2 rounded text-sm font-medium transition-all ${
                    primaryShiftType === type
                      ? "bg-blue-600 text-white ring-2 ring-blue-400"
                      : "bg-white text-gray-700 border border-gray-300 hover:border-blue-400"
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Category Selection & AI Auto-Fill */}
          {primaryShiftType && (
            <div className="rounded-lg border-2 border-green-300 bg-green-50 p-4 animate-in fade-in">
              <Label htmlFor="category" className="block font-semibold text-sm mb-2 text-green-900">
                Step 2: Select Category *
              </Label>
              <select
                id="category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as TaskCategory);
                  setAiSuggestionApplied(false); // Reset to re-fetch suggestions
                }}
                className="w-full rounded border-2 border-green-300 bg-white px-3 py-2 text-gray-700"
                aria-label="Task category selection"
              >
                <option value="personal_care">Personal Care</option>
                <option value="medication">Medication</option>
                <option value="domestic_assistance">Domestic Assistance</option>
                <option value="community_access">Community Access</option>
                <option value="transport">Transport</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          {/* Step 3: AI-Powered Details (auto-filled) */}
          {primaryShiftType && category && (
            <div className="rounded-lg border-2 border-purple-300 bg-purple-50 p-4 animate-in fade-in">
              <Label className="block font-semibold text-sm mb-2 text-purple-900">
                Step 3: Task Details
                {loadingAISuggestion && <span className="text-xs font-normal text-purple-600 ml-2">(AI suggesting...)</span>}
              </Label>

              {/* Title - Auto-filled by AI */}
              <div className="mb-3">
                <Label htmlFor="title" className="text-sm">
                  Task Title * {aiSuggestionApplied && <span className="text-xs text-purple-600">(AI-suggested{aiSourceDate ? ` — from session ${aiSourceDate}` : ""})</span>}
                </Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={loadingAISuggestion ? "Getting suggestion..." : "e.g., Morning medication"}
                  className="mt-1 border-purple-200"
                  disabled={loadingAISuggestion}
                />
              </div>

              {/* Priority */}
              <div className="mb-3">
                <Label htmlFor="priority" className="text-sm">
                  Priority
                </Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  aria-label="Task priority level"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              {/* Evidence Required - Auto-filled by AI */}
              <div className="mb-3">
                <Label htmlFor="evidence" className="text-sm">
                  Evidence Required {aiSuggestionApplied && <span className="text-xs text-purple-600">(AI-suggested)</span>}
                </Label>
                <select
                  id="evidence"
                  value={evidenceRequired}
                  onChange={(e) => setEvidenceRequired(e.target.value as EvidenceRequired)}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  aria-label="Evidence required for task completion"
                >
                  <option value="none">None</option>
                  <option value="notes">Notes only</option>
                  <option value="photo">Photo only</option>
                  <option value="notes_and_photo">Notes & Photo</option>
                </select>
              </div>

              {/* Recurrence */}
              <div className="mb-3">
                <Label htmlFor="recurrence" className="text-sm">
                  Task Type
                </Label>
                <select
                  id="recurrence"
                  value={recurrenceType}
                  onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  aria-label="Task recurrence type"
                >
                  <option value="one_off">One-off</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>

              {/* Recurring options */}
              {recurrenceType === "recurring" && (
                <div className="mb-3">
                  <Label htmlFor="frequency" className="text-sm">
                    Frequency *
                  </Label>
                  <select
                    id="frequency"
                    value={recurrenceFrequency}
                    onChange={(e) => setRecurrenceFrequency(e.target.value as RecurrenceFrequency)}
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                    aria-label="Task recurrence frequency"
                  >
                    <option value="">Select frequency</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="specific_weekdays">Specific Weekdays</option>
                    <option value="every_matching_shift">Every Matching Shift</option>
                  </select>
                </div>
              )}

              {/* Notes */}
              <div>
                <Label htmlFor="notes" className="text-sm">
                  Additional Notes
                </Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any additional context or instructions"
                  className="mt-1"
                  rows={2}
                />
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => createTaskMutation.mutate()}
            disabled={!canSave || createTaskMutation.isPending}
            className="gap-2"
          >
            {createTaskMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
