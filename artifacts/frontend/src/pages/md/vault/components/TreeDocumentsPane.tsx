import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { triggerBlobDownload } from "@/lib/vaultZip";
import { fetchDocumentFile, type VaultDocument } from "@/services/vaultService";
import { DocumentTable } from "./DocumentTable";
import { DocumentPreviewPane } from "./DocumentPreviewPane";
import { ShareAuditorDialog } from "./ShareAuditorDialog";

const NO_FIELDS = new Set<string>();

/** One organised subfolder's documents, with preview and share. */
export function TreeDocumentsPane({
  documents,
  targetDescription,
}: {
  documents: VaultDocument[];
  targetDescription: string;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setSelected(new Set());
    setPreviewId(null);
  }, [documents]);

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
    setSelected((prev) => (prev.size < documents.length ? new Set(documents.map((d) => d.id)) : new Set()));
  }

  return (
    <>
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
      <ShareAuditorDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        documents={documents
          .filter((d) => selected.has(d.id))
          .map((d) => ({ category: d.category, id: d.id, exclude_fields: [] }))}
        folderKeys={Array.from(new Set(documents.map((d) => d.category)))}
        targetDescription={targetDescription}
      />
    </>
  );
}
