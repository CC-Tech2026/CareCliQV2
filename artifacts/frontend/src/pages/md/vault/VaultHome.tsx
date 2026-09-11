import { useEffect, useState, type ReactNode } from "react";
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
  RefreshCw,
  Flame,
  Folder,
  FolderPlus,
  Share2,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  GripVertical,
  type LucideIcon,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { StatCardGroup, StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  fetchVaultStats,
  fetchVaultFolders,
  fetchPolicyAcknowledgementStatus,
  setFolderOrder,
  type VaultStats,
  type VaultFolder,
} from "@/services/vaultService";
import { ShareAuditorDialog } from "./components/ShareAuditorDialog";
import { CreateFolderDialog } from "./components/CreateFolderDialog";

const FOLDER_ICONS: Record<string, LucideIcon> = {
  session_notes: FileText,
  incident_reports: AlertTriangle,
  ndis_plans: ClipboardList,
  medication_records: Pill,
  worker_credentials: KeyRound,
  invoices: Receipt,
  audit_packs: ShieldCheck,
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
  if (!iso) return "empty";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A literal folder silhouette (tab + body) rather than a dashboard stat
 * card — record folders carry solid Charcoal Navy, governance/policy
 * folders carry a lighter navy tint, so the two groups read as distinct at
 * a glance using only neutral tones, not brand accent colour. */
function FolderGlyph({ tint, Icon, size = "lg" }: { tint: string; Icon: LucideIcon; size?: "lg" | "sm" }) {
  const dims = size === "lg" ? { w: "w-16", h: "h-14", tabW: "w-7", tabH: "h-3", icon: 20 } : { w: "w-10", h: "h-9", tabW: "w-4", tabH: "h-2", icon: 14 };
  return (
    <div className={`relative ${dims.h} ${dims.w} shrink-0`}>
      <div className={`absolute left-0 top-0 ${dims.tabH} ${dims.tabW} rounded-t-[3px]`} style={{ background: tint }} />
      <div
        className="absolute inset-x-0 bottom-0 top-1.5 flex items-center justify-center rounded-lg rounded-tl-none"
        style={{ background: tint, top: size === "lg" ? 8 : 6 }}
      >
        <Icon size={dims.icon} color="white" />
      </div>
    </div>
  );
}

function folderTint(folder: VaultFolder): string {
  return folder.group === "governance" ? "var(--cc-muted)" : "var(--cc-text)";
}

function FlaggedBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
      style={{ background: "var(--cc-status-warning)" }}
    >
      {count}
    </span>
  );
}

function FolderTileContent({ folder }: { folder: VaultFolder }) {
  const Icon = FOLDER_ICONS[folder.category] || Folder;
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-center" style={{ cursor: "grab" }}>
      <div className="relative">
        <FolderGlyph tint={folderTint(folder)} Icon={Icon} />
        <FlaggedBadge count={folder.flagged_count} />
      </div>
      <p className="line-clamp-2 text-[12.5px] font-bold leading-tight" style={{ color: "var(--cc-text)" }}>
        {folder.label}
      </p>
      <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>
        {folder.count} file{folder.count === 1 ? "" : "s"} · {formatUpdated(folder.updated_at)}
      </p>
    </div>
  );
}

/** File-explorer-style row — Name / Files / Updated columns, one folder per
 * row in a divide-y list, for MDs who'd rather scan a dense list than an
 * icon grid (the same "Details view vs. icon view" choice OneDrive/Explorer
 * offer). */
function FolderListRowContent({ folder }: { folder: VaultFolder }) {
  const Icon = FOLDER_ICONS[folder.category] || Folder;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ cursor: "grab" }}>
      <GripVertical size={14} style={{ color: "var(--cc-border)" }} className="shrink-0" />
      <div className="relative shrink-0">
        <FolderGlyph tint={folderTint(folder)} Icon={Icon} size="sm" />
        <FlaggedBadge count={folder.flagged_count} />
      </div>
      <p className="min-w-0 flex-1 truncate text-[13px] font-bold" style={{ color: "var(--cc-text)" }}>
        {folder.label}
      </p>
      <p className="hidden w-24 shrink-0 text-[12px] sm:block" style={{ color: "var(--cc-muted)" }}>
        {folder.count} file{folder.count === 1 ? "" : "s"}
      </p>
      <p className="hidden w-32 shrink-0 text-[12px] sm:block" style={{ color: "var(--cc-muted)" }}>
        {formatUpdated(folder.updated_at)}
      </p>
      <ChevronRight size={15} className="shrink-0" style={{ color: "var(--cc-muted)" }} />
    </div>
  );
}

function SortableFolderItem({ folder, mode, onOpen }: { folder: VaultFolder; mode: ViewMode; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: folder.category });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  if (mode === "list") {
    return (
      <div ref={setNodeRef} style={style} className="hover:bg-[var(--cc-active-bg)]" onClick={onOpen} {...attributes} {...listeners}>
        <FolderListRowContent folder={folder} />
      </div>
    );
  }
  return (
    <div ref={setNodeRef} style={style} className="rounded-xl hover:bg-[var(--cc-active-bg)]" onClick={onOpen} {...attributes} {...listeners}>
      <FolderTileContent folder={folder} />
    </div>
  );
}

function NewFolderControl({ mode, onClick }: { mode: ViewMode; onClick: () => void }) {
  if (mode === "list") {
    return (
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="w-[14px] shrink-0" />
        <span className="flex h-9 w-10 shrink-0 items-center justify-center">
          <FolderPlus size={18} style={{ color: "var(--cc-muted)" }} />
        </span>
        <span className="text-[13px] font-bold" style={{ color: "var(--cc-muted)" }}>
          New folder
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-3 text-center"
      style={{ borderColor: "var(--cc-border)" }}
    >
      <div className="flex h-14 w-16 items-center justify-center">
        <FolderPlus size={26} style={{ color: "var(--cc-muted)" }} />
      </div>
      <p className="text-[12.5px] font-bold" style={{ color: "var(--cc-muted)" }}>
        New folder
      </p>
    </button>
  );
}

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="flex items-center rounded-lg border p-0.5" style={{ borderColor: "var(--cc-border)" }}>
      {(
        [
          ["grid", LayoutGrid],
          ["list", ListIcon],
        ] as const
      ).map(([key, Icon]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-label={key === "grid" ? "Grid view" : "List view"}
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{
            background: mode === key ? "var(--cc-active-bg)" : "transparent",
            color: mode === key ? "var(--cc-text)" : "var(--cc-muted)",
          }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

const GRID_CLASS = "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8";

function FolderGroup({
  title,
  subtitle,
  folders,
  mode,
  onDragEnd,
  navigate,
  trailing,
  headerExtra,
}: {
  title: string;
  subtitle: string;
  folders: VaultFolder[];
  mode: ViewMode;
  onDragEnd: (event: DragEndEvent) => void;
  navigate: (path: string) => void;
  trailing?: ReactNode;
  headerExtra?: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black" style={{ color: "var(--cc-text)" }}>
            {title}
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--cc-muted)" }}>
            {subtitle}
          </p>
        </div>
        {headerExtra}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext
          items={folders.map((f) => f.category)}
          strategy={mode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
        >
          {mode === "grid" ? (
            <div className={`mt-3 ${GRID_CLASS}`}>
              {folders.map((f) => (
                <SortableFolderItem key={f.category} folder={f} mode={mode} onOpen={() => navigate(`/md/vault/${f.category}`)} />
              ))}
              {trailing}
            </div>
          ) : (
            <div className="mt-3 divide-y rounded-xl border" style={{ borderColor: "var(--cc-border)" }}>
              {folders.map((f) => (
                <SortableFolderItem key={f.category} folder={f} mode={mode} onOpen={() => navigate(`/md/vault/${f.category}`)} />
              ))}
              {trailing}
            </div>
          )}
        </SortableContext>
      </DndContext>
    </div>
  );
}

export default function VaultHome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderGroup, setCreateFolderGroup] = useState<"record" | "governance">("record");
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [ackSummary, setAckSummary] = useState<{ acknowledged: number; total: number } | null>(null);

  useEffect(() => {
    void refresh();
    fetchPolicyAcknowledgementStatus()
      .then((rows) =>
        setAckSummary(
          rows.length === 0
            ? null
            : rows.reduce((acc, r) => ({ acknowledged: acc.acknowledged + r.acknowledged, total: acc.total + r.total }), { acknowledged: 0, total: 0 })
        )
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
    try {
      const [statsData, foldersData] = await Promise.all([fetchVaultStats(), fetchVaultFolders()]);
      setStats(statsData);
      setFolders(foldersData);
    } catch {
      toast({ title: "Could not load the document vault", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function persistOrder(nextRecord: VaultFolder[], nextGovernance: VaultFolder[]) {
    void setFolderOrder([...nextRecord, ...nextGovernance].map((f) => f.category));
  }

  function handleRecordDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFolders((prev) => {
      const record = prev.filter((f) => f.group === "record");
      const governance = prev.filter((f) => f.group === "governance");
      const oldIndex = record.findIndex((f) => f.category === active.id);
      const newIndex = record.findIndex((f) => f.category === over.id);
      const reordered = arrayMove(record, oldIndex, newIndex);
      persistOrder(reordered, governance);
      return [...reordered, ...governance];
    });
  }

  function handleGovernanceDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFolders((prev) => {
      const record = prev.filter((f) => f.group === "record");
      const governance = prev.filter((f) => f.group === "governance");
      const oldIndex = governance.findIndex((f) => f.category === active.id);
      const newIndex = governance.findIndex((f) => f.category === over.id);
      const reordered = arrayMove(governance, oldIndex, newIndex);
      persistOrder(record, reordered);
      return [...record, ...reordered];
    });
  }

  const recordFolders = folders.filter((f) => f.group === "record");
  const governanceFolders = folders.filter((f) => f.group === "governance");

  return (
    <HubLayout>
      <div className="space-y-6 pb-12">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: "var(--cc-active-bg)", color: "var(--cc-plum)" }}
            >
              <ShieldCheck size={20} />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-[-0.025em]" style={{ color: "var(--cc-text)" }}>
                Documents & Audit Vault
              </h1>
              <p className="mt-0.5 text-[13px]" style={{ color: "var(--cc-muted)" }}>
                Every participant, worker and governance record, organised and ready for audit.
              </p>
            </div>
          </div>
          <Button className="gap-2 shrink-0" style={{ background: "var(--cc-plum)", color: "white" }} onClick={() => setShareOpen(true)}>
            <Share2 size={15} />
            Share with auditor
          </Button>
        </div>

        <StatCardGroup fill>
          <StatCard icon={<FileText size={16} />} label="Total documents" value={loading ? "…" : stats?.total_documents ?? 0} tone="info" />
          <StatCard
            icon={<AlertTriangle size={16} />}
            label="Flagged for review"
            value={loading ? "…" : stats?.flagged_for_review ?? 0}
            tone="warning"
          />
          <StatCard
            icon={<Share2 size={16} />}
            label="Shared with auditors"
            value={loading ? "…" : stats?.shared_last_30_days ?? 0}
            sub="last 30 days"
            tone="success"
          />
        </StatCardGroup>

        <div className="flex items-center justify-end">
          <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
        </div>

        <FolderGroup
          title="Browse by record type"
          subtitle="Drag a folder to reorder it."
          folders={recordFolders}
          mode={viewMode}
          onDragEnd={handleRecordDragEnd}
          navigate={navigate}
          trailing={
            <NewFolderControl
              mode={viewMode}
              onClick={() => {
                setCreateFolderGroup("record");
                setCreateFolderOpen(true);
              }}
            />
          }
        />

        <FolderGroup
          title="Organisational governance & policies"
          subtitle="Business-level records tied to your organisation itself, as distinct from records tied to a specific participant or worker."
          folders={governanceFolders}
          mode={viewMode}
          onDragEnd={handleGovernanceDragEnd}
          navigate={navigate}
          headerExtra={
            ackSummary && (
              <div
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold"
                style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
              >
                <Users size={13} style={{ color: "var(--cc-muted)" }} />
                {ackSummary.acknowledged}/{ackSummary.total} policy acknowledgements
              </div>
            )
          }
          trailing={
            <NewFolderControl
              mode={viewMode}
              onClick={() => {
                setCreateFolderGroup("governance");
                setCreateFolderOpen(true);
              }}
            />
          }
        />
      </div>

      <ShareAuditorDialog open={shareOpen} onOpenChange={setShareOpen} documents={[]} folderKeys={[]} targetDescription="Documents across the vault" />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onCreated={() => void refresh()}
        initialGroup={createFolderGroup}
      />
    </HubLayout>
  );
}
