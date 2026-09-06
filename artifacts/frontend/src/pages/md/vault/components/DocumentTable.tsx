import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { VaultDocument } from "@/services/vaultService";

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  reported: { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)" },
  under_investigation: { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)" },
  expiring: { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)" },
  pending_review: { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)" },
  pending: { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)" },
  overdue: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  expired: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  rejected: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  refused: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  missed: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  withheld: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  administration_error: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
  cancelled: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-status-danger)" },
};

function statusTone(status: string) {
  return STATUS_TONE[status] || { bg: "var(--cc-status-success-bg)", fg: "var(--cc-status-success)" };
}

function formatDate(iso: string): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Compact by design — this list shares its pane with a live preview, so
 * every column has to earn its width. Participant folds into the document
 * cell as a subtext line instead of its own column, and status sits next
 * to the download button rather than getting a full column of its own. */
/** Optional paging footer — the caller owns the current page and the slice
 * of `documents` it passes in, this just renders "Showing X-Y of Z" plus
 * prev/next + numbered controls. Omitted entirely when there's only one page. */
function DocumentTablePagination({
  page,
  totalPages,
  from,
  to,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, 4, totalPages];
    if (page >= totalPages - 2) return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, page - 1, page, page + 1, totalPages];
  }, [page, totalPages]);

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2"
      style={{ borderColor: "var(--cc-border)", background: "var(--cc-soft)" }}
    >
      <p className="text-[11px] font-medium tabular-nums" style={{ color: "var(--cc-muted)" }}>
        Showing {from}-{to} of {total}
      </p>
      <nav className="flex items-center gap-1" aria-label="Document pages">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40"
          style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)", background: "var(--cc-surface)" }}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        {pages.map((p, idx) => {
          const prev = pages[idx - 1];
          const showEllipsis = prev != null && p - prev > 1;
          const active = p === page;
          return (
            <span key={p} className="flex items-center gap-1">
              {showEllipsis && (
                <span className="px-0.5 text-[11px] font-bold" style={{ color: "var(--cc-muted)" }} aria-hidden>
                  …
                </span>
              )}
              <button
                type="button"
                onClick={() => onPageChange(p)}
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[11px] font-black tabular-nums"
                style={{
                  borderColor: active ? "var(--cc-plum)" : "var(--cc-border)",
                  background: active ? "var(--cc-plum)" : "var(--cc-surface)",
                  color: active ? "white" : "var(--cc-text)",
                }}
                aria-current={active ? "page" : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40"
          style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)", background: "var(--cc-surface)" }}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </nav>
    </div>
  );
}

export function DocumentTable({
  documents,
  showCategoryColumn = false,
  selectedIds,
  onToggle,
  onToggleAll,
  onDownload,
  onPreview,
  focusedId,
  pagination,
}: {
  documents: VaultDocument[];
  showCategoryColumn?: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDownload: (doc: VaultDocument) => void;
  onPreview?: (doc: VaultDocument) => void;
  focusedId?: string | null;
  /** Renders a paging footer when there's more than one page. `documents`
   * should already be sliced to the current page by the caller. */
  pagination?: { page: number; totalPages: number; from: number; to: number; total: number; onPageChange: (page: number) => void };
}) {
  const allSelected = documents.length > 0 && documents.every((d) => selectedIds.has(d.id));
  const someSelected = documents.some((d) => selectedIds.has(d.id));

  if (documents.length === 0) {
    return (
      <div className="rounded-xl border p-10 text-center text-[13px]" style={{ borderColor: "var(--cc-border)", color: "var(--cc-muted)" }}>
        No documents match these filters.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border overflow-hidden lg:flex lg:h-full lg:flex-col" style={{ borderColor: "var(--cc-border)" }}>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--cc-border)", background: "var(--cc-soft)" }}>
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={onToggleAll}
        />
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>
          Document
        </span>
      </div>
      {/* Only this row list scrolls on desktop — header and pagination
       * footer stay put, so the preview beside it never needs page-scroll. */}
      <div className="divide-y lg:min-h-0 lg:flex-1 lg:overflow-y-auto" style={{ borderColor: "var(--cc-border)" }}>
        {documents.map((doc) => {
          const tone = statusTone(doc.status);
          const isFocused = focusedId === doc.id;
          return (
            <div
              key={`${doc.category}:${doc.id}`}
              onClick={() => onPreview?.(doc)}
              className="flex items-start gap-2 px-3 py-2.5"
              style={{
                background: isFocused ? "var(--cc-active-bg)" : undefined,
                cursor: onPreview ? "pointer" : undefined,
              }}
            >
              <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selectedIds.has(doc.id)} onCheckedChange={() => onToggle(doc.id)} />
              </div>
              <FileText size={15} className="mt-0.5 shrink-0" style={{ color: "var(--cc-muted)" }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>
                  {doc.title}
                </p>
                <p className="truncate text-[11px]" style={{ color: "var(--cc-muted)" }}>
                  {doc.person_name}
                  {showCategoryColumn ? ` · ${doc.folder_label}` : ""}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold capitalize"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {doc.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10.5px]" style={{ color: "var(--cc-muted)" }}>
                    {formatDate(doc.date)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(doc);
                }}
                className="shrink-0 rounded-md p-1.5"
                style={{ color: "var(--cc-muted)" }}
                aria-label={`Download ${doc.title}`}
              >
                <Download size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {pagination && pagination.totalPages > 1 && <DocumentTablePagination {...pagination} />}
    </div>
  );
}
