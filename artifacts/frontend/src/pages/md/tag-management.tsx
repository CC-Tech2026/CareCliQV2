import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag as TagIcon, X } from "lucide-react";

import { HubLayout } from "@/components/layout/HubLayout";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { SectionInfo } from "@/components/ui/section-info";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getTagCatalog,
  createTagCategory,
  setTagCategoryActive,
  setTagCategoryMatchingRole,
  createTag,
  setTagActive,
  type TagCategory,
  type TagMatchingRole,
} from "@/services/coordinatorService";

const MATCHING_ROLE_LABEL: Record<NonNullable<TagMatchingRole>, string> = {
  interests: "Interests",
  lived_experience: "Lived experience",
};

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CTA = "var(--cc-cta)";

function CategoryCard({ category }: { category: TagCategory }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [newTagLabel, setNewTagLabel] = useState("");

  // Must include orgId — useOrgQuery prefixes every key with it, and
  // invalidateQueries only partial-matches on the raw key array (not the
  // hashed cache key), so an un-prefixed key here silently invalidates nothing.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [orgId, "coordinator-tags"] });

  const addTagMutation = useMutation({
    mutationFn: (label: string) => createTag(category.id, label),
    onSuccess: () => { setNewTagLabel(""); invalidate(); },
    onError: (err) => toast({ title: "Could not add tag", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleTagMutation = useMutation({
    mutationFn: ({ tagId, isActive }: { tagId: string; isActive: boolean }) => setTagActive(tagId, isActive),
    onSuccess: invalidate,
    onError: (err) => toast({ title: "Could not update tag", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleCategoryMutation = useMutation({
    mutationFn: (isActive: boolean) => setTagCategoryActive(category.id, isActive),
    onSuccess: invalidate,
    onError: (err) => toast({ title: "Could not update category", description: (err as Error).message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: (role: TagMatchingRole) => setTagCategoryMatchingRole(category.id, role),
    onSuccess: invalidate,
    onError: (err) => toast({ title: "Could not update matching role", description: (err as Error).message, variant: "destructive" }),
  });

  function submitTag(event: React.FormEvent) {
    event.preventDefault();
    const label = newTagLabel.trim();
    if (!label) return;
    addTagMutation.mutate(label);
  }

  return (
    <div className="rounded-2xl border bg-white p-5" style={{ borderColor: BORDER, opacity: category.is_active ? 1 : 0.55 }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-black" style={{ color: TEXT }}>{category.name}</h3>
        <button
          type="button"
          onClick={() => toggleCategoryMutation.mutate(!category.is_active)}
          className="text-[10px] font-bold underline"
          style={{ color: MUTED }}
        >
          {category.is_active ? "Deactivate" : "Reactivate"}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Feeds match score:</p>
        <Select value={category.matching_role ?? "none"} onValueChange={(v) => roleMutation.mutate(v === "none" ? null : (v as TagMatchingRole))}>
          <SelectTrigger className="h-6 w-auto gap-1 rounded-full border-0 px-2 text-[10px] font-bold" style={{ background: category.matching_role ? "var(--cc-plum-soft)" : SOFT, color: category.matching_role ? PLUM : MUTED }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not used for matching</SelectItem>
            <SelectItem value="interests">{MATCHING_ROLE_LABEL.interests}</SelectItem>
            <SelectItem value="lived_experience">{MATCHING_ROLE_LABEL.lived_experience}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {category.tags.length === 0 && (
          <p className="text-[11px] font-medium" style={{ color: MUTED }}>No tags yet.</p>
        )}
        {category.tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={{
              borderColor: BORDER,
              background: tag.is_active ? SOFT : "transparent",
              color: tag.is_active ? TEXT : MUTED,
              textDecoration: tag.is_active ? "none" : "line-through",
            }}
          >
            <TagIcon size={11} style={{ color: PLUM }} />
            {tag.label}
            <button
              type="button"
              onClick={() => toggleTagMutation.mutate({ tagId: tag.id, isActive: !tag.is_active })}
              aria-label={tag.is_active ? `Deactivate ${tag.label}` : `Reactivate ${tag.label}`}
              className="opacity-60 hover:opacity-100"
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>

      <form onSubmit={submitTag} className="mt-3 flex gap-2">
        <Input
          value={newTagLabel}
          onChange={(event) => setNewTagLabel(event.target.value)}
          placeholder="New tag label..."
          className="h-8 rounded-lg text-[12px]"
        />
        <Button type="submit" size="sm" disabled={addTagMutation.isPending} className="h-8 gap-1 rounded-lg px-3 text-[11px]" style={{ background: CTA }}>
          <Plus size={13} /> Add
        </Button>
      </form>
    </div>
  );
}

export default function TagManagementPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { data, isLoading, error } = useOrgQuery(["coordinator-tags"], { queryFn: getTagCatalog });
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryRole, setNewCategoryRole] = useState<TagMatchingRole>(null);

  const addCategoryMutation = useMutation({
    mutationFn: ({ name, role }: { name: string; role: TagMatchingRole }) => createTagCategory(name, role ?? undefined),
    onSuccess: () => {
      setNewCategoryName("");
      setNewCategoryRole(null);
      queryClient.invalidateQueries({ queryKey: [orgId, "coordinator-tags"] });
    },
    onError: (err) => toast({ title: "Could not add category", description: (err as Error).message, variant: "destructive" }),
  });

  function submitCategory(event: React.FormEvent) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    addCategoryMutation.mutate({ name, role: newCategoryRole });
  }

  return (
    <HubLayout>
      <div className="space-y-6 pb-12">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
            Matching Tags
            <SectionInfo text="A curated list of interests, lived experience, and communication-style tags coordinators can assign to participants and workers. Shared interests and relevant experience help suggest a better-fitting support worker for a shift, on top of the usual availability and credential checks." />
          </h1>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Manage the shared tag list used for participant/worker matching. Deactivating a tag hides it from new
            assignments without removing it from anyone it's already on.
          </p>
        </header>

        <div className="rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Add a category</p>
          <form onSubmit={submitCategory} className="mt-2 flex max-w-xl flex-wrap gap-2">
            <Input
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="e.g. Communication Style"
              className="h-9 min-w-[180px] flex-1 rounded-lg text-[12px]"
            />
            <Select value={newCategoryRole ?? "none"} onValueChange={(v) => setNewCategoryRole(v === "none" ? null : (v as TagMatchingRole))}>
              <SelectTrigger className="h-9 w-[190px] rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not used for matching</SelectItem>
                <SelectItem value="interests">Feeds "{MATCHING_ROLE_LABEL.interests}" score</SelectItem>
                <SelectItem value="lived_experience">Feeds "{MATCHING_ROLE_LABEL.lived_experience}" score</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={addCategoryMutation.isPending} className="h-9 gap-1 rounded-lg px-3 text-[11px]" style={{ background: CTA }}>
              <Plus size={13} /> Add category
            </Button>
          </form>
          <p className="mt-2 text-[10px]" style={{ color: MUTED }}>
            Only categories marked "Interests" or "Lived experience" affect the shift-assignment match score - everything
            else is descriptive only. You can change this later per category.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl" style={{ background: SOFT }} />)}
          </div>
        ) : error ? (
          <p className="text-sm font-bold text-red-600">Could not load tags.</p>
        ) : !data || data.length === 0 ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
            <TagIcon size={22} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[13px] font-black" style={{ color: TEXT }}>No categories yet</p>
            <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
              Start with something like "Interests" or "Lived Experience" above.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.map((category) => <CategoryCard key={category.id} category={category} />)}
          </div>
        )}
      </div>
    </HubLayout>
  );
}
