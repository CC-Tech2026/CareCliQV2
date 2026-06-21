import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import {
  CalendarDays, ChevronDown, ChevronUp, Loader2,
  Search, Target, Plus, X, CheckCircle2, Archive,
  ClipboardList, Edit2, Trash2, CheckSquare, BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  getCoordinatorGoals,
  type ParticipantGoalGroup,
  type GoalStatus,
  getNdisGoals, createNdisGoal, updateNdisGoal, archiveNdisGoal, completeNdisGoal,
  getTaskTemplates, createTaskTemplate, updateTaskTemplate, deleteTaskTemplate,
  getGoalProgress,
  type NdisGoal, type NdisGoalPayload, type TaskTemplate,
  type GoalProgressResponse, type TaskTemplatesResponse,
} from "@/services/coordinatorService";
import { jsonFetch } from "@/services/http";

const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

const STATUS_META: Record<GoalStatus, { label: string; color: string; bg: string }> = {
  progressing: { label: "Progressing",  color: "#059669", bg: "#ECFDF5" },
  achieved:    { label: "Achieved",     color: "#7C3AED", bg: "#F5F3FF" },
  stalled:     { label: "Stalled",      color: "#D97706", bg: "#FFFBEB" },
  blocked:     { label: "Blocked",      color: "#DC2626", bg: "#FEF2F2" },
  general:     { label: "Active",       color: "#5533CC", bg: "#F5F3FC" },
};
function statusMeta(s?: GoalStatus) {
  return STATUS_META[s ?? "general"] ?? STATUS_META.general;
}

const GOAL_AREA_META: Record<NdisGoal["goal_area"], { label: string; color: string; bg: string }> = {
  daily_living: { label: "Daily Living",  color: "#1D4ED8", bg: "#EFF6FF" },
  community:    { label: "Community",     color: "#15803D", bg: "#F0FDF4" },
  health:       { label: "Health",        color: "#DC2626", bg: "#FEF2F2" },
  social:       { label: "Social",        color: "#7E22CE", bg: "#FDF4FF" },
  employment:   { label: "Employment",    color: "#D97706", bg: "#FFFBEB" },
  other:        { label: "Other",         color: MUTED,     bg: SOFT      },
};

const GOAL_STATUS_META: Record<NdisGoal["status"], { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: PLUM,      bg: SOFT      },
  completed: { label: "Completed", color: "#059669", bg: "#ECFDF5" },
  archived:  { label: "Archived",  color: MUTED,     bg: "#F3F4F6" },
};

const EVIDENCE_OPTS = [
  { v: "optional",    label: "Optional"      },
  { v: "photo",       label: "Photo"         },
  { v: "voice",       label: "Voice Note"    },
  { v: "text",        label: "Text Note"     },
  { v: "photo+voice", label: "Photo + Voice" },
] as const;

// ── Overview tab helpers ──────────────────────────────────────────────────────

type FilterKey = "all" | "stalled" | "blocked" | "no_session";

function CategoryChip({ category }: { category: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    core:              { label: "Core",              bg: "#EFF6FF", color: "#1D4ED8" },
    capacity_building: { label: "Capacity Building", bg: "#F0FDF4", color: "#15803D" },
    capital:           { label: "Capital",           bg: "#FDF4FF", color: "#7E22CE" },
    general:           { label: "General",           bg: SOFT,      color: PLUM      },
  };
  const meta = map[category.toLowerCase()] ?? map.general;
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

function ScheduleReviewPanel({ group, open, onClose }: { group: ParticipantGoalGroup; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [reviewDate, setReviewDate] = useState(group.upcoming_review_date ?? "");

  const mutation = useMutation({
    mutationFn: () => jsonFetch(`/api/participants/${group.participant_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upcoming_review_date: reviewDate }),
    }),
    onSuccess: () => { toast({ title: "Review date saved" }); qc.invalidateQueries({ queryKey: ["coordinator-goals", orgId] }); onClose(); },
    onError: () => toast({ variant: "destructive", title: "Save failed" }),
  });

  if (!open) return null;
  return (
    <div className="mt-4 rounded-xl border p-4 space-y-3" style={{ background: SOFT, borderColor: BORDER }}>
      <p className="text-[12px] font-black uppercase tracking-widest" style={{ color: MUTED }}>Schedule Review</p>
      <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="h-9 rounded-xl text-[13px]" />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="rounded-xl text-xs" style={{ borderColor: BORDER }} onClick={onClose}>Cancel</Button>
        <Button size="sm" className="rounded-xl text-xs" style={{ background: PLUM, color: "#fff" }} disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Save Date"}
        </Button>
      </div>
    </div>
  );
}

function ParticipantCard({ group }: { group: ParticipantGoalGroup }) {
  const [open, setOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: BORDER }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-[#F5F3FC]">
        <div className="flex items-center gap-3 text-left min-w-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-black shrink-0" style={{ background: SOFT, color: PLUM }}>
            {group.participant_name[0]}
          </div>
          <div className="min-w-0">
            <p className="font-black text-[14px] truncate" style={{ color: TEXT }}>{group.participant_name}</p>
            <p className="text-[11px] truncate" style={{ color: MUTED }}>
              {group.goals.length} goal{group.goals.length !== 1 ? "s" : ""}{group.last_session_date && ` · Last session ${group.last_session_date}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {group.upcoming_review_date && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: SOFT, color: PLUM }}>Review {group.upcoming_review_date}</span>
          )}
          {open ? <ChevronUp size={16} style={{ color: MUTED }} /> : <ChevronDown size={16} style={{ color: MUTED }} />}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-3">
          {group.goals.map((goal) => {
            const sm = statusMeta(goal.status as GoalStatus);
            return (
              <div key={goal.id} className="flex items-start justify-between gap-3 rounded-xl p-3" style={{ background: SOFT }}>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {goal.category && <CategoryChip category={goal.category} />}
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
                  </div>
                  <p className="text-[13px] leading-snug" style={{ color: TEXT }}>{goal.description}</p>
                </div>
              </div>
            );
          })}
          <div className="flex gap-2 flex-wrap pt-1">
            <Button size="sm" variant="outline" className="rounded-xl text-xs gap-1" style={{ borderColor: BORDER, color: MUTED }} onClick={() => setReviewOpen((v) => !v)}>
              <CalendarDays size={12} /> Schedule Review
            </Button>
          </div>
          <ScheduleReviewPanel group={group} open={reviewOpen} onClose={() => setReviewOpen(false)} />
        </div>
      )}
    </div>
  );
}

// ── NDIS Goals tab ────────────────────────────────────────────────────────────

const BLANK_GOAL: NdisGoalPayload = {
  participant_id: "", name: "", goal_area: "daily_living",
  description: "", target_date: null, success_criteria: "", related_task_ids: [], status: "active",
};

function GoalFormModal({ goal, participants, onClose, onSaved }: {
  goal: Partial<NdisGoal> | null; participants: ParticipantGoalGroup[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!goal?.id;
  const [form, setForm] = useState<NdisGoalPayload>(
    goal ? { participant_id: goal.participant_id ?? "", name: goal.name ?? "", goal_area: goal.goal_area ?? "daily_living",
      description: goal.description ?? "", target_date: goal.target_date ?? null,
      success_criteria: goal.success_criteria ?? "", related_task_ids: goal.related_task_ids ?? [], status: goal.status ?? "active",
    } : { ...BLANK_GOAL }
  );
  const mut = useMutation({
    mutationFn: () => isEdit ? updateNdisGoal(goal!.id!, form) : createNdisGoal(form),
    onSuccess: () => { toast({ title: isEdit ? "Goal updated" : "Goal created" }); onSaved(); onClose(); },
    onError: () => toast({ variant: "destructive", title: "Save failed" }),
  });
  const set = (k: keyof NdisGoalPayload, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(30,22,64,0.35)" }}>
      <div className="w-full max-w-lg rounded-3xl p-6 space-y-4 overflow-y-auto bg-white" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-black text-[16px]" style={{ color: TEXT }}>{isEdit ? "Edit Goal" : "New NDIS Goal"}</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100"><X size={16} style={{ color: MUTED }} /></button>
        </div>
        {!isEdit && (
          <div className="space-y-1">
            <Label className="text-xs font-semibold" style={{ color: MUTED }}>Participant *</Label>
            <select value={form.participant_id} onChange={(e) => set("participant_id", e.target.value)}
              className="w-full h-9 rounded-xl px-3 text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
              <option value="">Select participant…</option>
              {participants.map((p) => <option key={p.participant_id} value={p.participant_id}>{p.participant_name}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>Goal Name *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Increase community participation" className="rounded-xl h-9 text-[13px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>Goal Area</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(GOAL_AREA_META) as NdisGoal["goal_area"][]).map((area) => {
              const m = GOAL_AREA_META[area];
              return (
                <button key={area} type="button" onClick={() => set("goal_area", area)}
                  className="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors"
                  style={{ background: form.goal_area === area ? m.color : m.bg, color: form.goal_area === area ? "#fff" : m.color }}>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>Description</Label>
          <textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2}
            placeholder="What does this goal involve?" className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>Success Criteria</Label>
          <textarea value={form.success_criteria ?? ""} onChange={(e) => set("success_criteria", e.target.value)} rows={2}
            placeholder="How will we know this goal is achieved?" className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>Target Date</Label>
          <Input type="date" value={form.target_date ?? ""} onChange={(e) => set("target_date", e.target.value || null)} className="rounded-xl h-9 text-[13px]" />
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1 rounded-xl" style={{ borderColor: BORDER }} onClick={onClose}>Cancel</Button>
          <Button className="flex-1 rounded-xl" style={{ background: PLUM, color: "#fff" }}
            disabled={!form.name.trim() || (!isEdit && !form.participant_id) || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : isEdit ? "Update Goal" : "Create Goal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoalProgressPanel({ goal, onClose }: { goal: NdisGoal; onClose: () => void }) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { data, isLoading } = useOrgQuery<GoalProgressResponse>(["goal-progress", goal.id, orgId], { queryFn: () => getGoalProgress(goal.id) });
  const pct = data ? (data.sessions_count > 0 ? Math.round((data.evidence_count / data.sessions_count) * 100) : 0) : 0;
  return (
    <div className="rounded-2xl p-5 space-y-4 mt-3" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <p className="font-black text-[13px]" style={{ color: TEXT }}>Progress — Last 30 Days</p>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-white"><X size={14} style={{ color: MUTED }} /></button>
      </div>
      {isLoading && <div className="flex items-center gap-2 text-[12px]" style={{ color: MUTED }}><Loader2 size={13} className="animate-spin" /> Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[["Sessions", data.sessions_count], ["With Evidence", data.evidence_count], ["Evidence Rate", `${pct}%`]].map(([l, v]) => (
              <div key={String(l)} className="rounded-xl p-3 bg-white text-center" style={{ border: `1px solid ${BORDER}` }}>
                <p className="text-[18px] font-black" style={{ color: PLUM }}>{v}</p>
                <p className="text-[10px] font-semibold" style={{ color: MUTED }}>{l}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="flex justify-between text-[10px] font-semibold mb-1" style={{ color: MUTED }}>
              <span>Evidence rate</span><span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 70 ? "#22C55E" : pct >= 40 ? "#F59E0B" : CORAL }} />
            </div>
          </div>
          {data.sessions.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: MUTED }}>Recent Sessions</p>
              {data.sessions.map((s: { id: string; session_date: string; status: string; compliance_score?: number; notes?: string }) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl px-3 py-2 bg-white text-[12px]" style={{ border: `1px solid ${BORDER}` }}>
                  <span style={{ color: TEXT }}>{s.session_date}</span>
                  <div className="flex items-center gap-2">
                    {s.notes && <span style={{ color: "#059669" }}>✓ Notes</span>}
                    {s.compliance_score != null && <span style={{ color: s.compliance_score >= 80 ? "#059669" : "#D97706" }}>{s.compliance_score}%</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NdisGoalCard({ goal, onEdit, onArchive, onComplete }: {
  goal: NdisGoal; onEdit: (g: NdisGoal) => void;
  onArchive: (id: string) => void; onComplete: (id: string) => void;
}) {
  const [progressOpen, setProgressOpen] = useState(false);
  const areaM = GOAL_AREA_META[goal.goal_area];
  const statusM = GOAL_STATUS_META[goal.status];
  return (
    <div className="rounded-2xl p-4 space-y-3 bg-white" style={{ border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase" style={{ background: areaM.bg, color: areaM.color }}>{areaM.label}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase" style={{ background: statusM.bg, color: statusM.color }}>{statusM.label}</span>
          </div>
          <p className="font-black text-[14px]" style={{ color: TEXT }}>{goal.name}</p>
          {goal.description && <p className="text-[12px] mt-0.5 line-clamp-2" style={{ color: MUTED }}>{goal.description}</p>}
        </div>
        {goal.status === "active" && (
          <div className="flex gap-1 shrink-0">
            <button className="p-1.5 rounded-lg hover:bg-gray-100" onClick={() => onEdit(goal)} title="Edit"><Edit2 size={13} style={{ color: MUTED }} /></button>
            <button className="p-1.5 rounded-lg hover:bg-gray-100" onClick={() => onComplete(goal.id)} title="Complete"><CheckCircle2 size={13} style={{ color: "#059669" }} /></button>
            <button className="p-1.5 rounded-lg hover:bg-gray-100" onClick={() => onArchive(goal.id)} title="Archive"><Archive size={13} style={{ color: MUTED }} /></button>
          </div>
        )}
      </div>
      {goal.success_criteria && (
        <p className="text-[11px] px-3 py-2 rounded-xl" style={{ background: SOFT, color: MUTED }}>
          <span className="font-black" style={{ color: TEXT }}>Success: </span>{goal.success_criteria}
        </p>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {goal.target_date && (
          <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: MUTED }}>
            <CalendarDays size={11} /> Target {goal.target_date}
          </span>
        )}
        <button className="text-[11px] font-semibold flex items-center gap-1 hover:underline" style={{ color: PLUM }} onClick={() => setProgressOpen((v) => !v)}>
          <BarChart2 size={12} /> {progressOpen ? "Hide Progress" : "View Progress"}
        </button>
      </div>
      {progressOpen && <GoalProgressPanel goal={goal} onClose={() => setProgressOpen(false)} />}
    </div>
  );
}

// ── Task Templates tab ────────────────────────────────────────────────────────

type TemplateFormState = {
  name: string; description: string;
  evidence_required: (typeof EVIDENCE_OPTS)[number]["v"];
  is_mandatory: boolean; estimated_duration_minutes: string;
};

const BLANK_TEMPLATE: TemplateFormState = { name: "", description: "", evidence_required: "optional", is_mandatory: false, estimated_duration_minutes: "" };

function TaskTemplateForm({ participantId, initial, templateId, goals, linkedGoalIds, setLinkedGoalIds, onClose, onSaved }: {
  participantId: string; initial: TemplateFormState; templateId?: string;
  goals: NdisGoal[]; linkedGoalIds: string[]; setLinkedGoalIds: (ids: string[]) => void;
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<TemplateFormState>(initial);
  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name, description: form.description || null,
        evidence_required: form.evidence_required, is_mandatory: form.is_mandatory,
        estimated_duration_minutes: form.estimated_duration_minutes ? parseInt(form.estimated_duration_minutes) : null,
        linked_goal_ids: linkedGoalIds, sort_order: 0,
      };
      return templateId ? updateTaskTemplate(templateId, payload) : createTaskTemplate(participantId, payload);
    },
    onSuccess: () => { toast({ title: templateId ? "Template updated" : "Template created" }); onSaved(); onClose(); },
    onError: () => toast({ variant: "destructive", title: "Save failed" }),
  });
  const set = (k: keyof TemplateFormState, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="rounded-2xl p-4 space-y-4" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <p className="font-black text-[13px]" style={{ color: TEXT }}>{templateId ? "Edit Template" : "New Task Template"}</p>
        <button onClick={onClose}><X size={14} style={{ color: MUTED }} /></button>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-semibold" style={{ color: MUTED }}>Task Name *</Label>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Meal preparation" className="rounded-xl h-9 text-[13px]" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-semibold" style={{ color: MUTED }}>Description</Label>
        <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Optional detail…"
          className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none" style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#fff" }} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-semibold" style={{ color: MUTED }}>Evidence Required</Label>
        <div className="flex flex-wrap gap-1.5">
          {EVIDENCE_OPTS.map((o) => (
            <button key={o.v} type="button" onClick={() => set("evidence_required", o.v)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
              style={{ background: form.evidence_required === o.v ? PLUM : "#fff", color: form.evidence_required === o.v ? "#fff" : MUTED, border: `1px solid ${form.evidence_required === o.v ? PLUM : BORDER}` }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_mandatory} onChange={(e) => set("is_mandatory", e.target.checked)} className="rounded" />
          <span className="text-[12px] font-semibold" style={{ color: TEXT }}>Mandatory</span>
        </label>
        <div className="flex items-center gap-2">
          <Label className="text-xs font-semibold whitespace-nowrap" style={{ color: MUTED }}>Est. Duration (min)</Label>
          <Input type="number" value={form.estimated_duration_minutes} onChange={(e) => set("estimated_duration_minutes", e.target.value)} placeholder="30" className="w-20 h-8 rounded-xl text-[13px]" />
        </div>
      </div>
      {goals.filter((g) => g.status === "active").length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs font-semibold" style={{ color: MUTED }}>Linked Goals</Label>
          <div className="flex flex-wrap gap-1.5">
            {goals.filter((g) => g.status === "active").map((g) => {
              const linked = linkedGoalIds.includes(g.id);
              return (
                <button key={g.id} type="button"
                  onClick={() => setLinkedGoalIds(linked ? linkedGoalIds.filter((id) => id !== g.id) : [...linkedGoalIds, g.id])}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
                  style={{ background: linked ? PLUM : "#fff", color: linked ? "#fff" : MUTED, border: `1px solid ${linked ? PLUM : BORDER}` }}>
                  {linked && <CheckSquare size={10} />}{g.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 rounded-xl text-xs" style={{ borderColor: BORDER }} onClick={onClose}>Cancel</Button>
        <Button size="sm" className="flex-1 rounded-xl text-xs" style={{ background: PLUM, color: "#fff" }} disabled={!form.name.trim() || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? "Saving…" : templateId ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  );
}

function TaskTemplatesTab({ participants }: { participants: ParticipantGoalGroup[] }) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedPid, setSelectedPid] = useState(participants[0]?.participant_id ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TaskTemplate | null>(null);
  const [linkedGoalIds, setLinkedGoalIds] = useState<string[]>([]);

  const { data: templatesData, isLoading } = useOrgQuery<TaskTemplatesResponse>(["task-templates", selectedPid, orgId], { queryFn: () => getTaskTemplates(selectedPid), enabled: !!selectedPid });
  const { data: goals = [] } = useOrgQuery<NdisGoal[]>(["ndis-goals", selectedPid, orgId], { queryFn: () => getNdisGoals({ participant_id: selectedPid }), enabled: !!selectedPid });

  const deleteMut = useMutation({
    mutationFn: deleteTaskTemplate,
    onSuccess: () => { toast({ title: "Template removed" }); qc.invalidateQueries({ queryKey: ["task-templates", selectedPid, orgId] }); },
    onError: () => toast({ variant: "destructive", title: "Delete failed" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-xs font-semibold shrink-0" style={{ color: MUTED }}>Participant</Label>
        <select value={selectedPid} onChange={(e) => { setSelectedPid(e.target.value); setFormOpen(false); }}
          className="h-9 rounded-xl px-3 text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: TEXT, minWidth: 200 }}>
          <option value="">Select participant…</option>
          {participants.map((p) => <option key={p.participant_id} value={p.participant_id}>{p.participant_name}</option>)}
        </select>
        {selectedPid && (
          <Button size="sm" className="rounded-xl gap-1.5 ml-auto" style={{ background: PLUM, color: "#fff" }}
            onClick={() => { setEditTemplate(null); setLinkedGoalIds([]); setFormOpen(true); }}>
            <Plus size={14} /> New Template
          </Button>
        )}
      </div>

      {formOpen && selectedPid && (
        <TaskTemplateForm
          participantId={selectedPid}
          initial={editTemplate ? { name: editTemplate.name, description: editTemplate.description ?? "", evidence_required: editTemplate.evidence_required,
            is_mandatory: editTemplate.is_mandatory, estimated_duration_minutes: String(editTemplate.estimated_duration_minutes ?? "") } : BLANK_TEMPLATE}
          templateId={editTemplate?.id}
          goals={goals as NdisGoal[]}
          linkedGoalIds={linkedGoalIds}
          setLinkedGoalIds={setLinkedGoalIds}
          onClose={() => { setFormOpen(false); setEditTemplate(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["task-templates", selectedPid, orgId] })}
        />
      )}

      {isLoading && <div className="flex items-center gap-2 py-6 text-[12px]" style={{ color: MUTED }}><Loader2 size={13} className="animate-spin" /> Loading templates…</div>}

      {templatesData && (
        <>
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: MUTED }}>Default Tasks ({templatesData.default_tasks.length})</p>
            {templatesData.default_tasks.map((t: import('@/services/coordinatorService').TaskTemplate) => (
              <div key={t.id} className="flex items-start gap-3 rounded-xl p-3 bg-white" style={{ border: `1px solid ${BORDER}` }}>
                <ClipboardList size={14} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
                <div className="flex-1">
                  <p className="font-semibold text-[13px]" style={{ color: TEXT }}>{t.name}</p>
                  {t.description && <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{t.description}</p>}
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>Default</span>
              </div>
            ))}
          </div>
          {templatesData.custom_tasks.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: MUTED }}>Custom Templates ({templatesData.custom_tasks.length})</p>
              {templatesData.custom_tasks.map((t: import('@/services/coordinatorService').TaskTemplate) => {
                const evid = EVIDENCE_OPTS.find((o) => o.v === t.evidence_required);
                return (
                  <div key={t.id} className="flex items-start gap-3 rounded-xl p-3 bg-white" style={{ border: `1px solid ${BORDER}` }}>
                    <ClipboardList size={14} className="mt-0.5 shrink-0" style={{ color: PLUM }} />
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <p className="font-semibold text-[13px]" style={{ color: TEXT }}>{t.name}</p>
                        {t.is_mandatory && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#FEF2F2", color: CORAL }}>Mandatory</span>}
                        {evid && evid.v !== "optional" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: SOFT, color: PLUM }}>{evid.label}</span>}
                        {t.estimated_duration_minutes && <span className="text-[10px] font-semibold" style={{ color: MUTED }}>~{t.estimated_duration_minutes} min</span>}
                      </div>
                      {t.description && <p className="text-[11px]" style={{ color: MUTED }}>{t.description}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button className="p-1.5 rounded-lg hover:bg-gray-100" onClick={() => { setEditTemplate(t); setLinkedGoalIds(t.linked_goal_ids ?? []); setFormOpen(true); }}>
                        <Edit2 size={12} style={{ color: MUTED }} />
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-gray-100" onClick={() => deleteMut.mutate(t.id)}>
                        <Trash2 size={12} style={{ color: CORAL }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CoordinatorGoals() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<"goals" | "overview" | "templates">("goals");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [goalStatusFilter, setGoalStatusFilter] = useState<"all" | NdisGoal["status"]>("active");
  const [goalParticipant, setGoalParticipant] = useState("");
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<NdisGoal | null>(null);

  const { data: legacyData = [], isLoading: legacyLoading } = useOrgQuery<ParticipantGoalGroup[]>(["coordinator-goals", orgId], { queryFn: getCoordinatorGoals });

  const { data: ndisGoals = [], isLoading: goalsLoading } = useOrgQuery<NdisGoal[]>(["ndis-goals", orgId], { queryFn: () => getNdisGoals(), enabled: tab === "goals" });

  const archiveMut = useMutation({
    mutationFn: archiveNdisGoal,
    onSuccess: () => { toast({ title: "Goal archived" }); qc.invalidateQueries({ queryKey: ["ndis-goals", orgId] }); },
    onError: () => toast({ variant: "destructive", title: "Archive failed" }),
  });
  const completeMut = useMutation({
    mutationFn: completeNdisGoal,
    onSuccess: () => { toast({ title: "Goal marked complete" }); qc.invalidateQueries({ queryKey: ["ndis-goals", orgId] }); },
    onError: () => toast({ variant: "destructive", title: "Update failed" }),
  });

  const filteredLegacy = useMemo(() => {
    let list = legacyData;
    if (search.trim()) list = list.filter((g) => g.participant_name.toLowerCase().includes(search.toLowerCase()));
    if (filter === "stalled") list = list.filter((g) => g.goals.some((gl) => gl.status === "stalled"));
    else if (filter === "blocked") list = list.filter((g) => g.goals.some((gl) => gl.status === "blocked"));
    else if (filter === "no_session") list = list.filter((g) => !g.last_session_date);
    return list;
  }, [legacyData, search, filter]);

  const filteredNdis = useMemo(() => {
    let list = ndisGoals as NdisGoal[];
    if (goalStatusFilter !== "all") list = list.filter((g) => g.status === goalStatusFilter);
    if (goalParticipant) list = list.filter((g) => g.participant_id === goalParticipant);
    if (search.trim()) list = list.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [ndisGoals, goalStatusFilter, goalParticipant, search]);

  const stalledCount = legacyData.filter((g) => g.goals.some((gl) => gl.status === "stalled")).length;
  const blockedCount = legacyData.filter((g) => g.goals.some((gl) => gl.status === "blocked")).length;

  const TABS = [
    { id: "goals",     label: "NDIS Goals"    },
    { id: "overview",  label: "Plan Overview" },
    { id: "templates", label: "Task Templates"},
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Coordinator</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Goals & Planning</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>Manage NDIS goals, track progress and configure task templates.</p>
        </div>
        {tab === "goals" && (
          <Button className="rounded-2xl gap-2" style={{ background: PLUM, color: "#fff" }} onClick={() => { setEditGoal(null); setGoalFormOpen(true); }}>
            <Plus size={16} /> New Goal
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Participants",    legacyData.length],
          ["Active Goals",   (ndisGoals as NdisGoal[]).filter((g) => g.status === "active").length],
          ["Completed",      (ndisGoals as NdisGoal[]).filter((g) => g.status === "completed").length],
          ["Need Attention", stalledCount + blockedCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
            <p className="text-xs font-bold uppercase" style={{ color: MUTED }}>{label}</p>
            <p className="mt-1 text-2xl font-black" style={{ color: TEXT }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setSearch(""); }}
            className="flex-1 py-2 rounded-xl text-[13px] font-bold transition-all"
            style={{ background: tab === t.id ? "#fff" : "transparent", color: tab === t.id ? PLUM : MUTED,
              boxShadow: tab === t.id ? "0 2px 8px rgba(85,51,204,0.08)" : "none" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: MUTED }} />
        <Input placeholder={tab === "goals" ? "Search goals…" : "Search participants…"}
          className="rounded-xl pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* NDIS Goals */}
      {tab === "goals" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {(["all", "active", "completed", "archived"] as const).map((s) => (
              <button key={s} onClick={() => setGoalStatusFilter(s)}
                className="rounded-full border px-3 py-1.5 text-xs font-bold capitalize transition-colors"
                style={goalStatusFilter === s ? { background: PLUM, color: "#fff", borderColor: PLUM } : { background: "#fff", color: MUTED, borderColor: BORDER }}>
                {s === "all" ? "All Status" : s}
              </button>
            ))}
            {legacyData.length > 0 && (
              <select value={goalParticipant} onChange={(e) => setGoalParticipant(e.target.value)}
                className="ml-auto h-8 rounded-xl px-3 text-[12px] outline-none" style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
                <option value="">All Participants</option>
                {legacyData.map((p) => <option key={p.participant_id} value={p.participant_id}>{p.participant_name}</option>)}
              </select>
            )}
          </div>
          {goalsLoading && <div className="flex items-center gap-2 py-8 text-sm" style={{ color: MUTED }}><Loader2 size={14} className="animate-spin" /> Loading goals…</div>}
          {!goalsLoading && filteredNdis.length === 0 && (
            <div className="rounded-2xl border bg-white px-6 py-12 text-center" style={{ borderColor: BORDER }}>
              <Target className="mx-auto h-10 w-10" style={{ color: BORDER }} />
              <p className="mt-3 font-black" style={{ color: TEXT }}>No goals found</p>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>Click "New Goal" to create one</p>
            </div>
          )}
          {filteredNdis.map((goal) => (
            <NdisGoalCard key={goal.id} goal={goal}
              onEdit={(g) => { setEditGoal(g); setGoalFormOpen(true); }}
              onArchive={(id) => archiveMut.mutate(id)}
              onComplete={(id) => completeMut.mutate(id)} />
          ))}
        </div>
      )}

      {/* Plan Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "all",        label: "All" },
              { key: "stalled",    label: `Stalled (${stalledCount})` },
              { key: "blocked",    label: `Blocked (${blockedCount})` },
              { key: "no_session", label: "No Recent Session" },
            ] as { key: FilterKey; label: string }[]).map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)}
                className="rounded-full border px-3 py-1.5 text-xs font-bold transition-colors"
                style={filter === key ? { background: PLUM, color: "#fff", borderColor: PLUM } : { background: "#fff", color: MUTED, borderColor: BORDER }}>
                {label}
              </button>
            ))}
          </div>
          {legacyLoading && <div className="flex items-center gap-2 py-8 text-sm" style={{ color: MUTED }}><Loader2 size={14} className="animate-spin" /> Loading…</div>}
          {!legacyLoading && filteredLegacy.length === 0 && (
            <div className="rounded-2xl border bg-white px-6 py-12 text-center" style={{ borderColor: BORDER }}>
              <Target className="mx-auto h-10 w-10" style={{ color: BORDER }} />
              <p className="mt-3 font-black" style={{ color: TEXT }}>No participants found</p>
            </div>
          )}
          {filteredLegacy.map((group) => <ParticipantCard key={group.participant_id} group={group} />)}
        </div>
      )}

      {/* Task Templates */}
      {tab === "templates" && <TaskTemplatesTab participants={legacyData} />}

      {goalFormOpen && (
        <GoalFormModal goal={editGoal} participants={legacyData}
          onClose={() => { setGoalFormOpen(false); setEditGoal(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ndis-goals", orgId] })} />
      )}
    </div>
  );
}
