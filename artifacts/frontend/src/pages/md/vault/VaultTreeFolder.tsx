import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Folder } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useToast } from "@/hooks/use-toast";
import { triggerBlobDownload } from "@/lib/vaultZip";
import {
  fetchDocumentFile,
  fetchTreeSubfolderDocuments,
  fetchVaultTree,
  type VaultDocument,
  type VaultTreeFolder,
} from "@/services/vaultService";
import { DocumentTable } from "./components/DocumentTable";
import { DocumentPreviewPane } from "./components/DocumentPreviewPane";
import { ShareAuditorDialog } from "./components/ShareAuditorDialog";

const NO_FIELDS = new Set<string>();

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";

export default function VaultTreeFolderPage({ top, sub }: { top: string; sub?: string }) {
  const { toast } = useToast();
  const [tree, setTree] = useState<VaultTreeFolder[] | null>(null);
  const [documents, setDocuments] = useState<VaultDocument[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVaultTree()
      .then((folders) => { if (!cancelled) setTree(folders); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the vault."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sub) return;
    let cancelled = false;
    setDocuments(null);
    setSelected(new Set());
    setPreviewId(null);
    fetchTreeSubfolderDocuments(top, sub)
      .then((docs) => { if (!cancelled) setDocuments(docs); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load these documents.");
        setDocuments([]);
      });
    return () => { cancelled = true; };
  }, [top, sub]);

  const topFolder = tree?.find((f) => f.key === top);
  const subFolder = topFolder?.subfolders.find((s) => s.key === sub);

  async function handleDownload(doc: VaultDocument) {
    try {
      const { filename, blob } = await fetchDocumentFile(doc.category, doc.id);
      triggerBlobDownload(blob, filename);
    } catch {
      toast({ title: "Couldn't download this document", variant: "destructive" });
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      documents && prev.size < documents.length ? new Set(documents.map((d) => d.id)) : new Set()
    );
  }

  const topLabel = topFolder?.label ?? "";
  const subLabel = subFolder?.label ?? "";

  return (
    <HubLayout>
      <div className="space-y-6 pb-12">
        <nav className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>
          <Link href="/md/vault" className="hover:underline">Documents & Audit Vault</Link>
          {topLabel && (
            <>
              <ChevronRight size={14} />
              {sub ? (
                <Link href={`/md/vault/tree/${top}`} className="hover:underline">{topLabel}</Link>
              ) : (
                <span style={{ color: TEXT }}>{topLabel}</span>
              )}
            </>
          )}
          {sub && subLabel && (
            <>
              <ChevronRight size={14} />
              <span style={{ color: TEXT }}>{subLabel}</span>
            </>
          )}
        </nav>

        <h1 className="text-xl font-semibold tracking-[-0.025em]" style={{ color: TEXT }}>
          {sub ? subLabel : topLabel}
        </h1>

        {loadError && (
          <p className="text-[13px] font-semibold" style={{ color: "#9A5B0A" }}>{loadError}</p>
        )}

        {!sub && tree === null && !loadError && (
          <p className="text-[13px]" style={{ color: MUTED }}>Loading…</p>
        )}

        {!sub && topFolder && (
          topFolder.subfolders.length === 0 ? (
            <p className="rounded-2xl border p-6 text-center text-[13px]" style={{ borderColor: BORDER, background: SURFACE, color: MUTED }}>
              No documents in this folder yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {topFolder.subfolders.map((s) => (
                <Link
                  key={s.key}
                  href={s.category ? `/md/vault/${s.category}` : `/md/vault/tree/${top}/${s.key}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border p-4 transition-colors hover:bg-black/5"
                  style={{ borderColor: BORDER, background: SURFACE }}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--cc-plum-soft)", color: PLUM }}>
                      <Folder size={16} />
                    </span>
                    <span className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{s.label}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold" style={{ color: MUTED }}>{s.count}</span>
                </Link>
              ))}
            </div>
          )
        )}

        {sub && (
          documents === null ? (
            <p className="text-[13px]" style={{ color: MUTED }}>Loading…</p>
          ) : documents.length === 0 ? (
            <p className="rounded-2xl border p-6 text-center text-[13px]" style={{ borderColor: BORDER, background: SURFACE, color: MUTED }}>
              No documents in this folder yet.
            </p>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 lg:w-[33%]">
                <DocumentTable
                  documents={documents}
                  showCategoryColumn
                  selectedIds={selected}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                  onDownload={handleDownload}
                  onPreview={(d) => setPreviewId(d.id)}
                  focusedId={previewId}
                />
              </div>
              <div className="w-full lg:sticky lg:top-[75px] lg:w-[67%] lg:self-start">
                <DocumentPreviewPane
                  doc={documents.find((d) => d.id === previewId) ?? null}
                  customizableFields={[]}
                  excludedFields={NO_FIELDS}
                  onToggleExcludedField={() => {}}
                  selectedDocs={documents.filter((d) => selected.has(d.id))}
                  onRemoveSelected={toggle}
                  bulkExcludedFields={NO_FIELDS}
                  onToggleExcludedFieldForAll={() => {}}
                  onShare={() => setShareOpen(true)}
                />
              </div>
            </div>
          )
        )}
      </div>

      {sub && documents && (
        <ShareAuditorDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          documents={documents
            .filter((d) => selected.has(d.id))
            .map((d) => ({ category: d.category, id: d.id, exclude_fields: [] }))}
          folderKeys={Array.from(new Set(documents.map((d) => d.category)))}
          targetDescription={subLabel}
        />
      )}
    </HubLayout>
  );
}
