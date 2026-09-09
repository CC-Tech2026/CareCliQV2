import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { Eye, EyeOff, Heart, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWorkerTagCatalog,
  getMyTags,
  addMyTag,
  removeMyTag,
  setMatchingOptIn,
} from "@/services/workerService";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

export function MyInterestsCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";
  const catalogKey = ["worker-tag-catalog"];
  const myTagsKey = ["worker-my-tags"];

  const { data: catalog = [] } = useOrgQuery(catalogKey, { queryFn: getWorkerTagCatalog });
  const { data: myTags = [], isLoading } = useOrgQuery(myTagsKey, { queryFn: getMyTags });

  const [selectedTagId, setSelectedTagId] = useState<string>("");

  const availableTags = useMemo(() => {
    const mine = new Set(myTags.map((t) => t.tag_id));
    return catalog.flatMap((category) =>
      category.tags.filter((t) => t.is_active && !mine.has(t.id)).map((t) => ({ ...t, categoryName: category.name }))
    );
  }, [catalog, myTags]);

  // useOrgQuery scopes myTagsKey's actual cache entry under [orgId, ...myTagsKey],
  // so invalidation has to include orgId too or it silently matches nothing.
  const invalidateMine = () => queryClient.invalidateQueries({ queryKey: [orgId, ...myTagsKey] });

  const addMutation = useMutation({
    mutationFn: ({ tagId, visible }: { tagId: string; visible: boolean }) => addMyTag(tagId, undefined, visible),
    onSuccess: () => { setSelectedTagId(""); invalidateMine(); },
    onError: (err) => toast({ title: "Could not add tag", description: (err as Error).message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (tagId: string) => removeMyTag(tagId),
    onSuccess: invalidateMine,
    onError: (err) => toast({ title: "Could not remove tag", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ tagId, visible }: { tagId: string; visible: boolean }) => addMyTag(tagId, undefined, visible),
    onSuccess: invalidateMine,
    onError: (err) => toast({ title: "Could not update visibility", description: (err as Error).message, variant: "destructive" }),
  });

  const optInMutation = useMutation({
    mutationFn: (optIn: boolean) => setMatchingOptIn(optIn),
    onSuccess: () => toast({ title: "Preference saved" }),
    onError: (err) => toast({ title: "Could not save preference", description: (err as Error).message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 rounded-2xl border border-[#E8E8EA] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#1A1A2E]">
          <Heart className="h-5 w-5 text-[#E8457A]" />
          <h2 className="font-black">My skills & interests</h2>
        </div>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
        Add skills you've picked up and things you're interested in. Sharing this helps coordinators suggest you
        for shifts where you and the participant are likely to actually get along, not just where you're available.
        Anything you mark "Private to coordinators" is only shown to coordinators and the managing director, never
        to participants or other workers. Nothing here is required.
      </p>

      <div className="rounded-xl border p-3" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black" style={{ color: "#1A1A2E" }}>Use my interests for shift matching</p>
            <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
              Turn this off to be excluded from interest-based shift suggestions entirely. Your tags stay saved either way.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={optInMutation.isPending}
              onClick={() => optInMutation.mutate(true)}
              className="h-7 rounded-lg text-[11px]"
            >
              On
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={optInMutation.isPending}
              onClick={() => optInMutation.mutate(false)}
              className="h-7 rounded-lg text-[11px]"
            >
              Off
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={selectedTagId} onValueChange={setSelectedTagId}>
          <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Choose a skill or interest to add..." /></SelectTrigger>
          <SelectContent>
            {availableTags.length === 0 ? (
              <div className="px-3 py-2 text-xs" style={{ color: MUTED }}>No more tags available. Ask your coordinator to add more.</div>
            ) : (
              availableTags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>{tag.categoryName} · {tag.label}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          type="button"
          disabled={!selectedTagId || addMutation.isPending}
          onClick={() => selectedTagId && addMutation.mutate({ tagId: selectedTagId, visible: false })}
          className="h-10 shrink-0 gap-2 rounded-xl"
          style={{ background: "var(--cc-cta)" }}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading...</p>}
        {!isLoading && myTags.length === 0 && (
          <p className="rounded-2xl bg-[#ECECEC] p-4 text-sm font-medium" style={{ color: MUTED }}>
            No interests added yet.
          </p>
        )}
        {myTags.map((tag) => (
          <div key={tag.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: BORDER }}>
            <p className="text-sm font-bold" style={{ color: "#1A1A2E" }}>{tag.label}</p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={toggleVisibilityMutation.isPending}
                onClick={() => toggleVisibilityMutation.mutate({ tagId: tag.tag_id, visible: !tag.visible_to_coordinator_only })}
                className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold"
                style={{ color: tag.visible_to_coordinator_only ? PLUM : MUTED }}
              >
                {tag.visible_to_coordinator_only ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {tag.visible_to_coordinator_only ? "Private to coordinators" : "Visible"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeMutation.mutate(tag.tag_id)}
                className="h-8 gap-1 rounded-lg px-2 text-[#7C3AED]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
