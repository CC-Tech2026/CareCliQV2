import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
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
  type LucideIcon,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { StatCardGroup, StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fetchVaultStats, fetchVaultFolders, setFolderOrder, type VaultStats, type VaultFolder } from "@/services/vaultService";
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
function FolderGlyph({ tint, Icon }: { tint: string; Icon: LucideIcon }) {
  return (
    <div className="relative h-14 w-16 shrink-0">
      <div className="absolute left-0 top-0 h-3 w-7 rounded-t-[4px]" style={{ background: tint }} />
      <div
        className="absolute inset-x-0 bottom-0 top-2 flex items-center justify-center rounded-lg rounded-tl-none"
        style={{ background: tint }}
      >
        <Icon size={20} color="white" />
      </div>
    </div>
  );
}

function FolderTileContent({ folder }: { folder: VaultFolder }) {
  const Icon = FOLDER_ICONS[folder.category] || Folder;
  const tint = folder.group === "governance" ? "var(--cc-muted)" : "var(--cc-text)";
  return (
    <div className="group flex flex-col items-center gap-1.5 rounded-xl p-3 text-center transition" style={{ cursor: "grab" }}>
      <div className="relative">
        <FolderGlyph tint={tint} Icon={Icon} />
        {folder.flagged_count > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
            style={{ background: "var(--cc-status-warning)" }}
          >
            {folder.flagged_count}
          </span>
        )}
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

function SortableFolderTile({ folder, onOpen }: { folder: VaultFolder; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: folder.category });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="rounded-xl hover:bg-[var(--cc-active-bg)]"
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <FolderTileContent folder={folder} />
    </div>
  );
}

function NewFolderTile({ onClick }: { onClick: () => void }) {
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

const GRID_CLASS = "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8";

export default function VaultHome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    void refresh();
  }, []);

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

        <div>
          <h2 className="text-[15px] font-black" style={{ color: "var(--cc-text)" }}>
            Browse by record type
          </h2>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--cc-muted)" }}>
            Drag a folder to reorder it.
          </p>
          <DndContext sensors={sensors} onDragEnd={handleRecordDragEnd}>
            <SortableContext items={recordFolders.map((f) => f.category)} strategy={rectSortingStrategy}>
              <div className={`mt-3 ${GRID_CLASS}`}>
                {recordFolders.map((f) => (
                  <SortableFolderTile key={f.category} folder={f} onOpen={() => navigate(`/md/vault/${f.category}`)} />
                ))}
                <NewFolderTile onClick={() => setCreateFolderOpen(true)} />
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div>
          <h2 className="text-[15px] font-black" style={{ color: "var(--cc-text)" }}>
            Organisational governance & policies
          </h2>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--cc-muted)" }}>
            Business-level records tied to your organisation itself, mapped to the NDIS Practice
            Standards Core Module, as distinct from records tied to a specific participant or worker.
          </p>
          <DndContext sensors={sensors} onDragEnd={handleGovernanceDragEnd}>
            <SortableContext items={governanceFolders.map((f) => f.category)} strategy={rectSortingStrategy}>
              <div className={`mt-3 ${GRID_CLASS}`}>
                {governanceFolders.map((f) => (
                  <SortableFolderTile key={f.category} folder={f} onOpen={() => navigate(`/md/vault/${f.category}`)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <ShareAuditorDialog open={shareOpen} onOpenChange={setShareOpen} documents={[]} folderKeys={[]} targetDescription="Documents across the vault" />
      <CreateFolderDialog open={createFolderOpen} onOpenChange={setCreateFolderOpen} onCreated={() => void refresh()} />
    </HubLayout>
  );
}
