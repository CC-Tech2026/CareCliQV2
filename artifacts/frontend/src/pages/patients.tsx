import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getNdisGoals, createNdisGoal, archiveNdisGoal, completeNdisGoal, updateNdisGoal, getGoalProgress,
  getParticipantTasks, createParticipantTask, deleteParticipantTask, getCoordinatorWorkerStats,
  getParticipantBillingPeriods, getParticipantCurrentBillingPeriod, planManagementTypeLabel,
  type NdisGoal, type NdisGoalPayload, type ParticipantTask, type ParticipantTaskPayload, type GoalProgressResponse, type WorkerStats,
  type BillingPeriod,
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
  Trash2,
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
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
  plan_management_type: z.enum(["NDIA-managed", "plan-managed", "self-managed"]).optional().or(z.literal("")),
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
});
type PlanFormValues = z.infer<typeof planSchema>;

type PlanBudgetCategoryOption = {
  category: string;
  category_name: string;
  category_group: "core_supports" | "capacity_building" | "capital_supports";
  source: "pricing" | "legacy";
};

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
  plan_management_type?: string | null;
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
  plan_id?: string;
  plan_number?: string;
  plan_start?: string | null;
  plan_end?: string | null;
  status?: string | null;
  total_funding?: number | string | null;
  total_allocated?: number;
  total_used?: number;
  total_remaining?: number;
  budgets?: Array<{
    category?: string;
    category_label?: string;
    category_group?: string;
    allocated?: number;
    used?: number;
    remaining?: number;
    percent_used?: number;
    overspent?: boolean;
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
  hasPlan = false,
}: {
  form: ReturnType<typeof useForm<ParticipantFormValues>>;
  onSubmit: (data: ParticipantFormValues) => void;
  isPending: boolean;
  onCancel: () => void;
  submitLabel: string;
  hasPlan?: boolean;
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
            name="plan_management_type"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>{translate("patients.field.planManagementType")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || undefined}>
                  <FormControl>
                    <SelectTrigger data-testid="select-plan-management-type">
                      <SelectValue placeholder={translate("patients.planManagementType.notSet")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="NDIA-managed">{translate("patients.planManagementType.ndiaManaged")}</SelectItem>
                    <SelectItem value="plan-managed">{translate("patients.planManagementType.planManaged")}</SelectItem>
                    <SelectItem value="self-managed">{translate("patients.planManagementType.selfManaged")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {hasPlan ? (
            <FormItem>
              <Label>{translate("patients.field.totalBudget")}</Label>
              <p className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Managed via Set Up NDIS Plan
              </p>
            </FormItem>
          ) : (
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
          )}
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
// Edit Participant Modal
// ---------------------------------------------------------------------------

function EditParticipantPanel({
  participant,
  hasPlan,
  onSaved,
}: {
  participant: any;
  hasPlan: boolean;
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
      plan_management_type: String(participant.plan_management_type ?? ""),
      plan_start_date: participant.plan_start_date ? String(participant.plan_start_date).slice(0, 10) : "",
      plan_end_date: participant.plan_end_date ? String(participant.plan_end_date).slice(0, 10) : "",
      total_budget: Number(participant.total_budget ?? 0),
    },
  });

  useEffect(() => {
    if (!open) return;
    editForm.reset({
      full_name: String(participant.full_name ?? ""),
      ndis_number: String(participant.ndis_number ?? ""),
      date_of_birth: participant.date_of_birth ? String(participant.date_of_birth).slice(0, 10) : "",
      email: String(participant.email ?? ""),
      phone: String(participant.phone ?? ""),
      primary_disability: String(participant.primary_disability ?? ""),
      biological_sex: String(participant.biological_sex ?? "unspecified"),
      plan_status: String(participant.plan_status ?? "active"),
      plan_management_type: String(participant.plan_management_type ?? ""),
      plan_start_date: participant.plan_start_date ? String(participant.plan_start_date).slice(0, 10) : "",
      plan_end_date: participant.plan_end_date ? String(participant.plan_end_date).slice(0, 10) : "",
      total_budget: Number(participant.total_budget ?? 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, participant.id]);

  const updateMutation = useMutation({
    mutationFn: async (data: ParticipantFormValues) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.email) delete payload.email;
      if (!payload.phone) delete payload.phone;
      if (!payload.primary_disability) delete payload.primary_disability;
      if (!payload.plan_start_date) delete payload.plan_start_date;
      if (!payload.plan_end_date) delete payload.plan_end_date;
      if (!payload.plan_management_type) delete payload.plan_management_type;

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
      <Button size="sm" variant="outline" className="h-9 gap-1.5 text-[12px] shrink-0" onClick={() => setOpen(true)}>
        <Edit className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden min-[380px]:inline">{translate("common.edit")}</span>
        <span className="min-[380px]:hidden">Edit</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{translate("patients.editTitle")}</DialogTitle>
          </DialogHeader>
          <ParticipantForm
            form={editForm}
            onSubmit={(data) => updateMutation.mutate(data)}
            isPending={updateMutation.isPending}
            onCancel={() => setOpen(false)}
            hasPlan={hasPlan}
            submitLabel={translate("patients.saveChanges")}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NDIS Plan Setup Inline Panel
// ---------------------------------------------------------------------------

function SetupPlanPanel({
  participantId,
  budget,
  onSaved,
}: {
  participantId: string;
  budget?: BudgetSummary;
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
      onSaved();
    },
    onError: () => toast({ title: translate("patients.toast.planSaveFailed"), variant: "destructive" }),
  });

  const hasPlan = !!budget?.plan_id;
  const existingBudgets = budget?.budgets ?? [];
  const usedCategoryKeys = new Set(existingBudgets.map((b) => b.category));

  useEffect(() => {
    if (!open) return;
    planForm.reset({
      plan_number: budget?.plan_number ?? "",
      plan_start: budget?.plan_start ? String(budget.plan_start).slice(0, 10) : "",
      plan_end: budget?.plan_end ? String(budget.plan_end).slice(0, 10) : "",
      total_funding: Number(budget?.total_funding ?? 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, budget?.plan_id]);

  const categoriesQuery = useOrgQuery(["participant", participantId, "budget-categories"], {
    queryFn: () => jsonFetch<PlanBudgetCategoryOption[]>(`/api/participants/${participantId}/plan/budget-categories`),
    enabled: open && hasPlan,
  });
  const availableCategories = categoriesQuery.data ?? [];

  const [categoryDraft, setCategoryDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const categoryBudgetFormRef = useRef<HTMLDivElement>(null);

  const selectableCategories = availableCategories.filter(
    (c) => editingCategory === c.category || !usedCategoryKeys.has(c.category),
  );
  const allCategoriesAllocated =
    !categoriesQuery.isLoading && !editingCategory && selectableCategories.length === 0;
  const editingCategoryLabel =
    existingBudgets.find((b) => b.category === editingCategory)?.category_label
    ?? availableCategories.find((c) => c.category === editingCategory)?.category_name
    ?? editingCategory;

  const resetCategoryDraft = () => {
    setCategoryDraft("");
    setAmountDraft("");
    setEditingCategory(null);
  };

  const startEditingCategory = (category?: string, allocated?: number) => {
    if (!category) return;
    setEditingCategory(category);
    setCategoryDraft(category);
    setAmountDraft(String(allocated ?? 0));
    requestAnimationFrame(() => {
      categoryBudgetFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const upsertBudget = useMutation({
    mutationFn: async (payload: { category: string; allocated_amount: number }) => {
      const res = await apiFetch(`/api/participants/${participantId}/plan/budgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save category budget");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: translate("patients.toast.planSaved") });
      resetCategoryDraft();
      onSaved();
    },
    onError: () => toast({ title: translate("patients.toast.planSaveFailed"), variant: "destructive" }),
  });

  const deleteBudget = useMutation({
    mutationFn: async (category: string) => {
      const res = await apiFetch(`/api/participants/${participantId}/plan/budgets/${encodeURIComponent(category)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove category budget");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: translate("patients.toast.planSaved") });
      onSaved();
    },
    onError: () => toast({ title: translate("patients.toast.planSaveFailed"), variant: "destructive" }),
  });

  return (
    <div>
      <Button size="sm" variant="outline" className="h-9 gap-1.5 text-[12px] shrink-0" onClick={() => setOpen(true)}>
        <PlusCircle className="h-3.5 w-3.5 shrink-0" />
        {hasPlan ? (
          <>
            <span className="hidden min-[380px]:inline">Edit Plan Details</span>
            <span className="min-[380px]:hidden">Edit Plan</span>
          </>
        ) : (
          <>
            <span className="hidden min-[380px]:inline">{translate("patients.setupPlan")}</span>
            <span className="min-[380px]:hidden">Set Up Plan</span>
          </>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{hasPlan ? "Edit Plan Details" : translate("patients.setupPlan")}</DialogTitle>
          </DialogHeader>
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
              </div>

              {!hasPlan && (
                <div className="border-t border-purple-100/60 pt-4">
                  <p className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4" /> {translate("patients.budgetByCategory")}
                  </p>
                  <p className="text-[12px] text-[#6B7280]">
                    Save the plan details above first — category budgets can be added once the plan exists.
                  </p>
                </div>
              )}

              {hasPlan && (
                <div className="border-t border-purple-100/60 pt-4">
                  <p className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4" /> {translate("patients.budgetByCategory")}
                  </p>

                  {existingBudgets.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {existingBudgets.map((b) => (
                        <div
                          key={b.category}
                          className="flex items-center justify-between gap-2 rounded-xl border border-purple-100/60 bg-white p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-[12px] font-bold text-[#111827] truncate">{b.category_label || b.category}</p>
                            <p className="text-[10px] text-[#6B7280]">
                              {money(b.allocated)} allocated
                              {b.overspent && <span className="ml-1.5 font-bold text-red-600">· Over budget</span>}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => startEditingCategory(b.category, b.allocated)}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-red-600"
                              disabled={deleteBudget.isPending}
                              onClick={() => b.category && deleteBudget.mutate(b.category)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div ref={categoryBudgetFormRef} className="space-y-2 rounded-xl border border-dashed border-purple-200 p-3">
                    {allCategoriesAllocated ? (
                      <p className="text-[12px] text-[#6B7280] text-center py-1">
                        All available support categories already have a budget. Use the edit button on a row above to change an allocation.
                      </p>
                    ) : (
                      <>
                        {editingCategory ? (
                          <div className="flex h-9 items-center rounded-md border border-purple-100/60 bg-[#FDFCFF] px-3 text-[12px] font-medium text-[#111827]">
                            {editingCategoryLabel}
                          </div>
                        ) : (
                          <Select
                            value={categoryDraft || undefined}
                            onValueChange={setCategoryDraft}
                            disabled={categoriesQuery.isLoading}
                          >
                            <SelectTrigger className="h-9 text-[12px]">
                              <SelectValue placeholder={categoriesQuery.isLoading ? "Loading categories…" : "Select category"} />
                            </SelectTrigger>
                            <SelectContent position="popper" onCloseAutoFocus={(e) => e.preventDefault()}>
                              {selectableCategories.map((c) => (
                                <SelectItem key={c.category} value={c.category}>
                                  {c.category_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Input
                          type="number"
                          min={0}
                          placeholder="Allocated amount"
                          value={amountDraft}
                          onChange={(e) => setAmountDraft(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          {editingCategory && (
                            <Button type="button" variant="outline" size="sm" onClick={resetCategoryDraft}>
                              Cancel
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            disabled={!categoryDraft || amountDraft === "" || upsertBudget.isPending}
                            onClick={() =>
                              upsertBudget.mutate({ category: categoryDraft, allocated_amount: Number(amountDraft) })
                            }
                          >
                            {upsertBudget.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                            {editingCategory ? "Update" : "Add"} Category Budget
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createPlan.isPending}>
                  {createPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {hasPlan ? "Update Plan" : translate("patients.savePlan")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail Wrapper Component
// ---------------------------------------------------------------------------

type ParticipantDetailTab = "overview" | "plan" | "goals" | "goals_tasks" | "sessions" | "compliance" | "shift_context" | "restricted";

function ParticipantDetail({ id, onRefreshList, initialTab }: { id: string; onRefreshList: () => void; initialTab?: ParticipantDetailTab }) {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator";

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
  const billingPeriodCurrentQuery = useOrgQuery(["participant", id, "billing-period-current"], {
    queryFn: () => getParticipantCurrentBillingPeriod(id),
    enabled: isCoordinator,
  });
  const billingPeriodsQuery = useOrgQuery(["participant", id, "billing-periods"], {
    queryFn: () => getParticipantBillingPeriods(id),
    enabled: isCoordinator,
  });

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
      setTaskTitle(""); setTaskInstructions(""); setLinkedGoalId(null); setTaskPurpose("core"); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false);
    },
    onError: () => toastFn({ title: "Failed to create task", variant: "destructive" }),
  });

  const deleteTaskMut = useMutation({
    mutationFn: deleteParticipantTask,
    onSuccess: () => { toastFn({ title: "Task deleted" }); qc.invalidateQueries({ queryKey: ["participant", id, "participant-tasks"] }); },
    onError: () => toastFn({ title: "Failed to delete task", variant: "destructive" }),
  });

  const fetchGoalSuggestions = async () => {
    setGoalAiLoading(true);
    try {
      const params = new URLSearchParams({
        participant_id: id,
        goal_area: goalCategory,
        ...(goalTitle.trim() ? { current_title: goalTitle.trim() } : {}),
      });
      const data = await jsonFetch<{ names: string[]; descriptions: string[]; success_criteria: string[] }>(
        `/api/tasks/ai/goal-full-suggestions?${params}`, { method: 'POST' }
      );
      setGoalAiSuggestions(data);
    } catch (err) {
      console.error('Goal suggestions failed:', err);
      toastFn({ title: 'AI unavailable', description: 'Could not generate suggestions.', variant: 'destructive' });
    } finally {
      setGoalAiLoading(false);
    }
  };

  const fetchTaskSuggestions = async () => {
    setTaskAiLoading(true);
    try {
      const linkedGoal = linkedGoalId ? ndisGoals.find(g => g.id === linkedGoalId) : null;
      const params = new URLSearchParams({ participant_id: id, task_purpose: taskPurpose });
      if (linkedGoal?.name) params.set('goal_name', linkedGoal.name);
      if (linkedGoal?.description) {
        const plain = (linkedGoal.description as string).replace(/<[^>]+>/g, '').trim().slice(0, 400);
        if (plain) params.set('goal_description', plain);
      }
      const data = await jsonFetch<{ names: string[]; instructions: string[]; category: string | null; priority: string | null }>(
        `/api/tasks/ai/task-full-suggestions?${params}`, { method: 'POST' }
      );
      setTaskAiSuggestions(data);
      if (data.category) setTaskCategory(data.category as typeof taskCategory);
      if (data.priority) setTaskPriority(data.priority as typeof taskPriority);
    } catch (err) {
      console.error('Task suggestions failed:', err);
      toastFn({ title: 'AI unavailable', description: 'Could not generate task suggestions.', variant: 'destructive' });
    } finally {
      setTaskAiLoading(false);
    }
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
  const [goalDescriptionAiApplied, setGoalDescriptionAiApplied] = useState(false);
  const [goalAiSuggestions, setGoalAiSuggestions] = useState<{ names: string[]; descriptions: string[]; success_criteria: string[] } | null>(null);
  const [goalAiLoading, setGoalAiLoading] = useState(false);
  const goalDescriptionRef = useRef<HTMLDivElement>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskTitleSuggestions, setTaskTitleSuggestions] = useState<string[]>([]);
  const [taskTitleLoading, setTaskTitleLoading] = useState(false);
  const [taskInstructions, setTaskInstructions] = useState('');
  const [taskSupportCategory, setTaskSupportCategory] = useState('');
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
  const [taskAiSuggestions, setTaskAiSuggestions] = useState<{ names: string[]; instructions: string[]; category: string | null; priority: string | null } | null>(null);
  const [taskAiLoading, setTaskAiLoading] = useState(false);

  // Sync contenteditable description div when goal form opens or switches between modes
  useEffect(() => {
    if (!goalDescriptionRef.current) return;
    if (createMode === 'goal') {
      goalDescriptionRef.current.innerHTML = '';
    } else if (createMode === 'edit_goal') {
      goalDescriptionRef.current.innerHTML = goalDescription || '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode, editingGoal]);

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
  const goals = ndisGoalsQuery.data ?? [];
  const categoryBudgets = budget?.budgets ?? [];
  const hasCategoryBudgets = categoryBudgets.length > 0;
  const hasPlan = !!budget?.plan_id;
  // Once per-category budgets exist, they are the source of truth — total_allocated/used/remaining
  // are a computed rollup of those rows, not a separately-tracked figure. Otherwise, the plan record
  // (budget.total_funding) is authoritative once a plan exists — participant.total_budget is a legacy
  // field that can drift from it (e.g. via the separate Edit participant panel) and is only trusted
  // as a last resort when there's no plan at all.
  const totalBudget = hasCategoryBudgets
    ? Number(budget?.total_allocated ?? 0)
    : hasPlan
      ? Number(budget?.total_funding ?? 0)
      : Number(participant.total_budget ?? 0);
  const usedBudget = Number(budget?.total_used ?? 0);
  const remainingBudget = hasCategoryBudgets
    ? Number(budget?.total_remaining ?? totalBudget - usedBudget)
    : Math.max(totalBudget - usedBudget, 0);
  const isOverspent = remainingBudget < 0;
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
      value: isOverspent ? `${money(remainingBudget)} · Over budget` : money(remainingBudget),
      icon: DollarSign,
      tone: isOverspent ? "bg-red-50 text-red-700 border-red-200" : "bg-purple-50 text-[#3730A3] border-purple-100",
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
    { id: "overview"    as const, label: translate("patients.tab.overview"),    shortLabel: "Overview",  icon: UserCircle   },
    { id: "plan"        as const, label: translate("patients.tab.plan"),        shortLabel: "Plan",      icon: DollarSign   },
    ...(isCoordinator
      ? [{ id: "goals_tasks" as const, label: "Goals & Tasks", shortLabel: "Goals", icon: ClipboardList }]
      : [{ id: "goals" as const, label: translate("patients.tab.goals"), shortLabel: "Goals", icon: Target }]),
    { id: "sessions"    as const, label: "Shift History", shortLabel: "Shifts",    icon: CalendarDays },
    { id: "compliance"  as const, label: translate("patients.tab.compliance"),  shortLabel: "Compliance", icon: ShieldCheck  },
    ...(isCoordinator ? [{ id: "shift_context" as const, label: translate("patients.tab.shiftContext"), shortLabel: "Context", icon: Users }] : []),
    ...(isCoordinator ? [{ id: "restricted" as const, label: "Clinical Records", shortLabel: "Clinical", icon: Lock }] : []),
  ];

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 border-b border-purple-100/60 px-3 pt-3 pb-0 sm:px-5 sm:pt-5"
        style={{ background: "var(--cc-bg)" }}
      >

        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-[#BE185D] to-[#3730A3] flex items-center justify-center text-white text-sm font-black shrink-0 select-none">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="hidden">Participant Profile</p>
            <h3
              className="text-[16px] font-black leading-snug sm:truncate"
              style={{ color: "var(--cc-text)" }}
            >
              {participant.full_name}
            </h3>
            <p className="text-[11px] mt-0.5 leading-relaxed sm:hidden" style={{ color: "var(--cc-muted)" }}>
              {translateParams("patients.ndisLine", { number: participant.ndis_number || translate("patients.notRecorded") })}
              {participant.plan_start_date && participant.plan_end_date && (
                <> &middot; Plan {safeFormat(participant.plan_start_date)} – {safeFormat(participant.plan_end_date)}</>
              )}
            </p>
            
             {/* NDIS number + plan dates — desktop */}
              <p className="hidden sm:block text-[11px] text-[#6B7280] leading-relaxed mt-2" style={{ color: "var(--cc-muted)" }}>
                {translateParams("patients.ndisLine", { number: participant.ndis_number || translate("patients.notRecorded") })}
                {participant.plan_start_date && participant.plan_end_date && (
                  <> &middot; Plan {safeFormat(participant.plan_start_date)} – {safeFormat(participant.plan_end_date)}</>
                )}
              </p>
          </div>

          {/* Action buttons — desktop: inline right */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <EditParticipantPanel
              participant={participant}
              hasPlan={hasPlan}
              onSaved={() => { participantQuery.refetch(); onRefreshList(); billingPeriodCurrentQuery.refetch(); billingPeriodsQuery.refetch(); }}
            />
            <SetupPlanPanel
              participantId={id}
              budget={budget}
              onSaved={() => { participantQuery.refetch(); budgetQuery.refetch(); onRefreshList(); }}
            />
          </div>
        </div>

        {/* Stat cards — 2×2 on mobile, 4 across on desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3 mt-3">
          {metricCards.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className={`rounded-xl border px-3 py-2.5 ${metric.tone}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <p className="text-[9px] font-black uppercase tracking-wide opacity-70 leading-tight">{metric.label}</p>
                </div>
                <p className="text-[12px] sm:text-[13px] font-black capitalize leading-snug break-words">{metric.value}</p>
              </div>
            );
          })}
        </div>

        {/* Action buttons — mobile: below stat cards */}
        <div className="flex sm:hidden flex-wrap items-center gap-2 mb-3">
          <EditParticipantPanel
            participant={participant}
            hasPlan={hasPlan}
            onSaved={() => { participantQuery.refetch(); onRefreshList(); billingPeriodCurrentQuery.refetch(); billingPeriodsQuery.refetch(); }}
          />
          <SetupPlanPanel
            participantId={id}
            budget={budget}
            onSaved={() => { participantQuery.refetch(); budgetQuery.refetch(); onRefreshList(); }}
          />
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 -mb-px overflow-x-auto scrollbar-none scroll-px-3">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 sm:px-3.5 text-[11px] sm:text-[12px] font-bold border-b-2 whitespace-nowrap transition-colors shrink-0 min-h-[44px] ${
                  active
                    ? "border-[#3730A3] text-[#3730A3]"
                    : "border-transparent text-[#6B7280] hover:text-[#111827] hover:border-[#E5E7EB]"
                }`}
              >
                <Icon size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 pb-6">

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-3.5 w-3.5 text-[#3730A3]" />
              <h4 className="text-[13px] font-black text-[#111827]">{translate("patients.section.personalDetails")}</h4>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                [translate("patients.field.planManagementType"), planManagementTypeLabel(participant.plan_management_type, translate)],
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

        {activeTab === "overview" && isCoordinator && (
          <section className="rounded-2xl border border-purple-100/70 bg-[#FDFCFF] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-[#3730A3]" />
              <h4 className="text-[13px] font-black text-[#111827]">{translate("patients.billingPeriod.title")}</h4>
            </div>

            {billingPeriodCurrentQuery.isLoading ? (
              <Skeleton className="h-16 w-full rounded-xl" />
            ) : (
              <>
                {billingPeriodCurrentQuery.data?.type_differs_from_lock && (
                  <div
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900"
                    role="status"
                  >
                    {billingPeriodCurrentQuery.data.message ?? translate("patients.billingPeriod.nextPeriodNote")}
                  </div>
                )}
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    [translate("patients.billingPeriod.currentType"), planManagementTypeLabel(billingPeriodCurrentQuery.data?.current_plan_management_type, translate)],
                    [translate("patients.billingPeriod.lockedType"), planManagementTypeLabel(billingPeriodCurrentQuery.data?.open_period?.locked_plan_management_type, translate)],
                    [
                      translate("patients.billingPeriod.periodRange"),
                      billingPeriodCurrentQuery.data?.open_period
                        ? `${safeFormat(billingPeriodCurrentQuery.data.open_period.period_start)} – ${safeFormat(billingPeriodCurrentQuery.data.open_period.period_end)}`
                        : translate("patients.notSet"),
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-white border border-purple-100/60 px-3 py-2">
                      <dt className="text-[9px] font-black uppercase tracking-wider text-[#6B7280] leading-none mb-1">{label}</dt>
                      <dd className="text-[12px] font-bold text-[#111827]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {billingPeriodsQuery.data?.items && billingPeriodsQuery.data.items.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#6B7280] mb-2">
                  {translate("patients.billingPeriod.history")}
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {billingPeriodsQuery.data.items.map((period: BillingPeriod) => (
                    <div
                      key={period.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-purple-100/60 bg-white px-3 py-2 text-[12px]"
                    >
                      <span className="font-semibold text-[#111827]">
                        {safeFormat(period.period_start)} – {safeFormat(period.period_end)}
                      </span>
                      <span className="text-[#6B7280]">
                        {planManagementTypeLabel(period.locked_plan_management_type, translate)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${period.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {period.status === "open"
                          ? translate("patients.billingPeriod.statusOpen")
                          : translate("patients.billingPeriod.statusClosed")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                {/* Total / Used / Remaining — computed rollup of the category rows below once any exist */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { lbl: translate("patients.budget.total"),     val: money(totalBudget || budget?.total_funding), flagged: false },
                    { lbl: translate("patients.budget.used"),      val: money(usedBudget), flagged: false },
                    { lbl: translate("patients.budget.remaining"), val: money(remainingBudget), flagged: isOverspent },
                  ].map(({ lbl, val, flagged }) => (
                    <div
                      key={lbl}
                      className={`rounded-lg border px-3 py-2 ${flagged ? "bg-red-50 border-red-200" : "bg-white border-purple-100/60"}`}
                    >
                      <p className="text-[9px] font-black uppercase tracking-wider text-[#6B7280] leading-none mb-1">{lbl}</p>
                      <p className={`text-[12px] font-black truncate ${flagged ? "text-red-700" : "text-[#111827]"}`}>{val}</p>
                    </div>
                  ))}
                </div>
                {isOverspent && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
                    Plan is over budget — spending exceeds total allocated funding.
                  </div>
                )}
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
                        className={`h-full rounded-full transition-all ${isOverspent ? "bg-red-500" : "bg-gradient-to-r from-[#3730A3] to-[#8B5CF6]"}`}
                        style={{ width: `${Math.min(100, Math.round((usedBudget / totalBudget) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Category breakdown */}
                {hasCategoryBudgets && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#6B7280]">{translate("patients.budget.byCategory")}</p>
                    {categoryBudgets.map((item) => (
                      <div
                        key={item.category || item.category_label}
                        className={`rounded-xl border p-3 ${item.overspent ? "border-red-200 bg-red-50" : "border-purple-100/60 bg-white"}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-[12px] font-bold text-[#111827] truncate">{item.category_label || item.category}</span>
                          <span className={`text-[11px] font-black shrink-0 ${item.overspent ? "text-red-700" : "text-[#6B7280]"}`}>
                            {item.overspent ? "Over budget" : `${item.percent_used ?? 0}%`}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#EEEAFB] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${item.overspent ? "bg-red-500" : "bg-gradient-to-r from-[#3730A3] to-[#8B5CF6]"}`}
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
            setGoalAiSuggestions(null); setGoalAiLoading(false);
            setCreateMode("edit_goal");
          };
          const cancelGoalForm = () => {
            setCreateMode(null); setEditingGoal(null);
            setGoalDescriptionAiApplied(false); setGoalAiSuggestions(null); setGoalAiLoading(false);
          };

          const goalFormContent = (
            <div className="rounded-xl border border-purple-100 bg-white shadow-sm p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-[14px] font-bold text-[#111827]">{createMode === "edit_goal" ? "Edit goal" : "New NDIS goal"}</h4>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{participant.full_name}</p>
                </div>
                <button type="button" onClick={cancelGoalForm} title="Close" aria-label="Close" className="p-1 rounded-full hover:bg-gray-100"><X size={15} className="text-[#9CA3AF]" /></button>
              </div>

              {/* AI Goal Assistant panel */}
              <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                      <Sparkles size={12} className="text-violet-600" />
                    </div>
                    <div>
                      <span className="text-[12px] font-bold text-violet-900">AI Goal Assistant</span>
                      {goalAiSuggestions && !goalAiLoading && (
                        <span className="ml-1.5 text-[10px] text-violet-500 font-medium">based on {participant.full_name.split(' ')[0]}'s history</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={fetchGoalSuggestions}
                    disabled={goalAiLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-bold hover:bg-violet-700 disabled:opacity-60 transition-colors shrink-0"
                  >
                    {goalAiLoading
                      ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                      : goalAiSuggestions
                        ? <><Wand2 size={11} /> Regenerate</>
                        : <><Sparkles size={11} /> Suggest</>
                    }
                  </button>
                </div>

                {goalAiLoading && (
                  <div className="space-y-2 pt-0.5">
                    <div className="h-7 rounded-lg bg-violet-100/70 animate-pulse" />
                    <div className="h-7 rounded-lg bg-violet-100/50 animate-pulse w-4/5" />
                    <div className="h-7 rounded-lg bg-violet-100/40 animate-pulse w-3/5" />
                  </div>
                )}

                {!goalAiLoading && !goalAiSuggestions && (
                  <p className="text-[11px] text-violet-400">Click <strong>Suggest</strong> to get AI-generated goal names, descriptions, and success criteria based on {participant.full_name.split(' ')[0]}'s support history.</p>
                )}

                {!goalAiLoading && goalAiSuggestions && (
                  <div className="space-y-3 pt-0.5">
                    {/* Name suggestions */}
                    {goalAiSuggestions.names.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Goal names — tap to use</p>
                        <div className="flex flex-wrap gap-1.5">
                          {goalAiSuggestions.names.map((name, i) => (
                            <button key={i} type="button"
                              onClick={() => setGoalTitle(name)}
                              className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all text-left ${
                                goalTitle === name
                                  ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                                  : 'bg-white text-violet-800 border-violet-200 hover:border-violet-400 hover:bg-violet-50'
                              }`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Description suggestions */}
                    {goalAiSuggestions.descriptions.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Descriptions — tap to use</p>
                        <div className="space-y-1.5">
                          {goalAiSuggestions.descriptions.map((desc, i) => (
                            <div key={i}
                              className="group p-2.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm cursor-pointer transition-all flex items-start gap-2"
                              onClick={() => {
                                const html = desc.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
                                if (goalDescriptionRef.current) goalDescriptionRef.current.innerHTML = html;
                                setGoalDescription(desc);
                                setGoalDescriptionAiApplied(true);
                              }}
                            >
                              <p className="text-[11px] text-[#374151] leading-relaxed flex-1">{desc}</p>
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors whitespace-nowrap">
                                Use
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Success criteria suggestions */}
                    {goalAiSuggestions.success_criteria.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Success criteria — tap to use</p>
                        <div className="space-y-1.5">
                          {goalAiSuggestions.success_criteria.map((crit, i) => (
                            <div key={i}
                              className="group p-2.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm cursor-pointer transition-all flex items-start gap-2"
                              onClick={() => setGoalSuccessCriteria(crit)}
                            >
                              <p className="text-[11px] text-[#374151] leading-relaxed flex-1">{crit}</p>
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors whitespace-nowrap">
                                Use
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Goal name */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Goal name *</label>
                <input
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="e.g. Increase independence in morning routine"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>

              {/* NDIS outcome area */}
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

              {/* NDIS support category */}
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

              {/* Description — rich text editor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Description</label>
                  {goalDescriptionAiApplied && (
                    <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                      <Wand2 size={10} /> AI-suggested — edit as needed
                    </span>
                  )}
                </div>
                <div className={`rounded-lg border overflow-hidden transition-colors ${goalDescriptionAiApplied ? 'border-emerald-200' : 'border-gray-200 focus-within:border-purple-300'}`}>
                  {/* Formatting toolbar */}
                  <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-50 border-b border-gray-100">
                    <button type="button"
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); goalDescriptionRef.current?.focus(); }}
                      title="Bold"
                      className="w-7 h-6 rounded flex items-center justify-center text-[13px] font-bold text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors">B</button>
                    <button type="button"
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); goalDescriptionRef.current?.focus(); }}
                      title="Italic"
                      className="w-7 h-6 rounded flex items-center justify-center text-[13px] italic text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors">I</button>
                    <div className="w-px h-3.5 bg-gray-300 mx-0.5" />
                    <button type="button"
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList'); goalDescriptionRef.current?.focus(); }}
                      title="Bullet list"
                      className="w-7 h-6 rounded flex items-center justify-center text-[12px] text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors leading-none">•≡</button>
                  </div>
                  {/* Editable area */}
                  <div className="relative">
                    {!goalDescription && (
                      <div className="absolute top-0 left-0 right-0 px-3 py-2.5 text-[13px] text-gray-400 pointer-events-none select-none">
                        What does achieving this goal look like?
                      </div>
                    )}
                    <div
                      ref={goalDescriptionRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={() => {
                        if (goalDescriptionRef.current) {
                          const text = goalDescriptionRef.current.textContent?.trim() || '';
                          setGoalDescription(text ? goalDescriptionRef.current.innerHTML : '');
                          if (goalDescriptionAiApplied && text !== (goalAiSuggestions?.descriptions[0] ?? '')) {
                            setGoalDescriptionAiApplied(false);
                          }
                        }
                      }}
                      className="min-h-[90px] px-3 py-2.5 text-[13px] text-gray-800 outline-none [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5"
                    />
                  </div>
                </div>
              </div>

              {/* Success criteria + target date */}
              <div className="grid grid-cols-2 gap-3">
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
                    const descHtml = goalDescriptionRef.current?.textContent?.trim()
                      ? (goalDescriptionRef.current.innerHTML || null)
                      : null;
                    const payload: NdisGoalPayload = {
                      participant_id: id, name: goalTitle.trim(),
                      goal_area: goalCategory as NdisGoal["goal_area"],
                      support_category: goalSupportCategory || null,
                      description: descHtml,
                      target_date: goalTargetDate || null,
                      success_criteria: goalSuccessCriteria || null,
                      status: "active",
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
                <button type="button" onClick={() => { setCreateMode(null); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); }} title="Close" aria-label="Close" className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"><X size={16} className="text-[#9CA3AF]" /></button>
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

              {/* AI TASK ASSISTANT */}
              <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                      <Sparkles size={12} className="text-violet-600" />
                    </div>
                    <div>
                      <span className="text-[12px] font-bold text-violet-900">AI Task Assistant</span>
                      {taskAiSuggestions && !taskAiLoading && (
                        <span className="ml-1.5 text-[10px] text-violet-500 font-medium">
                          {linkedGoalId ? 'grounded in linked goal' : `based on ${participant.full_name.split(' ')[0]}'s history`}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={fetchTaskSuggestions}
                    disabled={taskAiLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-bold hover:bg-violet-700 disabled:opacity-60 transition-colors shrink-0"
                  >
                    {taskAiLoading
                      ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                      : taskAiSuggestions
                        ? <><Wand2 size={11} /> Regenerate</>
                        : <><Sparkles size={11} /> Suggest</>
                    }
                  </button>
                </div>

                {taskAiLoading && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Skeleton className="h-7 w-28 rounded-full" />
                      <Skeleton className="h-7 w-36 rounded-full" />
                      <Skeleton className="h-7 w-24 rounded-full" />
                    </div>
                    <Skeleton className="h-14 w-full rounded-lg" />
                    <Skeleton className="h-14 w-full rounded-lg" />
                  </div>
                )}

                {!taskAiLoading && taskAiSuggestions && (
                  <div className="space-y-3">
                    {taskAiSuggestions.names.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">Task name ideas — tap to use</p>
                        <div className="flex flex-wrap gap-1.5">
                          {taskAiSuggestions.names.map((name, i) => (
                            <button key={i} type="button"
                              onClick={() => { setTaskTitle(name); setTaskTitleAiApplied(true); }}
                              className="px-2.5 py-1 rounded-full bg-white border border-violet-200 text-[11px] font-semibold text-violet-800 hover:border-violet-400 hover:bg-violet-50 transition-colors text-left">
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {taskAiSuggestions.instructions.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">Worker instructions — tap to use</p>
                        <div className="space-y-1.5">
                          {taskAiSuggestions.instructions.map((instr, i) => (
                            <div key={i}
                              className="group p-2.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm cursor-pointer transition-all flex items-start gap-2"
                              onClick={() => { setTaskInstructions(instr); setTaskInstructionsAiApplied(true); }}
                            >
                              <p className="text-[11px] text-[#374151] leading-relaxed flex-1">{instr}</p>
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors whitespace-nowrap">
                                Use
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(taskAiSuggestions.category || taskAiSuggestions.priority) && (
                      <div className="flex items-center gap-1.5 pt-1 border-t border-violet-100">
                        <Wand2 size={10} className="text-violet-500 shrink-0" />
                        <p className="text-[10px] text-violet-600">Category and priority pre-filled from AI — adjust below if needed</p>
                      </div>
                    )}
                  </div>
                )}

                {!taskAiLoading && !taskAiSuggestions && (
                  <p className="text-[11px] text-violet-500/80 text-center py-0.5">
                    {taskPurpose === 'goal' && linkedGoalId
                      ? 'Get task ideas grounded in the linked goal'
                      : 'Get AI-powered task name and instruction suggestions'}
                  </p>
                )}
              </div>

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
                <button type="button" onClick={() => { setCreateMode(null); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); }}
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold text-[#111827]">Goals & Tasks</h3>
                  <p className="text-[12px] text-[#6B7280] mt-0.5">Manage {participant.full_name}'s NDIS goals and support tasks</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button type="button"
                    onClick={() => { setCreateMode("goal"); setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalSupportCategory(""); setEditingGoal(null); setGoalDescriptionAiApplied(false); setGoalAiSuggestions(null); setGoalAiLoading(false); }}
                    className="h-9 px-3 text-[12px] font-bold rounded-lg border border-purple-200 bg-white text-purple-700 hover:bg-purple-50">
                    + Goal
                  </button>
                  <button type="button"
                    onClick={() => { setCreateMode("tasks"); setTaskTitle(""); setTaskInstructions(""); setLinkedGoalId(null); setTaskPurpose("core"); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); }}
                    className="h-9 px-3 text-[12px] font-bold rounded-lg bg-[#3730A3] text-white hover:bg-[#312E81]">
                    + Task
                  </button>
                  <button type="button" onClick={() => setShiftModalOpen(true)}
                    className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-bold rounded-lg bg-[#3730A3] text-white hover:bg-[#312E81]">
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
                    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <Target size={15} className="shrink-0 mt-0.5 text-[#3730A3]" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-[#111827] leading-snug break-words">{goal.name}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: areaStyle.bg, color: areaStyle.color }}>
                              {areaStyle.label}
                            </span>
                            <span className="text-[10px] text-[#6B7280]">{goalTasks.length} task{goalTasks.length !== 1 ? "s" : ""}</span>
                            {goal.target_date && <span className="text-[10px] text-[#6B7280]">Due {goal.target_date}</span>}
                          </div>
                          {goal.description && <p className="text-[11px] text-[#6B7280] mt-1 leading-relaxed line-clamp-2 [&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic" dangerouslySetInnerHTML={{ __html: goal.description }} />}
                          {goal.success_criteria && (
                            <p className="text-[11px] mt-1 px-2 py-1 rounded-lg bg-purple-50 text-[#6B7280]">
                              <span className="font-bold text-[#374151]">Success: </span>{goal.success_criteria}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0 sm:justify-end">
                        <button type="button" onClick={() => { setCreateMode("tasks"); setLinkedGoalId(goal.id); setTaskTitle(""); setTaskInstructions(""); setTaskPurpose("goal"); setTaskInstructionsAiApplied(false); }}
                          className="h-9 px-2.5 text-[11px] font-bold rounded border border-purple-200 text-purple-700 hover:bg-purple-50">
                          + Task
                        </button>
                        <button type="button" onClick={() => startEditGoal(goal)}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-gray-100" title="Edit goal">
                          <Edit2 size={14} className="text-[#6B7280]" />
                        </button>
                        <button type="button" onClick={() => completeGoalMut.mutate(goal.id)} disabled={completeGoalMut.isPending}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-green-50" title="Mark completed">
                          <CheckCircle2 size={14} className="text-[#059669]" />
                        </button>
                        <button type="button" onClick={() => archiveGoalMut.mutate(goal.id)} disabled={archiveGoalMut.isPending}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-gray-100" title="Archive goal">
                          <Archive size={14} className="text-[#6B7280]" />
                        </button>
                        <button type="button"
                          onClick={() => setProgressGoalId((prev) => prev === goal.id ? null : goal.id)}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-purple-50" title="View progress">
                          <BarChart2 size={14} className={progressGoalId === goal.id ? "text-[#3730A3]" : "text-[#6B7280]"} />
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
    <div className="flex h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-8rem)] gap-0 md:gap-4 overflow-hidden -mx-4 md:mx-0">

      {/* ── Left panel — participant list ─────────────────────────────── */}
      <div
        className={`${showMobileDetail ? "hidden lg:flex" : "flex"} w-full lg:w-[300px] xl:w-[330px] shrink-0 flex-col rounded-none md:rounded-2xl overflow-hidden`}
        style={{ background: "var(--cc-bg)", border: showMobileDetail ? "none" : "1px solid var(--cc-border)" }}
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
        className={`${showMobileDetail ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col rounded-none lg:rounded-2xl overflow-hidden border-0 lg:border`}
        style={{ background: "var(--cc-bg)", borderColor: "var(--cc-border)" }}
      >
        {selectedId ? (
          <>
            {/* Mobile back button */}
            <button
              type="button"
              className="lg:hidden flex items-center gap-2 text-[13px] font-semibold px-3 py-2.5 shrink-0 transition-colors min-h-[44px]"
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
