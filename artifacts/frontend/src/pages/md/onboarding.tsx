import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, GraduationCap, Users, CheckCircle2, Clock, AlertTriangle,
  ThumbsUp, Send, Plus, Grip, Pencil, Trash2, Upload, FileText,
  FileVideo, Link2, X, Loader2,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
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

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const GREEN  = "#10B981";
const AMBER  = "#F59E0B";

type Tab = "overview" | "builder" | "resources" | "approvals";

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
  label, value, icon: Icon, accent, warn,
}: {
  label: string; value: number | string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  accent?: string; warn?: boolean;
}) {
  const color = warn ? "#EF4444" : accent ?? PLUM;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: SOFT, color }}>
          <Icon size={14} strokeWidth={2.5} />
        </div>
      </div>
      <p className="text-2xl font-black leading-none" style={{ color: warn ? "#EF4444" : TEXT }}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    active:    { label: "In Progress", bg: "#EFF6FF", color: "#2563EB" },
    completed: { label: "Completed",   bg: "#D1FAE5", color: "#065F46" },
    overdue:   { label: "Overdue",     bg: "#FEE2E2", color: "#991B1B" },
  };
  const s = map[status] ?? { label: status, bg: SOFT, color: MUTED };
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: s.bg, color: s.color }}>
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
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl" style={{ background: SOFT }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER }}>
        <AlertTriangle size={32} className="mx-auto mb-3" style={{ color: CORAL }} />
        <p className="font-black" style={{ color: TEXT }}>Could not load overview</p>
        <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Check your connection and reload the page.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER }}>
        <GraduationCap size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
        <p className="font-black" style={{ color: TEXT }}>No onboarding data yet</p>
        <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
          Create a program in the Builder tab and assign staff to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="New Starters"      value={data.new_starters}      icon={Users}         accent={PLUM} />
        <KpiCard label="In Progress"       value={data.in_progress}       icon={Clock}         accent="#0EA5E9" />
        <KpiCard label="Completed"         value={data.completed}         icon={CheckCircle2}  accent={GREEN} />
        <KpiCard label="Overdue"           value={data.overdue}           icon={AlertTriangle} warn={data.overdue > 0} />
        <KpiCard label="Awaiting Approval" value={data.awaiting_approval} icon={ThumbsUp}      accent={AMBER} />
      </div>

      {data.new_starter_table.length > 0 && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <h2 className="mb-4 text-[14px] font-black" style={{ color: TEXT }}>New Starter Progress</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b" style={{ borderColor: BORDER }}>
                  {["Name", "Role", "Program", "Current Stage", "Progress", "Status"].map((h) => (
                    <th key={h} className="pb-2 pr-4 text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.new_starter_table.map((row) => (
                  <tr key={row.assignment_id} className="border-b last:border-0" style={{ borderColor: BORDER }}>
                    <td className="py-2.5 pr-4 text-[13px] font-semibold" style={{ color: TEXT }}>{row.name}</td>
                    <td className="py-2.5 pr-4 text-[12px] font-medium capitalize" style={{ color: MUTED }}>
                      {row.role.replace(/_/g, " ")}
                    </td>
                    <td className="py-2.5 pr-4 text-[12px] font-medium" style={{ color: MUTED }}>{row.program_name || "—"}</td>
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
                        <div className="w-20 h-1.5 rounded-full" style={{ background: BORDER }}>
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${row.completion_pct}%`, background: row.completion_pct >= 100 ? GREEN : PLUM }}
                          />
                        </div>
                        <span className="text-[11px] font-black" style={{ color: TEXT }}>{row.completion_pct}%</span>
                      </div>
                    </td>
                    <td className="py-2.5"><StatusBadge status={row.status} /></td>
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
  { key: "must_watch_video",       label: "Must Watch Video" },
  { key: "must_download",          label: "Must Download Resource" },
  { key: "must_read",              label: "Must Read Document" },
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
  const [reqs, setReqs] = useState<Record<string, boolean>>(stage.completion_requirements ?? {});
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
      const res = await apiFetch(`/api/md/onboarding/programs/${programId}/stages/${stage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, instructions, completion_requirements: reqs }),
      });
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
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl flex flex-col" style={{ borderLeft: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <h3 className="text-[15px] font-black" style={{ color: TEXT }}>Edit Stage</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>
              Stage Name
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
              style={{ borderColor: BORDER }}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>
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
            <label className="mb-3 block text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>
              Completion Requirements
            </label>
            <div className="space-y-2">
              {COMPLETION_KEYS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!reqs[key]}
                    onChange={() => toggleReq(key)}
                    className="h-4 w-4 rounded accent-[#5533CC]"
                  />
                  <span className="text-[13px] font-medium" style={{ color: TEXT }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>
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
              <p className="text-[12px]" style={{ color: MUTED }}>No resources in library yet — upload some in the Resources tab.</p>
            )}
            {resourcesLoaded && allResources.length > 0 && (
              <div className="max-h-44 overflow-y-auto space-y-1.5 rounded-lg border p-2" style={{ borderColor: BORDER }}>
                {allResources.map((r) => (
                  <label key={r.id} className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={attachedIds.has(r.id)}
                      onChange={() => toggleAttach(r.id)}
                      className="h-4 w-4 rounded accent-[#5533CC] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[12px] font-semibold" style={{ color: TEXT }}>{r.name}</p>
                      <p className="text-[10px] font-medium uppercase" style={{ color: MUTED }}>{r.resource_type}{r.category ? ` · ${r.category}` : ""}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {attachedIds.size > 0 && (
              <p className="mt-1.5 text-[11px] font-bold" style={{ color: PLUM }}>
                {attachedIds.size} resource{attachedIds.size !== 1 ? "s" : ""} will be attached on save
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: BORDER }}>
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
            style={{ background: PLUM }}
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const reqCount = Object.values(stage.completion_requirements || {}).filter(Boolean).length;

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
        <p className="text-[13px] font-black" style={{ color: TEXT }}>{stage.title}</p>
        {stage.instructions && (
          <p className="mt-0.5 truncate text-[11px] font-medium" style={{ color: MUTED }}>
            {stage.instructions}
          </p>
        )}
        {reqCount > 0 && (
          <p className="mt-0.5 text-[10px] font-medium" style={{ color: MUTED }}>
            {reqCount} requirement{reqCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100"
          style={{ color: PLUM }}
        >
          <Pencil size={13} strokeWidth={2.5} />
        </button>
        <button
          onClick={onDelete}
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingPrograms(true);
    setProgramsError(false);
    apiFetch("/api/md/onboarding/programs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Program[]) => { if (!cancelled) setPrograms(d); })
      .catch(() => { if (!cancelled) setProgramsError(true); })
      .finally(() => { if (!cancelled) setLoadingPrograms(false); });
    return () => { cancelled = true; };
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
    const res = await apiFetch(`/api/md/onboarding/programs/${selectedProgram.id}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Stage", stage_order: nextOrder }),
    });
    if (res.ok) {
      const created = await res.json();
      setStages((prev) => [...prev, created]);
      setEditingStage(created);
    }
  }

  async function deleteStage(stageId: string) {
    if (!selectedProgram) return;
    await apiFetch(`/api/md/onboarding/programs/${selectedProgram.id}/stages/${stageId}`, { method: "DELETE" });
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    toast({ title: "Stage deleted" });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = stages.findIndex((s) => s.id === active.id);
    const newIdx = stages.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(stages, oldIdx, newIdx).map((s, i) => ({ ...s, stage_order: i }));
    setStages(reordered);
    if (selectedProgram) {
      apiFetch(`/api/md/onboarding/programs/${selectedProgram.id}/stages/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reordered.map((s) => ({ stage_id: s.id, new_order: s.stage_order }))),
      }).catch(() => {});
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Onboarding Programs</h2>
        <button
          onClick={() => setShowNewProgram(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white"
          style={{ background: PLUM }}
        >
          <Plus size={12} strokeWidth={2.5} /> New Program
        </button>
      </div>

      {showNewProgram && (
        <div className="flex items-center gap-2 rounded-xl border bg-white p-3" style={{ borderColor: BORDER }}>
          <input
            autoFocus
            value={newProgramName}
            onChange={(e) => setNewProgramName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createProgram(); if (e.key === "Escape") setShowNewProgram(false); }}
            placeholder="Program name…"
            className="flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
            style={{ borderColor: BORDER }}
          />
          <button
            onClick={createProgram}
            disabled={savingProgram || !newProgramName.trim()}
            className="rounded-lg px-3 py-2 text-[12px] font-black text-white disabled:opacity-50"
            style={{ background: PLUM }}
          >
            {savingProgram ? <Loader2 size={13} className="animate-spin" /> : "Create"}
          </button>
          <button onClick={() => setShowNewProgram(false)} className="rounded-lg p-2 hover:bg-gray-100">
            <X size={14} style={{ color: MUTED }} />
          </button>
        </div>
      )}

      {loadingPrograms ? (
        <div className="h-16 animate-pulse rounded-xl" style={{ background: SOFT }} />
      ) : programsError ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: BORDER }}>
          <AlertTriangle size={28} className="mx-auto mb-2" style={{ color: CORAL }} />
          <p className="text-[13px] font-black" style={{ color: TEXT }}>Could not load programs</p>
          <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>Reload the page to try again.</p>
        </div>
      ) : programs.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: BORDER }}>
          <GraduationCap size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-[13px] font-black" style={{ color: TEXT }}>No programs yet</p>
          <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>Create your first onboarding program above.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {programs.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProgram(p)}
              className="rounded-lg border px-4 py-2 text-[12px] font-black transition"
              style={{
                borderColor: selectedProgram?.id === p.id ? PLUM : BORDER,
                background: selectedProgram?.id === p.id ? PLUM : "white",
                color: selectedProgram?.id === p.id ? "#fff" : TEXT,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {selectedProgram && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4" style={{ borderColor: BORDER }}>
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-black" style={{ color: TEXT }}>
              Stages — {selectedProgram.name}
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
            <div className="h-16 animate-pulse rounded-xl" style={{ background: SOFT }} />
          ) : stages.length === 0 ? (
            <div className="rounded-xl p-6 text-center" style={{ background: SOFT }}>
              <p className="text-[13px] font-medium" style={{ color: MUTED }}>
                No stages yet — click "Add Stage" to build your onboarding flow.
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
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
            setStages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setEditingStage(null);
          }}
        />
      )}
    </div>
  );
}

function ResourceTypeIcon({ type }: { type: string }) {
  if (type === "video") return <FileVideo size={20} strokeWidth={2} style={{ color: "#7C3AED" }} />;
  if (type === "pdf")   return <FileText  size={20} strokeWidth={2} style={{ color: CORAL }} />;
  if (type === "link")  return <Link2     size={20} strokeWidth={2} style={{ color: "#0EA5E9" }} />;
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

  const CATEGORIES = ["General", "Welcome", "Compliance", "NDIS", "HR", "Platform Training", "Policies", "Safety"];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiFetch("/api/md/onboarding/resources")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Resource[]) => { if (!cancelled) setResources(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleUpload() {
    if (!selectedFile || !uploadName.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("name", uploadName.trim());
      formData.append("category", uploadCategory);
      const res = await apiFetch("/api/md/onboarding/resources/upload", { method: "POST", body: formData });
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
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Training Resources</h2>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white"
          style={{ background: PLUM }}
        >
          <Upload size={12} strokeWidth={2.5} /> Upload Resource
        </button>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl border bg-white shadow-xl" style={{ borderColor: BORDER }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
              <h3 className="text-[14px] font-black" style={{ color: TEXT }}>Upload Resource</h3>
              <button onClick={() => { setShowUpload(false); setSelectedFile(null); }} className="rounded-lg p-1 hover:bg-gray-100">
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
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setSelectedFile(f); if (!uploadName) setUploadName(f.name); }
                  }}
                />
                {selectedFile ? (
                  <>
                    <CheckCircle2 size={24} style={{ color: GREEN }} className="mb-2" />
                    <p className="text-[13px] font-semibold" style={{ color: TEXT }}>{selectedFile.name}</p>
                    <p className="text-[11px]" style={{ color: MUTED }}>{formatBytes(selectedFile.size)}</p>
                  </>
                ) : (
                  <>
                    <Upload size={24} className="mb-2" style={{ color: MUTED }} />
                    <p className="text-[13px] font-semibold" style={{ color: TEXT }}>Click to select file</p>
                    <p className="text-[11px]" style={{ color: MUTED }}>PDF, document, or video</p>
                  </>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Name</label>
                <input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Resource name…"
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                  style={{ borderColor: BORDER }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                  style={{ borderColor: BORDER }}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: BORDER }}>
              <button onClick={() => { setShowUpload(false); setSelectedFile(null); }} className="rounded-lg border px-4 py-2 text-[13px] font-bold" style={{ borderColor: BORDER, color: MUTED }}>
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !uploadName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-black text-white disabled:opacity-50"
                style={{ background: PLUM }}
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl" style={{ background: SOFT }} />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border p-10 text-center" style={{ borderColor: BORDER }}>
          <AlertTriangle size={32} className="mx-auto mb-3" style={{ color: CORAL }} />
          <p className="font-black" style={{ color: TEXT }}>Could not load resources</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Reload the page to try again.</p>
        </div>
      ) : resources.length === 0 ? (
        <div className="rounded-xl border p-10 text-center" style={{ borderColor: BORDER }}>
          <FileText size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
          <p className="font-black" style={{ color: TEXT }}>No resources uploaded yet</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Upload PDFs, documents, or videos for your onboarding programs.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => (
            <div key={r.id} className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0" style={{ background: SOFT }}>
                  <ResourceTypeIcon type={r.resource_type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black" style={{ color: TEXT }}>{r.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {r.category && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: SOFT, color: MUTED }}>
                        {r.category}
                      </span>
                    )}
                    {r.file_size_bytes ? (
                      <span className="text-[10px] font-medium" style={{ color: MUTED }}>{formatBytes(r.file_size_bytes)}</span>
                    ) : null}
                  </div>
                  {r.created_at && (
                    <span className="mt-1 block text-[10px] font-medium" style={{ color: MUTED }}>
                      Uploaded {new Date(r.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                  <a
                    href={`/api/md/onboarding/resources/${r.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
                    style={{ color: PLUM }}
                  >
                    View <Link2 size={10} />
                  </a>
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
      .then((d: ApprovalItem[]) => { if (!cancelled) setItems(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function approve(progressId: string) {
    setActioning(progressId);
    try {
      const res = await apiFetch(`/api/md/onboarding/approvals/${progressId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
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
      const res = await apiFetch(`/api/md/onboarding/approvals/${progressId}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: changesNote.trim() }),
      });
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
        <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Approval Queue</h2>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black" style={{ background: items.length > 0 ? "#FEF3C7" : SOFT, color: items.length > 0 ? "#92400E" : MUTED }}>
          {items.length} pending
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl" style={{ background: SOFT }} />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border p-10 text-center" style={{ borderColor: BORDER }}>
          <AlertTriangle size={32} className="mx-auto mb-3" style={{ color: CORAL }} />
          <p className="font-black" style={{ color: TEXT }}>Could not load approvals</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Reload the page to try again.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-10 text-center" style={{ borderColor: BORDER }}>
          <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: GREEN }} />
          <p className="font-black" style={{ color: TEXT }}>All clear!</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>No stage submissions awaiting your approval.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.progress_id} className="rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full font-black text-[13px] shrink-0" style={{ background: SOFT, color: PLUM }}>
                    {(item.staff_name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[13px] font-black" style={{ color: TEXT }}>{item.staff_name}</p>
                    <p className="text-[11px] font-medium" style={{ color: MUTED }}>
                      Stage: <span style={{ color: TEXT }}>{item.stage_name}</span>
                    </p>
                    {item.submitted_at && (
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>
                        Submitted {new Date(item.submitted_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full" style={{ background: BORDER }}>
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${item.completion_pct}%`, background: item.completion_pct >= 100 ? GREEN : PLUM }}
                          />
                        </div>
                        <span className="text-[10px] font-black" style={{ color: TEXT }}>{item.completion_pct}% done</span>
                      </div>
                      {item.resource_count > 0 && (
                        <span className="text-[10px] font-medium" style={{ color: MUTED }}>
                          {item.resource_count} resource{item.resource_count !== 1 ? "s" : ""} attached
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setRequestChangesId(item.progress_id); setChangesNote(""); }}
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
                    {actioning === item.progress_id ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                    Approve
                  </button>
                </div>
              </div>

              {requestChangesId === item.progress_id && (
                <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: BORDER }}>
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
                      onClick={() => { setRequestChangesId(null); setChangesNote(""); }}
                      className="rounded-lg border px-3 py-1.5 text-[12px] font-bold"
                      style={{ borderColor: BORDER, color: MUTED }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => requestChanges(item.progress_id)}
                      disabled={!changesNote.trim() || actioning === item.progress_id}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-black text-white disabled:opacity-50"
                      style={{ background: CORAL }}
                    >
                      {actioning === item.progress_id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
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

const TABS: { id: Tab; label: string }[] = [
  { id: "overview",  label: "Overview" },
  { id: "builder",   label: "Builder" },
  { id: "resources", label: "Resources" },
  { id: "approvals", label: "Approvals" },
];

export default function MDOnboardingPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> Hub
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Onboarding Centre</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>Design programs, manage resources, track progress and approve completions</p>
          </div>
          <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: SOFT, color: PLUM }}>
            <GraduationCap size={16} strokeWidth={2.5} />
          </div>
        </div>

        <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 rounded-lg py-2 text-[12px] font-black transition"
              style={{
                background: activeTab === tab.id ? "#fff" : "transparent",
                color: activeTab === tab.id ? PLUM : MUTED,
                boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "overview"  && <OverviewTab />}
        {activeTab === "builder"   && <BuilderTab />}
        {activeTab === "resources" && <ResourcesTab />}
        {activeTab === "approvals" && <ApprovalsTab />}
      </div>
    </HubLayout>
  );
}
