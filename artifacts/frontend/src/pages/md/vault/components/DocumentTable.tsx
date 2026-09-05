import { Download, FileText } from "lucide-react";
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
export function DocumentTable({
  documents,
  showCategoryColumn = false,
  selectedIds,
  onToggle,
  onToggleAll,
  onDownload,
  onPreview,
  focusedId,
}: {
  documents: VaultDocument[];
  showCategoryColumn?: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDownload: (doc: VaultDocument) => void;
  onPreview?: (doc: VaultDocument) => void;
  focusedId?: string | null;
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
    <div className="rounded-2xl border" style={{ borderColor: "var(--cc-border)" }}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--cc-border)", background: "var(--cc-soft)" }}>
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={onToggleAll}
        />
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>
          Document
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
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
    </div>
  );
}
