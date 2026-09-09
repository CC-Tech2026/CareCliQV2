import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, X as XIcon } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { ParticipantShiftContextEditor } from "@/components/participants/ParticipantShiftContextEditor";
import {
  getParticipantTags,
  addParticipantTag,
  removeParticipantTag,
  getTagCatalog,
} from "@/services/coordinatorService";

interface ParticipantShiftContextTabProps {
  participantId: string;
}

/** "Shift Context" facet of the participant Detail archetype — coordinator only. */
export function ParticipantShiftContextTab({ participantId }: ParticipantShiftContextTabProps) {
  const { translate } = useAccessibility();

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-violet-200/70 bg-violet-50/30 p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-violet-700" />
            <p className="text-[12px] font-black uppercase tracking-[0.13em] text-violet-800">{translate("patients.shiftContext.title")}</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-300 text-violet-700 font-semibold uppercase tracking-wide bg-violet-100">
            Coordinator Authoring
          </span>
        </div>
        <p className="text-[12px] leading-relaxed text-violet-700/80">
          This information appears in the Support Worker My Shift experience. Keep instructions concise, current, and action-oriented.
        </p>
      </div>

      <ParticipantTagsSection participantId={participantId} />

      <ParticipantShiftContextEditor participantId={participantId} />
    </section>
  );
}

/** Worker-Participant Matching Enhancement, Phase 1 — structured interest/
 * preference tags, distinct from the free-text fields just below (likes,
 * communication guidance, preferred activities): those are prose for a
 * worker's shift briefing, these are curated so overlap with a worker's own
 * tags can be computed for ranking (Phase 2). */
function ParticipantTagsSection({ participantId }: { participantId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const tagsKey = ["participant-tags", participantId];
  const catalogKey = ["coordinator-tags"];

  const { data: tags = [], isLoading } = useOrgQuery(tagsKey, { queryFn: () => getParticipantTags(participantId) });
  const { data: catalog = [] } = useOrgQuery(catalogKey, { queryFn: getTagCatalog });

  const [selectedTagId, setSelectedTagId] = useState("");

  const availableTags = (() => {
    const already = new Set(tags.map((t) => t.tag_id));
    return catalog.flatMap((category) =>
      category.tags.filter((t) => t.is_active && !already.has(t.id)).map((t) => ({ ...t, categoryName: category.name }))
    );
  })();

  // useOrgQuery scopes tagsKey's actual cache entry under [orgId, ...tagsKey],
  // so invalidation has to include orgId too or it silently matches nothing.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [orgId, ...tagsKey] });

  const addMutation = useMutation({
    mutationFn: (tagId: string) => addParticipantTag(participantId, tagId),
    onSuccess: () => { setSelectedTagId(""); invalidate(); },
    onError: (err) => toast({ title: "Could not add tag", description: (err as Error).message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (tagId: string) => removeParticipantTag(participantId, tagId),
    onSuccess: invalidate,
    onError: (err) => toast({ title: "Could not remove tag", description: (err as Error).message, variant: "destructive" }),
  });

  if (isLoading) return null;

  return (
    <div className="rounded-2xl border border-[var(--cc-border)] bg-white p-4">
      <p className="text-[12px] font-black uppercase tracking-[0.13em]" style={{ color: "var(--cc-muted)" }}>Interests & preferences</p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--cc-muted)" }}>
        Structured tags used to suggest a better-fitting support worker for this participant's shifts.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className="text-xs italic" style={{ color: "var(--cc-muted)" }}>Nothing on file yet.</p>}
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={{ borderColor: "var(--cc-border)", background: "var(--cc-soft)", color: "var(--cc-text)" }}
          >
            {tag.label}
            <button type="button" onClick={() => removeMutation.mutate(tag.tag_id)} aria-label={`Remove ${tag.label}`} className="opacity-60 hover:opacity-100">
              <XIcon size={11} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <select
          title="Add a tag"
          value={selectedTagId}
          onChange={(event) => setSelectedTagId(event.target.value)}
          className="h-8 flex-1 rounded-lg border px-2 text-xs"
          style={{ borderColor: "var(--cc-border)" }}
        >
          <option value="">Add an interest...</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.categoryName} · {tag.label}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedTagId || addMutation.isPending}
          onClick={() => selectedTagId && addMutation.mutate(selectedTagId)}
          className="rounded-lg px-3 text-xs font-bold text-white disabled:opacity-50"
          style={{ background: "var(--cc-plum)" }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
