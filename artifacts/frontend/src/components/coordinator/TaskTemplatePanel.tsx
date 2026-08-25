import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, ChevronDown, ChevronUp, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
  type TaskTemplate,
  type NdisGoal,
} from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const SHIFT_TYPES = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "overnight", label: "Overnight" },
  { value: "flexible", label: "Flexible" },
];

const CATEGORIES = [
  { value: "personal_care", label: "Personal Care" },
  { value: "meal_prep", label: "Meal Prep" },
  { value: "medication", label: "Medication" },
  { value: "community_access", label: "Community Access" },
  { value: "documentation", label: "Documentation" },
  { value: "other", label: "Other" },
];

const CATEGORY_KEYS: Record<string, string> = {
  personal_care: "coordinator.taskTemplate.category.personalCare",
  meal_prep: "coordinator.taskTemplate.category.mealPrep",
  medication: "coordinator.taskTemplate.category.medication",
  community_access: "coordinator.taskTemplate.category.communityAccess",
  documentation: "coordinator.taskTemplate.category.documentation",
  other: "coordinator.taskTemplate.category.other",
};

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

interface TaskTemplateFormModalProps {
  goal: NdisGoal | null;
  participantId: string;
  template: TaskTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function TaskTemplateFormModal({ goal, participantId, template, onClose, onSaved }: TaskTemplateFormModalProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: template?.name ?? "",
    description: template?.description ?? "",
    primary_shift_type: template?.primary_shift_type ?? "",
    additional_shift_types: template?.additional_shift_types ?? [],
    recurrence_type: template?.recurrence_type ?? "one_off",
    recurrence_frequency: template?.recurrence_frequency ?? "",
    recurrence_weekdays: template?.recurrence_weekdays ?? [],
    due_window_start: template?.due_window_start ?? "",
    due_window_end: template?.due_window_end ?? "",
    category: template?.category ?? "",
    priority: template?.priority ?? "medium",
    linked_goal_id: template?.linked_goal_id ?? goal?.id ?? "",
  });

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        primary_shift_type: form.primary_shift_type || null,
        additional_shift_types: form.additional_shift_types,
        recurrence_type: form.recurrence_type,
        recurrence_frequency: form.recurrence_frequency || null,
        recurrence_weekdays: form.recurrence_weekdays,
        due_window_start: form.due_window_start || null,
        due_window_end: form.due_window_end || null,
        category: form.category || null,
        priority: form.priority,
        linked_goal_id: form.linked_goal_id || goal?.id || null,
        status: "active" as const,
        evidence_required: "none" as const,
        is_mandatory: false,
      };
      return template
        ? updateTaskTemplate(template.id, payload)
        : createTaskTemplate(participantId, payload);
    },
    onSuccess: () => {
      toast({ title: template ? translate("coordinator.taskTemplate.updated") : translate("coordinator.taskTemplate.created") });
      onSaved();
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: translateParams("coordinator.taskTemplate.saveFailed", { message: err?.message ?? "" }) }),
  });

  const toggleWeekday = (day: number) => {
    setForm((f) => ({
      ...f,
      recurrence_weekdays: f.recurrence_weekdays.includes(day)
        ? f.recurrence_weekdays.filter((d) => d !== day)
        : [...f.recurrence_weekdays, day].sort(),
    }));
  };

  const toggleAdditionalShift = (shiftType: string) => {
    setForm((f) => ({
      ...f,
      additional_shift_types: f.additional_shift_types.includes(shiftType)
        ? f.additional_shift_types.filter((s) => s !== shiftType)
        : [...f.additional_shift_types, shiftType],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,24,39,0.35)" }}>
      <div className="w-full max-w-2xl rounded-3xl p-6 space-y-4 overflow-y-auto bg-white" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-black text-[16px]" style={{ color: TEXT }}>
            {template ? translate("coordinator.taskTemplate.editTitle") : translate("coordinator.taskTemplate.newTitle")}
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" title={translate("common.close")}>
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>

        {goal && (
          <div className="space-y-1">
            <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translateParams("coordinator.taskTemplate.goalLabel", { name: goal.name })}</Label>
            <p className="text-[12px]" style={{ color: MUTED }}>{goal.description}</p>
          </div>
        )}

        {/* Basic fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.taskName")}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={translate("coordinator.taskTemplate.taskNamePlaceholder")}
              className="rounded-xl h-9 text-[13px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.category")}</Label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}
              aria-label={translate("coordinator.taskTemplate.category")}
            >
              <option value="">{translate("coordinator.taskTemplate.selectCategory")}</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {translate(CATEGORY_KEYS[cat.value] ?? cat.label)}
                </option>
              ))}
            </select>
          </div>
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

        {/* Shift-based section */}
        <div className="border-t pt-4" style={{ borderColor: BORDER }}>
          <h3 className="font-semibold text-[13px] mb-3" style={{ color: TEXT }}>{translate("coordinator.taskTemplate.shiftRecurrence")}</h3>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.primaryShiftType")}</Label>
              <select
                value={form.primary_shift_type}
                onChange={(e) => setForm((f) => ({ ...f, primary_shift_type: e.target.value }))}
                className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
                style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                aria-label="Primary shift type"
              >
                <option value="">{translate("coordinator.taskTemplate.selectShiftType")}</option>
                {SHIFT_TYPES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {translate(`coordinator.taskTemplate.shiftType.${st.value}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.recurrenceType")}</Label>
              <select
                value={form.recurrence_type}
                onChange={(e) => setForm((f) => ({ ...f, recurrence_type: e.target.value }))}
                className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
                style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                aria-label={translate("coordinator.taskTemplate.recurrenceType")}
              >
                <option value="one_off">{translate("coordinator.taskTemplate.recurrence.oneOff")}</option>
                <option value="recurring">{translate("coordinator.taskTemplate.recurrence.recurring")}</option>
                <option value="specific_weekdays">{translate("coordinator.taskTemplate.recurrence.specificWeekdays")}</option>
              </select>
            </div>
          </div>

          {(form.recurrence_type === "recurring" || form.recurrence_type === "specific_weekdays") && (
            <div className="space-y-1 mb-3">
              <Label className="text-xs font-semibold" style={{ color: MUTED }}>
                {form.recurrence_type === "specific_weekdays" ? translate("coordinator.taskTemplate.daysOfWeek") : translate("coordinator.taskTemplate.frequency")}
              </Label>
              {form.recurrence_type === "specific_weekdays" ? (
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day.value}
                      onClick={() => toggleWeekday(day.value)}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                      style={{
                        background: form.recurrence_weekdays.includes(day.value) ? PLUM : SOFT,
                        color: form.recurrence_weekdays.includes(day.value) ? "#fff" : TEXT,
                      }}
                    >
                      {translate(`coordinator.taskTemplate.weekday.${['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day.value]}`).slice(0, 3)}
                    </button>
                  ))}
                </div>
              ) : (
                <select
                  value={form.recurrence_frequency}
                  onChange={(e) => setForm((f) => ({ ...f, recurrence_frequency: e.target.value }))}
                  className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
                  style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                  aria-label={translate("coordinator.taskTemplate.frequency")}
                >
                  <option value="">{translate("coordinator.taskTemplate.selectFrequency")}</option>
                  <option value="daily">{translate("coordinator.taskTemplate.frequency.daily")}</option>
                  <option value="weekly">{translate("coordinator.taskTemplate.frequency.weekly")}</option>
                </select>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.availableFrom")}</Label>
              <TimePicker
                value={form.due_window_start}
                onChange={(v) => setForm((f) => ({ ...f, due_window_start: v }))}
                className="rounded-xl h-9 text-[13px]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.availableUntil")}</Label>
              <TimePicker
                value={form.due_window_end}
                onChange={(v) => setForm((f) => ({ ...f, due_window_end: v }))}
                className="rounded-xl h-9 text-[13px]"
              />
            </div>
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>{translate("coordinator.taskTemplate.priority")}</Label>
          <select
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            aria-label={translate("coordinator.taskTemplate.priority")}
          >
            <option value="low">{translate("coordinator.taskTemplate.priority.low")}</option>
            <option value="medium">{translate("coordinator.taskTemplate.priority.medium")}</option>
            <option value="high">{translate("coordinator.taskTemplate.priority.high")}</option>
          </select>
        </div>

        <div className="flex gap-2 pt-2 border-t" style={{ borderColor: BORDER }}>
          <Button variant="outline" className="flex-1 rounded-xl" style={{ borderColor: BORDER }} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl"
            style={{ background: PLUM, color: "#fff" }}
            disabled={!form.name.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? translate("common.saving") : template ? translate("coordinator.taskTemplate.updateTemplate") : translate("coordinator.taskTemplate.createTemplate")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface TaskTemplatePanelProps {
  participantId: string;
  goal: NdisGoal | null;
  templates: TaskTemplate[];
  onTemplatesChanged: () => void;
}

export function TaskTemplatePanel({
  participantId,
  goal,
  templates,
  onTemplatesChanged,
}: TaskTemplatePanelProps) {
  const { translate, translateParams } = useAccessibility();
  const [formOpen, setFormOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TaskTemplate | null>(null);
  const { toast } = useToast();

  const goalTemplates = goal ? templates.filter((t) => t.linked_goal_id === goal.id) : templates;

  const deleteMut = useMutation({
    mutationFn: deleteTaskTemplate,
    onSuccess: () => {
      toast({ title: translate("coordinator.taskTemplate.deleted") });
      onTemplatesChanged();
    },
    onError: (err: any) => toast({ variant: "destructive", title: translateParams("coordinator.taskTemplate.deleteFailed", { message: err?.message ?? "" }) }),
  });

  return (
    <>
      <div className="rounded-xl border p-4" style={{ borderColor: BORDER, background: SOFT }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[13px]" style={{ color: TEXT }}>
            {goal ? translateParams("coordinator.taskTemplate.templatesFor", { name: goal.name }) : translate("coordinator.taskTemplate.title")}
          </h3>
          <Button
            size="sm"
            className="rounded-lg gap-1"
            style={{ background: PLUM, color: "#fff" }}
            onClick={() => {
              setEditTemplate(null);
              setFormOpen(true);
            }}
          >
            <Plus size={12} /> {translate("common.add")}
          </Button>
        </div>

        <div className="space-y-2">
          {goalTemplates.length === 0 ? (
            <p className="text-[12px]" style={{ color: MUTED }}>
              No templates yet. Create one to enable automatic task generation.
            </p>
          ) : (
            goalTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-start justify-between rounded-lg p-3"
                style={{ background: "#fff", border: `1px solid ${BORDER}` }}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[12px]" style={{ color: TEXT }}>
                    {template.name}
                  </p>
                  {template.primary_shift_type && (
                    <p className="text-[10px] mt-1" style={{ color: MUTED }}>
                      {translateParams("coordinator.taskTemplate.shiftMeta", { shift: template.primary_shift_type ?? "", recurrence: template.recurrence_type ?? "" })}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
                  <button
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                    onClick={() => {
                      setEditTemplate(template);
                      setFormOpen(true);
                    }}
                    title={translate("common.edit")}
                  >
                    <Edit2 size={12} style={{ color: MUTED }} />
                  </button>
                  <button
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                    onClick={() => deleteMut.mutate(template.id)}
                    title={translate("common.delete")}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 size={12} style={{ color: CORAL }} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {formOpen && (
        <TaskTemplateFormModal
          goal={goal}
          participantId={participantId}
          template={editTemplate}
          onClose={() => {
            setFormOpen(false);
            setEditTemplate(null);
          }}
          onSaved={onTemplatesChanged}
        />
      )}
    </>
  );
}
