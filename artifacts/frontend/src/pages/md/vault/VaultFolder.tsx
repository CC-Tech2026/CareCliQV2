import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, Upload, ChevronRight } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  fetchFolderDocuments,
  fetchDocumentFile,
  fetchFolderMeta,
  fetchCustomizableFields,
  uploadGovernanceDocument,
  uploadCustomFolderDocument,
  type VaultDocument,
  type VaultFolder as VaultFolderMeta,
} from "@/services/vaultService";
import { triggerBlobDownload } from "@/lib/vaultZip";
import { DocumentTable } from "./components/DocumentTable";
import { DocumentPreviewPane } from "./components/DocumentPreviewPane";
import { ShareAuditorDialog } from "./components/ShareAuditorDialog";
import { FolderUploadDialog } from "./components/FolderUploadDialog";

const CUSTOM_FOLDER_PREFIX = "custom:";
const PAGE_SIZE = 20;

const GOVERNANCE_FOLDER_KEYS = new Set([
  "governance_operational",
  "risk_management",
  "quality_management",
  "information_management",
  "feedback_complaints",
  "incident_management_system",
  "human_resource_management",
  "continuity_of_supports",
  "emergency_disaster_management",
]);

const DATE_PRESETS = [
  { key: "all", label: "All time" },
  { key: "3m", label: "Last 3 months" },
  { key: "6m", label: "Last 6 months" },
  { key: "1y", label: "Last year" },
  { key: "custom", label: "Custom range" },
] as const;

function presetToDateFrom(preset: string): string | undefined {
  const days: Record<string, number> = { "3m": 90, "6m": 180, "1y": 365 };
  const d = days[preset];
  if (!d) return undefined;
  const date = new Date();
  date.setDate(date.getDate() - d);
  return date.toISOString().slice(0, 10);
}

export default function VaultFolderPage({ category }: { category: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [meta, setMeta] = useState<VaultFolderMeta | null>(null);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<string>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [docExclusions, setDocExclusions] = useState<Record<string, Set<string>>>({});
  const [customizableFields, setCustomizableFields] = useState<Record<string, string[]>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const isGovernance = GOVERNANCE_FOLDER_KEYS.has(category);
  const isCustom = category.startsWith(CUSTOM_FOLDER_PREFIX);
  const customFolderId = isCustom ? category.slice(CUSTOM_FOLDER_PREFIX.length) : null;
  const canUpload = isGovernance || isCustom;

  useEffect(() => {
    setSelectedIds(new Set());
    setPreviewId(null);
    setPage(1);
    void loadMeta();
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    setPage(1);
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, person, datePreset, customFrom, customTo]);

  useEffect(() => {
    fetchCustomizableFields()
      .then(setCustomizableFields)
      .catch(() => setCustomizableFields({}));
  }, []);

  async function loadMeta() {
    try {
      setMeta(await fetchFolderMeta(category));
    } catch {
      // non-fatal — the page still works without the header count/label refreshing
    }
  }

  async function loadDocuments() {
    setLoading(true);
    try {
      const date_from = datePreset === "custom" ? customFrom || undefined : presetToDateFrom(datePreset);
      const date_to = datePreset === "custom" ? customTo || undefined : undefined;
      const docs = await fetchFolderDocuments(category, {
        search: search || undefined,
        person: person !== "all" ? person : undefined,
        date_from,
        date_to,
      });
      setDocuments(docs);
    } catch {
      toast({ title: "Could not load this folder", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const people = useMemo(() => {
    const names = new Set(documents.map((d) => d.person_name).filter(Boolean));
    return Array.from(names).sort();
  }, [documents]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    // Scoped to the visible page, matching the checkbox's own visual state
    // (DocumentTable computes "all selected" from whatever slice it's given).
    const allSelected = pagedDocuments.length > 0 && pagedDocuments.every((d) => selectedIds.has(d.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const d of pagedDocuments) {
        if (allSelected) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });
  }

  async function handleDownloadOne(doc: VaultDocument) {
    try {
      const exclude = Array.from(docExclusions[doc.id] ?? []);
      const { filename, blob } = await fetchDocumentFile(doc.category, doc.id, exclude);
      triggerBlobDownload(blob, filename);
    } catch {
      toast({ title: "Couldn't download this document", variant: "destructive" });
    }
  }

  function toggleExcludedField(field: string) {
    if (!previewId) return;
    setDocExclusions((prev) => {
      const current = new Set(prev[previewId] ?? []);
      if (current.has(field)) current.delete(field);
      else current.add(field);
      return { ...prev, [previewId]: current };
    });
  }

  const selectedDocIds = documents.filter((d) => selectedIds.has(d.id)).map((d) => d.id);

  // A field only shows as "on" for the bulk row once every selected
  // document already has it excluded - toggling it then flips all of them
  // together in one direction, so it can't leave some selected docs
  // redacted and others not without the MD explicitly seeing that state.
  const bulkExcludedFields = new Set(
    (customizableFields[category] ?? []).filter(
      (field) => selectedDocIds.length > 0 && selectedDocIds.every((id) => docExclusions[id]?.has(field))
    )
  );

  function toggleExcludedFieldForSelected(field: string) {
    if (selectedDocIds.length === 0) return;
    const allExcluded = selectedDocIds.every((id) => docExclusions[id]?.has(field));
    setDocExclusions((prev) => {
      const next = { ...prev };
      for (const id of selectedDocIds) {
        const current = new Set(next[id] ?? []);
        if (allExcluded) current.delete(field);
        else current.add(field);
        next[id] = current;
      }
      return next;
    });
  }

  const selectedRefs = documents
    .filter((d) => selectedIds.has(d.id))
    .map((d) => ({ category: d.category, id: d.id, exclude_fields: Array.from(docExclusions[d.id] ?? []) }));
  const label = meta?.label || documents[0]?.folder_label || category.replace(/_/g, " ");

  const totalPages = Math.max(1, Math.ceil(documents.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedDocuments = documents.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <HubLayout>
      <div className="space-y-4 pb-12">
        <nav className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>
          <button type="button" onClick={() => navigate("/md/vault")} className="hover:underline" style={{ color: "var(--cc-plum)" }}>
            Documents & Audit Vault
          </button>
          <ChevronRight size={13} />
          <span>{label}</span>
        </nav>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black tracking-[-0.025em]" style={{ color: "var(--cc-text)" }}>
              {label}
            </h1>
            <p className="mt-0.5 text-[13px]" style={{ color: "var(--cc-muted)" }}>
              {documents.length} document{documents.length === 1 ? "" : "s"}
            </p>
          </div>
          {canUpload && (
            <Button className="gap-2 shrink-0" onClick={() => setUploadOpen(true)} style={{ background: "var(--cc-plum)", color: "white" }}>
              <Upload size={15} />
              Upload document
            </Button>
          )}
        </div>

        <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--cc-border)", background: "var(--cc-surface)" }}>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--cc-muted)" }} />
              <Input className="pl-8" placeholder="Search this folder" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All participants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All participants</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setDatePreset(p.key)}
                className="rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{
                  background: datePreset === p.key ? "var(--cc-plum)" : "var(--cc-soft)",
                  color: datePreset === p.key ? "white" : "var(--cc-muted)",
                }}
              >
                {p.label}
              </button>
            ))}
            {datePreset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-md border px-2 py-1 text-[12px]"
                  style={{ borderColor: "var(--cc-border)" }}
                />
                <span className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                  to
                </span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-md border px-2 py-1 text-[12px]"
                  style={{ borderColor: "var(--cc-border)" }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-1 flex flex-col gap-4 lg:flex-row lg:items-start lg:h-[calc(100vh-220px)] lg:min-h-[640px]">
          <div className="min-w-0 lg:flex lg:h-full lg:w-[33%] lg:flex-col">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg" style={{ background: "var(--cc-soft)" }} />
                ))}
              </div>
            ) : (
              <DocumentTable
                documents={pagedDocuments}
                selectedIds={selectedIds}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onDownload={(d) => void handleDownloadOne(d)}
                onPreview={(d) => setPreviewId(d.id)}
                focusedId={previewId}
                pagination={{
                  page: safePage,
                  totalPages,
                  from: documents.length === 0 ? 0 : pageStart + 1,
                  to: Math.min(pageStart + PAGE_SIZE, documents.length),
                  total: documents.length,
                  onPageChange: setPage,
                }}
              />
            )}
          </div>

          <div className="w-full lg:sticky lg:top-[75px] lg:h-full lg:w-[67%]">
            <DocumentPreviewPane
              doc={documents.find((d) => d.id === previewId) ?? null}
              showVersionHistory={isGovernance}
              customizableFields={customizableFields[category] ?? []}
              excludedFields={(previewId && docExclusions[previewId]) || new Set()}
              onToggleExcludedField={toggleExcludedField}
              selectedDocs={documents.filter((d) => selectedIds.has(d.id))}
              onRemoveSelected={toggle}
              bulkExcludedFields={bulkExcludedFields}
              onToggleExcludedFieldForAll={toggleExcludedFieldForSelected}
              onShare={() => setShareOpen(true)}
            />
          </div>
        </div>
      </div>

      <ShareAuditorDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        documents={selectedRefs}
        folderKeys={[category]}
        targetDescription={`All ${selectedRefs.length} selected file${selectedRefs.length === 1 ? "" : "s"} in ${label}`}
      />

      {canUpload && (
        <FolderUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          folderLabel={label}
          withDescription={isGovernance}
          existingDocuments={isGovernance ? documents.map((d) => ({ id: d.id, title: d.title })) : undefined}
          onUpload={({ title, description, file, supersedesDocumentId, versionLabel }) =>
            isCustom && customFolderId
              ? uploadCustomFolderDocument({ folderId: customFolderId, title, file })
              : uploadGovernanceDocument({
                  folderKey: category,
                  title,
                  description,
                  file,
                  supersedesDocumentId,
                  versionLabel,
                })
          }
          onUploaded={() => {
            void loadDocuments();
            void loadMeta();
          }}
        />
      )}
    </HubLayout>
  );
}
