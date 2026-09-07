import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, History, Maximize2, Minimize2, Share2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchDocumentFile,
  fetchGovernanceDocumentVersions,
  type GovernanceDocumentVersion,
  type VaultDocument,
} from "@/services/vaultService";

type PreviewKind = "pdf" | "image" | "unsupported" | "not_found";

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
  showVersionHistory = false,
  customizableFields,
  excludedFields,
  onToggleExcludedField,
  selectedDocs,
  onRemoveSelected,
  bulkExcludedFields,
  onToggleExcludedFieldForAll,
  onShare,
}: {
  doc: VaultDocument | null;
  /** Governance folders only — offers a "version history" toggle showing
   * every prior version this document supersedes. */
  showVersionHistory?: boolean;
  customizableFields: string[];
  excludedFields: Set<string>;
  onToggleExcludedField: (field: string) => void;
  selectedDocs: VaultDocument[];
  onRemoveSelected: (id: string) => void;
  bulkExcludedFields: Set<string>;
  onToggleExcludedFieldForAll: (field: string) => void;
  onShare: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<PreviewKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<GovernanceDocumentVersion[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const excludedKey = Array.from(excludedFields).sort().join("|");

  useEffect(() => {
    setHistoryOpen(false);
    setVersions(null);
  }, [doc?.id]);

  // Real browser fullscreen (not a CSS-only overlay) — the PDF/image gets
  // the entire screen, exit via Esc (native) or the button below, which
  // also handles the reverse: exiting fullscreen some other way (browser
  // chrome, F11) keeps this state in sync so the icon never lies.
  useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === frameRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void frameRef.current?.requestFullscreen();
    }
  }

  function toggleHistory() {
    if (!doc) return;
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && versions === null) {
      setVersionsLoading(true);
      fetchGovernanceDocumentVersions(doc.id)
        .then(setVersions)
        .catch(() => setVersions([]))
        .finally(() => setVersionsLoading(false));
    }
  }

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
      .catch((err: unknown) => {
        if (cancelled) return;
        const notFound = err instanceof Error && err.message === "not_found";
        setPreviewKind(notFound ? "not_found" : "unsupported");
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
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border" style={{ borderColor: "var(--cc-border)", background: "var(--cc-surface)" }}>
      {/* No min-height here on purpose — the pane now sits in a
       * viewport-bounded sticky column (see VaultFolder.tsx), so a fixed
       * floor from the pre-sticky layout could force this taller than the
       * space actually available and overflow past the card's edges (the
       * PDF iframe's own backdrop bleeding into whatever sits below it). */}
      <div
        ref={frameRef}
        className="flex min-h-0 flex-1 flex-col border-b"
        style={{ borderColor: "var(--cc-border)", background: "var(--cc-surface)" }}
      >
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
              <div className="flex shrink-0 items-center gap-2">
                {(previewKind === "pdf" || previewKind === "image") && previewUrl && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                    style={{ borderColor: "var(--cc-border)", color: "var(--cc-muted)" }}
                  >
                    {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    {isFullscreen ? "Exit full screen" : "Full screen"}
                  </button>
                )}
                {showVersionHistory && (
                  <button
                    type="button"
                    onClick={toggleHistory}
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                    style={{
                      borderColor: historyOpen ? "var(--cc-plum)" : "var(--cc-border)",
                      color: historyOpen ? "var(--cc-plum)" : "var(--cc-muted)",
                    }}
                  >
                    <History size={12} />
                    Version history
                  </button>
                )}
              </div>
            </div>

            {historyOpen && (
              <div className="border-t px-3.5 py-2.5" style={{ borderColor: "var(--cc-border)" }}>
                {versionsLoading ? (
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    Loading version history…
                  </p>
                ) : !versions || versions.length === 0 ? (
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    No version history yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {versions.map((v) => (
                      <div key={v.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5" style={{ background: "var(--cc-soft)" }}>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold" style={{ color: "var(--cc-text)" }}>
                            {v.title}
                            {v.version_label ? ` · ${v.version_label}` : ""}
                          </p>
                          <p className="text-[10.5px]" style={{ color: "var(--cc-muted)" }}>
                            {v.is_current ? "Current" : "Superseded"} · {formatDate(v.created_at)}
                          </p>
                        </div>
                        {v.file_url && (
                          <a
                            href={v.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-md p-1.5"
                            style={{ color: "var(--cc-muted)" }}
                            aria-label={`Open ${v.title}`}
                          >
                            <Download size={13} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                <iframe title={doc.title} src={previewUrl} className="h-full w-full rounded-lg border-0" />
              ) : previewKind === "image" && previewUrl ? (
                <img src={previewUrl} alt={doc.title} className="mx-auto max-h-full max-w-full rounded-lg object-contain" />
              ) : (
                <div
                  className="flex h-full flex-col items-center justify-center gap-2 rounded-lg text-center"
                  style={{ background: "var(--cc-soft)" }}
                >
                  <FileText size={22} style={{ color: "var(--cc-muted)" }} />
                  <p className="px-4 text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {previewKind === "not_found"
                      ? "No file has been uploaded for this record yet."
                      : previewUrl
                        ? "No inline preview for this file type."
                        : "Couldn't load a preview for this document."}
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

        {selectedDocs.length > 1 && customizableFields.length > 0 && (
          <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--cc-border)" }}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>
              Redact for all {selectedDocs.length} selected
            </p>
            <div className="flex flex-wrap gap-1.5">
              {customizableFields.map((field) => {
                const excluded = bulkExcludedFields.has(field);
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => onToggleExcludedFieldForAll(field)}
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
