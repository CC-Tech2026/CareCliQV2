import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FileText,
  FileBarChart2,
  AlertTriangle,
  ClipboardList,
  Pill,
  KeyRound,
  Receipt,
  ShieldCheck,
  FileCheck2,
  Building2,
  ShieldAlert,
  Award,
  Database,
  MessageSquareWarning,
  Siren,
  Users,
  UserCheck,
  RefreshCw,
  Flame,
  BookOpen,
  Folder,
  FolderOpen,
  FolderPlus,
  ArrowUpToLine,
  ArrowDownToLine,
  Upload,
  Share2,
  Search,
  LayoutGrid,
  List as ListIcon,
  type LucideIcon,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useToast } from "@/hooks/use-toast";
import {
  fetchVaultStats,
  fetchVaultFolders,
  fetchVaultTree,
  fetchFolderDocuments,
  fetchTreeSubfolderDocuments,
  CUSTOM_FOLDER_CATEGORY_PREFIX,
  fetchPolicyAcknowledgementStatus,
  setFolderOrder,
  fetchShareEvents,
  type DocRef,
  type VaultDocument,
  type VaultStats,
  type VaultFolder,
  type VaultShareEvent,
  type VaultTreeFolder,
} from "@/services/vaultService";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatAppDate } from "@/lib/datetime";
import { ShareAuditorDialog } from "./components/ShareAuditorDialog";
import { CreateFolderDialog } from "./components/CreateFolderDialog";
import {
  FolderCard,
  FolderRow,
  type FolderMenuItem,
  type PreviewContent,
} from "./components/FileManager";
import { formatBytes, sizeDetails, sizeLabel, useVaultSizes } from "./components/useVaultSizes";
import { useFolderActions, type FolderTarget } from "./components/useFolderActions";
import { uniqueDocs } from "@/lib/vault-share";

const FOLDER_ICONS: Record<string, LucideIcon> = {
  session_notes: FileText,
  incident_reports: AlertTriangle,
  ndis_plans: ClipboardList,
  medication_records: Pill,
  worker_credentials: KeyRound,
  invoices: Receipt,
  audit_packs: ShieldCheck,
  participant_reports: FileBarChart2,
  consent_onboarding: FileCheck2,
  governance_operational: Building2,
  risk_management: ShieldAlert,
  quality_management: Award,
  information_management: Database,
  feedback_complaints: MessageSquareWarning,
  incident_management_system: Siren,
  human_resource_management: Users,
  continuity_of_supports: RefreshCw,
  emergency_disaster_management: Flame,
};

type ViewMode = "grid" | "list";
const VIEW_MODE_KEY = "cc-vault-view-mode";

function readStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function formatUpdated(iso: string | null): string {
  if (!iso) return "Empty";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recently";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function shortDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const TOP_ICONS: Record<string, LucideIcon> = {
  governance: Building2,
  participant: Users,
  policy: BookOpen,
  staff: UserCheck,
};

/** "3 gaps across 2 participants", "1 gap", or null when complete. */
function treeGapLine(folder: VaultTreeFolder): string | null {
  if (!folder.gap_count) return null;
  const gaps = plural(folder.gap_count, "gap");
  if (folder.gap_people == null) return gaps;
  const noun = folder.key === "staff" ? "worker" : "participant";
  return `${gaps} across ${plural(folder.gap_people, noun)}`;
}

function treeSubHref(folder: VaultTreeFolder, sub: VaultTreeFolder["subfolders"][number]) {
  return sub.category ? `/md/vault/${sub.category}` : `/md/vault/tree/${folder.key}/${sub.key}`;
}

/** The subfolders of a main folder, as the hover preview. */
function treePreview(folder: VaultTreeFolder): PreviewContent {
  const shown = folder.subfolders.filter((s) => s.state !== "not_applicable");
  const list = (shown.length ? shown : folder.subfolders).slice(0, 7);
  const gapNoun = folder.person_level ? (folder.key === "staff" ? "worker" : "participant") : null;
  return {
    nodes: list.map((s) => {
      const gap = s.state === "missing" || s.state === "expired";
      return {
        kind: "folder" as const,
        label: s.label,
        href: treeSubHref(folder, s),
        meta: gap
          ? gapNoun
            ? `${s.gap_count} missing`
            : s.state === "expired" ? "Expired" : "Missing"
          : String(s.count),
        tone: gap ? (s.state === "expired" ? "warning" : "danger") : "neutral",
      };
    }),
    more: folder.subfolders.length - list.length,
    moreNoun: folder.subfolders.length - list.length === 1 ? "folder" : "folders",
    empty: "No subfolders yet.",
  };
}

/** The latest files in a folder, as the hover preview. */
function filesPreview(folder: VaultFolder, docs: VaultDocument[]): PreviewContent {
  const latest = [...docs].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);
  return {
    nodes: latest.map((doc) => ({
      kind: "file" as const,
      // Many records share a title ("Support work note"), so lead with who.
      label: doc.person_type !== "Organisation" && doc.person_name ? doc.person_name : doc.title,
      sublabel: [doc.person_type !== "Organisation" && doc.person_name ? doc.title : null, shortDate(doc.date)]
        .filter(Boolean)
        .join(" · "),
    })),
    more: Math.max(0, folder.count - latest.length),
    moreNoun: folder.count - latest.length === 1 ? "file" : "files",
    empty: "No files in this folder yet.",
  };
}

function SortableFolder({
  folder,
  mode,
  onOpen,
  menu,
  preview,
  loadPreview,
  size,
}: {
  folder: VaultFolder;
  size?: string;
  mode: ViewMode;
  onOpen: () => void;
  menu: FolderMenuItem[];
  preview?: PreviewContent;
  loadPreview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: folder.category,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const Icon = FOLDER_ICONS[folder.category];
  const dragProps = { ...attributes, ...listeners } as Record<string, unknown>;

  if (mode === "list") {
    return (
      <li ref={setNodeRef} style={style} className="border-b last:border-b-0" >
        <FolderRow
          title={folder.label}
          Icon={Icon}
          muted={folder.count === 0}
          badge={folder.flagged_count}
          onOpen={onOpen}
          dragProps={dragProps}
          columns={[plural(folder.count, "file"), size ?? "", formatUpdated(folder.updated_at)]}
        />
      </li>
    );
  }
  return (
    <div ref={setNodeRef} style={style} className="h-full">
      <FolderCard
        compact
        title={folder.label}
        Icon={Icon}
        muted={folder.count === 0}
        meta={[plural(folder.count, "file"), size]}
        badge={folder.flagged_count}
        onOpen={onOpen}
        menu={menu}
        preview={preview}
        loadPreview={folder.count > 0 ? loadPreview : undefined}
        dragProps={dragProps}
      />
    </div>
  );
}

const COMPACT_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

function NewFolderCard({ onClick, mode }: { onClick: () => void; mode: ViewMode }) {
  if (mode === "list") {
    return (
      <li>
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-cc-soft sm:px-5"
          style={{ color: "var(--cc-plum)" }}
        >
          <span className="flex h-[27px] w-[34px] items-center justify-center"><FolderPlus size={18} /></span>
          New folder
        </button>
      </li>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm font-semibold transition hover:bg-cc-surface"
      style={{ borderColor: "var(--cc-border)", color: "var(--cc-plum)" }}
    >
      <FolderPlus size={22} />
      New folder
    </button>
  );
}

function FolderSection({
  title,
  description,
  folders,
  mode,
  onDragEnd,
  onOpen,
  menuFor,
  previews,
  loadPreview,
  onNewFolder,
  headerExtra,
  sizeOf,
}: {
  sizeOf: (folder: VaultFolder) => string | undefined;
  title: string;
  description: string;
  folders: VaultFolder[];
  mode: ViewMode;
  onDragEnd: (event: DragEndEvent) => void;
  onOpen: (folder: VaultFolder) => void;
  menuFor: (folder: VaultFolder) => FolderMenuItem[];
  previews: Record<string, PreviewContent>;
  loadPreview: (folder: VaultFolder) => void;
  onNewFolder: () => void;
  headerExtra?: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--cc-text)" }}>{title}</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--cc-muted)" }}>{description}</p>
        </div>
        {headerExtra}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext
          items={folders.map((f) => f.category)}
          strategy={mode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
        >
          {mode === "grid" ? (
            <div className={COMPACT_GRID}>
              {folders.map((f) => (
                <SortableFolder
                  key={f.category}
                  folder={f}
                  mode={mode}
                  onOpen={() => onOpen(f)}
                  menu={menuFor(f)}
                  preview={previews[f.category]}
                  loadPreview={() => loadPreview(f)}
                  size={sizeOf(f)}
                />
              ))}
              <NewFolderCard mode={mode} onClick={onNewFolder} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-cc-surface">
              <div className="hidden items-center gap-3 border-b px-5 py-2.5 text-xs font-medium sm:flex" style={{ borderColor: "var(--cc-border)", color: "var(--cc-muted)" }}>
                <span className="w-[34px]" />
                <span className="flex-1">Name</span>
                <span className="w-28 text-right">Files</span>
                <span className="w-28 text-right">Size</span>
                <span className="w-28 text-right">Updated</span>
              </div>
              <ul style={{ borderColor: "var(--cc-border)" }} className="[&>li]:border-cc-border">
                {folders.map((f) => (
                  <SortableFolder
                    key={f.category}
                    folder={f}
                    mode={mode}
                    onOpen={() => onOpen(f)}
                    menu={menuFor(f)}
                    preview={previews[f.category]}
                    loadPreview={() => loadPreview(f)}
                    size={sizeOf(f)}
                  />
                ))}
                <NewFolderCard mode={mode} onClick={onNewFolder} />
              </ul>
            </div>
          )}
        </SortableContext>
      </DndContext>
      {folders.length > 1 && (
        <p className="text-xs" style={{ color: "var(--cc-muted)" }}>Drag a folder to reorder it.</p>
      )}
    </section>
  );
}

const SHARE_METHOD_LABELS: Record<VaultShareEvent["share_method"], string> = {
  download_zip: "Downloaded as ZIP",
  email_gmail: "Emailed (Gmail)",
  email_outlook: "Emailed (Outlook)",
  email_mailto: "Emailed",
};

/** Behind the "Shared with auditors" tile: every share in the last 30 days. */
function ShareHistorySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [events, setEvents] = useState<VaultShareEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEvents(null);
    setFailed(false);
    fetchShareEvents(30)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Shared with auditors</SheetTitle>
          <SheetDescription>Every share from the vault in the last 30 days.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2.5">
          {failed ? (
            <p role="alert" className="text-sm" style={{ color: "var(--cc-status-danger)" }}>
              Couldn't load the share history. Try again shortly.
            </p>
          ) : events === null ? (
            <p className="text-sm" style={{ color: "var(--cc-muted)" }}>Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--cc-muted)" }}>Nothing has been shared in the last 30 days.</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="rounded-xl border p-3.5" style={{ borderColor: "var(--cc-border)" }}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-bold" style={{ color: "var(--cc-text)" }}>
                    {event.document_count} document{event.document_count === 1 ? "" : "s"}
                  </p>
                  <p className="shrink-0 text-[11px]" style={{ color: "var(--cc-muted)" }}>
                    {formatAppDate(event.created_at)}
                  </p>
                </div>
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--cc-muted)" }}>
                  {SHARE_METHOD_LABELS[event.share_method] ?? event.share_method} by {event.shared_by_name}
                  {event.recipient_hint ? ` · to ${event.recipient_hint}` : ""}
                </p>
                {event.folders.length > 0 && (
                  <p className="mt-1 text-[12px]" style={{ color: "var(--cc-text)" }}>{event.folders.join(", ")}</p>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function VaultHome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const sizes = useVaultSizes();
  const folderSize = (f: VaultFolder) => sizeLabel(sizes?.folders[f.category], !!sizes);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [tree, setTree] = useState<VaultTreeFolder[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchVaultTree()
      .then((data) => { if (!cancelled) setTree(data); })
      .catch(() => { if (!cancelled) setTree([]); });
    return () => { cancelled = true; };
  }, []);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [shareHistoryOpen, setShareHistoryOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ folderKeys: string[]; description: string; documents: DocRef[] } | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderGroup, setCreateFolderGroup] = useState<"record" | "governance">("record");
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [ackSummary, setAckSummary] = useState<{ acknowledged: number; total: number } | null>(null);
  // Hover previews for record-type folders, loaded once each on demand.
  const [previews, setPreviews] = useState<Record<string, PreviewContent>>({});
  const requestedPreviews = useRef(new Set<string>());

  // With "Flagged for review" on, folders open showing only flagged documents.
  const openPath = (path: string) => navigate(flaggedOnly ? `${path}?flagged=1` : path);

  useEffect(() => {
    void refresh();
    fetchPolicyAcknowledgementStatus()
      .then((rows) =>
        setAckSummary(
          rows.length === 0
            ? null
            : rows.reduce(
                (acc, r) => ({ acknowledged: acc.acknowledged + r.acknowledged, total: acc.total + r.total }),
                { acknowledged: 0, total: 0 },
              ),
        ),
      )
      .catch(() => setAckSummary(null));
  }, []);

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // per-viewer convenience only — fine if storage is unavailable
    }
  }

  async function refresh() {
    setLoading(true);
    setLoadError(false);
    try {
      const [statsData, foldersData] = await Promise.all([fetchVaultStats(), fetchVaultFolders()]);
      setStats(statsData);
      setFolders(foldersData);
    } catch {
      setLoadError(true);
      toast({ title: "Could not load the document vault", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function loadPreview(folder: VaultFolder) {
    if (requestedPreviews.current.has(folder.category)) return;
    requestedPreviews.current.add(folder.category);
    fetchFolderDocuments(folder.category)
      .then((docs) => setPreviews((prev) => ({ ...prev, [folder.category]: filesPreview(folder, docs) })))
      .catch(() =>
        setPreviews((prev) => ({
          ...prev,
          [folder.category]: { nodes: [], empty: "Couldn't load a preview. Open the folder to see its files." },
        })),
      );
  }

  function persistOrder(nextRecord: VaultFolder[], nextGovernance: VaultFolder[]) {
    void setFolderOrder([...nextRecord, ...nextGovernance].map((f) => f.category));
  }

  function reorder(group: "record" | "governance") {
    return (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setFolders((prev) => {
        const record = prev.filter((f) => f.group === "record");
        const governance = prev.filter((f) => f.group === "governance");
        const list = group === "record" ? record : governance;
        const reordered = arrayMove(
          list,
          list.findIndex((f) => f.category === active.id),
          list.findIndex((f) => f.category === over.id),
        );
        const nextRecord = group === "record" ? reordered : record;
        const nextGovernance = group === "governance" ? reordered : governance;
        persistOrder(nextRecord, nextGovernance);
        return [...nextRecord, ...nextGovernance];
      });
    };
  }

  // Governance and Policy & Procedures already hold these as subfolders;
  // listing them again on the home page is what made the vault feel doubled.
  // Matched by key only, so a folder that merely shares a name still shows.
  const inTree = new Set(
    (tree ?? [])
      .filter((t) => !t.person_level)
      .flatMap((t) => t.subfolders.flatMap((s) => [s.key, s.category].filter(Boolean) as string[])),
  );

  const query = search.trim().toLowerCase();
  const matches = (f: VaultFolder) =>
    f.label.toLowerCase().includes(query) && (!flaggedOnly || f.flagged_count > 0);
  const recordFolders = folders.filter((f) => f.group === "record" && matches(f));
  const governanceFolders = folders.filter((f) => f.group === "governance" && !inTree.has(f.category) && matches(f));
  const treeFolders = (tree ?? []).filter(
    (t) =>
      (!query || t.label.toLowerCase().includes(query) || t.subfolders.some((s) => s.label.toLowerCase().includes(query))) &&
      (!flaggedOnly || t.gap_count > 0),
  );
  const nothingMatches =
    !loading && !loadError && tree !== null && treeFolders.length + recordFolders.length + governanceFolders.length === 0;

  const actions = useFolderActions({ onChanged: () => void refresh() });

  /** Move a folder to the start or end of its section. */
  function moveFolder(folder: VaultFolder, to: "start" | "end") {
    setFolders((prev) => {
      const record = prev.filter((f) => f.group === "record");
      const governance = prev.filter((f) => f.group === "governance");
      const list = folder.group === "record" ? record : governance;
      const rest = list.filter((f) => f.category !== folder.category);
      const moved = to === "start" ? [folder, ...rest] : [...rest, folder];
      const nextRecord = folder.group === "record" ? moved : record;
      const nextGovernance = folder.group === "governance" ? moved : governance;
      persistOrder(nextRecord, nextGovernance);
      return [...nextRecord, ...nextGovernance];
    });
  }

  function folderTarget(folder: VaultFolder): FolderTarget {
    const custom = folder.category.startsWith(CUSTOM_FOLDER_CATEGORY_PREFIX);
    return {
      title: folder.label,
      href: `/md/vault/${folder.category}`,
      path: `Vault › ${folder.label}`,
      files: folder.count,
      folderKeys: [folder.category],
      loadDocuments: () => fetchFolderDocuments(folder.category),
      details: [
        ...sizeDetails(sizes?.folders[folder.category], !!sizes, folder.count),
        ["Last updated", formatUpdated(folder.updated_at)],
        ["Flagged for review", String(folder.flagged_count)],
        ["Section", folder.group === "record" ? "Records by type" : "Other governance folders"],
      ],
      customFolderId: custom ? folder.category.slice(CUSTOM_FOLDER_CATEGORY_PREFIX.length) : undefined,
    };
  }

  function folderMenu(folder: VaultFolder): FolderMenuItem[] {
    const custom = folder.category.startsWith(CUSTOM_FOLDER_CATEGORY_PREFIX);
    const list = folder.group === "record" ? folders.filter((f) => f.group === "record") : folders.filter((f) => f.group === "governance");
    const index = list.findIndex((f) => f.category === folder.category);
    return actions.menuFor(folderTarget(folder), {
      shortcuts: [
        ...(folder.flagged_count > 0
          ? [{ label: `Show ${folder.flagged_count} flagged`, icon: AlertTriangle, onSelect: () => navigate(`/md/vault/${folder.category}?flagged=1`) }]
          : []),
        ...(folder.group === "governance" || custom
          ? [{ label: "Upload a file", icon: Upload, onSelect: () => navigate(`/md/vault/${folder.category}?upload=1`) }]
          : []),
      ],
      arrange: [
        { label: "Move to start", icon: ArrowUpToLine, onSelect: () => moveFolder(folder, "start"), disabled: index === 0 },
        { label: "Move to end", icon: ArrowDownToLine, onSelect: () => moveFolder(folder, "end"), disabled: index === list.length - 1 },
      ],
    });
  }

  function treeMenu(folder: VaultTreeFolder): FolderMenuItem[] {
    const base = `/md/vault/tree/${folder.key}`;
    const noun = folder.key === "staff" ? "worker" : "participant";
    const gapLine = treeGapLine(folder);
    return actions.menuFor(
      {
        title: folder.label,
        href: base,
        path: `Vault › ${folder.label}`,
        files: folder.count,
        loadDocuments: async () =>
          uniqueDocs((await Promise.all(folder.subfolders.map((s) => fetchTreeSubfolderDocuments(folder.key, s.key)))).flat()),
        details: [
          ...sizeDetails(sizes?.tree[folder.key], !!sizes, folder.count),
          ["Subfolders", String(folder.subfolders.length)],
          ["Gaps", gapLine ?? "Nothing missing"],
          ["Organised", folder.person_level ? `A folder per ${noun}` : "By record type"],
        ],
      },
      {
        shortcuts: folder.person_level
          ? [
              { label: `Browse by ${noun}`, icon: Users, onSelect: () => navigate(base) },
              { label: "Browse by document type", icon: Folder, onSelect: () => navigate(`${base}?view=type`) },
              ...(folder.gap_count ? [{ label: `Show ${noun}s with gaps`, icon: AlertTriangle, onSelect: () => navigate(`${base}?gaps=1`) }] : []),
            ]
          : [],
      },
    );
  }

  const summary = [
    { value: stats?.total_documents ?? 0, label: "documents", color: "var(--cc-text)", onClick: () => { setFlaggedOnly(false); setSearch(""); } },
    { value: stats?.flagged_for_review ?? 0, label: "flagged for review", color: stats?.flagged_for_review ? "var(--cc-amber)" : "var(--cc-green)", onClick: () => setFlaggedOnly(true) },
    { value: stats?.shared_last_30_days ?? 0, label: "shared with auditors in 30 days", color: "var(--cc-text)", onClick: () => setShareHistoryOpen(true) },
    ...(sizes && sizes.total.files > 0
      ? [{
          value: sizes.pending > 0 ? "…" : formatBytes(sizes.total.bytes),
          label: sizes.pending > 0 ? `measuring ${plural(sizes.pending, "document")}` : "in total",
          color: "var(--cc-text)",
          onClick: () => undefined,
        }]
      : []),
  ];

  return (
    <HubLayout>
      <div className="space-y-8 pb-12">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold" style={{ color: "var(--cc-muted)" }}>Documents & Audit Vault</p>
            <h1
              className="mt-1 text-3xl font-semibold tracking-tight"
              style={{ color: "var(--cc-text)", fontFamily: "var(--app-font-display)" }}
            >
              Vault
            </h1>
            <p className="mt-2 text-sm leading-6" style={{ color: "var(--cc-muted)" }}>
              Every participant, worker and governance record, filed in folders and ready for audit.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:gap-2">
            <button type="button" onClick={() => navigate("/md/staff")} className="min-h-11 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft" style={{ color: "var(--cc-text)" }}>
              Staff directory
            </button>
            <button type="button" onClick={() => navigate("/billing")} className="min-h-11 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft" style={{ color: "var(--cc-text)" }}>
              NDIS invoices
            </button>
            <button
              type="button"
              onClick={() => setShareTarget({ folderKeys: [], description: "Choose the folders to include", documents: [] })}
              className="order-first inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum sm:order-none sm:w-auto"
              style={{ background: "var(--cc-cta)" }}
            >
              <Share2 size={15} />
              Share with auditor
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
          {summary.map((item, index) => (
            <div key={item.label} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="mr-2 hidden h-6 w-px sm:block" style={{ background: "var(--cc-border)" }} />}
              <button type="button" onClick={item.onClick} className="flex min-h-11 items-center rounded-full px-3 transition hover:bg-cc-soft">
                <span className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: item.color }}>
                    {loading ? "…" : item.value}
                  </span>
                  <span className="text-sm" style={{ color: "var(--cc-muted)" }}>{item.label}</span>
                </span>
              </button>
            </div>
          ))}
        </div>

        <ShareHistorySheet open={shareHistoryOpen} onOpenChange={setShareHistoryOpen} />

        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--cc-muted)" }} />
            <input
              aria-label="Search vault folders"
              type="search"
              placeholder="Search folders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-full border bg-cc-surface pl-11 pr-4 text-sm outline-none transition focus:ring-2 focus:ring-cc-plum"
              style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={flaggedOnly}
              onClick={() => setFlaggedOnly((v) => !v)}
              className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
              style={flaggedOnly ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: "var(--cc-text)", boxShadow: "inset 0 0 0 1px var(--cc-border)" }}
            >
              <AlertTriangle size={15} />
              Needs attention
            </button>
            <div className="flex items-center rounded-full border p-1" style={{ borderColor: "var(--cc-border)" }} role="group" aria-label="View">
              {([["grid", LayoutGrid, "Folder view"], ["list", ListIcon, "List view"]] as const).map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => changeViewMode(key)}
                  aria-label={label}
                  aria-pressed={viewMode === key}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition"
                  style={viewMode === key ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: "var(--cc-muted)" }}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-cc-surface px-5 py-4 text-sm" style={{ color: "var(--cc-text)" }}>
            The vault couldn't be loaded.
            <button type="button" onClick={() => void refresh()} className="min-h-10 rounded-full border px-4 font-semibold" style={{ borderColor: "var(--cc-border)" }}>
              Try again
            </button>
          </div>
        )}

        {nothingMatches && (
          <div className="rounded-2xl bg-cc-surface px-6 py-12 text-center">
            <Folder size={26} className="mx-auto mb-3" style={{ color: "var(--cc-muted)" }} />
            <p className="text-base font-semibold" style={{ color: "var(--cc-text)" }}>No folders match</p>
            <p className="mt-1 text-sm" style={{ color: "var(--cc-muted)" }}>Try another name, or clear the filters.</p>
            <button type="button" onClick={() => { setSearch(""); setFlaggedOnly(false); }} className="mt-4 min-h-11 rounded-full border px-5 text-sm font-semibold" style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}>
              Clear filters
            </button>
          </div>
        )}

        {/* Main folders */}
        {tree === null ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-cc-surface" />)}
          </div>
        ) : treeFolders.length > 0 && (
          <section className="space-y-3" aria-label="Folders">
            <h2 className="text-lg font-semibold" style={{ color: "var(--cc-text)" }}>Folders</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {treeFolders.map((folder) => {
                const gapLine = treeGapLine(folder);
                return (
                  <FolderCard
                    key={folder.key}
                    title={folder.label}
                    Icon={TOP_ICONS[folder.key]}
                    meta={[
                      `${plural(folder.count, "file")} · ${plural(folder.subfolders.length, "folder")}`,
                      sizeLabel(sizes?.tree[folder.key], !!sizes),
                    ]}
                    status={gapLine ? { label: gapLine, tone: "danger" } : { label: "Nothing missing", tone: "good" }}
                    onOpen={() => navigate(`/md/vault/tree/${folder.key}`)}
                    menu={treeMenu(folder)}
                    preview={treePreview(folder)}
                  />
                );
              })}
            </div>
          </section>
        )}

        {recordFolders.length > 0 && (
          <FolderSection
            title="Records by type"
            description="Notes, incidents, plans and other records, filed automatically as they're created."
            folders={recordFolders}
            mode={viewMode}
            onDragEnd={reorder("record")}
            onOpen={(f) => openPath(`/md/vault/${f.category}`)}
            menuFor={folderMenu}
            previews={previews}
            loadPreview={loadPreview}
            sizeOf={folderSize}
            onNewFolder={() => { setCreateFolderGroup("record"); setCreateFolderOpen(true); }}
          />
        )}

        {governanceFolders.length > 0 && (
          <FolderSection
            title="Other governance folders"
            description="Organisation records kept outside Governance and Policy & Procedures, including folders you've created."
            folders={governanceFolders}
            mode={viewMode}
            onDragEnd={reorder("governance")}
            onOpen={(f) => openPath(`/md/vault/${f.category}`)}
            menuFor={folderMenu}
            previews={previews}
            loadPreview={loadPreview}
            sizeOf={folderSize}
            onNewFolder={() => { setCreateFolderGroup("governance"); setCreateFolderOpen(true); }}
            headerExtra={
              ackSummary && (
                <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--cc-muted)" }}>
                  <Users size={14} />
                  <span className="font-semibold tabular-nums" style={{ color: "var(--cc-text)" }}>
                    {ackSummary.acknowledged}/{ackSummary.total}
                  </span>
                  policy acknowledgements
                </span>
              )
            }
          />
        )}
      </div>

      <ShareAuditorDialog
        open={shareTarget !== null}
        onOpenChange={(open) => { if (!open) setShareTarget(null); }}
        documents={shareTarget?.documents ?? []}
        folderKeys={shareTarget?.folderKeys ?? []}
        targetDescription={shareTarget?.description ?? "Documents across the vault"}

      />
      {actions.dialogs}
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onCreated={() => void refresh()}
        initialGroup={createFolderGroup}
      />
    </HubLayout>
  );
}
