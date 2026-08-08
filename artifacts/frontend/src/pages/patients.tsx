import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getNdisGoals, createNdisGoal, archiveNdisGoal, completeNdisGoal, updateNdisGoal, getGoalProgress,
  getParticipantTasks, createParticipantTask, deleteParticipantTask, getCoordinatorWorkerStats,
  getParticipantBillingPeriods, getParticipantCurrentBillingPeriod, planManagementTypeLabel,
  getTaskTemplates,
  type NdisGoal, type NdisGoalPayload, type ParticipantTask, type ParticipantTaskPayload, type GoalProgressResponse, type WorkerStats,
  type BillingPeriod, type TaskTemplate as DbTaskTemplate, type TaskTemplatesResponse,
} from "@/services/coordinatorService";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { TaskTemplatePanel } from "@/components/coordinator/TaskTemplatePanel";
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
  MessageSquare,
  Mic,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LayoutTemplate,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SmartInput } from "@/components/SmartInput";
import { ParticipantShiftContextEditor } from "@/components/participants/ParticipantShiftContextEditor";
import { ParticipantOverviewTab } from "@/components/participants/ParticipantOverviewTab";
import { ParticipantPlanTab } from "@/components/participants/ParticipantPlanTab";
import { ParticipantComplianceTab } from "@/components/participants/ParticipantComplianceTab";
import { ParticipantPlanMeetingsTab } from "@/components/participants/ParticipantPlanMeetingsTab";
import { ParticipantRestrictedTab, type RestrictedClinicalDraft } from "@/components/participants/ParticipantRestrictedTab";
import { ParticipantShiftContextTab } from "@/components/participants/ParticipantShiftContextTab";
import { ParticipantMedicationsPanel } from "@/components/participants/ParticipantMedicationsPanel";
import { getParticipantMedications } from "@/services/medicationService";
import { ParticipantClinicalRecordEditor } from "@/components/participants/ParticipantClinicalRecordEditor";
import { ParticipantSessionsTab } from "@/components/participants/ParticipantSessionsTab";
import { PlanMeetingCapture } from "@/components/coordinator/PlanMeetingCapture";
import { safeFormat, money, statusBadge, complianceTone, normalizeGoalTitle } from "@/lib/participant-format";
import { FormPanel } from "@/components/FormPanel";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
// ---------------------------------------------------------------------------
// Template Presets (backed by participant_task_templates via getTaskTemplates)
// ---------------------------------------------------------------------------

// The task-creation form only offers these category/evidence options; DB templates
// (seeded with a richer vocabulary, e.g. "meal_prep", "voice") are normalized down
// to the closest valid form option so the select never ends up on a hidden value.
type TaskFormCategory = "personal_care" | "medication" | "domestic_assistance" | "community_access" | "transport" | "other";
type TaskFormEvidence = "none" | "photo" | "notes" | "photo_and_notes";

const TASK_FORM_CATEGORY_MAP: Record<string, TaskFormCategory> = {
  personal_care: "personal_care",
  meal_prep: "personal_care",
  medication: "medication",
  health_wellness: "personal_care",
  domestic_assistance: "domestic_assistance",
  community_access: "community_access",
  transport: "transport",
  documentation: "other",
};

const TASK_FORM_EVIDENCE_MAP: Record<string, TaskFormEvidence> = {
  none: "none",
  photo: "photo",
  notes: "notes",
  photo_and_notes: "photo_and_notes",
  voice: "notes",
  photo_and_voice: "photo_and_notes",
};

function normalizeTemplateCategory(category?: string | null): TaskFormCategory {
  return (category && TASK_FORM_CATEGORY_MAP[category]) || "personal_care";
}

function normalizeTemplateEvidence(evidence?: string | null): TaskFormEvidence {
  return (evidence && TASK_FORM_EVIDENCE_MAP[evidence]) || "none";
}


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

export type ParticipantRecord = {
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

export type SessionRecord = {
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

export type BudgetSummary = {
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

export type ComplianceHistoryItem = {
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

// Helpers moved to @/lib/participant-format (imported at top of file) so extracted
// tab components (components/participants/*) can share them without importing this page.

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
      plan_status: (participant.plan_status ?? "active") as ParticipantFormValues["plan_status"],
      plan_management_type: (participant.plan_management_type ?? "") as ParticipantFormValues["plan_management_type"],
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
      plan_status: (participant.plan_status ?? "active") as ParticipantFormValues["plan_status"],
      plan_management_type: (participant.plan_management_type ?? "") as ParticipantFormValues["plan_management_type"],
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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{translate("patients.editTitle")}</SheetTitle>
          </SheetHeader>
          <ParticipantForm
            form={editForm}
            onSubmit={(data) => updateMutation.mutate(data)}
            isPending={updateMutation.isPending}
            onCancel={() => setOpen(false)}
            hasPlan={hasPlan}
            submitLabel={translate("patients.saveChanges")}
          />
        </SheetContent>
      </Sheet>
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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{hasPlan ? "Edit Plan Details" : translate("patients.setupPlan")}</SheetTitle>
          </SheetHeader>
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
                  <p className="text-[12px] text-[#6A6A77]">
                    Save the plan details above first. Category budgets can be added once the plan exists.
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
                            <p className="text-[12px] font-bold text-[#1A1A2E] truncate">{b.category_label || b.category}</p>
                            <p className="text-[10px] text-[#6A6A77]">
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
                      <p className="text-[12px] text-[#6A6A77] text-center py-1">
                        All available support categories already have a budget. Use the edit button on a row above to change an allocation.
                      </p>
                    ) : (
                      <>
                        {editingCategory ? (
                          <div className="flex h-9 items-center rounded-md border border-purple-100/60 bg-[#FDFCFF] px-3 text-[12px] font-medium text-[#1A1A2E]">
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

              <SheetFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createPlan.isPending}>
                  {createPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {hasPlan ? "Update Plan" : translate("patients.savePlan")}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail Wrapper Component
// ---------------------------------------------------------------------------

type ParticipantDetailTab = "overview" | "plan_goals" | "sessions" | "compliance" | "plan_meetings" | "care_profile";

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

  // UI state — collapsible header + inline shift detail
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  // Session detail panel — opens full session detail in-context instead of navigating away
  const [sessionPanelId, setSessionPanelId] = useState<string | null>(null);

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

  const taskTemplatesQuery = useOrgQuery<TaskTemplatesResponse>(["participant", id, "task-templates"], {
    queryFn: () => getTaskTemplates(id),
    enabled: isCoordinator,
  });
  const taskTemplates = [...(taskTemplatesQuery.data?.system_tasks ?? []), ...(taskTemplatesQuery.data?.custom_tasks ?? [])];
  const [templatesGoalId, setTemplatesGoalId] = useState<string | null>(null);

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
    onError: (err: Error) => toastFn({ title: err.message || "Failed to create goal", variant: "destructive" }),
  });

  const editGoalMut = useMutation({
    mutationFn: ({ goalId, payload }: { goalId: string; payload: NdisGoalPayload }) => updateNdisGoal(goalId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant", id, "ndis-goals"] });
      setCreateMode(null); setEditingGoal(null);
      setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalDescriptionAiApplied(false);
    },
    onError: (err: Error) => toastFn({ title: err.message || "Failed to update goal", variant: "destructive" }),
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
      setTaskTitle(""); setTaskInstructions(""); setLinkedGoalId(null); setTaskPurpose("core"); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null);
    },
    onError: (err: Error) => toastFn({ title: err.message || "Failed to create task", variant: "destructive" }),
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
  const pendingMedicationsQuery = useOrgQuery(["participant-medications-pending", id], {
    queryFn: () => getParticipantMedications(id, "pending_verification"),
    enabled: isCoordinator,
  });
  const [restrictedDraft, setRestrictedDraft] = useState<RestrictedClinicalDraft | null>(null);
  useEffect(() => {
    if (restrictedQuery.data && restrictedDraft === null) {
      setRestrictedDraft({
        restricted_behavioural_notes: restrictedQuery.data.restricted_behavioural_notes ?? "",
        behaviour_support_plan: restrictedQuery.data.behaviour_support_plan ?? "",
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
  const [careProfileSection, setCareProfileSection] = useState<"context" | "clinical">("context");
  const [planGoalsSection, setPlanGoalsSection] = useState<"plan" | "goals">("plan");
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
  const [appliedTemplate, setAppliedTemplate] = useState<DbTaskTemplate | null>(null);

  const applyTaskTemplate = (template: DbTaskTemplate) => {
    setTaskTitle(template.name);
    setTaskInstructions(template.description || "");
    setTaskCategory(normalizeTemplateCategory(template.category));
    setTaskShiftType((template.primary_shift_type as any) || "morning");
    setTaskPriority((template.priority as any) || "medium");
    setTaskEvidenceRequired(normalizeTemplateEvidence(template.evidence_required));
    setIsMandatory(template.is_mandatory);
    setTaskTitleAiApplied(true);
    setTaskInstructionsAiApplied(true);
    setAppliedTemplate(template);
  };

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
  const pendingMedicationCount = pendingMedicationsQuery.data?.medications.length ?? 0;

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
      tone: isOverspent ? "bg-red-50 text-red-700 border-red-200" : "bg-purple-50 text-[#E8457A] border-purple-100",
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
      linkLabel: pendingMedicationCount > 0
        ? translateParams("patients.metric.pendingMedications", { count: String(pendingMedicationCount) })
        : undefined,
      onLinkClick: () => { setActiveTab("care_profile"); setCareProfileSection("clinical"); },
    },
  ];

  const initials = participant.full_name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const TABS = [
    { id: "overview"   as const, label: translate("patients.tab.overview"),   shortLabel: "Overview",  icon: UserCircle   },
    { id: "plan_goals" as const, label: "Plan & Goals", shortLabel: "Plan", icon: DollarSign },
    { id: "sessions"   as const, label: "Shift History",                       shortLabel: "Shifts",    icon: CalendarDays },
    { id: "compliance" as const, label: translate("patients.tab.compliance"),  shortLabel: "Compliance", icon: ShieldCheck  },
    ...(isCoordinator ? [{ id: "care_profile"  as const, label: "Care Profile", shortLabel: "Care",     icon: ClipboardList  }] : []),
    ...(isCoordinator ? [{ id: "plan_meetings" as const, label: "Easy Capture",  shortLabel: "Meetings", icon: Mic, isNew: true }] : []),
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
          <div className="w-11 h-11 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#E8457A] flex items-center justify-center text-white text-sm font-black shrink-0 select-none">
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
              <p className="hidden sm:block text-[11px] text-[#6A6A77] leading-relaxed mt-2" style={{ color: "var(--cc-muted)" }}>
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
          {/* Header collapse toggle */}
          <button
            type="button"
            onClick={() => setHeaderCollapsed(c => !c)}
            className="h-7 w-7 rounded-full flex items-center justify-center transition-colors shrink-0 ml-1"
            style={{ background: "var(--cc-soft)", color: "var(--cc-muted)" }}
            title={headerCollapsed ? "Show stats" : "Hide stats"}
          >
            {headerCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>

        {/* Collapsible body — stat cards + mobile action buttons */}
        {!headerCollapsed && (
          <>
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
                    {metric.linkLabel && (
                      <button
                        type="button"
                        onClick={metric.onLinkClick}
                        className="mt-1 flex items-center gap-0.5 text-[10px] font-bold underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
                      >
                        {metric.linkLabel} <ChevronRight className="h-2.5 w-2.5" />
                      </button>
                    )}
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
          </>
        )}

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
                    ? "border-[#E8457A] text-[#E8457A]"
                    : "border-transparent text-[#6A6A77] hover:text-[#1A1A2E] hover:border-[#E8E8EA]"
                }`}
              >
                <Icon size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
                {"isNew" in tab && tab.isNew && (
                  <span
                    className="rounded-full px-1.5 py-[1px] text-[9px] font-black uppercase tracking-wide text-white"
                    style={{ background: "var(--cc-coral)" }}
                  >
                    New
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 pb-6">

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <ParticipantOverviewTab
            participant={participant}
            budget={budget}
            totalBudget={totalBudget}
            isCoordinator={isCoordinator}
            billingPeriodCurrent={billingPeriodCurrentQuery.data}
            billingPeriodCurrentLoading={billingPeriodCurrentQuery.isLoading}
            billingPeriodHistory={billingPeriodsQuery.data?.items}
          />
        )}

        {activeTab === "plan_goals" && (
          <>
            {/* Segmented section switcher */}
            <div className="flex rounded-xl overflow-hidden border mb-5" style={{ borderColor: "var(--cc-border)", background: "var(--cc-soft)" }}>
              <button type="button" onClick={() => setPlanGoalsSection("plan")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: planGoalsSection === "plan" ? "var(--cc-bg)" : "transparent",
                  color: planGoalsSection === "plan" ? "var(--cc-text)" : "var(--cc-muted)",
                  boxShadow: planGoalsSection === "plan" ? "var(--cc-card-shadow)" : "none",
                  margin: planGoalsSection === "plan" ? 3 : 0,
                  borderRadius: planGoalsSection === "plan" ? "0.6rem" : 0,
                }}
              >
                <DollarSign size={14} strokeWidth={1.8} />
                Plan &amp; Budget
              </button>
              <button type="button" onClick={() => setPlanGoalsSection("goals")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: planGoalsSection === "goals" ? "var(--cc-bg)" : "transparent",
                  color: planGoalsSection === "goals" ? "var(--cc-text)" : "var(--cc-muted)",
                  boxShadow: planGoalsSection === "goals" ? "var(--cc-card-shadow)" : "none",
                  margin: planGoalsSection === "goals" ? 3 : 0,
                  borderRadius: planGoalsSection === "goals" ? "0.6rem" : 0,
                }}
              >
                <Target size={14} strokeWidth={1.8} />
                Goals &amp; Tasks
              </button>
            </div>

            {planGoalsSection === "plan" && (
              <ParticipantPlanTab
                budget={budget}
                isLoading={budgetQuery.isLoading}
                totalBudget={totalBudget}
                usedBudget={usedBudget}
                remainingBudget={remainingBudget}
                isOverspent={isOverspent}
                hasCategoryBudgets={hasCategoryBudgets}
                categoryBudgets={categoryBudgets}
              />
            )}
          </>
        )}

        {/* GOALS & TASKS (inside Plan & Goals tab) */}
        {activeTab === "plan_goals" && planGoalsSection === "goals" && isCoordinator && (() => {
          const AREA_COLORS: Record<string, { bg: string; color: string; label: string }> = {
            daily_living: { bg: "#EFF6FF", color: "#1D4ED8", label: "Daily Living" },
            community:    { bg: "#F0FDF4", color: "#15803D", label: "Community"    },
            health:       { bg: "#FEF2F2", color: "#DC2626", label: "Health"       },
            social:       { bg: "#FDF4FF", color: "#7E22CE", label: "Social"       },
            employment:   { bg: "#FFFBEB", color: "#D97706", label: "Employment"   },
            other:        { bg: "#F3F4F6", color: "#6A6A77", label: "Other"        },
          };

          type SupportCatMeta = { label: string; bg: string; color: string };
          const SUPPORT_CATS: Record<string, SupportCatMeta> = {
            core_daily_activities: { label: "Daily Activities",   bg: "#EFF6FF", color: "#1D4ED8" },
            core_transport:        { label: "Transport",          bg: "#EFF6FF", color: "#1D4ED8" },
            core_consumables:      { label: "Consumables",        bg: "#EFF6FF", color: "#1D4ED8" },
            core_social_community: { label: "Social & Community", bg: "#EFF6FF", color: "#1D4ED8" },
          };

          function SupportCategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
            return (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(SUPPORT_CATS).map(([k, m]) => {
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
            );
          }

          const activeGoals = ndisGoals.filter((g) => g.status === "active");
          const doneGoals   = ndisGoals.filter((g) => g.status !== "active");
          const goalsNeedingCategory = activeGoals.filter((g) => !g.support_category);

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
            <div className="space-y-4">
              {/* AI Goal Assistant panel */}
              <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                      <Sparkles size={12} className="text-violet-600" />
                    </div>
                    <div>
                      <span className="text-[12px] font-bold text-violet-800">AI Goal Assistant</span>
                      {goalAiSuggestions && !goalAiLoading && (
                        <span className="ml-1.5 text-[10px] text-violet-700 font-medium">based on {participant.full_name.split(' ')[0]}'s history</span>
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
                  <p className="text-[11px] text-violet-700">Click <strong>Suggest</strong> to get AI-generated goal names, descriptions, and success criteria based on {participant.full_name.split(' ')[0]}'s support history.</p>
                )}

                {!goalAiLoading && goalAiSuggestions && (
                  <div className="space-y-3 pt-0.5">
                    {/* Name suggestions */}
                    {goalAiSuggestions.names.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Goal names, tap to use</p>
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
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Descriptions, tap to use</p>
                        <div className="space-y-1.5">
                          {goalAiSuggestions.descriptions.map((desc, i) => (
                            <div key={i}
                              className="group p-2.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm cursor-pointer transition-all flex items-start gap-2"
                              onClick={() => {
                                const html = desc.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
                                if (goalDescriptionRef.current) goalDescriptionRef.current.innerHTML = html;
                                setGoalDescription(html);
                                setGoalDescriptionAiApplied(true);
                              }}
                            >
                              <p className="text-[11px] leading-relaxed flex-1" style={{ color: "var(--cc-text)" }}>{desc}</p>
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
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Success criteria, tap to use</p>
                        <div className="space-y-1.5">
                          {goalAiSuggestions.success_criteria.map((crit, i) => (
                            <div key={i}
                              className="group p-2.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm cursor-pointer transition-all flex items-start gap-2"
                              onClick={() => setGoalSuccessCriteria(crit)}
                            >
                              <p className="text-[11px] leading-relaxed flex-1" style={{ color: "var(--cc-text)" }}>{crit}</p>
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

              {/* Goal task linkage hint */}
              {goalCategory && (
                <div className="text-[10px] text-[#6A6A77] bg-purple-50 rounded-lg p-3 border border-purple-100">
                  <p className="text-purple-600">
                    Once this goal is created, you can add tasks and link them to it from the goal's "Add task" action.
                  </p>
                </div>
              )}

              {/* NDIS support category */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">
                  NDIS support category <span className="text-red-500">*</span>
                  <span className="ml-1.5 normal-case font-normal text-[#9CA3AF]">Which funded budget line does this goal draw from?</span>
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
                      <Wand2 size={10} /> AI-suggested, edit as needed
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
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-[12px] font-bold text-[#6A6A77] hover:bg-gray-50">Cancel</button>
                <button type="button"
                  disabled={!goalTitle.trim() || !goalSupportCategory || createGoalMut.isPending || editGoalMut.isPending}
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
                  className="flex-1 rounded-lg bg-[#E8457A] py-2.5 text-[12px] font-bold text-white hover:bg-[#312E81] disabled:opacity-50">
                  {(createGoalMut.isPending || editGoalMut.isPending) ? "Saving…" : createMode === "edit_goal" ? "Update goal" : "Create goal"}
                </button>
              </div>
            </div>
          );

          const taskFormContent = (
            <div className="space-y-5">

              {/* AI TASK ASSISTANT */}
              <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                      <Sparkles size={12} className="text-violet-600" />
                    </div>
                    <div>
                      <span className="text-[12px] font-bold text-violet-800">AI Task Assistant</span>
                      {taskAiSuggestions && !taskAiLoading && (
                        <span className="ml-1.5 text-[10px] text-violet-700 font-medium">
                          based on {participant.full_name.split(' ')[0]}'s history
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
                        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">Task name ideas, tap to use</p>
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
                        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">Worker instructions, tap to use</p>
                        <div className="space-y-1.5">
                          {taskAiSuggestions.instructions.map((instr, i) => (
                            <div key={i}
                              className="group p-2.5 rounded-lg bg-white border border-violet-100 hover:border-violet-300 hover:shadow-sm cursor-pointer transition-all flex items-start gap-2"
                              onClick={() => { setTaskInstructions(instr); setTaskInstructionsAiApplied(true); }}
                            >
                              <p className="text-[11px] leading-relaxed flex-1" style={{ color: "var(--cc-text)" }}>{instr}</p>
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
                        <p className="text-[10px] text-violet-600">Category and priority pre-filled from AI, adjust below if needed</p>
                      </div>
                    )}
                  </div>
                )}

                  {!taskAiLoading && !taskAiSuggestions && (
                  <p className="text-[11px] text-violet-500/80 text-center py-0.5">
                    Get AI-powered task name and instruction suggestions
                  </p>
                )}
              </div>

              {/* TEMPLATE PRESETS */}
              <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-4">
                <label className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">Quick-start templates</label>

                {/* System templates */}
                <div className="space-y-2">
                  <p className="text-[10px] text-[#6A6A77]">Or start with a system task template:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {taskTemplatesQuery.isLoading ? (
                      <p className="text-[10px] text-[#9CA3AF]">Loading templates…</p>
                    ) : (taskTemplatesQuery.data?.system_tasks ?? []).length === 0 ? (
                      <p className="text-[10px] text-[#9CA3AF]">No system templates configured</p>
                    ) : (
                      (taskTemplatesQuery.data?.system_tasks ?? []).map(template => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTaskTemplate(template)}
                          className="rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                        >
                          {template.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Goal-linked templates (conditional) */}
                {linkedGoalId && (
                  <div className="space-y-2 border-t border-blue-200 pt-2">
                    <p className="text-[10px] text-[#6A6A77]">Or use a template linked to this goal:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const templates = taskTemplates.filter(t => t.linked_goal_id === linkedGoalId);
                        if (templates.length === 0) {
                          return (
                            <p className="text-[10px] text-[#9CA3AF]">
                              No templates linked to this goal yet — manage templates in Task Templates.
                            </p>
                          );
                        }
                        return templates.map(template => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => applyTaskTemplate(template)}
                            className="rounded-full border border-purple-300 bg-white px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50 transition-colors"
                          >
                            {template.name}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
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
                          : "border-gray-200 bg-white text-[#6A6A77] hover:border-gray-300"
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
                          : "border-gray-200 bg-white text-[#6A6A77] hover:border-gray-300"
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
                {appliedTemplate && <p className="text-[10px] text-emerald-600 flex items-center gap-1 pt-1"><CheckCircle2 size={12} /> Applied from template: {appliedTemplate.name}</p>}
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setCreateMode(null); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null); }}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-[12px] font-bold text-[#6A6A77] hover:bg-gray-50">Cancel</button>
                <button type="button" disabled={!taskTitle.trim() || createTaskMut.isPending}
                  onClick={() => createTaskMut.mutate({
                    name: taskTitle.trim(),
                    description: taskInstructions || null,
                    goal_id: linkedGoalId,
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
            <>
            <section className="space-y-4">
              {/* Header — spans full width */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold text-[#1A1A2E]">Goals & Tasks</h3>
                  <p className="text-[12px] text-[#6A6A77] mt-0.5">Manage {participant.full_name}'s NDIS goals and support tasks</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button type="button"
                    onClick={() => { setCreateMode("goal"); setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalSupportCategory(""); setEditingGoal(null); setGoalDescriptionAiApplied(false); setGoalAiSuggestions(null); setGoalAiLoading(false); }}
                    className="h-9 px-3 text-[12px] font-bold rounded-lg border border-purple-200 bg-white text-purple-700 hover:bg-purple-50">
                    + Goal
                  </button>
                  <button type="button" onClick={() => setShiftModalOpen(true)}
                    className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-bold rounded-lg bg-[#E8457A] text-white hover:bg-[#312E81]">
                    <CalendarClock size={13} /> Assign Shift
                  </button>
                </div>
              </div>

              {/* Content: Goals & Tasks list (full width) */}
              <div className="space-y-4">
                  {/* Goals missing support category — coordinator review */}
              {goalsNeedingCategory.length > 0 && createMode !== "goal" && createMode !== "edit_goal" && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/80 p-4 space-y-2">
                  <p className="text-[12px] font-bold text-amber-900">
                    {goalsNeedingCategory.length} goal{goalsNeedingCategory.length !== 1 ? "s" : ""} need a support category
                  </p>
                  <p className="text-[11px] text-amber-800">
                    Link each goal to a funded NDIS budget line so billing and reporting stay accurate.
                  </p>
                  <div className="space-y-1.5">
                    {goalsNeedingCategory.map((goal) => (
                      <div key={goal.id} className="flex items-center justify-between gap-2 rounded-md border border-amber-100 bg-white px-3 py-2">
                        <span className="text-[12px] font-semibold text-[#1A1A2E] truncate">{goal.name}</span>
                        <button
                          type="button"
                          onClick={() => startEditGoal(goal)}
                          className="shrink-0 text-[11px] font-bold text-amber-900 underline-offset-2 hover:underline"
                        >
                          Assign category
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Loading */}
              {ndisGoalsQuery.isLoading && (
                <div className="flex items-center gap-2 py-4 text-[13px] text-[#6A6A77]"><Loader2 size={14} className="animate-spin" /> Loading goals…</div>
              )}

              {/* Empty state */}
              {!ndisGoalsQuery.isLoading && activeGoals.length === 0 && createMode !== "goal" && (
                <div className="rounded-lg border border-purple-100/60 bg-purple-50/40 p-6 text-center">
                  <Target className="h-8 w-8 text-[#6A6A77] opacity-30 mx-auto mb-2" />
                  <p className="text-[13px] font-bold text-[#1A1A2E]">No active goals</p>
                  <p className="text-[12px] text-[#6A6A77] mt-1">Click <strong>+ Goal</strong> to create the first NDIS goal for {participant.full_name}.</p>
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
                        <Target size={15} className="shrink-0 mt-0.5 text-[#E8457A]" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-[#1A1A2E] leading-snug break-words">{goal.name}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: areaStyle.bg, color: areaStyle.color }}>
                              {areaStyle.label}
                            </span>
                            <span className="text-[10px] text-[#6A6A77]">{goalTasks.length} task{goalTasks.length !== 1 ? "s" : ""}</span>
                            {!goal.support_category && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                Needs category
                              </span>
                            )}
                            {goal.target_date && <span className="text-[10px] text-[#6A6A77]">Due {goal.target_date}</span>}
                          </div>
                          {goal.description && <p className="text-[11px] text-[#6A6A77] mt-1 leading-relaxed line-clamp-2 [&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic" dangerouslySetInnerHTML={{ __html: goal.description }} />}
                          {goal.success_criteria && (
                            <p className="text-[11px] mt-1 px-2 py-1 rounded-lg bg-purple-50 text-[#6A6A77]">
                              <span className="font-bold text-[#374151]">Success: </span>{goal.success_criteria}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0 sm:justify-end">
                        <button type="button" onClick={() => { setCreateMode("tasks"); setLinkedGoalId(goal.id); setTaskTitle(""); setTaskInstructions(""); setTaskPurpose("goal"); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null); }}
                          className="h-9 px-2.5 text-[11px] font-bold rounded border border-purple-200 text-purple-700 hover:bg-purple-50">
                          + Task
                        </button>
                        <button type="button" onClick={() => startEditGoal(goal)}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-gray-100" title="Edit goal">
                          <Edit2 size={14} className="text-[#6A6A77]" />
                        </button>
                        <button type="button" onClick={() => completeGoalMut.mutate(goal.id)} disabled={completeGoalMut.isPending}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-green-50" title="Mark completed">
                          <CheckCircle2 size={14} className="text-[#059669]" />
                        </button>
                        <button type="button" onClick={() => archiveGoalMut.mutate(goal.id)} disabled={archiveGoalMut.isPending}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-gray-100" title="Archive goal">
                          <Archive size={14} className="text-[#6A6A77]" />
                        </button>
                        <button type="button"
                          onClick={() => setProgressGoalId((prev) => prev === goal.id ? null : goal.id)}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-purple-50" title="View progress">
                          <BarChart2 size={14} className={progressGoalId === goal.id ? "text-[#E8457A]" : "text-[#6A6A77]"} />
                        </button>
                        <button type="button"
                          onClick={() => setTemplatesGoalId((prev) => prev === goal.id ? null : goal.id)}
                          className="h-9 w-9 flex items-center justify-center rounded hover:bg-purple-50" title="Manage task templates">
                          <LayoutTemplate size={14} className={templatesGoalId === goal.id ? "text-[#E8457A]" : "text-[#6A6A77]"} />
                        </button>
                      </div>
                    </div>

                    {/* Task template management for this goal */}
                    {templatesGoalId === goal.id && (
                      <div className="border-t border-purple-100/60 px-4 py-3 bg-purple-50/30">
                        <TaskTemplatePanel
                          participantId={id}
                          goal={goal}
                          templates={taskTemplates}
                          onTemplatesChanged={() => taskTemplatesQuery.refetch()}
                        />
                      </div>
                    )}

                    {/* Progress panel */}
                    {progressGoalId === goal.id && (
                      <div className="border-t border-purple-100/60 px-4 py-3 bg-purple-50/30">
                        {progressLoading && <p className="text-[12px] text-[#6A6A77] flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading progress…</p>}
                        {progressData && (
                          <div className="space-y-3">
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#6A6A77]">Progress: Last 30 Days</p>
                            <div className="grid grid-cols-3 gap-2">
                              {([["Sessions", progressData.sessions_count], ["With Evidence", progressData.evidence_count], ["Evidence Rate", `${pct}%`]] as [string, string | number][]).map(([l, v]) => (
                                <div key={l} className="rounded-lg px-3 py-2 bg-white border border-purple-100/60 text-center">
                                  <p className="text-[15px] font-black text-[#E8457A]">{v}</p>
                                  <p className="text-[9px] font-semibold text-[#6A6A77]">{l}</p>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="flex justify-between text-[10px] font-semibold mb-1 text-[#6A6A77]"><span>Evidence rate</span><span>{pct}%</span></div>
                              <div className="h-1.5 rounded-full overflow-hidden bg-purple-100">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 70 ? "#22C55E" : pct >= 40 ? "#F59E0B" : "#EF4444" }} />
                              </div>
                            </div>
                            {progressData.sessions.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-[#6A6A77]">Recent Sessions</p>
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
                                <p className="text-[12px] font-semibold text-[#1A1A2E] truncate">{task.name}</p>
                                {task.description && <p className="text-[11px] text-[#6A6A77] truncate">{task.description}</p>}
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
                        <p className="text-[11px] text-[#9CA3AF] italic">No tasks yet. Click + Task to add one</p>
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
                    <h4 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest px-1">Core support, not linked to a goal</h4>
                    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                      {coreTasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClipboardList size={13} className="shrink-0 text-[#6A6A77]" />
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-[#1A1A2E] truncate">{task.name}</p>
                              {task.description && <p className="text-[11px] text-[#6A6A77] truncate">{task.description}</p>}
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
                    className="flex items-center gap-1.5 text-[11px] font-bold text-[#6A6A77] hover:text-[#374151] px-1">
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
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${goal.status === "completed" ? "bg-green-50 text-green-700" : "bg-gray-100 text-[#6A6A77]"}`}>
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
            </div>
            </section>

            {/* Goal & Task Form Panels - Fixed right-side overlay */}
            <FormPanel
              isOpen={createMode === "goal" || createMode === "edit_goal"}
              title={createMode === "edit_goal" ? "Edit goal" : "New NDIS goal"}
              subtitle={participant.full_name}
              onClose={cancelGoalForm}
              showLogo={false}
            >
              {goalFormContent}
            </FormPanel>

            <FormPanel
              isOpen={createMode === "tasks"}
              title="Create New Task"
              subtitle={`Setting up support for ${participant.full_name}`}
              onClose={() => { setCreateMode(null); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null); }}
              showLogo={false}
            >
              {taskFormContent}
            </FormPanel>
            </>
          );
        })()}

        {/* SESSIONS TAB */}
        {activeTab === "sessions" && (
          <ParticipantSessionsTab
            sessions={sessions}
            isLoading={sessionsQuery.isLoading}
            sessionPanelId={sessionPanelId}
            onSessionPanelIdChange={setSessionPanelId}
          />
        )}
        {activeTab === "compliance" && (
          <ParticipantComplianceTab
            complianceHistory={complianceHistory}
            averageCompliance={averageCompliance}
            isLoading={complianceQuery.isLoading}
            onSelectSession={setSessionPanelId}
          />
        )}

        {activeTab === "plan_meetings" && isCoordinator && (
          <ParticipantPlanMeetingsTab participantId={id} participantName={participant.full_name} />
        )}

        {activeTab === "care_profile" && isCoordinator && (
          <div className="space-y-0">
            {/* Segmented section switcher */}
            <div className="flex rounded-xl overflow-hidden border mb-6" style={{ borderColor: "var(--cc-border)", background: "var(--cc-soft)" }}>
              <button
                type="button"
                onClick={() => setCareProfileSection("context")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: careProfileSection === "context" ? "var(--cc-bg)" : "transparent",
                  color: careProfileSection === "context" ? "var(--cc-text)" : "var(--cc-muted)",
                  boxShadow: careProfileSection === "context" ? "var(--cc-card-shadow)" : "none",
                  margin: careProfileSection === "context" ? 3 : 0,
                  borderRadius: careProfileSection === "context" ? "0.6rem" : 0,
                }}
              >
                <Users size={14} strokeWidth={1.8} />
                Worker Shift Context
              </button>
              <button
                type="button"
                onClick={() => setCareProfileSection("clinical")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: careProfileSection === "clinical" ? "var(--cc-bg)" : "transparent",
                  color: careProfileSection === "clinical" ? "var(--cc-text)" : "var(--cc-muted)",
                  boxShadow: careProfileSection === "clinical" ? "var(--cc-card-shadow)" : "none",
                  margin: careProfileSection === "clinical" ? 3 : 0,
                  borderRadius: careProfileSection === "clinical" ? "0.6rem" : 0,
                }}
              >
                <Lock size={14} strokeWidth={1.8} />
                Clinical Records
              </button>
            </div>

            {careProfileSection === "context" && (
              <ParticipantShiftContextTab participantId={id} />
            )}
            {careProfileSection === "clinical" && (
              <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-start">
                <div className="space-y-3">
                  <ParticipantMedicationsPanel participantId={id} />
                </div>
                <div className="space-y-3">
                  <ParticipantClinicalRecordEditor participantId={id} />
                  <ParticipantRestrictedTab
                    isLoading={restrictedQuery.isLoading}
                    draft={restrictedDraft}
                    onDraftChange={setRestrictedDraft}
                    onSave={() => saveRestricted.mutate()}
                    isSaving={saveRestricted.isPending}
                  />
                </div>
              </div>
            )}
          </div>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
        className={`${showMobileDetail ? "hidden lg:flex" : "flex"} ${sidebarCollapsed ? "lg:w-14" : "lg:w-[300px] xl:w-[330px]"} w-full shrink-0 flex-col rounded-none md:rounded-2xl overflow-hidden transition-all duration-200`}
        style={{ background: "var(--cc-bg)", border: showMobileDetail ? "none" : "1px solid var(--cc-border)" }}
      >
        {sidebarCollapsed ? (
          /* ── Collapsed rail — desktop only ── */
          <div className="hidden lg:flex flex-col items-center pt-3 gap-3 px-1">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand participant list"
              className="h-8 w-8 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: "var(--cc-active-bg)", color: "var(--cc-plum)" }}
              title="Expand list"
            >
              <ChevronRight size={16} />
            </button>
            {selectedId && (() => {
              const p = (participants ?? []).find((p: any) => p.id === selectedId);
              if (!p) return null;
              const inits = (p.full_name as string).split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              return (
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-black"
                  style={{ background: "var(--cc-plum)" }}
                >{inits}</div>
              );
            })()}
          </div>
        ) : (
          <>
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
            <div className="flex items-center gap-1.5">
              <Link href="/participants/new">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl text-[12px]">
                  <UserPlus className="h-3.5 w-3.5" />
                  {translate("patients.add")}
                </Button>
              </Link>
              {/* Collapse sidebar — desktop only */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Collapse participant list"
                className="hidden lg:flex h-7 w-7 rounded-lg items-center justify-center transition-colors"
                style={{ background: "var(--cc-soft)", color: "var(--cc-muted)" }}
                title="Collapse list"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
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
                        NDIS {p.ndis_number || "N/A"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
          </>
        )}
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
