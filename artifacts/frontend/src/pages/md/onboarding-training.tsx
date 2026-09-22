import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  GraduationCap,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ThumbsUp,
  Send,
  Plus,
  Grip,
  Pencil,
  Trash2,
  Upload,
  FileText,
  FileVideo,
  Link2,
  X,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import { TrainingReviews } from "@/components/training/TrainingReviews";
import { TrainingModuleEditor } from "@/components/training/TrainingModuleEditor";
import { SharedResourceAccess } from "@/components/training/WorkerResourceLibrary";
import { CourseCover } from "@/components/training/CourseCover";
import { HubLayout } from "@/components/layout/HubLayout";
import { SectionInfo } from "@/components/ui/section-info";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import {
  getTrainingModules,
  updateTrainingModule,
  type TrainingModule as CoordinatorTrainingModule,
} from "@/services/coordinatorService";
import {
  getInductionItems,
  createInductionItem,
  updateInductionItem,
  type InductionItem,
} from "@/services/inductionService";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";

interface KpiData {
  new_starters: number;
  in_progress: number;
  completed: number;
  overdue: number;
  awaiting_approval: number;
  new_starter_table: StarterRow[];
}

interface StarterRow {
  assignment_id: string;
  user_id: string;
  name: string;
  role: string;
  program_name: string;
  current_stage: string;
  completion_pct: number;
  status: string;
  assigned_at?: string;
}

interface Program {
  id: string;
  name: string;
  description?: string;
}

interface Stage {
  id: string;
  title: string;
  instructions?: string;
  stage_order: number;
  completion_requirements: Record<string, boolean>;
}

interface Resource {
  id: string;
  name: string;
  resource_type: "video" | "pdf" | "document" | "link";
  url?: string;
  file_size_bytes?: number;
  category?: string;
  created_at?: string;
}

interface ApprovalItem {
  progress_id: string;
  staff_name: string;
  stage_name: string;
  submitted_at?: string;
  notes?: string;
  completion_pct: number;
  resource_count: number;
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  warn,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  accent?: string;
  warn?: boolean;
}) {
  const color = warn ? "#B3261E" : (accent ?? PLUM);
  return (
    <div
      className="rounded-xl border bg-white p-4 shadow-sm"
      style={{ borderColor: BORDER }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-black uppercase tracking-[0.14em]"
          style={{ color: MUTED }}
        >
          {label}
        </span>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: SOFT, color }}
        >
          <Icon size={14} strokeWidth={2.5} />
        </div>
      </div>
      <p
        className="text-2xl font-black leading-none"
        style={{ color: warn ? "#B3261E" : TEXT }}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    active: { label: "In Progress", bg: "#EAF1F7", color: "#2A5C8A" },
    completed: { label: "Completed", bg: "#E9F5F0", color: "#0B5F44" },
    overdue: { label: "Overdue", bg: "#FBEAE9", color: "#8F211B" },
  };
  const s = map[status] ?? { label: status, bg: SOFT, color: MUTED };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-black"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function OverviewTab() {
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiFetch("/api/md/onboarding/overview")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl"
            style={{ background: SOFT }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-2xl border p-10 text-center"
        style={{ borderColor: BORDER }}
      >
        <AlertTriangle
          size={32}
          className="mx-auto mb-3"
          style={{ color: CORAL }}
        />
        <p className="font-black" style={{ color: TEXT }}>
          Could not load overview
        </p>
        <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
          Check your connection and reload the page.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="rounded-2xl border p-10 text-center"
        style={{ borderColor: BORDER }}
      >
        <GraduationCap
          size={32}
          className="mx-auto mb-3"
          style={{ color: MUTED }}
        />
        <p className="font-black" style={{ color: TEXT }}>
          No onboarding data yet
        </p>
        <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
          Create a program in the Builder tab and assign staff to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="New Starters"
          value={data.new_starters}
          icon={Users}
          accent={PLUM}
        />
        <KpiCard
          label="In Progress"
          value={data.in_progress}
          icon={Clock}
          accent="#2A5C8A"
        />
        <KpiCard
          label="Completed"
          value={data.completed}
          icon={CheckCircle2}
          accent={GREEN}
        />
        <KpiCard
          label="Overdue"
          value={data.overdue}
          icon={AlertTriangle}
          warn={data.overdue > 0}
        />
        <KpiCard
          label="Awaiting Approval"
          value={data.awaiting_approval}
          icon={ThumbsUp}
          accent={AMBER}
        />
      </div>

      {data.new_starter_table.length > 0 && (
        <section
          className="rounded-2xl border bg-white p-5 shadow-sm"
          style={{ borderColor: BORDER }}
        >
          <h2 className="mb-4 text-[14px] font-black" style={{ color: TEXT }}>
            New Starter Progress
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b" style={{ borderColor: BORDER }}>
                  {[
                    "Name",
                    "Role",
                    "Program",
                    "Current Stage",
                    "Progress",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      className="pb-2 pr-4 text-[10px] font-black uppercase tracking-[0.14em]"
                      style={{ color: MUTED }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.new_starter_table.map((row) => (
                  <tr
                    key={row.assignment_id}
                    className="border-b last:border-0"
                    style={{ borderColor: BORDER }}
                  >
                    <td
                      className="py-2.5 pr-4 text-[13px] font-semibold"
                      style={{ color: TEXT }}
                    >
                      {row.name}
                    </td>
                    <td
                      className="py-2.5 pr-4 text-[12px] font-medium capitalize"
                      style={{ color: MUTED }}
                    >
                      {row.role.replace(/_/g, " ")}
                    </td>
                    <td
                      className="py-2.5 pr-4 text-[12px] font-medium"
                      style={{ color: MUTED }}
                    >
                      {row.program_name || "N/A"}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className="inline-block max-w-[140px] truncate rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: SOFT, color: PLUM }}
                        title={row.current_stage}
                      >
                        {row.current_stage || "Not Started"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-20 h-1.5 rounded-full"
                          style={{ background: BORDER }}
                        >
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${row.completion_pct}%`,
                              background:
                                row.completion_pct >= 100 ? GREEN : PLUM,
                            }}
                          />
                        </div>
                        <span
                          className="text-[11px] font-black"
                          style={{ color: TEXT }}
                        >
                          {row.completion_pct}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

const COMPLETION_KEYS = [
  { key: "must_watch_video", label: "Must Watch Video" },
  { key: "must_download", label: "Must Download Resource" },
  { key: "must_read", label: "Must Read Document" },
  { key: "must_complete_checklist", label: "Must Complete Checklist" },
  { key: "require_acknowledgement", label: "Require Acknowledgement" },
];

function StageSheet({
  stage,
  programId,
  onClose,
  onSave,
}: {
  stage: Stage;
  programId: string;
  onClose: () => void;
  onSave: (updated: Stage) => void;
}) {
  const [title, setTitle] = useState(stage.title);
  const [instructions, setInstructions] = useState(stage.instructions ?? "");
  const [reqs, setReqs] = useState<Record<string, boolean>>(
    stage.completion_requirements ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [allResources, setAllResources] = useState<Resource[]>([]);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesLoaded, setResourcesLoaded] = useState(false);
  const { toast } = useToast();

  function toggleReq(key: string) {
    setReqs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function loadResources() {
    if (resourcesLoaded || resourcesLoading) return;
    setResourcesLoading(true);
    apiFetch("/api/md/onboarding/resources")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Resource[]) => {
        setAllResources(list);
        setResourcesLoaded(true);
      })
      .catch(() => {})
      .finally(() => setResourcesLoading(false));
  }

  function toggleAttach(id: string) {
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(
        `/api/md/onboarding/programs/${programId}/stages/${stage.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            instructions,
            completion_requirements: reqs,
          }),
        },
      );
      if (!res.ok) {
        throw new Error("Save failed");
      }
      // Link any newly attached resources to this stage
      for (const rid of attachedIds) {
        await apiFetch(`/api/md/onboarding/resources/${rid}/attach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_id: stage.id }),
        }).catch(() => {});
      }
      toast({ title: "Stage saved" });
      onSave({ ...stage, title, instructions, completion_requirements: reqs });
    } catch {
      toast({ title: "Failed to save stage", variant: "destructive" });
      // keep editor open so MD can retry
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl flex flex-col"
        style={{ borderLeft: `1px solid ${BORDER}` }}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: BORDER }}
        >
          <h3 className="text-[15px] font-black" style={{ color: TEXT }}>
            Edit Stage
          </h3>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1 hover:bg-gray-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          <div>
            <label
              className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: MUTED }}
            >
              Stage Name
            </label>
            <input
              aria-label="Stage name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
              style={{ borderColor: BORDER }}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: MUTED }}
            >
              Instructions
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none resize-none focus:ring-1"
              style={{ borderColor: BORDER }}
              placeholder="Describe what the new starter should do in this stage…"
            />
          </div>

          <div>
            <label
              className="mb-3 block text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: MUTED }}
            >
              Completion Requirements
            </label>
            <div className="space-y-2">
              {COMPLETION_KEYS.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!!reqs[key]}
                    onChange={() => toggleReq(key)}
                    className="h-4 w-4 rounded accent-[#1E3A5F]"
                  />
                  <span
                    className="text-[13px] font-medium"
                    style={{ color: TEXT }}
                  >
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-[11px] font-black uppercase tracking-[0.12em]"
                style={{ color: MUTED }}
              >
                Attach Resources
              </label>
              {!resourcesLoaded && (
                <button
                  onClick={loadResources}
                  className="text-[11px] font-bold underline"
                  style={{ color: PLUM }}
                >
                  {resourcesLoading ? "Loading…" : "Load resources"}
                </button>
              )}
            </div>
            {resourcesLoaded && allResources.length === 0 && (
              <p className="text-[12px]" style={{ color: MUTED }}>
                No resources in library yet. Upload some in the Resources tab.
              </p>
            )}
            {resourcesLoaded && allResources.length > 0 && (
              <div
                className="max-h-44 overflow-y-auto space-y-1.5 rounded-lg border p-2"
                style={{ borderColor: BORDER }}
              >
                {allResources.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={attachedIds.has(r.id)}
                      onChange={() => toggleAttach(r.id)}
                      className="h-4 w-4 rounded accent-[#1E3A5F] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="truncate text-[12px] font-semibold"
                        style={{ color: TEXT }}
                      >
                        {r.name}
                      </p>
                      <p
                        className="text-[10px] font-medium uppercase"
                        style={{ color: MUTED }}
                      >
                        {r.resource_type}
                        {r.category ? ` · ${r.category}` : ""}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {attachedIds.size > 0 && (
              <p
                className="mt-1.5 text-[11px] font-bold"
                style={{ color: PLUM }}
              >
                {attachedIds.size} resource{attachedIds.size !== 1 ? "s" : ""}{" "}
                will be attached on save
              </p>
            )}
          </div>
        </div>

        <div
          className="flex justify-end gap-2 border-t px-5 py-4"
          style={{ borderColor: BORDER }}
        >
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-[13px] font-bold"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-black text-white disabled:opacity-50"
            style={{ background: "var(--cc-cta)" }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Save Stage
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableStageCard({
  stage,
  onEdit,
  onDelete,
}: {
  stage: Stage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const reqCount = Object.values(stage.completion_requirements || {}).filter(
    Boolean,
  ).length;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderColor: BORDER }}
      className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm"
    >
      <button
        className="cursor-grab touch-none rounded p-1 hover:bg-gray-100"
        style={{ color: MUTED }}
        {...attributes}
        {...listeners}
      >
        <Grip size={15} strokeWidth={2} />
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-black" style={{ color: TEXT }}>
          {stage.title}
        </p>
        {stage.instructions && (
          <p
            className="mt-0.5 truncate text-[11px] font-medium"
            style={{ color: MUTED }}
          >
            {stage.instructions}
          </p>
        )}
        {reqCount > 0 && (
          <p
            className="mt-0.5 text-[10px] font-medium"
            style={{ color: MUTED }}
          >
            {reqCount} requirement{reqCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEdit}
          aria-label="Edit stage"
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100"
          style={{ color: PLUM }}
        >
          <Pencil size={13} strokeWidth={2.5} />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete stage"
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-red-50"
          style={{ color: CORAL }}
        >
          <Trash2 size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function BuilderTab() {
  const { toast } = useToast();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [loadingPrograms, setLoadingPrograms] = useState(true);
  const [loadingStages, setLoadingStages] = useState(false);
  const [programsError, setProgramsError] = useState(false);
  const [newProgramName, setNewProgramName] = useState("");
  const [showNewProgram, setShowNewProgram] = useState(false);
  const [savingProgram, setSavingProgram] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingPrograms(true);
    setProgramsError(false);
    apiFetch("/api/md/onboarding/programs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Program[]) => {
        if (!cancelled) setPrograms(d);
      })
      .catch(() => {
        if (!cancelled) setProgramsError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPrograms(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadStages = useCallback((programId: string) => {
    setLoadingStages(true);
    apiFetch(`/api/md/onboarding/programs/${programId}/stages`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Stage[]) => setStages(d))
      .catch(() => {})
      .finally(() => setLoadingStages(false));
  }, []);

  function selectProgram(p: Program) {
    setSelectedProgram(p);
    loadStages(p.id);
  }

  async function createProgram() {
    if (!newProgramName.trim()) return;
    setSavingProgram(true);
    try {
      const res = await apiFetch("/api/md/onboarding/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProgramName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setPrograms((prev) => [...prev, created]);
        setNewProgramName("");
        setShowNewProgram(false);
        selectProgram(created);
        toast({ title: "Program created" });
      }
    } catch {
      toast({ title: "Failed to create program", variant: "destructive" });
    } finally {
      setSavingProgram(false);
    }
  }

  async function addStage() {
    if (!selectedProgram) return;
    const nextOrder = stages.length;
    const res = await apiFetch(
      `/api/md/onboarding/programs/${selectedProgram.id}/stages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Stage", stage_order: nextOrder }),
      },
    );
    if (res.ok) {
      const created = await res.json();
      setStages((prev) => [...prev, created]);
      setEditingStage(created);
    }
  }

  async function deleteStage(stageId: string) {
    if (!selectedProgram) return;
    await apiFetch(
      `/api/md/onboarding/programs/${selectedProgram.id}/stages/${stageId}`,
      { method: "DELETE" },
    );
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    toast({ title: "Stage deleted" });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = stages.findIndex((s) => s.id === active.id);
    const newIdx = stages.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(stages, oldIdx, newIdx).map((s, i) => ({
      ...s,
      stage_order: i,
    }));
    setStages(reordered);
    if (selectedProgram) {
      apiFetch(
        `/api/md/onboarding/programs/${selectedProgram.id}/stages/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            reordered.map((s) => ({
              stage_id: s.id,
              new_order: s.stage_order,
            })),
          ),
        },
      ).catch(() => {});
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
          Onboarding Programs
        </h2>
        <button
          onClick={() => setShowNewProgram(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white"
          style={{ background: "var(--cc-cta)" }}
        >
          <Plus size={12} strokeWidth={2.5} /> New Program
        </button>
      </div>

      {showNewProgram && (
        <div
          className="flex items-center gap-2 rounded-xl border bg-white p-3"
          style={{ borderColor: BORDER }}
        >
          <input
            autoFocus
            value={newProgramName}
            onChange={(e) => setNewProgramName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createProgram();
              if (e.key === "Escape") setShowNewProgram(false);
            }}
            placeholder="Program name…"
            className="flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
            style={{ borderColor: BORDER }}
          />
          <button
            onClick={createProgram}
            disabled={savingProgram || !newProgramName.trim()}
            className="rounded-lg px-3 py-2 text-[12px] font-black text-white disabled:opacity-50"
            style={{ background: "var(--cc-cta)" }}
          >
            {savingProgram ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              "Create"
            )}
          </button>
          <button
            onClick={() => setShowNewProgram(false)}
            aria-label="Cancel new program"
            className="rounded-lg p-2 hover:bg-gray-100"
          >
            <X size={14} style={{ color: MUTED }} />
          </button>
        </div>
      )}

      {loadingPrograms ? (
        <div
          className="h-16 animate-pulse rounded-xl"
          style={{ background: SOFT }}
        />
      ) : programsError ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: BORDER }}
        >
          <AlertTriangle
            size={28}
            className="mx-auto mb-2"
            style={{ color: CORAL }}
          />
          <p className="text-[13px] font-black" style={{ color: TEXT }}>
            Could not load programs
          </p>
          <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
            Reload the page to try again.
          </p>
        </div>
      ) : programs.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: BORDER }}
        >
          <GraduationCap
            size={28}
            className="mx-auto mb-2"
            style={{ color: MUTED }}
          />
          <p className="text-[13px] font-black" style={{ color: TEXT }}>
            No programs yet
          </p>
          <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
            Create your first onboarding program above.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {programs.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProgram(p)}
              className="rounded-lg border px-4 py-2 text-[12px] font-black transition"
              style={{
                borderColor:
                  selectedProgram?.id === p.id ? "var(--cc-text)" : BORDER,
                background:
                  selectedProgram?.id === p.id
                    ? "var(--cc-cta)"
                    : "var(--cc-bg)",
                color: selectedProgram?.id === p.id ? "#fff" : TEXT,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {selectedProgram && (
        <section
          className="rounded-2xl border bg-white p-5 shadow-sm space-y-4"
          style={{ borderColor: BORDER }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-black" style={{ color: TEXT }}>
              Stages: {selectedProgram.name}
            </h3>
            <button
              onClick={addStage}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-black transition hover:bg-gray-50"
              style={{ borderColor: PLUM, color: PLUM }}
            >
              <Plus size={11} strokeWidth={2.5} /> Add Stage
            </button>
          </div>

          {loadingStages ? (
            <div
              className="h-16 animate-pulse rounded-xl"
              style={{ background: SOFT }}
            />
          ) : stages.length === 0 ? (
            <div
              className="rounded-xl p-6 text-center"
              style={{ background: SOFT }}
            >
              <p className="text-[13px] font-medium" style={{ color: MUTED }}>
                No stages yet. Click "Add Stage" to build your onboarding flow.
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={stages.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {stages.map((stage) => (
                    <SortableStageCard
                      key={stage.id}
                      stage={stage}
                      onEdit={() => setEditingStage(stage)}
                      onDelete={() => deleteStage(stage.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      )}

      {editingStage && selectedProgram && (
        <StageSheet
          stage={editingStage}
          programId={selectedProgram.id}
          onClose={() => setEditingStage(null)}
          onSave={(updated) => {
            setStages((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s)),
            );
            setEditingStage(null);
          }}
        />
      )}
    </div>
  );
}

function ResourceTypeIcon({ type }: { type: string }) {
  if (type === "video")
    return <FileVideo size={20} strokeWidth={2} style={{ color: "#1E3A5F" }} />;
  if (type === "pdf")
    return <FileText size={20} strokeWidth={2} style={{ color: CORAL }} />;
  if (type === "link")
    return <Link2 size={20} strokeWidth={2} style={{ color: "#2A5C8A" }} />;
  return <FileText size={20} strokeWidth={2} style={{ color: PLUM }} />;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ResourcesTab() {
  const { toast } = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("General");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CATEGORIES = [
    "General",
    "Welcome",
    "Compliance",
    "NDIS",
    "HR",
    "Platform Training",
    "Policies",
    "Safety",
  ];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiFetch("/api/md/onboarding/resources")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Resource[]) => {
        if (!cancelled) setResources(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpload() {
    if (!selectedFile || !uploadName.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("name", uploadName.trim());
      formData.append("category", uploadCategory);
      const res = await apiFetch("/api/md/onboarding/resources/upload", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const created = await res.json();
        setResources((prev) => [created, ...prev]);
        setShowUpload(false);
        setSelectedFile(null);
        setUploadName("");
        toast({ title: "Resource uploaded" });
      } else {
        throw new Error();
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
            Shared resource library
          </h2>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>
            Guidelines, policies and documents uploaded here are available to
            all support workers in your organisation.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white"
          style={{ background: "var(--cc-cta)" }}
        >
          <Upload size={12} strokeWidth={2.5} /> Upload Resource
        </button>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div
            className="w-full max-w-md rounded-xl border bg-white shadow-xl"
            style={{ borderColor: BORDER }}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: BORDER }}
            >
              <h3 className="text-[14px] font-black" style={{ color: TEXT }}>
                Upload Resource
              </h3>
              <button
                onClick={() => {
                  setShowUpload(false);
                  setSelectedFile(null);
                }}
                aria-label="Close upload dialog"
                className="rounded-lg p-1 hover:bg-gray-100"
              >
                <X size={16} style={{ color: MUTED }} />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition hover:bg-gray-50"
                style={{ borderColor: selectedFile ? PLUM : BORDER }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-label="Select file to upload"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setSelectedFile(f);
                      if (!uploadName) setUploadName(f.name);
                    }
                  }}
                />
                {selectedFile ? (
                  <>
                    <CheckCircle2
                      size={24}
                      style={{ color: GREEN }}
                      className="mb-2"
                    />
                    <p
                      className="text-[13px] font-semibold"
                      style={{ color: TEXT }}
                    >
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px]" style={{ color: MUTED }}>
                      {formatBytes(selectedFile.size)}
                    </p>
                  </>
                ) : (
                  <>
                    <Upload
                      size={24}
                      className="mb-2"
                      style={{ color: MUTED }}
                    />
                    <p
                      className="text-[13px] font-semibold"
                      style={{ color: TEXT }}
                    >
                      Click to select file
                    </p>
                    <p className="text-[11px]" style={{ color: MUTED }}>
                      PDF, document, or video
                    </p>
                  </>
                )}
              </div>

              <div>
                <label
                  className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em]"
                  style={{ color: MUTED }}
                >
                  Name
                </label>
                <input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Resource name…"
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                  style={{ borderColor: BORDER }}
                />
              </div>

              <div>
                <label
                  className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em]"
                  style={{ color: MUTED }}
                >
                  Category
                </label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  aria-label="Resource category"
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                  style={{ borderColor: BORDER }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div
              className="flex justify-end gap-2 border-t px-5 py-3"
              style={{ borderColor: BORDER }}
            >
              <button
                onClick={() => {
                  setShowUpload(false);
                  setSelectedFile(null);
                }}
                className="rounded-lg border px-4 py-2 text-[13px] font-bold"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !uploadName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-black text-white disabled:opacity-50"
                style={{ background: "var(--cc-cta)" }}
              >
                {uploading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl"
              style={{ background: SOFT }}
            />
          ))}
        </div>
      ) : error ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <AlertTriangle
            size={32}
            className="mx-auto mb-3"
            style={{ color: CORAL }}
          />
          <p className="font-black" style={{ color: TEXT }}>
            Could not load resources
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Reload the page to try again.
          </p>
        </div>
      ) : resources.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <FileText
            size={32}
            className="mx-auto mb-3"
            style={{ color: MUTED }}
          />
          <p className="font-black" style={{ color: TEXT }}>
            No resources uploaded yet
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Upload PDFs, documents, or videos for your onboarding programs.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border bg-white p-4 shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                  style={{ background: SOFT }}
                >
                  <ResourceTypeIcon type={r.resource_type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-black"
                    style={{ color: TEXT }}
                  >
                    {r.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {r.category && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-black"
                        style={{ background: SOFT, color: MUTED }}
                      >
                        {r.category}
                      </span>
                    )}
                    {r.file_size_bytes ? (
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: MUTED }}
                      >
                        {formatBytes(r.file_size_bytes)}
                      </span>
                    ) : null}
                  </div>
                  {r.created_at && (
                    <span
                      className="mt-1 block text-[10px] font-medium"
                      style={{ color: MUTED }}
                    >
                      Uploaded{" "}
                      {new Date(r.created_at).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  <div className="mt-3">
                    <SharedResourceAccess
                      id={r.id}
                      name={r.name}
                      accessUrl={`/api/md/onboarding/resources/${encodeURIComponent(r.id)}/download?redirect=false`}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalsTab() {
  const { toast } = useToast();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [requestChangesId, setRequestChangesId] = useState<string | null>(null);
  const [changesNote, setChangesNote] = useState("");
  const [actioning, setActioning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiFetch("/api/md/onboarding/approvals")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ApprovalItem[]) => {
        if (!cancelled) setItems(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function approve(progressId: string) {
    setActioning(progressId);
    try {
      const res = await apiFetch(
        `/api/md/onboarding/approvals/${progressId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.progress_id !== progressId));
        toast({ title: "Stage approved" });
      }
    } catch {
      toast({ title: "Approval failed", variant: "destructive" });
    } finally {
      setActioning(null);
    }
  }

  async function requestChanges(progressId: string) {
    if (!changesNote.trim()) return;
    setActioning(progressId);
    try {
      const res = await apiFetch(
        `/api/md/onboarding/approvals/${progressId}/request-changes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: changesNote.trim() }),
        },
      );
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.progress_id !== progressId));
        setRequestChangesId(null);
        setChangesNote("");
        toast({ title: "Changes requested" });
      }
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
          Approval Queue
        </h2>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-black"
          style={{
            background: items.length > 0 ? "#FBF2E6" : SOFT,
            color: items.length > 0 ? "#7A4A08" : MUTED,
          }}
        >
          {items.length} pending
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl"
              style={{ background: SOFT }}
            />
          ))}
        </div>
      ) : error ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <AlertTriangle
            size={32}
            className="mx-auto mb-3"
            style={{ color: CORAL }}
          />
          <p className="font-black" style={{ color: TEXT }}>
            Could not load approvals
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Reload the page to try again.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <CheckCircle2
            size={32}
            className="mx-auto mb-3"
            style={{ color: GREEN }}
          />
          <p className="font-black" style={{ color: TEXT }}>
            All clear!
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            No stage submissions awaiting your approval.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div
              key={item.progress_id}
              className="rounded-xl border bg-white p-5 shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full font-black text-[13px] shrink-0"
                    style={{ background: SOFT, color: PLUM }}
                  >
                    {(item.staff_name || "?")
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div>
                    <p
                      className="text-[13px] font-black"
                      style={{ color: TEXT }}
                    >
                      {item.staff_name}
                    </p>
                    <p
                      className="text-[11px] font-medium"
                      style={{ color: MUTED }}
                    >
                      Stage:{" "}
                      <span style={{ color: TEXT }}>{item.stage_name}</span>
                    </p>
                    {item.submitted_at && (
                      <p
                        className="text-[10px] font-medium"
                        style={{ color: MUTED }}
                      >
                        Submitted{" "}
                        {new Date(item.submitted_at).toLocaleDateString(
                          "en-AU",
                          { day: "numeric", month: "short" },
                        )}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-16 h-1.5 rounded-full"
                          style={{ background: BORDER }}
                        >
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${item.completion_pct}%`,
                              background:
                                item.completion_pct >= 100 ? GREEN : PLUM,
                            }}
                          />
                        </div>
                        <span
                          className="text-[10px] font-black"
                          style={{ color: TEXT }}
                        >
                          {item.completion_pct}% done
                        </span>
                      </div>
                      {item.resource_count > 0 && (
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: MUTED }}
                        >
                          {item.resource_count} resource
                          {item.resource_count !== 1 ? "s" : ""} attached
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setRequestChangesId(item.progress_id);
                      setChangesNote("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-black transition hover:bg-gray-50"
                    style={{ borderColor: CORAL, color: CORAL }}
                  >
                    <Send size={12} /> Request Changes
                  </button>
                  <button
                    onClick={() => approve(item.progress_id)}
                    disabled={actioning === item.progress_id}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white disabled:opacity-50"
                    style={{ background: GREEN }}
                  >
                    {actioning === item.progress_id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ThumbsUp size={12} />
                    )}
                    Approve
                  </button>
                </div>
              </div>

              {requestChangesId === item.progress_id && (
                <div
                  className="mt-4 space-y-3 border-t pt-4"
                  style={{ borderColor: BORDER }}
                >
                  <textarea
                    autoFocus
                    value={changesNote}
                    onChange={(e) => setChangesNote(e.target.value)}
                    placeholder="Describe what needs to be changed or resubmitted…"
                    rows={3}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13px] resize-none outline-none focus:ring-1"
                    style={{ borderColor: BORDER }}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setRequestChangesId(null);
                        setChangesNote("");
                      }}
                      className="rounded-lg border px-3 py-1.5 text-[12px] font-bold"
                      style={{ borderColor: BORDER, color: MUTED }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => requestChanges(item.progress_id)}
                      disabled={
                        !changesNote.trim() || actioning === item.progress_id
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white disabled:opacity-50"
                      style={{ background: CORAL }}
                    >
                      {actioning === item.progress_id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CREDENTIAL_TYPE_OPTIONS = [
  { value: "", label: "None" },
  { value: "ndis_screening", label: "NDIS Worker Screening" },
  { value: "police_check", label: "Police Check" },
  { value: "first_aid", label: "First Aid" },
  { value: "manual_handling", label: "Manual Handling" },
  { value: "cpr", label: "CPR" },
  { value: "qualification", label: "Qualification" },
];

function ModulesTab({
  onEditingChange,
}: {
  onEditingChange: (editing: boolean) => void;
}) {
  const { toast } = useToast();
  const [modules, setModules] = useState<CoordinatorTrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingModule, setEditingModule] = useState<
    CoordinatorTrainingModule | undefined
  >();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const visibleModules = modules.filter(
    (module) =>
      (module.title + " " + (module.description ?? ""))
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (filter === "all" ||
        (filter === "available" && !module.is_locked) ||
        (filter === "maintenance" && module.is_locked) ||
        (filter === "new-hire" && module.auto_assign_on_hire)),
  );
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    getTrainingModules()
      .then((d) => setModules(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    onEditingChange(showForm);
  }, [showForm, onEditingChange]);

  async function toggleFlag(
    module: CoordinatorTrainingModule,
    key: "auto_assign_on_hire" | "requires_certification",
  ) {
    setUpdatingId(module.id);
    try {
      const updated = await updateTrainingModule(module.id, {
        [key]: !module[key],
      });
      setModules((prev) =>
        prev.map((m) => (m.id === module.id ? { ...m, ...updated } : m)),
      );
    } catch {
      toast({ title: "Failed to update module", variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  }

  if (showForm)
    return (
      <TrainingModuleEditor
        key={editingModule?.id ?? "new"}
        module={editingModule}
        credentials={CREDENTIAL_TYPE_OPTIONS}
        onChanged={(updated) => {
          setModules((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
          setEditingModule(updated);
        }}
        onClose={() => setShowForm(false)}
        onSaved={(created) => {
          setModules((prev) =>
            editingModule
              ? prev.map((m) =>
                  m.id === created.id ? { ...m, ...created } : m,
                )
              : [created, ...prev],
          );
          if (editingModule) {
            setShowForm(false);
          } else {
            setEditingModule(created);
          }
        }}
      />
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold" style={{ color: TEXT }}>
            Training Modules
          </h2>
          <p className="mt-0.5 text-sm font-medium" style={{ color: MUTED }}>
            Create courses, curate learning materials and set requirements for
            new hires.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingModule(undefined);
            setShowForm(true);
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shrink-0"
          style={{ background: "var(--cc-cta)" }}
        >
          <Plus size={12} strokeWidth={2.5} /> New Module
        </button>
      </div>

      <label className="block">
        <span className="sr-only">Search training modules</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search training modules"
          className="w-full rounded-xl border bg-card px-4 py-3 text-sm sm:max-w-sm"
        />
      </label>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1.5 text-sm font-medium text-cc-text">
          Show modules
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="min-h-11 rounded-lg border bg-card px-3 text-sm"
          >
            <option value="all">All modules</option>
            <option value="available">Available to workers</option>
            <option value="maintenance">Under maintenance</option>
            <option value="new-hire">Assigned to new hires</option>
          </select>
        </label>
        {!loading && !error && (
          <p role="status" className="text-sm text-cc-muted">
            {visibleModules.length} of {modules.length} modules
          </p>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl"
              style={{ background: SOFT }}
            />
          ))}
        </div>
      ) : error ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <AlertTriangle
            size={32}
            className="mx-auto mb-3"
            style={{ color: CORAL }}
          />
          <p className="font-semibold" style={{ color: TEXT }}>
            Could not load training modules
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            <button onClick={load} className="underline">
              Try again
            </button>
          </p>
        </div>
      ) : modules.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <GraduationCap
            size={32}
            className="mx-auto mb-3"
            style={{ color: MUTED }}
          />
          <p className="font-semibold" style={{ color: TEXT }}>
            No training modules yet
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Create one and mark it auto-assign to make it mandatory for new
            hires.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((m) => (
            <div
              key={m.id}
              className="flex h-full flex-col rounded-2xl border bg-card p-3 shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <CourseCover
                title={m.title}
                count={m.resources?.length}
                color={m.cover_color}
                imageUrl={m.cover_url}
              />
              <div className="flex flex-1 flex-col gap-4 p-2 pt-4">
                <div className="min-w-0 flex-1">
                  <p
                    className="min-min-h-11 text-sm font-bold leading-5"
                    style={{ color: TEXT }}
                  >
                    {m.title}
                  </p>
                  <span
                    className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-bold ${m.is_locked ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-700"}`}
                  >
                    {m.is_locked ? "Under maintenance" : "Available to workers"}
                  </span>
                  {m.description && (
                    <p
                      className="mt-2 line-clamp-3 text-xs leading-5"
                      style={{ color: MUTED }}
                    >
                      {m.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {m.linked_credential_type && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: SOFT, color: MUTED }}
                      >
                        Linked: {m.linked_credential_type.replace(/_/g, " ")}
                      </span>
                    )}
                    {m.requires_certification && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: SOFT, color: PLUM }}
                      >
                        Certification required
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-auto grid gap-2 border-t pt-4">
                  <button
                    onClick={() => {
                      setEditingModule(m);
                      setShowForm(true);
                    }}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground"
                  >
                    <Pencil size={14} /> Manage module
                  </button>
                  <button
                    onClick={() => toggleFlag(m, "auto_assign_on_hire")}
                    disabled={updatingId !== null}
                    aria-pressed={m.auto_assign_on_hire}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold disabled:opacity-50"
                    style={{ borderColor: BORDER, color: MUTED }}
                  >
                    {updatingId === m.id && (
                      <Loader2 size={13} className="animate-spin" />
                    )}
                    {m.auto_assign_on_hire
                      ? "New-hire assignment: On"
                      : "New-hire assignment: Off"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading &&
        !error &&
        modules.length > 0 &&
        visibleModules.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No modules match your search and filter.
          </p>
        )}
    </div>
  );
}

function InductionFormSheet({
  onClose,
  onSaved,
  nextSortOrder,
}: {
  onClose: () => void;
  onSaved: (item: InductionItem) => void;
  nextSortOrder: number;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [isMandatory, setIsMandatory] = useState(true);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await createInductionItem({
        title: title.trim(),
        description: description.trim() || undefined,
        content_url: contentUrl.trim() || undefined,
        is_mandatory: isMandatory,
        sort_order: nextSortOrder,
      });
      toast({ title: "Induction item created" });
      onSaved(created);
    } catch {
      toast({
        title: "Failed to create induction item",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl flex flex-col"
        style={{ borderLeft: `1px solid ${BORDER}` }}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: BORDER }}
        >
          <h3 className="text-[15px] font-black" style={{ color: TEXT }}>
            New Induction Item
          </h3>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1 hover:bg-gray-100"
          >
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          <div>
            <label
              className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: MUTED }}
            >
              Title
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Meet your team"
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
              style={{ borderColor: BORDER }}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: MUTED }}
            >
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none resize-none focus:ring-1"
              style={{ borderColor: BORDER }}
              placeholder="What should a new worker do for this item?"
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: MUTED }}
            >
              Resource link
            </label>
            <input
              value={contentUrl}
              onChange={(e) => setContentUrl(e.target.value)}
              placeholder="Optional — a reading, video, or policy link"
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
              style={{ borderColor: BORDER }}
            />
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isMandatory}
              onChange={(e) => setIsMandatory(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-[#1E3A5F]"
            />
            <span className="text-[13px] font-medium" style={{ color: TEXT }}>
              Mandatory
              <span
                className="mt-0.5 block text-[11px] font-normal"
                style={{ color: MUTED }}
              >
                Applies to every worker in the org. Rostering is blocked until
                it's complete. Uncheck for optional/informational items that
                never block anything.
              </span>
            </span>
          </label>
        </div>

        <div
          className="flex justify-end gap-2 border-t px-5 py-4"
          style={{ borderColor: BORDER }}
        >
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-[13px] font-bold"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-black text-white disabled:opacity-50"
            style={{ background: "var(--cc-cta)" }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Create Item
          </button>
        </div>
      </div>
    </div>
  );
}

function InductionItemsTab() {
  const { toast } = useToast();
  const [items, setItems] = useState<InductionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    getInductionItems()
      .then((d) => setItems([...d].sort((a, b) => a.sort_order - b.sort_order)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleMandatory(item: InductionItem) {
    setUpdatingId(item.id);
    try {
      const updated = await updateInductionItem(item.id, {
        is_mandatory: !item.is_mandatory,
      });
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, ...updated } : i)),
      );
    } catch {
      toast({
        title: "Failed to update induction item",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
            Induction Items
          </h2>
          <p
            className="mt-0.5 text-[11px] font-medium"
            style={{ color: MUTED }}
          >
            A one-time first-day checklist, separate from ongoing training.
            Every mandatory item applies to every worker and blocks rostering
            until complete.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white shrink-0"
          style={{ background: "var(--cc-cta)" }}
        >
          <Plus size={12} strokeWidth={2.5} /> New Item
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl"
              style={{ background: SOFT }}
            />
          ))}
        </div>
      ) : error ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <AlertTriangle
            size={32}
            className="mx-auto mb-3"
            style={{ color: CORAL }}
          />
          <p className="font-black" style={{ color: TEXT }}>
            Could not load induction items
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Reload the page to try again.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ borderColor: BORDER }}
        >
          <ClipboardCheck
            size={32}
            className="mx-auto mb-3"
            style={{ color: MUTED }}
          />
          <p className="font-black" style={{ color: TEXT }}>
            No induction items yet
          </p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            Create the first-day checklist every new hire sees.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border bg-white p-4 shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-black" style={{ color: TEXT }}>
                    {item.title}
                  </p>
                  {item.description && (
                    <p
                      className="mt-0.5 text-[11px] font-medium"
                      style={{ color: MUTED }}
                    >
                      {item.description}
                    </p>
                  )}
                  {item.content_url && (
                    <a
                      href={item.content_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block text-[11px] font-bold underline"
                      style={{ color: PLUM }}
                    >
                      Resource link
                    </a>
                  )}
                </div>

                <button
                  onClick={() => toggleMandatory(item)}
                  disabled={updatingId === item.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition disabled:opacity-50"
                  style={{
                    background: item.is_mandatory
                      ? "var(--cc-plum-soft)"
                      : SOFT,
                    color: item.is_mandatory ? PLUM : MUTED,
                    border: `1px solid ${item.is_mandatory ? PLUM : BORDER}`,
                  }}
                  title="Toggle mandatory"
                >
                  {updatingId === item.id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : null}
                  {item.is_mandatory ? "Mandatory" : "Optional"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <InductionFormSheet
          onClose={() => setShowForm(false)}
          nextSortOrder={items.length}
          onSaved={(created) => {
            setItems((prev) => [...prev, created]);
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

const TAB_KEYS = [
  { id: "modules", label: "Training modules" },
  { id: "resources", label: "Resource library" },
  { id: "reviews", label: "Completion reviews" },
] as const;

export default function MDOnboardingTrainingPage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "modules" | "resources" | "reviews"
  >("modules");

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        {!editing && (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={() => navigate("/md/onboarding")}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
                style={{ color: MUTED, background: SOFT }}
              >
                <ArrowLeft size={13} strokeWidth={2.5} /> Back to Onboarding
              </button>
              <div>
                <h1
                  className="flex items-center gap-2 text-2xl font-semibold tracking-tight"
                  style={{ color: TEXT }}
                >
                  Competency & Training
                  <SectionInfo text={translate("md.onboarding.subtitle")} />
                </h1>
              </div>
              <div
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ background: SOFT, color: PLUM }}
              >
                <GraduationCap size={16} strokeWidth={2.5} />
              </div>
            </div>

            <div
              aria-label="Training sections"
              className="grid grid-cols-1 gap-1 rounded-xl p-1 sm:grid-cols-3"
              style={{ background: SOFT }}
            >
              {TAB_KEYS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="min-h-11 min-w-0 rounded-lg px-3 py-2 text-sm font-semibold transition"
                  style={{
                    background:
                      activeTab === tab.id ? "var(--cc-bg)" : "transparent",
                    color: activeTab === tab.id ? PLUM : MUTED,
                    boxShadow:
                      activeTab === tab.id
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </>
        )}
        {activeTab === "modules" && <ModulesTab onEditingChange={setEditing} />}
        {activeTab === "resources" && <ResourcesTab />}
        {activeTab === "reviews" && <TrainingReviews />}
      </div>
    </HubLayout>
  );
}

export function MDOnboardingSetupPage() {
  const [, navigate] = useLocation();
  return (
    <HubLayout>
      <div className="space-y-5 pb-10">
        <button
          onClick={() => navigate("/md/onboarding")}
          className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold"
        >
          <ArrowLeft size={15} />
          Back to onboarding
        </button>
        <div>
          <h1 className="text-2xl font-bold">Onboarding setup</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage new-starter programmes, induction and stage approvals.
          </p>
        </div>
        {[
          { title: "Onboarding overview", content: <OverviewTab /> },
          { title: "Programme builder", content: <BuilderTab /> },
          { title: "Induction checklist", content: <InductionItemsTab /> },
          { title: "Stage completion approvals", content: <ApprovalsTab /> },
        ].map(({ title, content }) => (
          <details key={title} className="rounded-2xl border bg-card p-5">
            <summary className="cursor-pointer text-sm font-bold">
              {title}
            </summary>
            <div className="mt-5">{content}</div>
          </details>
        ))}
      </div>
    </HubLayout>
  );
}
