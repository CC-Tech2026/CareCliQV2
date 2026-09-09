import { jsonFetch } from "@/services/http";
import { useState } from "react";
import {
  BookOpen,
  FileText,
  PlayCircle,
  Search,
  ExternalLink,
  LockKeyhole,
  Loader2,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import {
  getSharedTrainingResources,
  getSharedTrainingResourceUrl,
  type TrainingModule,
} from "@/services/workerPerformanceService";
import { safeMaterialUrl } from "@/lib/training";

export function SharedResourceAccess({
  id,
  name,
  accessUrl,
}: {
  id: string;
  name: string;
  accessUrl?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const { toast } = useToast();
  async function open() {
    setBusy(true);
    const preview = window.open("", "_blank");
    if (preview) preview.opener = null;
    try {
      const { url } = accessUrl
        ? await jsonFetch<{ url: string }>(accessUrl)
        : await getSharedTrainingResourceUrl(id);
      const safeUrl = safeMaterialUrl(url);
      if (!safeUrl) throw new Error("The resource link is unavailable.");
      if (preview) preview.location.href = safeUrl;
      else setFallback(safeUrl);
    } catch (error) {
      preview?.close();
      toast({
        title: "Could not open resource",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={busy}
        onClick={() => void open()}
        aria-label={`Open ${name}`}
        className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs font-bold disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ExternalLink size={14} />
        )}
        Open
      </button>
      {fallback && (
        <a
          href={fallback}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline"
        >
          View file
        </a>
      )}
    </div>
  );
}

export function WorkerResourceLibrary({
  modules,
}: {
  modules: TrainingModule[];
}) {
  const query = useOrgQuery(["worker", "training-shared-resources"], {
    queryFn: getSharedTrainingResources,
    refetchInterval: 30000,
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const shared = query.data?.resources ?? [];
  const categories = [
    ...new Set(shared.map((r) => r.category || "General")),
  ].sort();
  const matches = (text: string) =>
    text.toLowerCase().includes(search.trim().toLowerCase());
  const visible = shared.filter(
    (r) =>
      matches(`${r.name} ${r.category ?? ""}`) &&
      (category === "all" || category === (r.category || "General")),
  );
  const materials = modules
    .filter((m) => !m.is_locked)
    .flatMap((module) =>
      (module.resources ?? []).map((resource) => ({ module, resource })),
    )
    .filter(({ module, resource }) =>
      matches(`${resource.title} ${module.title}`),
    );
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BookOpen size={23} />
        </div>
        <h2 className="text-xl font-bold">Your resource library</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Find guidelines, policies, reference documents and course materials
          whenever you need them. Shared resources remain available outside your
          assigned training.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-card px-4 py-3">
          <Search size={17} className="text-muted-foreground" />
          <input
            aria-label="Search resources"
            placeholder="Search guidelines, policies or materials"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 w-full bg-transparent text-sm outline-none"
          />
        </label>
        <select
          aria-label="Resource category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl border bg-card px-3 py-2 text-sm"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <section className="space-y-3">
        <h3 className="font-bold">
          Guidelines & shared resources{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {visible.length}
          </span>
        </h3>
        {query.isLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading resources…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="rounded-xl border p-4 text-sm">
            Unable to load shared resources.{" "}
            <button
              onClick={() => void query.refetch()}
              className="font-semibold underline"
            >
              Try again
            </button>
          </div>
        )}
        {!query.isLoading && !query.isError && !visible.length && (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {shared.length
              ? "No resources match your search."
              : "Your organisation has not published shared resources yet."}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((r) => (
            <article
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
            >
              <div className="rounded-xl bg-sky-50 p-3 text-sky-700">
                {r.resource_type === "video" ? (
                  <PlayCircle size={22} />
                ) : (
                  <FileText size={22} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="break-words text-sm font-bold">{r.name}</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.category || "General"} · {r.resource_type}
                  {r.file_size_bytes
                    ? ` · ${(r.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                    : ""}
                </p>
              </div>
              <SharedResourceAccess id={r.id} name={r.name} />
            </article>
          ))}
        </div>
      </section>
      {category === "all" && (
        <section className="space-y-3">
          <h3 className="font-bold">
            Course materials{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {materials.length}
            </span>
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {materials.map(({ module, resource }) => (
              <article
                key={`${module.id}/${resource.id}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-4"
              >
                <BookOpen size={22} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h4 className="break-words text-sm font-bold">
                    {resource.title}
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {module.title}
                  </p>
                </div>
                {safeMaterialUrl(resource.access_url || resource.external_url) ? (
                  <a
                    href={safeMaterialUrl(resource.access_url || resource.external_url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${resource.title}`}
                    className="rounded-lg border px-3 py-2 text-xs font-bold"
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Link unavailable
                  </span>
                )}
              </article>
            ))}
          </div>
          {!materials.length && (
            <p className="text-sm text-muted-foreground">
              No course materials match your search.
            </p>
          )}
        </section>
      )}
      {modules.some((m) => m.is_locked) && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-4 text-xs text-amber-900">
          <LockKeyhole size={16} />
          Materials for modules under maintenance return here when the module is
          unlocked.
        </p>
      )}
    </div>
  );
}
