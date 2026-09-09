import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCoordinatorFeedbackTags,
  submitCoordinatorShiftFeedback,
} from "@/services/workerPerformanceService";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

type Props = {
  shiftId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function CoordinatorShiftFeedbackForm({ shiftId, onSuccess, onCancel }: Props) {
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [actions, setActions] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const tagsQuery = useQuery({
    queryKey: ["coordinator", "feedback-tags"],
    queryFn: () => getCoordinatorFeedbackTags(),
  });

  const submitMut = useMutation({
    mutationFn: () =>
      submitCoordinatorShiftFeedback(shiftId, {
        strengths,
        areas_to_improve: improvements,
        action_items: actions,
        tag_ids: selectedTags,
      }),
    onSuccess: () => {
      toast({
        title: translate("coordinator.feedback.sent"),
        description: translate("coordinator.feedback.workerNotified"),
      });
      void queryClient.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      onSuccess?.();
    },
    onError: (e: Error) =>
      toast({ title: translate("coordinator.feedback.failed"), description: e.message, variant: "destructive" }),
  });

  const tags = tagsQuery.data?.tags ?? [];
  const canSubmit = strengths.trim() && improvements.trim() && actions.trim();

  const toggleTag = (id: string) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const fields = [
    {
      label: translate("coordinator.feedback.strengths"),
      value: strengths,
      set: setStrengths,
      placeholder: translate("coordinator.feedback.strengthsPlaceholder"),
    },
    {
      label: translate("coordinator.feedback.improvements"),
      value: improvements,
      set: setImprovements,
      placeholder: translate("coordinator.feedback.improvementsPlaceholder"),
    },
    {
      label: translate("coordinator.feedback.actions"),
      value: actions,
      set: setActions,
      placeholder: translate("coordinator.feedback.actionsPlaceholder"),
    },
  ];

  return (
    <div className="space-y-4 rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <h3 className="text-sm font-black" style={{ color: TEXT }}>{translate("coordinator.feedback.title")}</h3>
      <p className="text-xs font-medium" style={{ color: MUTED }}>
        {translate("coordinator.feedback.hint")}
      </p>

      {fields.map((field) => (
        <label key={field.label} className="block">
          <span className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {field.label} *
          </span>
          <textarea
            value={field.value}
            onChange={(e) => field.set(e.target.value)}
            rows={3}
            placeholder={field.placeholder}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: BORDER }}
          />
        </label>
      ))}

      {!!tags.length && (
        <div>
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {translate("coordinator.feedback.tagsOptional")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => {
              const active = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className="rounded-full px-3 py-1 text-xs font-bold"
                  style={{
                    background: active ? PLUM : "#F8F6FE",
                    color: active ? "var(--cc-surface)" : MUTED,
                  }}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full py-2.5 text-sm font-black"
            style={{ background: "var(--cc-active)", color: MUTED }}
          >
            {translate("common.cancel")}
          </button>
        )}
        <button
          type="button"
          disabled={!canSubmit || submitMut.isPending}
          onClick={() => submitMut.mutate()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-black text-white disabled:opacity-50"
          style={{ background: PLUM }}
        >
          {submitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={16} />}
          {translate("coordinator.feedback.submit")}
        </button>
      </div>
    </div>
  );
}
