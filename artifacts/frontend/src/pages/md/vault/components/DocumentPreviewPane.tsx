import { useEffect, useState } from "react";
import { Eye, FileText, Share2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchDocumentFile, type VaultDocument } from "@/services/vaultService";

type PreviewKind = "pdf" | "image" | "unsupported";

function formatDate(iso: string): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Right-hand pane for the folder view: a live preview of whichever
 * document was last clicked, a per-document "leave this field out" toggle
 * list so an MD can redact specific content before it ever reaches a share
 * (not just include/exclude the whole file), and a persistent "share
 * basket" of whatever is currently checked — so the whole decision of what
 * goes to the auditor happens right here, with the preview updating live,
 * instead of ticking boxes blind in a list. */
export function DocumentPreviewPane({
  doc,
  isSelected,
  onToggleSelected,
  customizableFields,
  excludedFields,
  onToggleExcludedField,
  selectedDocs,
  onRemoveSelected,
  onShare,
}: {
  doc: VaultDocument | null;
  isSelected: boolean;
  onToggleSelected: () => void;
  customizableFields: string[];
  excludedFields: Set<string>;
  onToggleExcludedField: (field: string) => void;
  selectedDocs: VaultDocument[];
  onRemoveSelected: (id: string) => void;
  onShare: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<PreviewKind | null>(null);
  const [loading, setLoading] = useState(false);

  const excludedKey = Array.from(excludedFields).sort().join("|");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setPreviewKind(null);
    if (!doc) return undefined;

    setLoading(true);
    fetchDocumentFile(doc.category, doc.id, Array.from(excludedFields))
      .then(({ blob }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        if (blob.type === "application/pdf") setPreviewKind("pdf");
        else if (blob.type.startsWith("image/")) setPreviewKind("image");
        else setPreviewKind("unsupported");
      })
      .catch(() => {
        if (!cancelled) setPreviewKind("unsupported");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.category, doc?.id, excludedKey]);

  return (
    <div className="flex h-full flex-col rounded-2xl border" style={{ borderColor: "var(--cc-border)", background: "var(--cc-surface)" }}>
      <div className="flex min-h-[560px] flex-1 flex-col border-b" style={{ borderColor: "var(--cc-border)" }}>
        {!doc ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Eye size={22} style={{ color: "var(--cc-muted)" }} />
            <p className="text-[12.5px] font-semibold" style={{ color: "var(--cc-muted)" }}>
              Select a document to preview it
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-2 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-bold" style={{ color: "var(--cc-text)" }}>
                  {doc.title}
                </p>
                <p className="text-[11.5px]" style={{ color: "var(--cc-muted)" }}>
                  {doc.person_name} · {formatDate(doc.date)}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-bold" style={{ color: "var(--cc-text)" }}>
                <Checkbox checked={isSelected} onCheckedChange={onToggleSelected} />
                Include
              </label>
            </div>

            {customizableFields.length > 0 && (
              <div className="border-t px-3.5 py-2.5" style={{ borderColor: "var(--cc-border)" }}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <SlidersHorizontal size={12} style={{ color: "var(--cc-muted)" }} />
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>
                    Customize what's shared
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {customizableFields.map((field) => {
                    const excluded = excludedFields.has(field);
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => onToggleExcludedField(field)}
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                          borderColor: excluded ? "var(--cc-status-danger)" : "var(--cc-border)",
                          color: excluded ? "var(--cc-status-danger)" : "var(--cc-text)",
                          background: excluded ? "var(--cc-status-danger-bg)" : "transparent",
                          textDecoration: excluded ? "line-through" : "none",
                        }}
                      >
                        {field}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 px-3.5 pb-3.5 pt-2.5">
              {loading ? (
                <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--cc-muted)" }}>
                  Loading preview…
                </div>
              ) : previewKind === "pdf" && previewUrl ? (
                <iframe title={doc.title} src={previewUrl} className="h-full min-h-[420px] w-full rounded-lg border-0" />
              ) : previewKind === "image" && previewUrl ? (
                <img src={previewUrl} alt={doc.title} className="mx-auto max-h-full max-w-full rounded-lg object-contain" />
              ) : (
                <div
                  className="flex h-full min-h-[380px] flex-col items-center justify-center gap-2 rounded-lg text-center"
                  style={{ background: "var(--cc-soft)" }}
                >
                  <FileText size={22} style={{ color: "var(--cc-muted)" }} />
                  <p className="px-4 text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    No inline preview for this file type.
                  </p>
                  {previewUrl && (
                    <Button size="sm" variant="outline" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}>
                      Open in new tab
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3.5">
        <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-text)" }}>
          Selected for sharing ({selectedDocs.length})
        </p>
        {selectedDocs.length === 0 ? (
          <p className="text-[11.5px]" style={{ color: "var(--cc-muted)" }}>
            Tick "Include" above, or check rows in the list, to build a share set.
          </p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {selectedDocs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1" style={{ background: "var(--cc-soft)" }}>
                <p className="truncate text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>
                  {d.title}
                </p>
                <button type="button" onClick={() => onRemoveSelected(d.id)} aria-label={`Remove ${d.title} from selection`}>
                  <X size={13} style={{ color: "var(--cc-muted)" }} />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button
          disabled={selectedDocs.length === 0}
          className="mt-1 w-full gap-2"
          onClick={onShare}
          style={{ background: "var(--cc-plum)", color: "white" }}
        >
          <Share2 size={14} />
          Share with auditor
        </Button>
      </div>
    </div>
  );
}
