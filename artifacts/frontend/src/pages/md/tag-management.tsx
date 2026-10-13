import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, RotateCcw, Pause, ChevronDown, Tags } from "lucide-react";

import { HubLayout } from "@/components/layout/HubLayout";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

import { Input } from "@/components/ui/input";
import { LoadError, PageHeader, ctaClass, outlineClass } from "@/components/layout/PageKit";

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


export function CategoryCard({ category, search = "", onTagAdded }: { category: TagCategory; search?: string; onTagAdded?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [newTagLabel, setNewTagLabel] = useState("");
  const [tagStatus, setTagStatus] = useState("all");
  const [roleDraft, setRoleDraft] = useState<TagMatchingRole | undefined>(undefined);

  // Must include orgId — useOrgQuery prefixes every key with it, and
  // invalidateQueries only partial-matches on the raw key array (not the
  // hashed cache key), so an un-prefixed key here silently invalidates nothing.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [orgId, "coordinator-tags"] });

  const addTagMutation = useMutation({
    mutationFn: (label: string) => createTag(category.id, label),
    onSuccess: async (_, label) => { setNewTagLabel(""); setTagStatus("all"); await invalidate(); onTagAdded?.(); toast({ title: "Tag added", description: label + " is now in " + category.name + "." }); },
    onError: (err) => toast({ title: "Could not add tag", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleTagMutation = useMutation({
    mutationFn: ({ tagId, isActive }: { tagId: string; isActive: boolean }) => setTagActive(tagId, isActive),
    onSuccess: async (_, change) => { await invalidate(); toast({ title: change.isActive ? "Tag reactivated" : "Tag deactivated", description: change.isActive ? "Available for new selections." : "Existing assignments are kept." }); },
    onError: (err) => toast({ title: "Could not update tag", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleCategoryMutation = useMutation({
    mutationFn: (isActive: boolean) => setTagCategoryActive(category.id, isActive),
    onSuccess: async (_, active) => { await invalidate(); toast({ title: active ? "Category reactivated" : "Category deactivated" }); },
    onError: (err) => toast({ title: "Could not update category", description: (err as Error).message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: (role: TagMatchingRole) => setTagCategoryMatchingRole(category.id, role),
    onSuccess: async () => { await invalidate(); setRoleDraft(undefined); toast({ title: "Matching purpose updated" }); },
    onError: (err) => toast({ title: "Could not update matching role", description: (err as Error).message, variant: "destructive" }),
  });

  function submitTag(event: React.FormEvent) {
    event.preventDefault();
    const label = newTagLabel.trim();
    if (!label || duplicateTag || addTagMutation.isPending || !category.is_active) return;
    addTagMutation.mutate(label);
  }

  const duplicateTag = category.tags.find(tag => tag.label.trim().toLowerCase() === newTagLabel.trim().toLowerCase());
  const query = search.trim().toLowerCase();
  const tags = category.tags.filter(tag => (category.name.toLowerCase().includes(query) || tag.label.toLowerCase().includes(query)) && (tagStatus === "all" || tag.is_active === (tagStatus === "active"))).sort((a, b) => a.label.localeCompare(b.label, "en-AU"));
  const effectiveRole = roleDraft === undefined ? category.matching_role : roleDraft;
  const roleDirty = effectiveRole !== category.matching_role;
  const busy = toggleCategoryMutation.isPending || roleMutation.isPending || toggleTagMutation.isPending || addTagMutation.isPending;
  return (
    <section aria-label={category.name} className="flex min-w-0 flex-col bg-cc-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-cc-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold text-cc-text">{category.name}</h2>
          <p className="mt-1 text-xs text-cc-muted">{category.tags.filter(tag => tag.is_active).length} active / {category.tags.length} tags</p>
        </div>
        <button type="button" disabled={busy} onClick={() => toggleCategoryMutation.mutate(!category.is_active)} aria-label={(category.is_active ? "Deactivate " : "Reactivate ") + category.name} className={outlineClass}>
          {category.is_active ? <Pause size={14} /> : <RotateCcw size={14} />}{category.is_active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
      {!category.is_active && <p className="border-b border-cc-border bg-cc-soft px-4 py-2 text-xs font-medium text-cc-text">Inactive category. Reactivate it to add tags.</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cc-border px-5 py-4">
        <label htmlFor={"matching-role-" + category.id} className="text-xs font-medium text-cc-muted">Used in matching as</label>
        <select id={"matching-role-" + category.id} disabled={busy || !category.is_active} value={effectiveRole ?? "none"} onChange={event => setRoleDraft(event.target.value === "none" ? null : event.target.value as TagMatchingRole)} className="min-h-11 w-full rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text disabled:opacity-60 sm:w-64">
          <option value="none">Profile information only</option><option value="interests">Interests</option><option value="lived_experience">Lived experience</option>
        </select>
        {roleDirty && <><button type="button" disabled={busy} onClick={() => roleMutation.mutate(effectiveRole)} className={ctaClass}>{roleMutation.isPending ? "Saving..." : "Save matching purpose"}</button><button type="button" disabled={busy} onClick={() => setRoleDraft(undefined)} className={outlineClass}>Cancel</button></>}
        <p className="w-full text-xs text-cc-muted">{effectiveRole ? "This category contributes to the matching score. Save to apply a change." : "These tags provide profile context without changing the matching score."}</p>
      </div>
      <form onSubmit={submitTag} className="border-b border-cc-border px-5 py-4">
        <label htmlFor={"new-tag-" + category.id} className="sr-only">New tag in {category.name}</label>
        <div className="flex gap-2"><Input id={"new-tag-" + category.id} value={newTagLabel} onChange={event => setNewTagLabel(event.target.value)} disabled={busy || !category.is_active} placeholder="Add a tag" className="min-h-11 min-w-0 rounded-full px-4" aria-invalid={!!newTagLabel.trim() && !!duplicateTag} aria-describedby={duplicateTag ? "duplicate-" + category.id : undefined} />
        <button type="submit" disabled={busy || !category.is_active || !newTagLabel.trim() || !!duplicateTag} className={ctaClass}><Plus size={16} />{addTagMutation.isPending ? "Adding..." : "Add"}</button></div>
        {newTagLabel.trim() && duplicateTag && <p id={"duplicate-" + category.id} role="status" className="mt-2 text-xs text-cc-muted">{duplicateTag.is_active ? "This tag already exists in this category." : "This tag already exists and is inactive."}{!duplicateTag.is_active && <button type="button" disabled={busy || !category.is_active} onClick={() => toggleTagMutation.mutate({ tagId: duplicateTag.id, isActive: true })} className="ml-2 min-h-10 font-semibold text-cc-plum">Reactivate existing tag</button>}</p>}
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><p className="text-xs text-cc-muted" role="status">{tags.length} tags shown</p><label className="flex items-center gap-2 text-xs text-cc-muted">Tag status<select aria-label={"Tag status in " + category.name} value={tagStatus} onChange={event => setTagStatus(event.target.value)} className="min-h-10 rounded-full border border-cc-border bg-cc-surface px-3 text-cc-text"><option value="all">All tags</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
      <div className="grid max-h-[480px] min-h-16 grid-cols-1 gap-x-6 overflow-y-auto px-5 pb-2 xl:grid-cols-2" role="list" aria-label={category.name + " tags"}>
        {tags.map(tag => <div key={tag.id} role="listitem" className="flex min-h-12 items-center justify-between gap-2 border-b border-cc-border py-2 last:border-0">
          <span className="min-w-0 break-words text-sm text-cc-text">{tag.label}{!tag.is_active && <span className="ml-2 text-xs text-cc-muted">Inactive</span>}</span>
          <button type="button" disabled={busy || !category.is_active} onClick={() => toggleTagMutation.mutate({ tagId: tag.id, isActive: !tag.is_active })} aria-label={(tag.is_active ? "Deactivate " : "Reactivate ") + tag.label} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-cc-text hover:bg-cc-soft disabled:opacity-50">
            {tag.is_active ? <Pause size={14} /> : <RotateCcw size={14} />}{tag.is_active ? "Deactivate" : "Reactivate"}
          </button>
        </div>)}
        {!tags.length && <p className="py-4 text-sm text-cc-muted">{query ? "No tags match this search in this category." : "No tags to show. Add a tag above or change the tag status filter."}</p>}
      </div>

    </section>
  );
}

export default function TagManagementPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { data, isLoading, error, refetch } = useOrgQuery(["coordinator-tags"], { queryFn: getTagCatalog });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryRole, setNewCategoryRole] = useState<TagMatchingRole>(null);

  const addCategoryMutation = useMutation({
    mutationFn: ({ name, role }: { name: string; role: TagMatchingRole }) => createTagCategory(name, role ?? undefined),
    onSuccess: (created) => {
      setSelectedId(created.id);
      setSearch("");
      setStatus("all");
      setRoleFilter("all");
      toast({ title: "Category created", description: "Add tags to " + created.name + " to get started." });
      setNewCategoryName("");
      setNewCategoryRole(null);
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: [orgId, "coordinator-tags"] });
    },
    onError: (err) => toast({ title: "Could not add category", description: (err as Error).message, variant: "destructive" }),
  });

  function submitCategory(event: React.FormEvent) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name || duplicateCategory || addCategoryMutation.isPending) return;
    addCategoryMutation.mutate({ name, role: newCategoryRole });
  }

  const duplicateCategory = (data ?? []).some(category => category.name.trim().toLowerCase() === newCategoryName.trim().toLowerCase());
  const query = search.trim().toLowerCase();
  const filtered = (data ?? []).filter(category =>
    (status === "all" || category.is_active === (status === "active")) &&
    (roleFilter === "all" || (category.matching_role ?? "none") === roleFilter) &&
    (category.name.toLowerCase().includes(query) || category.tags.some(tag => tag.label.toLowerCase().includes(query)))
  );
  const selected = filtered.find(category => category.id === selectedId) ?? filtered[0];
  return (
    <HubLayout>
      <div className="space-y-6 pb-12">
        <PageHeader
          eyebrow="Workforce & People"
          title="Matching tags"
          description="Organise the interests and experience used to match participants with support workers."
          actions={<button type="button" onClick={() => setShowCreate(!showCreate)} aria-expanded={showCreate} aria-controls="create-tag-category" className={`${ctaClass} w-full sm:w-auto`}><Plus size={16} />Add category</button>}
        />
        {showCreate && <section id="create-tag-category" className="rounded-2xl bg-cc-surface p-5">
          <h2 className="mb-3 text-lg font-semibold text-cc-text">New category</h2>
          <form onSubmit={submitCategory} className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div><label htmlFor="category-name" className="mb-1.5 block text-xs font-medium text-cc-muted">Category name</label><Input autoFocus id="category-name" value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} disabled={addCategoryMutation.isPending} placeholder="e.g. Communication preferences" className="min-h-11 rounded-full px-4" aria-invalid={!!newCategoryName.trim() && duplicateCategory} aria-describedby={duplicateCategory ? "category-duplicate" : undefined} /></div>
            <div><label htmlFor="category-role" className="mb-1.5 block text-xs font-medium text-cc-muted">Used in matching as</label><select id="category-role" value={newCategoryRole ?? "none"} disabled={addCategoryMutation.isPending} onChange={event => setNewCategoryRole(event.target.value === "none" ? null : event.target.value as TagMatchingRole)} className="min-h-11 w-full rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text"><option value="none">Profile information only</option><option value="interests">Interests</option><option value="lived_experience">Lived experience</option></select></div>
            <div className="flex gap-2"><button type="button" disabled={addCategoryMutation.isPending} onClick={() => setShowCreate(false)} className={outlineClass}>Cancel</button><button type="submit" disabled={addCategoryMutation.isPending || !newCategoryName.trim() || duplicateCategory} className={ctaClass}>{addCategoryMutation.isPending ? "Creating..." : "Create category"}</button></div>
          </form>
          {newCategoryName.trim() && duplicateCategory && <p id="category-duplicate" role="status" className="mt-2 text-sm text-cc-muted">This category already exists. Find it in the list below.</p>}
        </section>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm"><label htmlFor="tag-search" className="sr-only">Find a category or tag</label><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-cc-muted" /><input id="tag-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search the tag catalogue" className="h-11 w-full rounded-full border border-cc-border bg-cc-surface pl-11 pr-4 text-sm text-cc-text outline-none transition focus:ring-2 focus:ring-cc-plum" /></div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="category-status" className="sr-only">Category status</label><select id="category-status" value={status} onChange={event => setStatus(event.target.value)} className="min-h-10 rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text"><option value="all">All categories</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            <label htmlFor="role-filter" className="sr-only">Matching purpose</label><select id="role-filter" value={roleFilter} onChange={event => setRoleFilter(event.target.value)} className="min-h-10 rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text"><option value="all">All purposes</option><option value="interests">Interests</option><option value="lived_experience">Lived experience</option><option value="none">Profile information only</option></select>
          </div>
        </div>
        {isLoading ? <div role="status" aria-label="Loading matching tags" className="h-64 animate-pulse rounded-2xl bg-cc-surface" /> : error ? <LoadError onRetry={() => void refetch()}>Could not load the tag catalogue.</LoadError> : <>
          <p role="status" className="text-sm text-cc-muted">Showing {filtered.length} of {data?.length ?? 0} categories</p>
          {filtered.length ? <div className="overflow-hidden rounded-2xl bg-cc-surface md:grid md:grid-cols-[260px_minmax(0,1fr)]">
            <nav aria-label="Tag categories" className="border-b border-cc-border p-3 md:border-b-0 md:border-r">
              <p className="px-3 py-2 text-sm font-semibold text-cc-text">Categories</p>
              <label htmlFor="category-picker" className="sr-only">Select a category</label>
              <select id="category-picker" value={selected?.id ?? ""} onChange={event => setSelectedId(event.target.value)} className="min-h-11 w-full rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text md:hidden">{filtered.map(category => <option key={category.id} value={category.id}>{category.name} ({category.tags.length})</option>)}</select>
              <div className="hidden max-h-[640px] space-y-1 overflow-y-auto md:block">{filtered.map(category => <button key={category.id} type="button" onClick={() => setSelectedId(category.id)} aria-current={selected?.id === category.id ? "true" : undefined} className={"flex min-h-14 w-full items-center justify-between gap-2 rounded-2xl px-3 py-3 text-left transition-colors " + (selected?.id === category.id ? "bg-cc-soft text-cc-text" : "text-cc-text hover:bg-cc-soft")}><span className="min-w-0"><span className="block break-words text-sm font-semibold">{category.name}</span><span className="mt-0.5 block text-xs text-cc-muted">{!category.is_active ? "Inactive" : category.matching_role === "interests" ? "Interests matching" : category.matching_role === "lived_experience" ? "Experience matching" : "Profile information"}</span></span><span className="text-xs font-semibold tabular-nums text-cc-muted">{category.tags.length}</span></button>)}</div>
            </nav>
            <div className="min-w-0">{filtered.map(category => <div key={category.id} hidden={selected?.id !== category.id}><CategoryCard category={category} search={search} onTagAdded={() => { setSelectedId(category.id); setSearch(""); }} /></div>)}</div>
          </div> : <div className="rounded-2xl bg-cc-surface px-6 py-12 text-center"><Tags size={26} className="mx-auto mb-3 text-cc-muted" /><h2 className="text-base font-semibold text-cc-text">{data?.length ? "No matching categories" : "Start your tag catalogue"}</h2><p className="mt-1 text-sm text-cc-muted">{data?.length ? "Try a different search or clear your filters." : "Add a category, then create tags your team can use on participant and worker profiles."}</p><button type="button" className={`${outlineClass} mt-4`} onClick={() => { if (!data?.length) setShowCreate(true); else { setSearch(""); setStatus("all"); setRoleFilter("all"); } }}>{data?.length ? "Clear filters" : "Add your first category"}</button></div>}
        </>}
        <details className="rounded-2xl bg-cc-surface px-5 py-3 text-sm">
          <summary className="flex min-h-9 cursor-pointer items-center gap-2 font-medium text-cc-text">How tags affect matching<ChevronDown size={14} /></summary>
          <p className="pb-2 leading-relaxed text-cc-muted">Interests and lived experience categories contribute to the matching score. Profile information only categories add context without changing the score. Tags support matching alongside availability and credential checks. Deactivating a tag keeps existing assignments and removes it from new selections.</p>
        </details>

      </div>
    </HubLayout>
  );
}
