import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X as XIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { HELP, INPUT, NOTE, PRIMARY_BUTTON, SUBHEADING } from "@/components/participants/recordUi";
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

/** Daily support: what workers see about this participant before and during a
 * shift, and the interests used to match them with a worker. */
export function ParticipantShiftContextTab({ participantId }: ParticipantShiftContextTabProps) {
  return (
    <div className="space-y-5">
      <p className={NOTE}>
        Support workers see this in their app before and during each shift. Keep it short, current and practical.
      </p>
      <ParticipantTagsSection participantId={participantId} />
      <ParticipantShiftContextEditor participantId={participantId} />
    </div>
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
    <section aria-labelledby="interests-heading" className="space-y-3 border-b border-cc-border pb-5">
      <div>
        <h4 id="interests-heading" className={SUBHEADING}>Interests and preferences</h4>
        <p className={HELP}>Used to suggest support workers who share them.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className={HELP}>None added yet.</p>}
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-cc-soft px-3 py-1 text-sm text-cc-text"
          >
            {tag.label}
            <button type="button" onClick={() => removeMutation.mutate(tag.tag_id)} aria-label={`Remove ${tag.label}`} className="text-cc-muted hover:text-cc-text">
              <XIcon size={13} />
            </button>
          </span>
        ))}
      </div>

      <div className="flex max-w-xl gap-2">
        <select
          aria-label="Add an interest"
          value={selectedTagId}
          onChange={(event) => setSelectedTagId(event.target.value)}
          className={`${INPUT} min-h-10 flex-1`}
        >
          <option value="">Add an interest</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.categoryName} · {tag.label}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedTagId || addMutation.isPending}
          onClick={() => selectedTagId && addMutation.mutate(selectedTagId)}
          className={PRIMARY_BUTTON}
        >
          Add
        </button>
      </div>
    </section>
  );
}
