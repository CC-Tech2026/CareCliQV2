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
  fetchVaultFolders,
  uploadGovernanceDocument,
  uploadCustomFolderDocument,
  type VaultDocument,
  type VaultFolder as VaultFolderMeta,
} from "@/services/vaultService";
import { triggerBlobDownload } from "@/lib/vaultZip";
import { DocumentTable } from "./components/DocumentTable";
import { ShareAuditorDialog } from "./components/ShareAuditorDialog";
import { FolderUploadDialog } from "./components/FolderUploadDialog";

const CUSTOM_FOLDER_PREFIX = "custom:";

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
  const [shareOpen, setShareOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const isGovernance = GOVERNANCE_FOLDER_KEYS.has(category);
  const isCustom = category.startsWith(CUSTOM_FOLDER_PREFIX);
  const customFolderId = isCustom ? category.slice(CUSTOM_FOLDER_PREFIX.length) : null;
  const canUpload = isGovernance || isCustom;

  useEffect(() => {
    setSelectedIds(new Set());
    void loadMeta();
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, person, datePreset, customFrom, customTo]);

  async function loadMeta() {
    try {
      const folders = await fetchVaultFolders();
      setMeta(folders.find((f) => f.category === category) ?? null);
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
    const allSelected = documents.length > 0 && documents.every((d) => selectedIds.has(d.id));
    setSelectedIds(allSelected ? new Set() : new Set(documents.map((d) => d.id)));
  }

  async function handleDownloadOne(doc: VaultDocument) {
    try {
      const { filename, blob } = await fetchDocumentFile(doc.category, doc.id);
      triggerBlobDownload(blob, filename);
    } catch {
      toast({ title: "Couldn't download this document", variant: "destructive" });
    }
  }

  const selectedRefs = documents.filter((d) => selectedIds.has(d.id)).map((d) => ({ category: d.category, id: d.id }));
  const label = meta?.label || documents[0]?.folder_label || category.replace(/_/g, " ");

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
                <SelectValue placeholder="All people" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All people</SelectItem>
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

        {selectedIds.size > 0 && (
          <div
            className="mt-3 flex items-center justify-between rounded-xl border px-4 py-2.5"
            style={{ borderColor: "var(--cc-border)", background: "var(--cc-active-bg)" }}
          >
            <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-text)" }}>
              {selectedIds.size} selected
            </p>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>
                Clear
              </button>
              <Button size="sm" onClick={() => setShareOpen(true)} style={{ background: "var(--cc-plum)", color: "white" }}>
                Share with auditor
              </Button>
            </div>
          </div>
        )}

        <div className="mt-3">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg" style={{ background: "var(--cc-soft)" }} />
              ))}
            </div>
          ) : (
            <DocumentTable
              documents={documents}
              selectedIds={selectedIds}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onDownload={(d) => void handleDownloadOne(d)}
            />
          )}
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
          onUpload={({ title, description, file }) =>
            isCustom && customFolderId
              ? uploadCustomFolderDocument({ folderId: customFolderId, title, file })
              : uploadGovernanceDocument({ folderKey: category, title, description, file })
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
