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
};

function statusTone(status: string) {
  return STATUS_TONE[status] || { bg: "var(--cc-status-success-bg)", fg: "var(--cc-status-success)" };
}

function formatDate(iso: string): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--cc-border)" }}>
      <table className="w-full text-[13px]">
        <thead style={{ background: "var(--cc-soft)" }}>
          <tr className="text-left">
            <th className="w-10 px-3 py-2.5">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={onToggleAll}
              />
            </th>
            <th className="px-3 py-2.5 font-bold" style={{ color: "var(--cc-muted)" }}>
              Document
            </th>
            <th className="px-3 py-2.5 font-bold" style={{ color: "var(--cc-muted)" }}>
              Person
            </th>
            <th className="px-3 py-2.5 font-bold" style={{ color: "var(--cc-muted)" }}>
              Date
            </th>
            <th className="px-3 py-2.5 font-bold" style={{ color: "var(--cc-muted)" }}>
              Status
            </th>
            <th className="w-10 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const tone = statusTone(doc.status);
            const isFocused = focusedId === doc.id;
            return (
              <tr
                key={`${doc.category}:${doc.id}`}
                className="border-t"
                onClick={() => onPreview?.(doc)}
                style={{
                  borderColor: "var(--cc-border)",
                  background: isFocused ? "var(--cc-active-bg)" : undefined,
                  cursor: onPreview ? "pointer" : undefined,
                }}
              >
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(doc.id)} onCheckedChange={() => onToggle(doc.id)} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <FileText size={15} className="mt-0.5 shrink-0" style={{ color: "var(--cc-muted)" }} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold" style={{ color: "var(--cc-text)" }}>
                        {doc.title}
                      </p>
                      {showCategoryColumn && (
                        <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>
                          {doc.folder_label}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-medium" style={{ color: "var(--cc-text)" }}>
                    {doc.person_name}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>
                    {doc.person_type}
                  </p>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--cc-muted)" }}>
                  {formatDate(doc.date)}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className="inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold capitalize"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {doc.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onDownload(doc)}
                    className="rounded-md p-1.5"
                    style={{ color: "var(--cc-muted)" }}
                    aria-label={`Download ${doc.title}`}
                  >
                    <Download size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
