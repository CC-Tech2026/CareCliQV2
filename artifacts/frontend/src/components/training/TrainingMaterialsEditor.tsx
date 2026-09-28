import { useEffect, useRef, useState } from "react";
import { ExternalLink, Pencil, Trash2, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { safeMaterialUrl } from "@/lib/training";
import {
  saveTrainingResource,
  deleteTrainingResource,
  type TrainingResource,
} from "@/services/coordinatorService";

export function TrainingMaterialsEditor({
  moduleId,
  initialResources,
  onChange,
  onBusyChange,
  onDirtyChange,
}: {
  moduleId: string;
  initialResources: TrainingResource[];
  onChange: (resources: TrainingResource[]) => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [resources, setResources] = useState(initialResources);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<TrainingResource["resource_type"]>("pdf");
  const titleInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const original = resources.find((r) => r.id === editing);
  const dirty =
    title !== (original?.title ?? "") ||
    url !== (original?.external_url ?? "") ||
    type !== (original?.resource_type ?? "pdf");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const { toast } = useToast();
  const { user } = useAuth();
  const client = useQueryClient();
  function changed(next: TrainingResource[]) {
    setResources(next);
    onChange(next);
    void client.invalidateQueries({
      queryKey: [user?.organizationId, "worker", "training-modules"],
    });
  }
  function reset() {
    setEditing(null);
    setTitle("");
    setUrl("");
    setType("pdf");
    setError("");
  }
  function canDiscard() {
    return !dirty || window.confirm("Discard unsaved material changes?");
  }
  useEffect(() => {
    if (editing) titleInput.current?.focus();
  }, [editing]);
  async function save() {
    if (!title.trim() || !safeMaterialUrl(url.trim()) || busy) return;
    setBusy(true);
    setError("");
    try {
      const resource = await saveTrainingResource(
        moduleId,
        {
          title: title.trim(),
          external_url: url.trim(),
          resource_type: type,
          sort_order: editing
            ? (resources.find((r) => r.id === editing)?.sort_order ?? 0)
            : Math.max(-1, ...resources.map((r) => r.sort_order ?? 0)) + 1,
        },
        editing || undefined,
      );
      changed(
        editing
          ? resources.map((r) => (r.id === editing ? resource : r))
          : [...resources, resource],
      );
      reset();
      toast({ title: "Material saved" });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save material. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(resource: TrainingResource) {
    if (busy) return;
    if (!window.confirm(`Remove “${resource.title}” from this module?`)) return;
    setBusy(true);
    try {
      await deleteTrainingResource(moduleId, resource.id);
      changed(resources.filter((r) => r.id !== resource.id));
      if (editing === resource.id) {
        reset();
      }
    } catch {
      toast({ title: "Could not remove material", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
      <div>
        <h4 className="text-base font-bold">Learning materials</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Materials save immediately and appear in the worker’s course. Add a
          video, PDF or website that workers can access.
        </p>
      </div>
      <ol className="space-y-2">
        {resources.map((r, i) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border bg-background p-3 sm:p-4"
          >
            <span className="text-xs text-muted-foreground">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold">{r.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.resource_type === "pdf"
                  ? "Reading / PDF"
                  : r.resource_type === "video"
                    ? "Video"
                    : "Website"}
              </p>
            </div>
            {safeMaterialUrl(r.external_url) && (
              <a
                href={safeMaterialUrl(r.external_url)!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Preview ${r.title}`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border hover:bg-muted"
              >
                <ExternalLink size={14} />
              </a>
            )}
            <button
              disabled={busy}
              aria-label={`Edit ${r.title}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border hover:bg-muted"
              onClick={() => {
                if (r.id === editing || !canDiscard()) return;
                setError("");
                setEditing(r.id);
                setTitle(r.title);
                setUrl(r.external_url ?? "");
                setType(r.resource_type);
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              disabled={busy}
              aria-label={`Remove ${r.title}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-destructive hover:bg-muted"
              onClick={() => void remove(r)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ol>
      {!resources.length && (
        <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
          No learning materials yet.
        </p>
      )}
      <fieldset
        disabled={busy}
        className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2"
      >
        <legend className="text-xs font-bold">
          {editing ? "Edit material" : "Add material"}
        </legend>
        <label className="block text-xs font-semibold">
          Material title
          <input
            ref={titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border bg-background p-2 text-sm"
            placeholder="e.g. Safe manual handling guide"
          />
        </label>
        <label className="block text-xs font-semibold">
          Type
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as TrainingResource["resource_type"])
            }
            className="mt-1 w-full rounded-lg border bg-background p-2 text-sm"
          >
            <option value="pdf">Reading / PDF</option>
            <option value="video">Video</option>
            <option value="external_link">Website</option>
          </select>
        </label>
        <label className="block text-xs font-semibold sm:col-span-2">
          Material URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border bg-background p-2 text-sm"
            placeholder="https://"
          />
        </label>
        {url && !safeMaterialUrl(url) && (
          <p role="alert" className="text-xs text-red-600">
            Enter a complete http:// or https:// URL.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:col-span-2"
          >
            {error} Your changes are kept here for retry.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
          <button
            type="button"
            disabled={busy || !title.trim() || !safeMaterialUrl(url)}
            onClick={() => void save()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            <Plus size={13} />
            {busy ? "Saving…" : editing ? "Save material" : "Add material"}
          </button>
          {(editing || dirty) && (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-xl border px-4 text-xs font-semibold"
              onClick={() => {
                if (canDiscard()) reset();
              }}
            >
              {editing ? "Cancel edit" : "Clear draft"}
            </button>
          )}
        </div>
      </fieldset>
    </section>
  );
}
