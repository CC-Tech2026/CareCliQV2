import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getNdisGoals, createNdisGoal, archiveNdisGoal, completeNdisGoal, updateNdisGoal, getGoalProgress,
  getParticipantTasks, createParticipantTask, deleteParticipantTask, getCoordinatorWorkerStats,
  type NdisGoal, type NdisGoalPayload, type ParticipantTask, type ParticipantTaskPayload, type GoalProgressResponse, type WorkerStats,
} from "@/services/coordinatorService";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { useGetParticipants } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, parseISO } from "date-fns";
import { Link, useSearch } from "wouter";
import {
  Search,
  UserPlus,
  Loader2,
  Users,
  Edit,
  Edit2,
  DollarSign,
  PlusCircle,
  CheckCircle2,
  CalendarDays,
  ClipboardList,
  ShieldCheck,
  UserCircle,
  Target,
  Lock,
  Heart,
  Sparkles,
  Wand2,
  BarChart2,
  Archive,
  X,
  CalendarClock,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SmartInput } from "@/components/SmartInput";
import { TranslationAuditView } from "@/components/TranslationAuditView";
import { ParticipantShiftContextEditor } from "@/components/participants/ParticipantShiftContextEditor";
import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const participantSchema = z.object({
  full_name: z.string().min(1, "Name is required"),
  ndis_number: z.string().min(1, "NDIS Number is required"),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  primary_disability: z.string().optional(),
  biological_sex: z.string().optional(),
  plan_status: z.string().min(1, "Plan status is required"),
  plan_start_date: z.string().optional(),
  plan_end_date: z.string().optional(),
  total_budget: z.coerce.number().min(0).optional(),
});

type ParticipantFormValues = z.infer<typeof participantSchema>;

const planSchema = z.object({
  plan_number: z.string().optional(),
  plan_start: z.string().min(1, "Plan start date is required"),
  plan_end: z.string().min(1, "Plan end date is required"),
  total_funding: z.coerce.number().min(0),
  core_budget: z.coerce.number().min(0).optional(),
  capacity_budget: z.coerce.number().min(0).optional(),
  capital_budget: z.coerce.number().min(0).optional(),
});
type PlanFormValues = z.infer<typeof planSchema>;

type ParticipantRecord = {
  id: string;
  full_name: string;
  ndis_number?: string;
  date_of_birth?: string | null;
  email?: string | null;
  phone?: string | null;
  primary_disability?: string | null;
  biological_sex?: string | null;
  plan_status?: string;
  plan_start_date?: string | null;
  plan_end_date?: string | null;
  total_budget?: number | string | null;
  used_budget?: number | string | null;
  goals?: Array<Record<string, unknown>>;
  assigned_worker_id?: string | null;
  allied_health_id?: string | null;
};

type SessionRecord = {
  id: string;
  session_date?: string | null;
  session_type?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  compliance_score?: number | null;
  notes?: string | null;
  translated_english_note?: string | null;
  compliance_input_text?: string | null;
  original_language_input?: string | null;
  translation_status?: string | null;
  translation_metadata?: Record<string, unknown> | null;
  translation_provider?: string | null;
  goals_addressed?: unknown;
  participant_name?: string | null;
};

type BudgetSummary = {
  has_plan: boolean;
  plan_number?: string;
  plan_start?: string | null;
  plan_end?: string | null;
  status?: string | null;
  total_funding?: number | string | null;
  budgets?: Array<{
    category?: string;
    category_label?: string;
    allocated?: number;
    used?: number;
    remaining?: number;
    percent_used?: number;
  }>;
};

type ComplianceHistoryItem = {
  session_id: string;
  session_date?: string | null;
  session_type?: string | null;
  latest_audit?: {
    score?: number;
    compliance_score?: number;
    status?: string;
    created_at?: string;
    checked_at?: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeFormat(dateStr?: string | null, fmt = "MMM d, yyyy") {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), fmt);
  } catch {
    return dateStr;
  }
}

function money(value?: number | string | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    review: "bg-sky-50 text-sky-700 border-sky-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    draft: "bg-slate-100 text-slate-600 border-slate-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
  };
  return map[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

function complianceTone(score?: number | null) {
  if (score == null) return "bg-slate-100 text-slate-600 border-slate-200";
  if (score >= 85) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 60) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function normalizeGoalTitle(goal: Record<string, unknown>, index: number) {
  return String(goal.title || goal.description || goal.name || `Goal ${index + 1}`);
}

// ---------------------------------------------------------------------------
// Add / Edit Participant Form Component
// ---------------------------------------------------------------------------

function ParticipantForm({
  form,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
}: {
  form: ReturnType<typeof useForm<ParticipantFormValues>>;
  onSubmit: (data: ParticipantFormValues) => void;
  isPending: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  const { translate } = useAccessibility();
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>
                  {translate("patients.field.fullName")} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder={translate("patients.placeholder.fullName")} data-testid="input-full-name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ndis_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {translate("patients.field.ndisNumber")} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder={translate("patients.placeholder.ndisNumber")} data-testid="input-ndis-number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date_of_birth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {translate("patients.field.dateOfBirth")} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="date" data-testid="input-date-of-birth" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.email")}</FormLabel>
                <FormControl>
                  <Input type="email" placeholder={translate("patients.placeholder.email")} data-testid="input-email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.phone")}</FormLabel>
                <FormControl>
                  <Input placeholder={translate("patients.placeholder.phone")} data-testid="input-phone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="primary_disability"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>{translate("patients.field.primaryDisability")}</FormLabel>
                <FormControl>
                  <SmartInput
                    placeholder={translate("patients.placeholder.primaryDisability")}
                    data-testid="input-primary-disability"
                    value={field.value ?? ""}
                    onChange={(v) => field.onChange(v)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="biological_sex"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.biologicalSex")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? "unspecified"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-biological-sex">
                      <SelectValue placeholder={translate("patients.selectPlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="unspecified">{translate("patients.sex.unspecified")}</SelectItem>
                    <SelectItem value="male">{translate("patients.sex.male")}</SelectItem>
                    <SelectItem value="female">{translate("patients.sex.female")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="plan_status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.planStatus")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-plan-status">
                      <SelectValue placeholder={translate("patients.selectStatus")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">{translate("patients.planStatus.active")}</SelectItem>
                    <SelectItem value="pending">{translate("patients.planStatus.pending")}</SelectItem>
                    <SelectItem value="inactive">{translate("patients.planStatus.inactive")}</SelectItem>
                    <SelectItem value="expired">{translate("patients.planStatus.expired")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="total_budget"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.totalBudget")}</FormLabel>
                <FormControl>
                  <Input type="number" placeholder={translate("patients.placeholder.totalBudget")} data-testid="input-total-budget" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="plan_start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.planStartDate")}</FormLabel>
                <FormControl>
                  <Input type="date" data-testid="input-plan-start-date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="plan_end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{translate("patients.field.planEndDate")}</FormLabel>
                <FormControl>
                  <Input type="date" data-testid="input-plan-end-date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {translate("common.cancel")}
          </Button>
          <Button type="submit" data-testid="button-add-participant" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Edit Participant Inline Panel
// ---------------------------------------------------------------------------

function EditParticipantPanel({
  participant,
  onSaved,
}: {
  participant: any;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { translate } = useAccessibility();

  const editForm = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: {
      full_name: String(participant.full_name ?? ""),
      ndis_number: String(participant.ndis_number ?? ""),
      date_of_birth: participant.date_of_birth ? String(participant.date_of_birth).slice(0, 10) : "",
      email: String(participant.email ?? ""),
      phone: String(participant.phone ?? ""),
      primary_disability: String(participant.primary_disability ?? ""),
      biological_sex: String(participant.biological_sex ?? "unspecified"),
      plan_status: String(participant.plan_status ?? "active"),
      plan_start_date: participant.plan_start_date ? String(participant.plan_start_date).slice(0, 10) : "",
      plan_end_date: participant.plan_end_date ? String(participant.plan_end_date).slice(0, 10) : "",
      total_budget: Number(participant.total_budget ?? 0),
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: ParticipantFormValues) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.email) delete payload.email;
      if (!payload.phone) delete payload.phone;
      if (!payload.primary_disability) delete payload.primary_disability;
      if (!payload.plan_start_date) delete payload.plan_start_date;
      if (!payload.plan_end_date) delete payload.plan_end_date;

      const res = await apiFetch(`/api/participants/${participant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: translate("patients.toast.updated") });
      setOpen(false);
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: err.message || translate("patients.toast.updateFailed"), variant: "destructive" });
    },
  });

  return (
    <div>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen((prev) => !prev)}>
        <Edit className="h-3.5 w-3.5" /> {open ? translate("patients.closeEdit") : translate("common.edit")}
      </Button>
      {open && (
        <div className="mt-3 rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
          <h4 className="mb-3 text-[13px] font-black text-[#111827]">{translate("patients.editTitle")}</h4>
          <ParticipantForm
            form={editForm}
            onSubmit={(data) => updateMutation.mutate(data)}
            isPending={updateMutation.isPending}
            onCancel={() => setOpen(false)}
            submitLabel={translate("patients.saveChanges")}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NDIS Plan Setup Inline Panel
// ---------------------------------------------------------------------------

function SetupPlanPanel({
  participantId,
  onSaved,
}: {
  participantId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { translate } = useAccessibility();

  const planForm = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      plan_number: "",
      plan_start: "",
      plan_end: "",
      total_funding: 0,
      core_budget: 0,
      capacity_budget: 0,
      capital_budget: 0,
    },
  });

  const createPlan = useMutation({
    mutationFn: async (data: PlanFormValues) => {
      const res = await apiFetch(`/api/participants/${participantId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save plan");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: translate("patients.toast.planSaved") });
      setOpen(false);
      onSaved();
    },
    onError: () => toast({ title: translate("patients.toast.planSaveFailed"), variant: "destructive" }),
  });

  return (
    <div>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen((prev) => !prev)}>
        <PlusCircle className="h-3.5 w-3.5" /> {open ? translate("patients.closePlanSetup") : translate("patients.setupPlan")}
      </Button>
      {open && (
        <div className="mt-3 rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
          <h4 className="mb-3 text-[13px] font-black text-[#111827]">{translate("patients.setupPlan")}</h4>
          <Form {...planForm}>
            <form onSubmit={planForm.handleSubmit((d) => createPlan.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={planForm.control}
                name="plan_number"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>{translate("patients.field.planReference")}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 2024-ABC-001" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={planForm.control}
                name="plan_start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {translate("patients.field.planStart")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={planForm.control}
                name="plan_end"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {translate("patients.field.planEnd")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={planForm.control}
                name="total_funding"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>{translate("patients.field.totalFunding")}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder={translate("patients.placeholder.totalBudget")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="col-span-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" /> {translate("patients.budgetByCategory")}
                </p>
              </div>
              <FormField
                control={planForm.control}
                name="core_budget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{translate("patients.field.coreSupports")}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={planForm.control}
                name="capacity_budget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{translate("patients.field.capacityBuilding")}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={planForm.control}
                name="capital_budget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{translate("patients.field.capitalSupports")}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPlan.isPending}>
                {createPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {translate("patients.savePlan")}
              </Button>
            </div>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail Wrapper Component
// ---------------------------------------------------------------------------

type ParticipantDetailTab = "overview" | "plan" | "goals" | "goals_tasks" | "sessions" | "compliance" | "shift_context" | "restricted";

function ParticipantDetail({ id, onRefreshList, initialTab }: { id: string; onRefreshList: () => void; initialTab?: ParticipantDetailTab }) {
  const { translate, translateParams } = useAccessibility();
  const participantQuery = useOrgQuery(["participant", id], {
    queryFn: () => jsonFetch<ParticipantRecord>(`/api/participants/${id}`),
  });
  const sessionsQuery = useOrgQuery(["participant", id, "sessions"], {
    queryFn: () => jsonFetch<SessionRecord[]>(`/api/sessions/participant/${id}`),
  });
  const budgetQuery = useOrgQuery(["participant", id, "budget-summary"], {
    queryFn: () => jsonFetch<BudgetSummary>(`/api/participants/${id}/budget-summary`),
  });
  const complianceQuery = useOrgQuery(["participant", id, "compliance-history"], {
    queryFn: () => jsonFetch<ComplianceHistoryItem[]>(`/api/participants/${id}/compliance-history`),
  });

  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const qc = useQueryClient();

  // Assign Shift — coordinator only
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const workersQuery = useOrgQuery<WorkerStats[]>(["coordinator-worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
    enabled: isCoordinator,
  });

  // Goals & Tasks — coordinator only
  const ndisGoalsQuery = useOrgQuery<NdisGoal[]>(["participant", id, "ndis-goals"], {
    queryFn: () => getNdisGoals({ participant_id: id }),
    enabled: isCoordinator,
  });
  const ndisGoals = ndisGoalsQuery.data ?? [];

  const participantTasksQuery = useOrgQuery<ParticipantTask[]>(["participant", id, "participant-tasks"], {
    queryFn: () => getParticipantTasks(id),
    enabled: isCoordinator,
  });
  const participantTasks = participantTasksQuery.data ?? [];

  const [progressGoalId, setProgressGoalId] = useState<string | null>(null);
  const goalProgressQuery = useOrgQuery<GoalProgressResponse>(
    ["goal-progress", progressGoalId ?? "__none__"],
    { queryFn: () => getGoalProgress(progressGoalId!), enabled: !!progressGoalId }
  );

  const createGoalMut = useMutation({
    mutationFn: (payload: NdisGoalPayload) => createNdisGoal(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant", id, "ndis-goals"] });
      setCreateMode(null);
      setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalDescriptionAiApplied(false);
    },
    onError: () => toastFn({ title: "Failed to create goal", variant: "destructive" }),
  });

  const editGoalMut = useMutation({
    mutationFn: ({ goalId, payload }: { goalId: string; payload: NdisGoalPayload }) => updateNdisGoal(goalId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant", id, "ndis-goals"] });
      setCreateMode(null); setEditingGoal(null);
      setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalDescriptionAiApplied(false);
    },
    onError: () => toastFn({ title: "Failed to update goal", variant: "destructive" }),
  });

  const archiveGoalMut = useMutation({
    mutationFn: archiveNdisGoal,
    onSuccess: () => { toastFn({ title: "Goal archived" }); qc.invalidateQueries({ queryKey: ["participant", id, "ndis-goals"] }); },
    onError: () => toastFn({ title: "Failed to archive goal", variant: "destructive" }),
  });

  const completeGoalMut = useMutation({
    mutationFn: completeNdisGoal,
    onSuccess: () => { toastFn({ title: "Goal marked complete" }); qc.invalidateQueries({ queryKey: ["participant", id, "ndis-goals"] }); },
    onError: () => toastFn({ title: "Failed to complete goal", variant: "destructive" }),
  });

  const createTaskMut = useMutation({
    mutationFn: (payload: Omit<ParticipantTaskPayload, "status">) =>
      createParticipantTask(id, { ...payload, status: "pending" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant", id, "participant-tasks"] });
      setCreateMode(null);
      setTaskTitle(""); setTaskInstructions(""); setLinkedGoalId(null); setTaskPurpose("core"); setTaskInstructionsAiApplied(false);
    },
    onError: () => toastFn({ title: "Failed to create task", variant: "destructive" }),
  });

  const deleteTaskMut = useMutation({
    mutationFn: deleteParticipantTask,
    onSuccess: () => { toastFn({ title: "Task deleted" }); qc.invalidateQueries({ queryKey: ["participant", id, "participant-tasks"] }); },
    onError: () => toastFn({ title: "Failed to delete task", variant: "destructive" }),
  });

  const suggestGoalDescription = async () => {
    if (!goalTitle.trim()) return;
    setGoalDescriptionLoading(true); setGoalDescriptionAiApplied(false);
    try {
      const params = new URLSearchParams({ participant_id: id, goal_title: goalTitle.trim() });
      const res = await apiFetch(`/api/tasks/ai/goal-description-suggestion?${params}`, { method: "POST" });
      if (!res.ok) { toastFn({ title: "AI unavailable", description: `Server returned ${res.status}.`, variant: "destructive" }); return; }
      const data = await res.json() as { suggestion: string | null };
      if (data.suggestion) { setGoalDescription(data.suggestion); setGoalDescriptionAiApplied(true); toastFn({ title: "Description suggested", description: "Review and edit the AI-suggested text." }); }
      else toastFn({ title: "No suggestion available", description: "Write a description manually." });
    } catch (err) {
      toastFn({ title: "AI unavailable", description: "Couldn't reach the suggestion service.", variant: "destructive" });
      console.error("suggestGoalDescription error:", err);
    } finally { setGoalDescriptionLoading(false); }
  };

  const suggestTaskInstructions = async () => {
    if (!taskTitle.trim()) return;
    setTaskInstructionsLoading(true); setTaskInstructionsAiApplied(false);
    try {
      const params = new URLSearchParams({ participant_id: id, goal_title: taskTitle.trim() });
      const res = await apiFetch(`/api/tasks/ai/goal-description-suggestion?${params}`, { method: "POST" });
      if (!res.ok) { toastFn({ title: "AI unavailable", description: `Server returned ${res.status}.`, variant: "destructive" }); return; }
      const data = await res.json() as { suggestion: string | null };
      if (data.suggestion) { setTaskInstructions(data.suggestion); setTaskInstructionsAiApplied(true); toastFn({ title: "Instructions suggested", description: "Review and edit the AI-suggested text." }); }
      else toastFn({ title: "No suggestion available", description: "Write instructions manually." });
    } catch (err) {
      toastFn({ title: "AI unavailable", description: "Couldn't reach the suggestion service.", variant: "destructive" });
      console.error("suggestTaskInstructions error:", err);
    } finally { setTaskInstructionsLoading(false); }
  };

  const restrictedQuery = useOrgQuery(["participant", id, "restricted-clinical"], {
    queryFn: () => jsonFetch<{
      restricted_behavioural_notes: string | null;
      behaviour_support_plan: string | null;
      medications: string | null;
      medical_alerts: string | null;
    }>(`/api/participants/${id}/restricted-clinical`),
    enabled: isCoordinator,
  });
  const [restrictedDraft, setRestrictedDraft] = useState<{
    restricted_behavioural_notes: string;
    behaviour_support_plan: string;
    medications: string;
    medical_alerts: string;
  } | null>(null);
  useEffect(() => {
    if (restrictedQuery.data && restrictedDraft === null) {
      setRestrictedDraft({
        restricted_behavioural_notes: restrictedQuery.data.restricted_behavioural_notes ?? "",
        behaviour_support_plan: restrictedQuery.data.behaviour_support_plan ?? "",
        medications: restrictedQuery.data.medications ?? "",
        medical_alerts: restrictedQuery.data.medical_alerts ?? "",
      });
    }
  }, [restrictedQuery.data]);
  const { toast: toastFn } = useToast();
  const saveRestricted = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/participants/${id}/restricted-clinical`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restrictedDraft),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      restrictedQuery.refetch();
      toastFn({ title: translate("patients.toast.clinicalSaved") });
    },
    onError: () => toastFn({ title: translate("patients.toast.saveFailed"), variant: "destructive" }),
  });
  const [activeTab, setActiveTab] = useState<ParticipantDetailTab>(initialTab ?? "overview");

  // Form state for creating / editing goals & tasks
  const [createMode, setCreateMode] = useState<'goal' | 'edit_goal' | 'tasks' | null>(null);
  const [editingGoal, setEditingGoal] = useState<NdisGoal | null>(null);
  const [showArchivedGoals, setShowArchivedGoals] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalCategory, setGoalCategory] = useState('daily_living');
  const [goalSupportCategory, setGoalSupportCategory] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalSuccessCriteria, setGoalSuccessCriteria] = useState('');
  const [goalDescriptionLoading, setGoalDescriptionLoading] = useState(false);
  const [goalDescriptionAiApplied, setGoalDescriptionAiApplied] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskTitleSuggestions, setTaskTitleSuggestions] = useState<string[]>([]);
  const [taskTitleLoading, setTaskTitleLoading] = useState(false);
  const [taskInstructions, setTaskInstructions] = useState('');
  const [taskInstructionsSuggestions, setTaskInstructionsSuggestions] = useState<string[]>([]);
  const [taskSupportCategory, setTaskSupportCategory] = useState('');
  const [taskInstructionsLoading, setTaskInstructionsLoading] = useState(false);
  const [taskInstructionsAiApplied, setTaskInstructionsAiApplied] = useState(false);
  const [taskTitleAiApplied, setTaskTitleAiApplied] = useState(false);
  const [taskPurpose, setTaskPurpose] = useState<'core' | 'goal'>('core');
  const [linkedGoalId, setLinkedGoalId] = useState<string | null>(null);
  const [isMandatory, setIsMandatory] = useState(true);
  // Detailed task fields for proper invoice management & shift assignment
  const [taskShiftType, setTaskShiftType] = useState<'morning' | 'afternoon' | 'night' | 'anytime'>('morning');
  const [taskCategory, setTaskCategory] = useState<'personal_care' | 'medication' | 'domestic_assistance' | 'community_access' | 'transport' | 'other'>('personal_care');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  // NDIS professional fields
  const [taskEvidenceRequired, setTaskEvidenceRequired] = useState<'none' | 'photo' | 'notes' | 'photo_and_notes'>('none');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequencyPattern, setFrequencyPattern] = useState<'every_morning_shift' | 'every_afternoon_shift' | 'every_night_shift' | 'daily_all_shifts' | 'specific_days_of_week' | 'custom'>('daily_all_shifts');

  if (participantQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (participantQuery.error || !participantQuery.data) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {(participantQuery.error as Error)?.message || translate("patients.loadFailed")}
        </div>
      </div>
    );
  }

  const participant = participantQuery.data;
  const sessions = sessionsQuery.data ?? [];
  const budget = budgetQuery.data;
  const complianceHistory = complianceQuery.data ?? [];
  const goals = Array.isArray(participant.goals) ? participant.goals : [];
  const usedBudget = Number(participant.used_budget ?? 0);
  const totalBudget = Number(participant.total_budget ?? budget?.total_funding ?? 0);
  const remainingBudget = Math.max(totalBudget - usedBudget, 0);
  const scoredSessions = sessions.filter((session) => session.compliance_score != null);
  const averageCompliance = scoredSessions.length
    ? Math.round(scoredSessions.reduce((sum, session) => sum + Number(session.compliance_score ?? 0), 0) / scoredSessions.length)
    : null;
  const metricCards = [
    {
      label: translate("patients.metric.planStatus"),
      value: participant.plan_status || translate("patients.notRecorded"),
      icon: CheckCircle2,
      tone: statusBadge(participant.plan_status || ""),
    },
    {
      label: translate("patients.metric.budgetRemaining"),
      value: money(remainingBudget),
      icon: DollarSign,
      tone: "bg-purple-50 text-[#3730A3] border-purple-100",
    },
    {
      label: translate("patients.tab.sessions"),
      value: String(sessions.length),
      icon: CalendarDays,
      tone: "bg-sky-50 text-sky-700 border-sky-100",
    },
    {
      label: translate("patients.tab.compliance"),
      value: averageCompliance == null ? translate("patients.noScore") : `${averageCompliance}%`,
      icon: ShieldCheck,
      tone: complianceTone(averageCompliance),
    },
  ];

  const initials = participant.full_name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const TABS = [
    { id: "overview"    as const, label: "Overview",    icon: UserCircle   },
    { id: "plan"        as const, label: "NDIS Plan",   icon: DollarSign   },
    { id: "goals"       as const, label: "ParticipantGoals",       icon: Target       },
    { id: "sessions"    as const, label: "Sessions",    icon: CalendarDays },
    { id: "compliance"  as const, label: "Compliance",  icon: ShieldCheck  },
    { id: "overview"    as const, label: translate("patients.tab.overview"),    icon: UserCircle   },
    { id: "plan"        as const, label: translate("patients.tab.plan"),   icon: DollarSign   },
    ...(isCoordinator ? [{ id: "goals_tasks" as const, label: "Goals & Tasks", icon: ClipboardList }] : [{ id: "goals" as const, label: translate("patients.tab.goals"), icon: Target }]),
    { id: "sessions"    as const, label: "Shift History", icon: CalendarDays },
    { id: "compliance"  as const, label: translate("patients.tab.compliance"),  icon: ShieldCheck  },
    ...(isCoordinator ? [{ id: "shift_context" as const, label: translate("patients.tab.shiftContext"), icon: Users }] : []),
    ...(isCoordinator ? [{ id: "restricted" as const, label: "Clinical Records", icon: Lock }] : []),
  ];

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-purple-100/60 px-5 pt-5 pb-0">

        {/* Avatar + name + action buttons */}
        <div className="flex items-center gap-3 pb-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#BE185D] to-[#3730A3] flex items-center justify-center text-white text-sm font-black shrink-0 select-none">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="hidden">
              Participant Profile
            </p>
            <h3 className="text-[16px] font-black leading-tight truncate" style={{ color: "var(--cc-text)" }}>
              {participant.full_name}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <EditParticipantPanel
              participant={participant}
              onSaved={() => { participantQuery.refetch(); onRefreshList(); }}
            />
            <SetupPlanPanel participantId={id} onSaved={onRefreshList} />
          </div>
        </div>

        {/* NDIS number + plan dates */}
        <p className="text-[11px] text-[#6B7280] ml-[52px] -mt-2 mb-3 leading-relaxed">
          {translateParams("patients.ndisLine", { number: participant.ndis_number || translate("patients.notRecorded") })}
          {participant.plan_start_date && participant.plan_end_date && (
            <> &middot; Plan {safeFormat(participant.plan_start_date)} – {safeFormat(participant.plan_end_date)}</>
          )}
        </p>

        {/* 4-stat strip */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {metricCards.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className={`rounded-xl border px-2.5 py-2 ${metric.tone}`}>
                <div className="flex items-center gap-1 mb-1.5">
                  <Icon className="h-3 w-3 shrink-0 opacity-70" />
                  <p className="text-[8px] font-black uppercase tracking-[0.13em] opacity-70 leading-none truncate">{metric.label}</p>
                </div>
                <p className="text-[13px] font-black capitalize leading-tight truncate">{metric.value}</p>
              </div>
            );
          })}
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 -mb-px overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] font-bold border-b-2 whitespace-nowrap transition-colors shrink-0 ${
                  active
                    ? "border-[#3730A3] text-[#3730A3]"
                    : "border-transparent text-[#6B7280] hover:text-[#111827] hover:border-[#E5E7EB]"
                }`}
              >
                <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-3.5 w-3.5 text-[#3730A3]" />
              <h4 className="text-[13px] font-black text-[#111827]">{translate("patients.section.personalDetails")}</h4>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {[
                [translate("patients.field.dateOfBirth"),     safeFormat(participant.date_of_birth)],
                [translate("patients.field.biologicalSex"),    participant.biological_sex || translate("patients.notSet")],
                [translate("patients.field.primaryDisability"), participant.primary_disability || translate("patients.notSet")],
                [translate("patients.field.phone"),             participant.phone || translate("patients.notSet")],
                [translate("patients.field.email"),             participant.email || translate("patients.notSet")],
                [translate("patients.field.planPeriod"),       participant.plan_start_date
                  ? `${safeFormat(participant.plan_start_date)} – ${safeFormat(participant.plan_end_date)}`
                  : translate("patients.notSet")],
                [translate("patients.field.planStatus"),       participant.plan_status || translate("patients.notSet")],
                [translate("patients.field.totalBudget"),      money(totalBudget || budget?.total_funding)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
                  <dt className="text-[9px] font-black uppercase tracking-wider text-[#6B7280] leading-none mb-1">{label}</dt>
                  <dd className="text-[12px] font-bold text-[#111827] truncate" title={String(value)}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* NDIS PLAN TAB */}
        {activeTab === "plan" && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
            <div className="mb-3 flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-[#3730A3]" />
              <h4 className="text-[13px] font-black text-[#111827]">{translate("patients.section.ndisFunding")}</h4>
            </div>
            {budgetQuery.isLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : budget?.has_plan === false ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                {translate("patients.plan.noActive")}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Plan meta */}
                {budget?.plan_number && (
                  <div className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#6B7280] mb-1">{translate("patients.field.planNumber")}</p>
                    <p className="text-[12px] font-bold text-[#111827]">{budget.plan_number}</p>
                  </div>
                )}
                {/* Total / Used / Remaining */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    [translate("patients.budget.total"),     money(totalBudget || budget?.total_funding)],
                    [translate("patients.budget.used"),      money(usedBudget)],
                    [translate("patients.budget.remaining"), money(remainingBudget)],
                  ].map(([lbl, val]) => (
                    <div key={lbl} className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
                      <p className="text-[9px] font-black uppercase tracking-wider text-[#6B7280] leading-none mb-1">{lbl}</p>
                      <p className="text-[12px] font-black text-[#111827] truncate">{val}</p>
                    </div>
                  ))}
                </div>
                {/* Budget utilisation bar */}
                {totalBudget > 0 && (
                  <div className="rounded-xl border border-purple-100/60 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-bold text-[#111827]">{translate("patients.budget.utilisation")}</span>
                      <span className="text-[11px] font-black text-[#6B7280]">
                        {Math.round((usedBudget / totalBudget) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#EEEAFB] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#3730A3] to-[#8B5CF6] transition-all"
                        style={{ width: `${Math.min(100, Math.round((usedBudget / totalBudget) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Category breakdown */}
                {(budget?.budgets ?? []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#6B7280]">{translate("patients.budget.byCategory")}</p>
                    {(budget?.budgets ?? []).map((item) => (
                      <div key={item.category || item.category_label} className="rounded-xl border border-purple-100/60 bg-white p-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-[12px] font-bold text-[#111827] truncate">{item.category_label || item.category}</span>
                          <span className="text-[11px] font-black text-[#6B7280] shrink-0">{item.percent_used ?? 0}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#EEEAFB] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#3730A3] to-[#8B5CF6]"
                            style={{ width: `${Math.min(100, Math.max(0, item.percent_used ?? 0))}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-[10px] font-medium text-[#6B7280]">
                          {translateParams("patients.budget.categoryUsage", {
                            used: money(item.used),
                            remaining: money(item.remaining),
                            allocated: money(item.allocated),
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* GOALS & TASKS TAB (Coordinator) */}
        {activeTab === "goals_tasks" && isCoordinator && (() => {
          const AREA_COLORS: Record<string, { bg: string; color: string; label: string }> = {
            daily_living: { bg: "#EFF6FF", color: "#1D4ED8", label: "Daily Living" },
            community:    { bg: "#F0FDF4", color: "#15803D", label: "Community"    },
            health:       { bg: "#FEF2F2", color: "#DC2626", label: "Health"       },
            social:       { bg: "#FDF4FF", color: "#7E22CE", label: "Social"       },
            employment:   { bg: "#FFFBEB", color: "#D97706", label: "Employment"   },
            other:        { bg: "#F3F4F6", color: "#6B7280", label: "Other"        },
          };

          type SupportCatMeta = { label: string; group: "core" | "cb" | "capital"; groupLabel: string; bg: string; color: string };
          const SUPPORT_CATS: Record<string, SupportCatMeta> = {
            core_daily_activities:   { label: "Daily Activities",          group: "core",    groupLabel: "Core Supports",       bg: "#EFF6FF", color: "#1D4ED8" },
            core_transport:          { label: "Transport",                 group: "core",    groupLabel: "Core Supports",       bg: "#EFF6FF", color: "#1D4ED8" },
            core_consumables:        { label: "Consumables",               group: "core",    groupLabel: "Core Supports",       bg: "#EFF6FF", color: "#1D4ED8" },
            core_social_community:   { label: "Social & Community",        group: "core",    groupLabel: "Core Supports",       bg: "#EFF6FF", color: "#1D4ED8" },
            cb_support_coordination: { label: "Support Coordination",      group: "cb",      groupLabel: "Capacity Building",   bg: "#F0FDF4", color: "#15803D" },
            cb_daily_living:         { label: "Daily Living Skills",       group: "cb",      groupLabel: "Capacity Building",   bg: "#F0FDF4", color: "#15803D" },
            cb_health_wellbeing:     { label: "Health & Wellbeing",        group: "cb",      groupLabel: "Capacity Building",   bg: "#F0FDF4", color: "#15803D" },
            cb_social_skills:        { label: "Social & Community Skills", group: "cb",      groupLabel: "Capacity Building",   bg: "#F0FDF4", color: "#15803D" },
            cb_employment:           { label: "Employment",                group: "cb",      groupLabel: "Capacity Building",   bg: "#F0FDF4", color: "#15803D" },
            cb_learning:             { label: "Improved Learning",         group: "cb",      groupLabel: "Capacity Building",   bg: "#F0FDF4", color: "#15803D" },
            capital_assistive_tech:  { label: "Assistive Technology",      group: "capital", groupLabel: "Capital Supports",    bg: "#FDF4FF", color: "#7E22CE" },
            capital_home_mods:       { label: "Home Modifications",        group: "capital", groupLabel: "Capital Supports",    bg: "#FDF4FF", color: "#7E22CE" },
          };

          const SUPPORT_GROUP_HEADERS: Record<"core" | "cb" | "capital", { label: string; color: string }> = {
            core:    { label: "Core Supports",     color: "#1D4ED8" },
            cb:      { label: "Capacity Building", color: "#15803D" },
            capital: { label: "Capital Supports",  color: "#7E22CE" },
          };

          function SupportCategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
            const groups: ("core" | "cb" | "capital")[] = ["core", "cb", "capital"];
            return (
              <div className="space-y-2">
                {groups.map((group) => {
                  const keys = Object.entries(SUPPORT_CATS).filter(([, m]) => m.group === group).map(([k]) => k);
                  const hdr = SUPPORT_GROUP_HEADERS[group];
                  return (
                    <div key={group}>
                      <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: hdr.color }}>{hdr.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {keys.map((k) => {
                          const m = SUPPORT_CATS[k];
                          const active = value === k;
                          return (
                            <button key={k} type="button" onClick={() => onChange(active ? "" : k)}
                              className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
                              style={{ background: active ? m.color : m.bg, color: active ? "#fff" : m.color }}>
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }

          const activeGoals = ndisGoals.filter((g) => g.status === "active");
          const doneGoals   = ndisGoals.filter((g) => g.status !== "active");

          const startEditGoal = (goal: NdisGoal) => {
            setEditingGoal(goal);
            setGoalTitle(goal.name);
            setGoalCategory(goal.goal_area);
            setGoalSupportCategory(goal.support_category ?? "");
            setGoalDescription(goal.description ?? "");
            setGoalTargetDate(goal.target_date ?? "");
            setGoalSuccessCriteria(goal.success_criteria ?? "");
            setGoalDescriptionAiApplied(false);
            setCreateMode("edit_goal");
          };
          const cancelGoalForm = () => { setCreateMode(null); setEditingGoal(null); setGoalDescriptionAiApplied(false); };

          const goalFormContent = (
            <div className="rounded-xl border border-purple-100 bg-white shadow-sm p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-[14px] font-bold text-[#111827]">{createMode === "edit_goal" ? "Edit goal" : "New NDIS goal"}</h4>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{participant.full_name}</p>
                </div>
                <button type="button" onClick={cancelGoalForm} title="Close" aria-label="Close" className="p-1 rounded-full hover:bg-gray-100"><X size={15} className="text-[#9CA3AF]" /></button>
              </div>

              {/* Goal name */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Goal name *</label>
                <input
                  value={goalTitle}
                  onChange={(e) => { setGoalTitle(e.target.value); setGoalDescriptionAiApplied(false); }}
                  placeholder="e.g. Increase independence in morning routine"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-purple-400"
                />
                {goalTitle.trim() && (
                  <div className="flex items-center justify-between pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={11} className="text-purple-400" />
                      <button type="button" onClick={suggestGoalDescription} disabled={goalDescriptionLoading}
                        className="text-[11px] text-purple-600 hover:text-purple-800 font-semibold disabled:opacity-60">
                        {goalDescriptionLoading ? <><Loader2 size={10} className="animate-spin inline mr-1" />Generating…</> : "Suggest description"}
                      </button>
                    </div>
                    {goalDescriptionAiApplied && <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1"><Wand2 size={10} /> AI-suggested</span>}
                  </div>
                )}
              </div>

              {/* NDIS area — outcome domain */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">NDIS outcome area</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(AREA_COLORS) as [string, { bg: string; color: string; label: string }][]).map(([area, m]) => (
                    <button key={area} type="button" onClick={() => setGoalCategory(area)}
                      className="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors"
                      style={{ background: goalCategory === area ? m.color : m.bg, color: goalCategory === area ? "#fff" : m.color }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* NDIS support category — funding line */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">
                  NDIS support category <span className="text-red-500">*</span>
                  <span className="ml-1.5 normal-case font-normal text-[#9CA3AF]">— which funded budget line does this goal draw from?</span>
                </label>
                <SupportCategoryPicker value={goalSupportCategory} onChange={setGoalSupportCategory} />
                {!goalSupportCategory && goalTitle.trim() && (
                  <p className="text-[10px] text-amber-600 font-semibold">Select a support category to link this goal to the funded plan.</p>
                )}
              </div>

              {/* Description + target date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Description</label>
                  <textarea value={goalDescription}
                    onChange={(e) => { setGoalDescription(e.target.value); setGoalDescriptionAiApplied(false); }}
                    placeholder={goalDescriptionLoading ? "Generating AI description…" : "What does achieving this goal look like?"}
                    rows={3}
                    className={`w-full rounded-lg border bg-white px-3 py-2.5 text-[13px] outline-none resize-none focus:ring-1 focus:ring-purple-400 transition-colors ${goalDescriptionAiApplied ? "border-emerald-200 bg-emerald-50/30" : "border-gray-200"}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Success criteria</label>
                  <textarea value={goalSuccessCriteria} onChange={(e) => setGoalSuccessCriteria(e.target.value)}
                    placeholder="How will we know this goal is achieved?" rows={2}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none resize-none focus:ring-1 focus:ring-purple-400" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="goal-target-date" className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Target date</label>
                  <input id="goal-target-date" type="date" title="Target date" value={goalTargetDate}
                    onChange={(e) => setGoalTargetDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-purple-400" />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={cancelGoalForm}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-[12px] font-bold text-[#6B7280] hover:bg-gray-50">Cancel</button>
                <button type="button"
                  disabled={!goalTitle.trim() || createGoalMut.isPending || editGoalMut.isPending}
                  onClick={() => {
                    const payload: NdisGoalPayload = {
                      participant_id: id, name: goalTitle.trim(),
                      goal_area: goalCategory as NdisGoal["goal_area"],
                      description: goalDescription || null,
                      target_date: goalTargetDate || null,
                      success_criteria: goalSuccessCriteria || null,
                      related_task_ids: [], status: "active",
                    };
                    if (createMode === "edit_goal" && editingGoal) editGoalMut.mutate({ goalId: editingGoal.id, payload });
                    else createGoalMut.mutate(payload);
                  }}
                  className="flex-1 rounded-lg bg-[#3730A3] py-2.5 text-[12px] font-bold text-white hover:bg-[#312E81] disabled:opacity-50">
                  {(createGoalMut.isPending || editGoalMut.isPending) ? "Saving…" : createMode === "edit_goal" ? "Update goal" : "Create goal"}
                </button>
              </div>
            </div>
          );

          const taskFormContent = (
            <div className="rounded-xl border border-purple-200 bg-white shadow-md p-6 space-y-5">
              <div className="flex items-start justify-between pb-4 border-b border-purple-100">
                <div>
                  <h3 className="text-[16px] font-bold text-[#111827]">Create New Task</h3>
                  <p className="text-[12px] text-[#6B7280] mt-1">Setting up support for <span className="font-semibold">{participant.full_name}</span></p>
                </div>
                <button type="button" onClick={() => { setCreateMode(null); setTaskInstructionsAiApplied(false); }} title="Close" aria-label="Close" className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"><X size={16} className="text-[#9CA3AF]" /></button>
              </div>

              {/* PURPOSE SELECTION - FIRST FIELD */}
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-[#374151] uppercase tracking-wide">What is this task for?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setTaskPurpose("goal")}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[12px] font-bold transition-colors ${
                      taskPurpose === "goal" 
                        ? "border-purple-400 bg-purple-50 text-purple-700" 
                        : "border-gray-200 bg-white text-[#6B7280] hover:border-purple-300"
                    }`}>
                    <Target size={14} /> Supports a goal
                  </button>
                  <button type="button" onClick={() => { setTaskPurpose("core"); setLinkedGoalId(null); }}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[12px] font-bold transition-colors ${
                      taskPurpose === "core" 
                        ? "border-blue-400 bg-blue-50 text-blue-700" 
                        : "border-gray-200 bg-white text-[#6B7280] hover:border-blue-300"
                    }`}>
                    <Heart size={14} /> Core support
                  </button>
                </div>
                {taskPurpose === "core" && (
                  <p className="text-[11px] text-[#6B7280]">Routine support like personal care, medication, or domestic assistance — not tied to a specific goal milestone. Most tasks are this.</p>
                )}
              </div>

              {/* GOAL SELECTOR - CONDITIONAL */}
              {taskPurpose === "goal" && (
                <div className="space-y-1.5">
                  <label htmlFor="task-linked-goal" className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Linked goal *</label>
                  <select id="task-linked-goal" title="Link task to goal" value={linkedGoalId ?? ""}
                    onChange={(e) => setLinkedGoalId(e.target.value || null)}
                    className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-purple-400">
                    <option value="">Select a goal…</option>
                    {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}

              {/* TASK TITLE */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Task title *</label>
                <input value={taskTitle} onChange={(e) => { setTaskTitle(e.target.value); setTaskTitleAiApplied(false); }}
                  placeholder="e.g. Prompt independent dressing"
                  className={`w-full rounded-lg border bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 transition-colors ${
                    taskTitleAiApplied ? "border-emerald-200 bg-emerald-50/40 focus:ring-emerald-400" : "border-gray-200 focus:ring-purple-400"
                  }`} />
                {taskTitleAiApplied && <p className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1"><Wand2 size={10} /> AI-suggested</p>}
              </div>

              {/* AI INSTRUCTIONS BOX */}
              {taskTitle.trim() && (
                <div className="p-3 bg-purple-50/60 rounded-lg border border-purple-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-purple-600" />
                      <span className="text-[12px] font-semibold text-purple-900">AI suggestion</span>
                    </div>
                    {!taskInstructionsAiApplied && (
                      <button type="button" onClick={async () => {
                        setTaskInstructionsLoading(true);
                        try {
                          const goal = linkedGoalId ? activeGoals.find(g => g.id === linkedGoalId) : null;
                          const response = await jsonFetch<{ suggestions: string[] }>('/api/ai/task-instructions', {
                            method: 'POST',
                            body: JSON.stringify({
                              task_title: taskTitle.trim(),
                              task_purpose: taskPurpose,
                              goal_name: goal?.name,
                              goal_description: goal?.description,
                              participant_name: participant.full_name,
                            }),
                          });
                          setTaskInstructionsSuggestions(response.suggestions || []);
                        } catch (err) {
                          console.error('Failed to get instruction suggestions:', err);
                        } finally {
                          setTaskInstructionsLoading(false);
                        }
                      }} disabled={taskInstructionsLoading}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-purple-300 bg-white text-purple-700 hover:bg-purple-50 disabled:opacity-60">
                        {taskInstructionsLoading ? <>Generating…</> : <>Suggest instructions</>}
                      </button>
                    )}
                  </div>
                  {taskInstructionsSuggestions.length > 0 && (
                    <div className="space-y-1.5">
                      {taskInstructionsSuggestions.map((suggestion, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-white border border-purple-100 flex items-start justify-between gap-2 hover:bg-purple-50/40 transition-colors">
                          <p className="text-[11px] text-[#374151] flex-1 leading-snug">{suggestion}</p>
                          <button type="button" onClick={() => { setTaskInstructions(suggestion); setTaskInstructionsAiApplied(true); setTaskInstructionsSuggestions([]); }}
                            className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded bg-purple-600 text-white hover:bg-purple-700 whitespace-nowrap">
                            Use
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TASK CATEGORY */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Task category</label>
                <select value={taskCategory} onChange={(e) => setTaskCategory(e.target.value as any)} title="Select task category for invoice management"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-purple-400">
                  <option value="personal_care">Personal care</option>
                  <option value="medication">Medication</option>
                  <option value="domestic_assistance">Domestic assistance</option>
                  <option value="community_access">Community access</option>
                  <option value="transport">Transport</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* PRIORITY */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Priority</label>
                <div className="flex gap-2">
                  {[
                    { id: 'low', label: 'Low', color: 'blue' },
                    { id: 'medium', label: 'Medium', color: 'amber' },
                    { id: 'high', label: 'High', color: 'red' }
                  ].map(p => (
                    <button key={p.id} type="button" onClick={() => setTaskPriority(p.id as any)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-[12px] font-semibold transition-colors ${
                        taskPriority === p.id 
                          ? `border-${p.color}-400 bg-${p.color}-50 text-${p.color}-700` 
                          : "border-gray-200 bg-white text-[#6B7280] hover:border-gray-300"
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* SHIFT TYPE - DETAILED */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Shift type <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'morning', label: 'Morning', icon: 'ti-sunrise' },
                    { id: 'afternoon', label: 'Afternoon', icon: 'ti-sun' },
                    { id: 'night', label: 'Night', icon: 'ti-moon' },
                    { id: 'anytime', label: 'Anytime', icon: 'ti-clock' }
                  ].map(shift => (
                    <button key={shift.id} type="button" onClick={() => setTaskShiftType(shift.id as any)}
                      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
                        taskShiftType === shift.id 
                          ? "border-orange-400 bg-orange-50 text-orange-700" 
                          : "border-gray-200 bg-white text-[#6B7280] hover:border-gray-300"
                      }`}>
                      <i className={`ti ${shift.icon} text-sm`} />
                      {shift.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#9CA3AF]">Shifts are critical for invoice management and task assignment</p>
              </div>

              {/* EVIDENCE TRACKING - NDIS COMPLIANCE */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Evidence required on completion</label>
                <select value={taskEvidenceRequired} onChange={(e) => setTaskEvidenceRequired(e.target.value as any)} title="Select evidence required for task completion"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-purple-400">
                  <option value="none">No evidence needed</option>
                  <option value="photo">Photo</option>
                  <option value="notes">Notes</option>
                  <option value="photo_and_notes">Photo and notes</option>
                </select>
                <p className="text-[10px] text-[#9CA3AF]">Specifies what documentation workers must provide to verify task completion</p>
              </div>

              {/* RECURRING TASK SUPPORT */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Repeats</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="radio" name="repeats" checked={!isRecurring} onChange={() => setIsRecurring(false)} className="rounded" />
                    One-off
                  </label>
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="radio" name="repeats" checked={isRecurring} onChange={() => setIsRecurring(true)} className="rounded" />
                    Recurring
                  </label>
                </div>
              </div>

              {/* FREQUENCY OPTIONS - CONDITIONAL */}
              {isRecurring && (
                <div className="space-y-1.5 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Frequency</label>
                  <select value={frequencyPattern} onChange={(e) => setFrequencyPattern(e.target.value as any)} title="Select task recurrence pattern"
                    className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-blue-400">
                    <option value="every_morning_shift">Every Morning shift</option>
                    <option value="every_afternoon_shift">Every Afternoon shift</option>
                    <option value="every_night_shift">Every Night shift</option>
                    <option value="daily_all_shifts">Daily, regardless of shift</option>
                    <option value="specific_days_of_week">Specific days of the week</option>
                    <option value="custom">Custom schedule</option>
                  </select>
                </div>
              )}

              {/* REQUIREMENT */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Requirement</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="radio" name="requirement" checked={isMandatory} onChange={() => setIsMandatory(true)} className="rounded" />
                    Mandatory
                  </label>
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="radio" name="requirement" checked={!isMandatory} onChange={() => setIsMandatory(false)} className="rounded" />
                    Optional
                  </label>
                </div>
              </div>

              {/* NOTES FOR WORKER */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Notes for support worker</label>
                <textarea value={taskInstructions} onChange={(e) => { setTaskInstructions(e.target.value); setTaskInstructionsAiApplied(false); }}
                  placeholder="Any instructions the worker needs to know"
                  rows={2}
                  className={`w-full rounded-lg border bg-white px-3 py-2.5 text-[13px] outline-none resize-none focus:ring-1 transition-colors ${
                    taskInstructionsAiApplied ? "border-emerald-200 bg-emerald-50/40 focus:ring-emerald-400" : "border-gray-200 focus:ring-purple-400"
                  }`}
                />
                {taskInstructionsAiApplied && <p className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1"><Wand2 size={10} /> AI-suggested</p>}
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setCreateMode(null); setTaskInstructionsAiApplied(false); }}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-[12px] font-bold text-[#6B7280] hover:bg-gray-50">Cancel</button>
                <button type="button" disabled={!taskTitle.trim() || createTaskMut.isPending}
                  onClick={() => createTaskMut.mutate({
                    name: taskTitle.trim(),
                    description: taskInstructions || null,
                    goal_id: taskPurpose === "goal" ? linkedGoalId : null,
                    is_mandatory: isMandatory,
                    shift_type: taskShiftType,
                    category: taskCategory,
                    priority: taskPriority,
                    evidence_required: taskEvidenceRequired,
                    is_recurring: isRecurring,
                    frequency_pattern: isRecurring ? frequencyPattern : null,
                  })}
                  className="flex-1 rounded-lg bg-purple-600 py-2.5 text-[12px] font-bold text-white hover:bg-purple-700 disabled:opacity-50">
                  {createTaskMut.isPending ? "Creating…" : "Create task"}
                </button>
              </div>
            </div>
          );

          return (
            <section className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-[16px] font-bold text-[#111827]">Goals & Tasks</h3>
                  <p className="text-[12px] text-[#6B7280] mt-0.5">Manage {participant.full_name}'s NDIS goals and support tasks</p>
                </div>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => { setCreateMode("goal"); setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setEditingGoal(null); setGoalDescriptionAiApplied(false); }}
                    className="px-3 py-1.5 text-[12px] font-bold rounded-lg border border-purple-200 bg-white text-purple-700 hover:bg-purple-50">
                    + Goal
                  </button>
                  <button type="button"
                    onClick={() => { setCreateMode("tasks"); setTaskTitle(""); setTaskInstructions(""); setLinkedGoalId(null); setTaskPurpose("core"); setTaskInstructionsAiApplied(false); }}
                    className="px-3 py-1.5 text-[12px] font-bold rounded-lg bg-[#3730A3] text-white hover:bg-[#312E81]">
                    + Task
                  </button>
                  <button type="button" onClick={() => setShiftModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg bg-[#3730A3] text-white hover:bg-[#312E81]">
                    <CalendarClock size={13} /> Assign Shift
                  </button>
                </div>
              </div>

              {/* Goal / task create-edit forms */}
              {(createMode === "goal" || createMode === "edit_goal") && goalFormContent}
              {createMode === "tasks" && taskFormContent}

              {/* Loading */}
              {ndisGoalsQuery.isLoading && (
                <div className="flex items-center gap-2 py-4 text-[13px] text-[#6B7280]"><Loader2 size={14} className="animate-spin" /> Loading goals…</div>
              )}

              {/* Empty state */}
              {!ndisGoalsQuery.isLoading && activeGoals.length === 0 && createMode !== "goal" && (
                <div className="rounded-lg border border-purple-100/60 bg-purple-50/40 p-6 text-center">
                  <Target className="h-8 w-8 text-[#6B7280] opacity-30 mx-auto mb-2" />
                  <p className="text-[13px] font-bold text-[#111827]">No active goals</p>
                  <p className="text-[12px] text-[#6B7280] mt-1">Click <strong>+ Goal</strong> to create the first NDIS goal for {participant.full_name}.</p>
                </div>
              )}

              {/* Active goals */}
              {activeGoals.map((goal) => {
                const goalTasks = participantTasks.filter((t) => t.goal_id === goal.id);
                const areaStyle = AREA_COLORS[goal.goal_area] ?? AREA_COLORS.other;
                const progressData = progressGoalId === goal.id ? goalProgressQuery.data : undefined;
                const progressLoading = progressGoalId === goal.id && goalProgressQuery.isLoading;
                const pct = progressData && progressData.sessions_count > 0
                  ? Math.round((progressData.evidence_count / progressData.sessions_count) * 100) : 0;

                return (
                  <div key={goal.id} className="rounded-lg border border-purple-100/60 bg-white">
                    {/* Goal header */}
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <Target size={15} className="shrink-0 mt-0.5 text-[#3730A3]" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-[#111827] leading-snug">{goal.name}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: areaStyle.bg, color: areaStyle.color }}>
                              {areaStyle.label}
                            </span>
                            <span className="text-[10px] text-[#6B7280]">{goalTasks.length} task{goalTasks.length !== 1 ? "s" : ""}</span>
                            {goal.target_date && <span className="text-[10px] text-[#6B7280]">Due {goal.target_date}</span>}
                          </div>
                          {goal.description && <p className="text-[11px] text-[#6B7280] mt-1 leading-relaxed line-clamp-2">{goal.description}</p>}
                          {goal.success_criteria && (
                            <p className="text-[11px] mt-1 px-2 py-1 rounded-lg bg-purple-50 text-[#6B7280]">
                              <span className="font-bold text-[#374151]">Success: </span>{goal.success_criteria}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                        <button type="button" onClick={() => { setCreateMode("tasks"); setLinkedGoalId(goal.id); setTaskTitle(""); setTaskInstructions(""); setTaskPurpose("goal"); setTaskInstructionsAiApplied(false); }}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-purple-200 text-purple-700 hover:bg-purple-50">
                          + Task
                        </button>
                        <button type="button" onClick={() => startEditGoal(goal)}
                          className="p-1.5 rounded hover:bg-gray-100" title="Edit goal">
                          <Edit2 size={12} className="text-[#6B7280]" />
                        </button>
                        <button type="button" onClick={() => completeGoalMut.mutate(goal.id)} disabled={completeGoalMut.isPending}
                          className="p-1.5 rounded hover:bg-green-50" title="Mark completed">
                          <CheckCircle2 size={12} className="text-[#059669]" />
                        </button>
                        <button type="button" onClick={() => archiveGoalMut.mutate(goal.id)} disabled={archiveGoalMut.isPending}
                          className="p-1.5 rounded hover:bg-gray-100" title="Archive goal">
                          <Archive size={12} className="text-[#6B7280]" />
                        </button>
                        <button type="button"
                          onClick={() => setProgressGoalId((prev) => prev === goal.id ? null : goal.id)}
                          className="p-1.5 rounded hover:bg-purple-50" title="View progress">
                          <BarChart2 size={12} className={progressGoalId === goal.id ? "text-[#3730A3]" : "text-[#6B7280]"} />
                        </button>
                      </div>
                    </div>

                    {/* Progress panel */}
                    {progressGoalId === goal.id && (
                      <div className="border-t border-purple-100/60 px-4 py-3 bg-purple-50/30">
                        {progressLoading && <p className="text-[12px] text-[#6B7280] flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading progress…</p>}
                        {progressData && (
                          <div className="space-y-3">
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#6B7280]">Progress — Last 30 Days</p>
                            <div className="grid grid-cols-3 gap-2">
                              {([["Sessions", progressData.sessions_count], ["With Evidence", progressData.evidence_count], ["Evidence Rate", `${pct}%`]] as [string, string | number][]).map(([l, v]) => (
                                <div key={l} className="rounded-lg px-3 py-2 bg-white border border-purple-100/60 text-center">
                                  <p className="text-[15px] font-black text-[#3730A3]">{v}</p>
                                  <p className="text-[9px] font-semibold text-[#6B7280]">{l}</p>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="flex justify-between text-[10px] font-semibold mb-1 text-[#6B7280]"><span>Evidence rate</span><span>{pct}%</span></div>
                              <div className="h-1.5 rounded-full overflow-hidden bg-purple-100">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 70 ? "#22C55E" : pct >= 40 ? "#F59E0B" : "#EF4444" }} />
                              </div>
                            </div>
                            {progressData.sessions.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-[#6B7280]">Recent Sessions</p>
                                {progressData.sessions.slice(0, 4).map((s) => (
                                  <div key={s.id} className="flex items-center justify-between rounded-lg px-3 py-1.5 bg-white text-[11px] border border-purple-100/60">
                                    <span className="text-[#374151]">{s.session_date}</span>
                                    <div className="flex items-center gap-2">
                                      {s.notes && <span className="text-[#059669]">✓ Notes</span>}
                                      {s.compliance_score != null && <span className={s.compliance_score >= 80 ? "text-[#059669]" : "text-[#D97706]"}>{s.compliance_score}%</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tasks under this goal */}
                    {goalTasks.length > 0 && (
                      <div className="border-t border-purple-100/60 divide-y divide-gray-100">
                        {goalTasks.map((task) => (
                          <div key={task.id} className="flex items-center justify-between px-4 py-2.5 pl-9">
                            <div className="flex items-center gap-2 min-w-0">
                              <CheckCircle2 size={13} className="shrink-0 text-[#059669]" />
                              <div className="min-w-0">
                                <p className="text-[12px] font-semibold text-[#111827] truncate">{task.name}</p>
                                {task.description && <p className="text-[11px] text-[#6B7280] truncate">{task.description}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {task.is_mandatory && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-bold">Required</span>}
                              <button type="button" onClick={() => deleteTaskMut.mutate(task.id)} disabled={deleteTaskMut.isPending}
                                className="p-1 rounded hover:bg-red-50 text-[#9CA3AF] hover:text-red-500" title="Delete task">
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {goalTasks.length === 0 && (
                      <div className="border-t border-purple-100/60 px-4 py-2.5 pl-9">
                        <p className="text-[11px] text-[#9CA3AF] italic">No tasks yet — click + Task to add one</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Core support tasks (no goal) */}
              {(() => {
                const coreTasks = participantTasks.filter((t) => !t.goal_id);
                if (coreTasks.length === 0) return null;
                return (
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest px-1">Core support — not linked to a goal</h4>
                    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                      {coreTasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClipboardList size={13} className="shrink-0 text-[#6B7280]" />
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-[#111827] truncate">{task.name}</p>
                              {task.description && <p className="text-[11px] text-[#6B7280] truncate">{task.description}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {task.is_mandatory && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-bold">Required</span>}
                            <button type="button" onClick={() => deleteTaskMut.mutate(task.id)} disabled={deleteTaskMut.isPending}
                              className="p-1 rounded hover:bg-red-50 text-[#9CA3AF] hover:text-red-500" title="Delete task">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Archived / completed goals */}
              {doneGoals.length > 0 && (
                <div className="space-y-1">
                  <button type="button" onClick={() => setShowArchivedGoals((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-[#6B7280] hover:text-[#374151] px-1">
                    <Archive size={12} />
                    {showArchivedGoals ? "Hide" : "Show"} archived & completed ({doneGoals.length})
                  </button>
                  {showArchivedGoals && (
                    <div className="space-y-1">
                      {doneGoals.map((goal) => {
                        const areaStyle = AREA_COLORS[goal.goal_area] ?? AREA_COLORS.other;
                        return (
                          <div key={goal.id} className="rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-bold text-[#374151] truncate">{goal.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: areaStyle.bg, color: areaStyle.color }}>{areaStyle.label}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${goal.status === "completed" ? "bg-green-50 text-green-700" : "bg-gray-100 text-[#6B7280]"}`}>
                                  {goal.status === "completed" ? "Completed" : "Archived"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })()}

        {/* GOALS TAB */}
        {activeTab === "goals" && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-[#3730A3]" />
              <h4 className="text-[13px] font-black text-[#111827]">{translate("patients.section.ndisGoals")}</h4>
              {goals.length > 0 && (
                <span className="ml-auto rounded-full bg-[#EEEAFB] px-2.5 py-0.5 text-[10px] font-black text-[#3730A3]">
                  {goals.length}
                </span>
              )}
            </div>
            {goals.length === 0 ? (
              <div className="rounded-xl bg-white border border-purple-100/60 p-6 text-center">
                <Target className="h-8 w-8 text-[#6B7280] opacity-30 mx-auto mb-2" />
                <p className="text-[13px] font-semibold text-[#111827]">{translate("patients.goals.empty")}</p>
                <p className="text-[11px] text-[#6B7280] mt-1">{translate("patients.goals.emptyHint")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {goals.map((goal, index) => (
                  <div key={String(goal.id || index)} className="rounded-xl bg-white border border-purple-100/60 px-4 py-3 flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#EEEAFB] flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-black text-[#3730A3]">{index + 1}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-[#111827] leading-snug">{normalizeGoalTitle(goal, index)}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mt-1 capitalize">
                        {String(goal.status || "active")}
                        {goal.category ? ` · ${String(goal.category)}` : ""}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold shrink-0 capitalize ${statusBadge(String(goal.status || "active"))}`}>
                      {String(goal.status || "active")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* SESSIONS TAB */}
        {activeTab === "sessions" && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-[#3730A3]" />
                <h4 className="text-[13px] font-black text-[#111827]">Shift History</h4>
                <span className="rounded-full bg-[#EEEAFB] px-2.5 py-0.5 text-[10px] font-black text-[#3730A3]">
                  {sessions.length}
                </span>
              </div>
              {isCoordinator && (
                <button type="button" onClick={() => setShiftModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg bg-[#3730A3] text-white hover:bg-[#312E81]">
                  <CalendarClock size={13} /> Assign Shift
                </button>
              )}
            </div>
            {sessionsQuery.isLoading ? (
              <div className="space-y-2">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl bg-white border border-purple-100/60 p-6 text-center">
                <CalendarDays className="h-8 w-8 text-[#6B7280] opacity-30 mx-auto mb-2" />
                <p className="text-[13px] font-semibold text-[#111827]">No shifts yet</p>
                <p className="text-[11px] text-[#6B7280] mt-1">Shifts with this participant will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <Link key={session.id} href={`/sessions/${session.id}`}>
                    <div className="rounded-xl bg-white border border-purple-100/60 px-3 py-3 hover:border-[#3730A3]/30 hover:bg-[#F8F8FE] transition-colors cursor-pointer">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-bold text-[#111827] capitalize truncate">
                            {(session.session_type || "session").replace(/_/g, " ")}
                          </p>
                          <p className="text-[11px] text-[#6B7280] mt-0.5">
                            {safeFormat(session.session_date)} · {session.duration_minutes || 0} min
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {session.compliance_score != null && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${complianceTone(session.compliance_score)}`}>
                              {session.compliance_score}%
                            </span>
                          )}
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${statusBadge(session.status || "")}`}>
                            {session.status || "draft"}
                          </span>
                        </div>
                      </div>
                      {(session.translated_english_note || session.compliance_input_text || session.notes) && (
                        <p className="mt-1.5 text-[11px] text-[#6B7280] line-clamp-2 leading-relaxed">
                          {session.translated_english_note || session.compliance_input_text || session.notes}
                        </p>
                      )}
                      {(session.original_language_input || session.translated_english_note) && (
                        <div className="mt-2">
                          <TranslationAuditView
                            originalLanguageInput={session.original_language_input ?? undefined}
                            translatedEnglishNote={session.translated_english_note ?? undefined}
                            translationMetadata={session.translation_metadata ?? null}
                            translationStatus={session.translation_status ?? undefined}
                            translationProvider={session.translation_provider ?? undefined}
                          />
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* COMPLIANCE TAB */}
        {activeTab === "compliance" && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-[#3730A3]" />
                <h4 className="text-[13px] font-black text-[#111827]">{translate("patients.section.complianceHistory")}</h4>
              </div>
              {complianceHistory.length > 0 && averageCompliance != null && (
                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black ${complianceTone(averageCompliance)}`}>
                  {translateParams("patients.compliance.avg", { score: String(averageCompliance) })}
                </span>
              )}
            </div>
            {complianceQuery.isLoading ? (
              <div className="space-y-2">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : complianceHistory.length === 0 ? (
              <div className="rounded-xl bg-white border border-purple-100/60 p-6 text-center">
                <ShieldCheck className="h-8 w-8 text-[#6B7280] opacity-30 mx-auto mb-2" />
                <p className="text-[13px] font-semibold text-[#111827]">{translate("patients.compliance.empty")}</p>
                <p className="text-[11px] text-[#6B7280] mt-1">{translate("patients.compliance.emptyHint")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {complianceHistory.map((item) => {
                  const score = item.latest_audit?.score ?? item.latest_audit?.compliance_score;
                  const auditDate = item.latest_audit?.checked_at ?? item.latest_audit?.created_at;
                  return (
                    <Link key={item.session_id} href={`/sessions/${item.session_id}`}>
                      <div className="rounded-xl bg-white border border-purple-100/60 px-3 py-3 hover:border-[#3730A3]/30 hover:bg-[#F8F8FE] transition-colors cursor-pointer">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold text-[#111827] capitalize truncate">
                              {(item.session_type || "session").replace(/_/g, " ")}
                            </p>
                            <p className="text-[11px] text-[#6B7280] mt-0.5">
                              {translateParams("patients.compliance.sessionDate", { date: safeFormat(item.session_date) })}
                              {auditDate ? ` · ${translateParams("patients.compliance.audited", { date: safeFormat(auditDate, "MMM d") })}` : ""}
                            </p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-black shrink-0 ${complianceTone(score)}`}>
                            {score == null ? "–" : `${score}%`}
                          </span>
                        </div>
                        {item.latest_audit?.status && (
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider capitalize text-[#6B7280]">
                            {item.latest_audit.status.replace(/_/g, " ")}
                          </p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* RESTRICTED CLINICAL TAB — coordinator only */}
        {activeTab === "restricted" && isCoordinator && (
          <section className="rounded-2xl border border-orange-200/70 bg-orange-50/30 p-4 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-orange-600" />
                <p className="text-[12px] font-black uppercase tracking-[0.13em] text-orange-700">{translate("patients.restricted.title")}</p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-orange-300 text-orange-600 font-semibold uppercase tracking-wide bg-orange-100">{translate("patients.restricted.coordinatorOnly")}</span>
            </div>
            <p className="text-[12px] text-orange-700/80 leading-relaxed">
              This section contains restricted information accessible only to Support Coordinators. Handle in accordance with the participant's privacy consent and NDIS guidelines.
            </p>
            {restrictedQuery.isLoading ? (
              <div className="space-y-3">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
              </div>
            ) : (
              <div className="space-y-3">
                {([
                  { key: "restricted_behavioural_notes" as const, label: "Behavioural Notes (Restricted)", placeholder: "Document restricted behavioural observations and incidents…" },
                  { key: "behaviour_support_plan"       as const, label: "Behaviour Support Plan",         placeholder: "Summarise the participant's current behaviour support plan…" },
                  { key: "medications"                  as const, label: "Medications",                    placeholder: "Current medications, dosages, and administration notes…" },
                  { key: "medical_alerts"               as const, label: "Medical Alerts",                 placeholder: "Known allergies, contraindications, emergency protocols…" },
                ] as const).map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-orange-700">{label}</p>
                    <textarea
                      className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 min-h-[80px]"
                      placeholder={placeholder}
                      value={restrictedDraft?.[key] ?? ""}
                      onChange={(e) => setRestrictedDraft((prev) => prev ? { ...prev, [key]: e.target.value } : prev)}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  disabled={saveRestricted.isPending || !restrictedDraft}
                  onClick={() => saveRestricted.mutate()}
                  className="bg-orange-600 hover:bg-orange-700 text-white gap-1.5"
                >
                  {saveRestricted.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {translate("patients.restricted.save")}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* SHIFT CONTEXT TAB — coordinator only */}
        {activeTab === "shift_context" && isCoordinator && (
          <section className="space-y-3">
            <div className="rounded-2xl border border-violet-200/70 bg-violet-50/30 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-violet-700" />
                  <p className="text-[12px] font-black uppercase tracking-[0.13em] text-violet-800">{translate("patients.shiftContext.title")}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-300 text-violet-700 font-semibold uppercase tracking-wide bg-violet-100">
                  Coordinator Authoring
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-violet-700/80">
                This information appears in the Support Worker My Shift experience. Keep instructions concise, current, and action-oriented.
              </p>
            </div>

            <ParticipantShiftContextEditor participantId={id} />
          </section>
        )}

      </div>

      {isCoordinator && (
        <ShiftAssignmentModal
          open={shiftModalOpen}
          onOpenChange={setShiftModalOpen}
          workers={workersQuery.data ?? []}
          initialParticipantId={id}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers for list panel
// ---------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// ---------------------------------------------------------------------------
// Main Patients Management Workspace Layout
// ---------------------------------------------------------------------------

export default function Patients() {
  const { translate, translateParams } = useAccessibility();
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder]     = useState<"asc" | "desc">("asc");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Deep-link support: "Back to Participant" from session/shift detail pages
  // passes ?id=<participantId>&tab=<tab> so the coordinator lands back on the
  // exact participant + tab they came from instead of the bare list.
  const deepLinkQuery = useSearch();
  const deepLinkId = new URLSearchParams(deepLinkQuery).get("id");
  const deepLinkTab = new URLSearchParams(deepLinkQuery).get("tab") as ParticipantDetailTab | null;
  useEffect(() => {
    if (deepLinkId) {
      setSelectedId(deepLinkId);
      setShowMobileDetail(true);
    }
  }, [deepLinkId]);

  const { data: participants, isLoading: participantsLoading, refetch } = useGetParticipants();

  const filteredParticipants = (participants ?? [])
    .filter((p: any) => {
      const q = search.toLowerCase();
      const matchesSearch = !q
        || p.full_name.toLowerCase().includes(q)
        || (p.ndis_number ?? "").includes(q);
      const matchesStatus = statusFilter === "all" || p.plan_status === statusFilter;
      const matchesLetter = !letterFilter || p.full_name.toUpperCase().startsWith(letterFilter);
      return matchesSearch && matchesStatus && matchesLetter;
    })
    .sort((a: any, b: any) => {
      const cmp = a.full_name.localeCompare(b.full_name);
      return sortOrder === "asc" ? cmp : -cmp;
    });

  // Which letters actually have participants
  const activeLetters = new Set(
    (participants ?? []).map((p: any) => p.full_name[0]?.toUpperCase()).filter(Boolean)
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-8rem)] gap-4 overflow-hidden">

      {/* ── Left panel — participant list ─────────────────────────────── */}
      <div
        className={`${showMobileDetail ? "hidden lg:flex" : "flex"} w-full lg:w-[300px] xl:w-[330px] shrink-0 flex-col rounded-2xl overflow-hidden`}
        style={{ background: "var(--cc-bg)", border: "1px solid var(--cc-border)" }}
      >
        {/* Panel header */}
        <div className="px-4 pt-4 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--cc-border)" }}>

          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-black" style={{ color: "var(--cc-text)" }}>{translate("patients.title")}</h2>
              {!participantsLoading && (
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full"
                  style={{ background: "var(--cc-active-bg)", color: "var(--cc-plum)" }}
                >
                  {filteredParticipants.length}
                  {participants && filteredParticipants.length !== participants.length
                    ? ` of ${participants.length}` : ""}
                </span>
              )}
            </div>
            <Link href="/participants/new">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl text-[12px]">
                <UserPlus className="h-3.5 w-3.5" />
                {translate("patients.add")}
              </Button>
            </Link>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--cc-muted)" }} />
            <Input
              placeholder={translate("patients.searchPlaceholder")}
              className="pl-8 h-9 rounded-xl text-[13px]"
              style={{ background: "var(--cc-soft)", border: "1px solid var(--cc-border)" }}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setLetterFilter(null); }}
              data-testid="input-search-participants"
            />
          </div>

          {/* Status + sort controls */}
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 flex-1 rounded-xl text-[12px]" style={{ background: "var(--cc-soft)", border: "1px solid var(--cc-border)" }}>
                <SelectValue placeholder={translate("patients.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{translate("patients.allStatuses")}</SelectItem>
                <SelectItem value="active">{translate("patients.planStatus.active")}</SelectItem>
                <SelectItem value="pending">{translate("patients.planStatus.pending")}</SelectItem>
                <SelectItem value="inactive">{translate("patients.planStatus.inactive")}</SelectItem>
                <SelectItem value="expired">{translate("patients.planStatus.expired")}</SelectItem>
              </SelectContent>
            </Select>

            {/* A→Z / Z→A sort toggle */}
            <button
              type="button"
              onClick={() => setSortOrder((o) => o === "asc" ? "desc" : "asc")}
              className="h-8 px-2.5 rounded-xl text-[11px] font-black shrink-0 transition-colors"
              style={{
                background: "var(--cc-active-bg)",
                color: "var(--cc-plum)",
                border: "1px solid rgba(55,48,163,0.12)",
              }}
              title={sortOrder === "asc" ? translate("patients.sortAsc") : translate("patients.sortDesc")}
            >
              {sortOrder === "asc" ? "A→Z" : "Z→A"}
            </button>
          </div>

          {/* A–Z alphabet strip */}
          <div className="flex items-center gap-0.5 mt-2.5 overflow-x-auto scrollbar-none pb-0.5">
            <button
              type="button"
              onClick={() => setLetterFilter(null)}
              className="shrink-0 h-6 px-1.5 rounded text-[10px] font-black transition-colors"
              style={{
                background: !letterFilter ? "var(--cc-plum)" : "var(--cc-soft)",
                color: !letterFilter ? "white" : "var(--cc-muted)",
              }}
            >
              All
            </button>
            {ALPHABET.map((letter) => {
              const has = activeLetters.has(letter);
              const active = letterFilter === letter;
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!has}
                  onClick={() => setLetterFilter(active ? null : letter)}
                  className="shrink-0 h-6 w-6 rounded text-[10px] font-black transition-colors disabled:opacity-25"
                  style={{
                    background: active ? "var(--cc-plum)" : has ? "var(--cc-soft)" : "transparent",
                    color: active ? "white" : has ? "var(--cc-text)" : "var(--cc-muted)",
                  }}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </div>

        {/* Participant list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {participantsLoading ? (
            Array(6).fill(0).map((_, i) => (
              <div key={i} className="p-3 flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))
          ) : filteredParticipants.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--cc-active-bg)" }}>
                <Users className="h-5 w-5 opacity-40" style={{ color: "var(--cc-plum)" }} />
              </div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>{translate("patients.empty.title")}</p>
              <p className="text-[12px] text-center leading-relaxed" style={{ color: "var(--cc-muted)" }}>
                {letterFilter
                  ? translateParams("patients.empty.letterFilter", { letter: letterFilter })
                  : translate("patients.empty.adjustFilters")}
              </p>
            </div>
          ) : (
            filteredParticipants.map((p: any) => {
              const inits = p.full_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              const isSelected = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelectedId(p.id); setShowMobileDetail(true); }}
                  data-testid={`button-participant-${p.id}`}
                  className="w-full text-left rounded-xl transition-all duration-150 flex items-center gap-3 px-3 py-2.5 border"
                  style={{
                    background: isSelected ? "var(--cc-active-bg)" : "transparent",
                    borderColor: isSelected ? "rgba(55,48,163,0.18)" : "transparent",
                    boxShadow: isSelected ? "inset 3px 0 0 var(--cc-plum)" : "none",
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-[12px] font-black shrink-0 transition-colors"
                    style={{
                      background: isSelected ? "var(--cc-plum)" : "var(--cc-active-bg)",
                      color: isSelected ? "white" : "var(--cc-plum)",
                    }}
                  >
                    {inits}
                  </div>

                  {/* Name + ID */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className="text-[13px] font-bold truncate flex-1 min-w-0"
                        style={{ color: isSelected ? "var(--cc-plum)" : "var(--cc-text)" }}
                      >
                        {p.full_name}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold shrink-0 capitalize ${statusBadge(p.plan_status)}`}>
                        {p.plan_status}
                      </span>
                    </div>
                    {/* NDIS number as clear identifier */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                        style={{ background: "var(--cc-soft)", color: "var(--cc-muted)" }}
                      >
                        NDIS {p.ndis_number || "—"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right panel — participant detail ──────────────────────────── */}
      <div
        className={`${showMobileDetail ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col rounded-2xl overflow-hidden`}
        style={{ background: "var(--cc-bg)", border: "1px solid var(--cc-border)" }}
      >
        {selectedId ? (
          <>
            {/* Mobile back button */}
            <button
              type="button"
              className="lg:hidden flex items-center gap-2 text-[13px] font-semibold px-4 py-3 shrink-0 transition-colors"
              style={{ borderBottom: "1px solid var(--cc-border)", color: "var(--cc-plum)" }}
              onClick={() => setShowMobileDetail(false)}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {translate("patients.backToList")}
            </button>
            <div className="flex-1 overflow-y-auto">
              <ParticipantDetail key={selectedId} id={selectedId} onRefreshList={refetch} initialTab={deepLinkId === selectedId ? deepLinkTab ?? undefined : undefined} />
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "var(--cc-active-bg)" }}>
              <Users className="h-7 w-7 opacity-40" style={{ color: "var(--cc-plum)" }} />
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: "var(--cc-text)" }}>{translate("patients.selectPrompt")}</p>
              <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--cc-muted)" }}>
                {translate("patients.selectHint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
