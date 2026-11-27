import { matchesPerson } from "@/lib/person-identity";
import { LabelFilter, PersonLabels, useLabels } from "@/components/labels/labels";
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
import { ParticipantRecordsTab } from "@/components/participants/ParticipantRecordsTab";
import { ParticipantDirectoryWelcome } from "@/components/participants/ParticipantDirectoryWelcome";
import { ParticipantInvoiceSummary } from "@/components/participants/ParticipantInvoiceSummary";
import { ParticipantInvoicesPanel } from "@/components/participants/ParticipantInvoicesPanel";
import { ParticipantServiceAgreementSection } from "@/components/participants/ParticipantServiceAgreementSection";
import { ParticipantMeetGreetSummary } from "@/components/onboarding/MeetGreetSummaryPanel";
import { ShiftAssignmentModal } from "@/components/coordinator/ShiftAssignmentModal";
import { AddShiftMenu } from "@/components/coordinator/AddShiftMenu";
import { TaskTemplatePanel } from "@/components/coordinator/TaskTemplatePanel";
import { SectionInfo } from "@/components/ui/section-info";
import { safeRichText } from "@/lib/safe-html";
import { useGetParticipants } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, parseISO } from "date-fns";
import { Link, useLocation, useSearch } from "wouter";
import {
  Search,
  UserPlus,
  Loader2,
  Users,
  Edit,
  Edit2,
  Trash2,
  DollarSign,
  Plus,
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
  Maximize2,
  Minimize2,
  LayoutTemplate,
  Sunrise,
  Sun,
  Moon,
  Clock,
  FileDown,
  UserRoundPen,
  ListChecks,
  Contact,
  CalendarPlus,
  MoreHorizontal,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { SidePanel } from "@/components/layout/SidePanel";
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
  address: z.string().optional(),
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
  address?: string | null;
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
  assigned_worker_name?: string | null;
  allied_health_id?: string | null;
  case_manager_name?: string | null;
  case_manager_phone?: string | null;
  care_coordinator_id?: string | null;
  gp_name?: string | null;
  gp_phone?: string | null;
  gp_practice?: string | null;
  emergency_contact?: string | { name?: string | null; phone?: string | null; relationship?: string | null; display?: string } | null;
  next_of_kin?: string | { name?: string | null; phone?: string | null; relationship?: string | null; display?: string } | null;
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
  worker_id?: string | null;
  worker_name?: string | null;
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

export type ComplianceCategoryStatus = "good" | "attention" | "critical" | "none";

export type ComplianceCategory = {
  key: string;
  label: string;
  status: ComplianceCategoryStatus;
  detail: string;
  score?: number | null;
};

export type ComplianceBreakdown = {
  overall_score: number | null;
  categories: ComplianceCategory[];
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
          <h3 className="col-span-2 text-xs font-semibold uppercase tracking-wide text-cc-muted">About</h3>
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
          <h3 className="col-span-2 text-xs font-semibold uppercase tracking-wide text-cc-muted pt-2">Contact</h3>
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
            name="address"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>{translate("patients.field.address")}</FormLabel>
                <FormControl>
                  <AddressAutocomplete
                    placeholder={translate("patients.placeholder.address")}
                    data-testid="input-address"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value ?? ""}
                    onChange={(v) => field.onChange(v)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <h3 className="col-span-2 text-xs font-semibold uppercase tracking-wide text-cc-muted pt-2">NDIS plan</h3>
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
                Managed via Set up NDIS plan
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
      address: String(participant.address ?? ""),
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
      address: String(participant.address ?? ""),
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text hover:bg-cc-soft"
      >
        <Edit className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Edit details</span>
      </button>
      <SidePanel
        open={open}
        onOpenChange={setOpen}
        icon={UserRoundPen}
        title={translate("patients.editTitle")}
      >
          <ParticipantForm
            form={editForm}
            onSubmit={(data) => updateMutation.mutate(data)}
            isPending={updateMutation.isPending}
            onCancel={() => setOpen(false)}
            hasPlan={hasPlan}
            submitLabel={translate("patients.saveChanges")}
          />
      </SidePanel>
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text hover:bg-cc-soft"
      >
        {hasPlan ? <Edit className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <PlusCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        {hasPlan ? "Edit plan" : "Set up plan"}
      </button>
      <SidePanel
        open={open}
        onOpenChange={setOpen}
        icon={ClipboardList}
        title={hasPlan ? "Edit plan details" : translate("patients.setupPlan")}
      >
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
      </SidePanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail Wrapper Component
// ---------------------------------------------------------------------------

export type ParticipantDetailTab = "overview" | "plan_goals" | "sessions" | "compliance" | "plan_meetings" | "care_profile" | "records";

// A titled part of a record section: plain, separated by a rule from the one
// above, never a box inside the page's own surface.
const RECORD_SECTION = "space-y-4 border-t border-cc-border pt-6 first:border-t-0 first:pt-0";
const RECORD_HEADING = "text-base font-semibold text-cc-text";

// Also the MD's participant profile (onboard-participant.tsx), so both roles
// work from the same record with the same actions.
export function ParticipantDetail({
  id, onRefreshList, initialTab, fullScreen, onToggleFullScreen, syncUrl = true, bare = false, tab, onTabChange,
}: {
  id: string;
  onRefreshList: () => void;
  initialTab?: ParticipantDetailTab;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
  syncUrl?: boolean;
  /** Just the section's content: the page around it (the director's profile)
   *  already shows who this is, the actions and its own tabs. */
  bare?: boolean;
  /** Which section to show, when the page around it owns the tabs. */
  tab?: ParticipantDetailTab;
  onTabChange?: (tab: ParticipantDetailTab) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator" || user?.role === "managing_director";

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
  const complianceBreakdownQuery = useOrgQuery(["participant", id, "compliance-breakdown"], {
    queryFn: () => jsonFetch<ComplianceBreakdown>(`/api/participants/${id}/compliance-breakdown`),
    enabled: isCoordinator,
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

  const [, navigate] = useLocation();

  // UI state — collapsible header
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  // Assign Shift — coordinator only
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const workersQuery = useOrgQuery<WorkerStats[]>(["coordinator-worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
    enabled: isCoordinator,
  });

  // Goals & Tasks — coordinator only
  const orgId = user?.organizationId ?? "__no_org__";
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
      qc.invalidateQueries({ queryKey: [orgId, "participant", id, "ndis-goals"] });
      setCreateMode(null);
      setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalDescriptionAiApplied(false);
    },
    onError: (err: Error) => toastFn({ title: err.message || "Failed to create goal", variant: "destructive" }),
  });

  const editGoalMut = useMutation({
    mutationFn: ({ goalId, payload }: { goalId: string; payload: NdisGoalPayload }) => updateNdisGoal(goalId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "participant", id, "ndis-goals"] });
      setCreateMode(null); setEditingGoal(null);
      setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalDescriptionAiApplied(false);
    },
    onError: (err: Error) => toastFn({ title: err.message || "Failed to update goal", variant: "destructive" }),
  });

  const archiveGoalMut = useMutation({
    mutationFn: archiveNdisGoal,
    onSuccess: () => { toastFn({ title: "Goal archived" }); qc.invalidateQueries({ queryKey: [orgId, "participant", id, "ndis-goals"] }); },
    onError: () => toastFn({ title: "Failed to archive goal", variant: "destructive" }),
  });

  const completeGoalMut = useMutation({
    mutationFn: completeNdisGoal,
    onSuccess: () => { toastFn({ title: "Goal marked complete" }); qc.invalidateQueries({ queryKey: [orgId, "participant", id, "ndis-goals"] }); },
    onError: () => toastFn({ title: "Failed to complete goal", variant: "destructive" }),
  });

  const createTaskMut = useMutation({
    mutationFn: (payload: Omit<ParticipantTaskPayload, "status">) =>
      createParticipantTask(id, { ...payload, status: "pending" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "participant", id, "participant-tasks"] });
      setCreateMode(null);
      setTaskTitle(""); setTaskInstructions(""); setLinkedGoalId(null); setTaskPurpose("core"); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null);
    },
    onError: (err: Error) => toastFn({ title: err.message || "Failed to create task", variant: "destructive" }),
  });

  const deleteTaskMut = useMutation({
    mutationFn: deleteParticipantTask,
    onSuccess: () => { toastFn({ title: "Task deleted" }); qc.invalidateQueries({ queryKey: [orgId, "participant", id, "participant-tasks"] }); },
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
        medications: restrictedQuery.data.medications ?? "",
        medical_alerts: restrictedQuery.data.medical_alerts ?? "",
      });
    }
  }, [restrictedQuery.data]);
  const { toast: toastFn } = useToast();
  const [exportOpen, setExportOpen] = useState(initialTab === "records");
  const handleExportProfile = () => setExportOpen(true);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
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
  const [contactsOpen, setContactsOpen] = useState(false);
  const [ownTab, setOwnTab] = useState<ParticipantDetailTab>(initialTab === "records" ? "overview" : initialTab ?? "overview");
  const activeTab: ParticipantDetailTab = tab ?? ownTab;
  const setActiveTab = (next: ParticipantDetailTab) => (onTabChange ? onTabChange(next) : setOwnTab(next));

  // Keep ?id=&tab= in sync with what's actually on screen, replacing (not
  // pushing) so tab clicks don't pollute history - browser back only needs
  // to restore the CURRENT entry, not step through every tab switch. Without
  // this, navigating away (e.g. to a session's full detail page) and back
  // always landed on the participant list with nothing selected, since this
  // page's real state (which participant, which tab) never made it into the
  // URL despite the deep-link *read* side already existing below.
  // Off when embedded in another page (the MD's profile), which owns its URL.
  useEffect(() => {
    if (syncUrl) navigate(`/patients?id=${id}&tab=${activeTab}`, { replace: true });
  }, [id, activeTab, syncUrl]);

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
    { id: "overview" as const, label: "Overview", shortLabel: "Overview", icon: UserCircle },
    ...(isCoordinator ? [{ id: "care_profile" as const, label: "Care", shortLabel: "Care", icon: Heart }] : []),
    { id: "plan_goals" as const, label: "Plan & goals", shortLabel: "Plan", icon: Target },
    { id: "sessions" as const, label: "Shift history", shortLabel: "Shifts", icon: CalendarDays },
    { id: "compliance" as const, label: "Compliance", shortLabel: "Compliance", icon: ShieldCheck },
    ...(isCoordinator ? [{ id: "plan_meetings" as const, label: "Meetings & notes", shortLabel: "Meetings", icon: MessageSquare }] : []),
  ];

  const tabDescriptions: Record<ParticipantDetailTab, string> = {
    overview: "Personal details, key contacts and records for a clear picture of this participant's support.",
    care_profile: "Daily routines, support preferences, medications and clinical information for safe, consistent care.",
    plan_goals: "Review funding, agreed supports and goals, then track the tasks that help this participant progress.",
    sessions: "Review delivered support, staff notes and outcomes across this participant's shift history.",
    compliance: "Review documentation checks and follow up on records that need attention.",
    plan_meetings: "Keep review discussions, meeting notes and follow-up decisions together.",
    records: "Participant documents and supporting records.",
  };


  return (
    <div className={bare ? "min-w-0" : "flex flex-col min-h-full"}>

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      {!bare && (
      <div
        className="sticky top-0 z-10 border-b border-cc-border px-3 pt-3 sm:px-5 sm:pt-5"
        style={{ background: "var(--cc-surface)" }}
      >

        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-10 sm:h-10 rounded-2xl bg-[var(--cc-cta)] flex items-center justify-center text-white text-sm font-semibold shrink-0 select-none">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="hidden">Participant Profile</p>
            <h3
              className="text-xl font-semibold leading-snug break-words"
              style={{ color: "var(--cc-text)" }}
            >
              {participant.full_name}
            </h3>
            <p className="text-[11px] mt-0.5 leading-relaxed sm:hidden" style={{ color: "var(--cc-muted)" }}>
              {translateParams("patients.ndisLine", { number: participant.ndis_number || translate("patients.notRecorded") })}
              {participant.plan_start_date && participant.plan_end_date && (
                <> &middot; Plan {safeFormat(participant.plan_start_date)} – {safeFormat(participant.plan_end_date)}</>
              )}
              {participant.assigned_worker_name && (
                <> &middot; Assigned: {participant.assigned_worker_name}</>
              )}
            </p>

             {/* NDIS number + plan dates — desktop */}
              <p className="hidden sm:block text-[11px] text-[#6A6A77] leading-relaxed mt-2" style={{ color: "var(--cc-muted)" }}>
                {translateParams("patients.ndisLine", { number: participant.ndis_number || translate("patients.notRecorded") })}
                {participant.plan_start_date && participant.plan_end_date && (
                  <> &middot; Plan {safeFormat(participant.plan_start_date)} – {safeFormat(participant.plan_end_date)}</>
                )}
                {participant.assigned_worker_name && (
                  <> &middot; Assigned: {participant.assigned_worker_name}</>
                )}
              </p>
              {isCoordinator && (
                <div className="mt-2">
                  <PersonLabels target="participants" personId={id} personName={participant.full_name} compact />
                </div>
              )}
          </div>

          {/* Action buttons — desktop: inline right */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {isCoordinator && (
              <AddShiftMenu participant={{ id, full_name: participant.full_name }}>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--cc-cta)" }}
                >
                  <CalendarPlus size={13} />
                  Add shift
                </button>
              </AddShiftMenu>
            )}
            {onToggleFullScreen && (
              <button
                type="button"
                onClick={onToggleFullScreen}
                className="hidden lg:flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-colors hover:bg-cc-active-bg"
                style={{ borderColor: "var(--cc-border)", color: "var(--cc-plum)" }}
              >
                {fullScreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {fullScreen ? "Exit full screen" : "Full screen"}
              </button>
            )}
            {isCoordinator && (
              <button
                type="button"
                onClick={handleExportProfile}

                className="flex items-center gap-1.5 rounded-xl border border-cc-border px-3 py-2 text-[11px] font-semibold text-cc-text transition-colors hover:bg-cc-soft disabled:opacity-60"
              >
                <FileDown size={13} />
                Export records
              </button>
            )}
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
            {/* Key facts: one quiet strip. Colour only on values that need
                attention (over budget, low compliance), not on every box. It
                sizes to its own width, so it also fits the roster's drawer. */}
            <div className="@container mt-3 mb-3">
              <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-cc-border bg-cc-surface @lg:grid-cols-4">
                {metricCards.map((metric, index) => {
                  const Icon = metric.icon;
                  const valueTone = metric.tone
                    .split(" ")
                    .filter((c) => c.startsWith("text-") || c.startsWith("dark:text-"))
                    .join(" ");
                  return (
                    <div
                      key={metric.label}
                      className={`min-w-0 px-3 py-2.5 ${index % 2 === 1 ? "border-l border-cc-border" : ""} ${index >= 2 ? "border-t border-cc-border @lg:border-t-0" : ""} ${index === 2 ? "@lg:border-l" : ""}`}
                    >
                      <dt className="flex items-center gap-1.5 text-[11px] font-medium text-cc-muted">
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{metric.label}</span>
                      </dt>
                      <dd className={`mt-0.5 text-sm font-semibold capitalize leading-snug break-words ${valueTone || "text-cc-text"}`}>
                        {metric.value}
                      </dd>
                      {metric.linkLabel && (
                        <button
                          type="button"
                          onClick={metric.onLinkClick}
                          className="mt-1 flex items-center gap-0.5 text-[11px] font-semibold text-cc-plum underline decoration-dotted underline-offset-2"
                        >
                          {metric.linkLabel} <ChevronRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </dl>
            </div>

            {/* Action buttons — mobile: below stat cards */}
            <div className="flex sm:hidden flex-wrap items-center gap-2 mb-3">
              {isCoordinator && (
                <AddShiftMenu participant={{ id, full_name: participant.full_name }}>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "var(--cc-cta)" }}
                  >
                    <CalendarPlus size={13} />
                    Add shift
                  </button>
                </AddShiftMenu>
              )}
              {isCoordinator && (
                <button
                  type="button"
                  onClick={handleExportProfile}

                  className="flex items-center gap-1.5 rounded-xl border border-cc-border px-3 py-2 text-[11px] font-semibold text-cc-text transition-colors hover:bg-cc-soft disabled:opacity-60"
                >
                  <FileDown size={13} />
                  Export records
                </button>
              )}
            </div>
          </>
        )}

        {/* Sections: plain text tabs, the active one underlined. Scrolls
            sideways on narrow screens without showing a scrollbar. */}
        <nav
          aria-label="Participant record sections"
          className="-mb-px flex gap-5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-0.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum ${
                  active
                    ? "border-[var(--cc-coral)] font-semibold text-cc-text"
                    : "border-transparent font-medium text-cc-muted hover:text-cc-text"
                }`}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
      )}

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div
        className={bare ? "space-y-6" : "flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 pb-6"}
        style={bare ? undefined : { background: "var(--cc-surface)" }}
      >
        {!bare && tabDescriptions[activeTab] && (
          <p className="text-sm text-cc-muted">{tabDescriptions[activeTab]}</p>
        )}

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
            editAction={isCoordinator ? (<EditParticipantPanel
              participant={participant}
              hasPlan={hasPlan}
              onSaved={() => { participantQuery.refetch(); onRefreshList(); billingPeriodCurrentQuery.refetch(); billingPeriodsQuery.refetch(); }}
            />) : undefined}
            onViewPlan={bare ? undefined : () => setActiveTab("plan_goals")}
            onEditContacts={() => setContactsOpen(true)}
            invoiceSummary={isCoordinator ? <ParticipantInvoiceSummary participantId={id} onViewAll={() => setInvoicesOpen(true)} /> : undefined}
          />
        )}

        {activeTab === "plan_goals" && (
          <>
            <section aria-labelledby="record-plan-funding" className={RECORD_SECTION}>
              <h3 id="record-plan-funding" className={RECORD_HEADING}>NDIS plan and funding</h3>
              <ParticipantPlanTab
                editAction={isCoordinator ? (<SetupPlanPanel
              participantId={id}
              budget={budget}
              onSaved={() => { participantQuery.refetch(); budgetQuery.refetch(); onRefreshList(); }}
            />) : undefined}
                planDetails={<dl className="grid gap-4 text-sm sm:grid-cols-3">{[
                  ["Plan period", participant.plan_start_date ? safeFormat(participant.plan_start_date) + " to " + safeFormat(participant.plan_end_date) : "Not recorded"],
                  ["Plan status", participant.plan_status ? participant.plan_status.charAt(0).toUpperCase() + participant.plan_status.slice(1).replace(/_/g, " ") : "Not recorded"],
                  ["Plan management", planManagementTypeLabel(participant.plan_management_type, translate)],
                ].map(([label, value]) => <div key={label}><dt className="text-cc-muted">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>}
                budget={budget}
                isLoading={budgetQuery.isLoading}
                totalBudget={totalBudget}
                usedBudget={usedBudget}
                remainingBudget={remainingBudget}
                isOverspent={isOverspent}
                hasCategoryBudgets={hasCategoryBudgets}
                categoryBudgets={categoryBudgets}
              />
            </section>
            {isCoordinator && (
              <section aria-labelledby="record-agreement" className={RECORD_SECTION}>
                <h3 id="record-agreement" className={RECORD_HEADING}>Service agreement</h3>
                <div>
                  <ParticipantServiceAgreementSection
                    participantId={id}
                    participantName={participant.full_name}
                    participantEmail={participant.email ? String(participant.email) : null}
                    defaults={{
                      plan_management_type: participant.plan_management_type,
                      start_date: participant.plan_start_date,
                      end_date: participant.plan_end_date,
                    }}
                  />
                </div>
              </section>
            )}
            {isCoordinator && id && <ParticipantMeetGreetSummary participantId={id} />}
          </>
        )}

        {/* GOALS & TASKS (inside Plan & Goals tab) */}
        {activeTab === "plan_goals" && isCoordinator && (() => {
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
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
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
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[11px] font-bold rounded bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors whitespace-nowrap">
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
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[11px] font-bold rounded bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors whitespace-nowrap">
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
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
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
                              <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[11px] font-bold rounded bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors whitespace-nowrap">
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
                    { id: 'low', label: 'Low', selectedClass: 'border-blue-400 bg-blue-50 text-blue-700' },
                    { id: 'medium', label: 'Medium', selectedClass: 'border-amber-400 bg-amber-50 text-amber-700' },
                    { id: 'high', label: 'High', selectedClass: 'border-red-400 bg-red-50 text-red-700' }
                  ].map(p => (
                    <button key={p.id} type="button" onClick={() => setTaskPriority(p.id as any)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-[12px] font-semibold transition-colors ${
                        taskPriority === p.id
                          ? p.selectedClass
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
                    { id: 'morning', label: 'Morning', Icon: Sunrise },
                    { id: 'afternoon', label: 'Afternoon', Icon: Sun },
                    { id: 'night', label: 'Night', Icon: Moon },
                    { id: 'anytime', label: 'Anytime', Icon: Clock }
                  ].map(shift => (
                    <button key={shift.id} type="button" onClick={() => setTaskShiftType(shift.id as any)}
                      className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
                        taskShiftType === shift.id
                          ? "border-orange-400 bg-orange-50 text-orange-700"
                          : "border-gray-200 bg-white text-[#6A6A77] hover:border-gray-300"
                      }`}>
                      <shift.Icon className="h-3.5 w-3.5" />
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
            <section aria-labelledby="record-goals" className={RECORD_SECTION}>
              {/* Header — spans full width */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 id="record-goals" className={RECORD_HEADING}>NDIS goals and support tasks</h3>
                  <p className="mt-0.5 text-sm text-cc-muted">The goals in {participant.full_name}'s NDIS plan, and the tasks workers do on shift towards them.</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button type="button"
                    onClick={() => { setCreateMode("goal"); setGoalTitle(""); setGoalDescription(""); setGoalTargetDate(""); setGoalCategory("daily_living"); setGoalSuccessCriteria(""); setGoalSupportCategory(""); setEditingGoal(null); setGoalDescriptionAiApplied(false); setGoalAiSuggestions(null); setGoalAiLoading(false); }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-cc-border bg-cc-surface px-4 text-sm font-medium text-cc-text hover:bg-cc-soft">
                    <Plus size={14} aria-hidden /> Add a goal
                  </button>
                  {/* Embedded in the director's profile, its header has Add a shift. */}
                  {!bare && (
                    <button type="button" onClick={() => setShiftModalOpen(true)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-white hover:opacity-90"
                      style={{ background: "var(--cc-cta)" }}>
                      <CalendarClock size={14} aria-hidden /> Add a shift
                    </button>
                  )}
                </div>
              </div>

              {/* Content: goals and their tasks, one list */}
              <div className="space-y-5">
              {/* Goals missing support category: coordinator review */}
              {goalsNeedingCategory.length > 0 && createMode !== "goal" && createMode !== "edit_goal" && (
                <div className="space-y-2 border-l-4 border-amber-400 pl-4">
                  <p className="text-sm font-semibold text-cc-text">
                    {goalsNeedingCategory.length} goal{goalsNeedingCategory.length !== 1 ? "s need" : " needs"} a support category
                  </p>
                  <p className="text-sm text-cc-muted">
                    Link each goal to a funded NDIS support category so billing and reporting stay accurate.
                  </p>
                  <ul className="divide-y divide-cc-border">
                    {goalsNeedingCategory.map((goal) => (
                      <li key={goal.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="truncate text-sm text-cc-text">{goal.name}</span>
                        <button
                          type="button"
                          onClick={() => startEditGoal(goal)}
                          className="shrink-0 text-sm font-medium text-cc-plum hover:underline"
                        >
                          Choose a category
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ndisGoalsQuery.isLoading && (
                <p role="status" className="flex items-center gap-2 py-4 text-sm text-cc-muted"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading goals</p>
              )}

              {!ndisGoalsQuery.isLoading && activeGoals.length === 0 && createMode !== "goal" && (
                <div className="py-6 text-center">
                  <Target className="mx-auto mb-2 h-7 w-7 text-cc-muted" aria-hidden />
                  <p className="text-sm font-semibold text-cc-text">No current goals</p>
                  <p className="mt-1 text-sm text-cc-muted">Use Add a goal to record the first goal from {participant.full_name}'s NDIS plan.</p>
                </div>
              )}

              {activeGoals.length > 0 && (
              <ul className="divide-y divide-cc-border border-y border-cc-border">
              {activeGoals.map((goal) => {
                const goalTasks = participantTasks.filter((t) => t.goal_id === goal.id);
                const areaStyle = AREA_COLORS[goal.goal_area] ?? AREA_COLORS.other;
                const progressData = progressGoalId === goal.id ? goalProgressQuery.data : undefined;
                const progressLoading = progressGoalId === goal.id && goalProgressQuery.isLoading;
                const pct = progressData && progressData.sessions_count > 0
                  ? Math.round((progressData.evidence_count / progressData.sessions_count) * 100) : 0;

                return (
                  <li key={goal.id} className="py-4">
                    {/* Goal header */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <Target size={16} className="mt-0.5 shrink-0 text-cc-muted" aria-hidden />
                        <div className="min-w-0 space-y-1">
                          <p className="break-words text-sm font-semibold leading-snug text-cc-text">{goal.name}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-cc-muted">
                            <span className="rounded-full px-2 py-0.5 font-medium" style={{ background: areaStyle.bg, color: areaStyle.color }}>
                              {areaStyle.label}
                            </span>
                            <span>{goalTasks.length} task{goalTasks.length !== 1 ? "s" : ""}</span>
                            {goal.target_date && <span>· Target {safeFormat(goal.target_date)}</span>}
                            {!goal.support_category && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                                No support category
                              </span>
                            )}
                          </div>
                          {goal.description && <div className="line-clamp-2 text-sm leading-relaxed text-cc-muted [&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic" dangerouslySetInnerHTML={{ __html: safeRichText(goal.description) }} />}
                          {goal.success_criteria && (
                            <p className="text-sm text-cc-muted">
                              <span className="font-medium text-cc-text">Success looks like: </span>{goal.success_criteria}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                        <button type="button" onClick={() => { setCreateMode("tasks"); setLinkedGoalId(goal.id); setTaskTitle(""); setTaskInstructions(""); setTaskPurpose("goal"); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null); }}
                          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-cc-border px-3 text-sm font-medium text-cc-text hover:bg-cc-soft">
                          <Plus size={14} aria-hidden /> Add a task
                        </button>
                        <button type="button" onClick={() => startEditGoal(goal)}
                          className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-cc-text hover:bg-cc-soft">
                          <Edit2 size={14} aria-hidden /> Edit
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`More for ${goal.name}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-cc-muted hover:bg-cc-soft hover:text-cc-text">
                              <MoreHorizontal size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onSelect={() => setProgressGoalId((prev) => prev === goal.id ? null : goal.id)}>
                              <BarChart2 size={14} className="mr-2" aria-hidden /> {progressGoalId === goal.id ? "Hide progress" : "Progress, last 30 days"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTemplatesGoalId((prev) => prev === goal.id ? null : goal.id)}>
                              <LayoutTemplate size={14} className="mr-2" aria-hidden /> {templatesGoalId === goal.id ? "Hide task templates" : "Task templates"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={completeGoalMut.isPending} onSelect={() => completeGoalMut.mutate(goal.id)}>
                              <CheckCircle2 size={14} className="mr-2" aria-hidden /> Mark as achieved
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={archiveGoalMut.isPending} onSelect={() => archiveGoalMut.mutate(goal.id)}>
                              <Archive size={14} className="mr-2" aria-hidden /> Archive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Task template management for this goal */}
                    {templatesGoalId === goal.id && (
                      <div className="mt-3 border-l-2 border-cc-border pl-4 sm:ml-6">
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
                      <div className="mt-3 space-y-3 border-l-2 border-cc-border pl-4 sm:ml-6">
                        {progressLoading && <p className="flex items-center gap-1 text-sm text-cc-muted"><Loader2 size={12} className="animate-spin" aria-hidden /> Loading progress</p>}
                        {progressData && (
                          <>
                            <p className="text-sm font-medium text-cc-text">Progress in the last 30 days</p>
                            <dl className="grid max-w-md grid-cols-3 gap-4">
                              {([["shifts", progressData.sessions_count], ["with evidence", progressData.evidence_count], ["evidence rate", `${pct}%`]] as [string, string | number][]).map(([l, v]) => (
                                <div key={l}>
                                  <dd className="text-lg font-semibold tabular-nums text-cc-text">{v}</dd>
                                  <dt className="text-xs text-cc-muted">{l}</dt>
                                </div>
                              ))}
                            </dl>
                            <div className="h-2 max-w-md overflow-hidden rounded-full bg-cc-soft" role="img" aria-label={`Evidence rate ${pct}%`}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 70 ? "#16A34A" : pct >= 40 ? "#D97706" : "#DC2626" }} />
                            </div>
                            {progressData.sessions.length > 0 && (
                              <ul className="max-w-md divide-y divide-cc-border">
                                {progressData.sessions.slice(0, 4).map((s) => (
                                  <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                                    <span className="text-cc-text">{safeFormat(s.session_date)}</span>
                                    <span className="flex items-center gap-3 text-cc-muted">
                                      {s.notes && <span>Progress note written</span>}
                                      {s.compliance_score != null && <span className={s.compliance_score >= 80 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{s.compliance_score}%</span>}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Tasks under this goal */}
                    {goalTasks.length > 0 ? (
                      <ul className="mt-2 divide-y divide-cc-border sm:ml-6">
                        {goalTasks.map((task) => (
                          <li key={task.id} className="flex items-center justify-between gap-2 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <ListChecks size={14} className="shrink-0 text-cc-muted" aria-hidden />
                              <div className="min-w-0">
                                <p className="truncate text-sm text-cc-text">{task.name}</p>
                                {task.description && <p className="truncate text-xs text-cc-muted">{task.description}</p>}
                              </div>
                            </div>
                            <div className="ml-2 flex shrink-0 items-center gap-2">
                              {task.is_mandatory && <span className="rounded-full bg-cc-soft px-2 py-0.5 text-xs font-medium text-cc-text">Required</span>}
                              <button type="button" onClick={() => deleteTaskMut.mutate(task.id)} disabled={deleteTaskMut.isPending}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-cc-muted hover:bg-cc-soft hover:text-red-600" aria-label={`Delete task ${task.name}`}>
                                <X size={14} />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-cc-muted sm:ml-6">No tasks yet. Use Add a task to give workers something to do towards this goal.</p>
                    )}
                  </li>
                );
              })}
              </ul>
              )}

              {/* Core support tasks (no goal) */}
              {(() => {
                const coreTasks = participantTasks.filter((t) => !t.goal_id);
                if (coreTasks.length === 0) return null;
                return (
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-cc-text">Everyday support tasks, not linked to a goal</h4>
                    <ul className="divide-y divide-cc-border">
                      {coreTasks.map((task) => (
                        <li key={task.id} className="flex items-center justify-between gap-2 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <ClipboardList size={14} className="shrink-0 text-cc-muted" aria-hidden />
                            <div className="min-w-0">
                              <p className="truncate text-sm text-cc-text">{task.name}</p>
                              {task.description && <p className="truncate text-xs text-cc-muted">{task.description}</p>}
                            </div>
                          </div>
                          <div className="ml-2 flex shrink-0 items-center gap-2">
                            {task.is_mandatory && <span className="rounded-full bg-cc-soft px-2 py-0.5 text-xs font-medium text-cc-text">Required</span>}
                            <button type="button" onClick={() => deleteTaskMut.mutate(task.id)} disabled={deleteTaskMut.isPending}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-cc-muted hover:bg-cc-soft hover:text-red-600" aria-label={`Delete task ${task.name}`}>
                              <X size={14} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {/* Achieved and archived goals */}
              {doneGoals.length > 0 && (
                <div className="space-y-1">
                  <button type="button" onClick={() => setShowArchivedGoals((v) => !v)} aria-expanded={showArchivedGoals}
                    className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-cc-muted hover:text-cc-text">
                    <Archive size={14} aria-hidden />
                    {showArchivedGoals ? "Hide" : "Show"} achieved and archived goals ({doneGoals.length})
                  </button>
                  {showArchivedGoals && (
                    <ul className="divide-y divide-cc-border">
                      {doneGoals.map((goal) => {
                        const areaStyle = AREA_COLORS[goal.goal_area] ?? AREA_COLORS.other;
                        return (
                          <li key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                            <p className="min-w-0 flex-1 truncate text-sm text-cc-muted">{goal.name}</p>
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: areaStyle.bg, color: areaStyle.color }}>{areaStyle.label}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${goal.status === "completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-cc-soft text-cc-muted"}`}>
                              {goal.status === "completed" ? "Achieved" : "Archived"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
            </section>

            {/* Goal & Task forms — right-side panels, consistent with Edit Participant / Edit Plan */}
            <SidePanel
              open={createMode === "goal" || createMode === "edit_goal"}
              onOpenChange={(open) => { if (!open) cancelGoalForm(); }}
              icon={Target}
              title={createMode === "edit_goal" ? "Edit goal" : "New NDIS goal"}
              description={participant.full_name}
            >
                {goalFormContent}
            </SidePanel>

            <SidePanel
              open={createMode === "tasks"}
              onOpenChange={(open) => {
                if (!open) { setCreateMode(null); setTaskInstructionsAiApplied(false); setTaskAiSuggestions(null); setTaskAiLoading(false); setAppliedTemplate(null); }
              }}
              icon={ListChecks}
              title="New task"
              description={`Setting up support for ${participant.full_name}`}
            >
                {taskFormContent}
            </SidePanel>
            </>
          );
        })()}

        {/* SESSIONS TAB */}
        {activeTab === "sessions" && (
          <ParticipantSessionsTab
            sessions={sessions}
            isLoading={sessionsQuery.isLoading}
          />
        )}
        {activeTab === "compliance" && (
          <ParticipantComplianceTab
            complianceHistory={complianceHistory}
            averageCompliance={averageCompliance}
            isLoading={complianceQuery.isLoading}
            onSelectSession={(sessionId) => navigate(`/sessions/${sessionId}`)}
            breakdown={complianceBreakdownQuery.data ?? null}
            breakdownLoading={complianceBreakdownQuery.isLoading}
          />
        )}

        {activeTab === "plan_meetings" && isCoordinator && (
          <ParticipantPlanMeetingsTab participantId={id} participantName={participant.full_name} />
        )}

        {activeTab === "care_profile" && isCoordinator && (
          <div className="space-y-6">
            <section aria-labelledby="record-daily-support" className={RECORD_SECTION}>
              <h3 id="record-daily-support" className={RECORD_HEADING}>Daily support and key contacts</h3>
              <ParticipantShiftContextTab participantId={id} />
            </section>
            <section id="record-clinical" aria-labelledby="record-clinical-heading" className={RECORD_SECTION}>
              <h3 id="record-clinical-heading" className={RECORD_HEADING}>Medication and health information</h3>
              <div className="space-y-6">
                <ParticipantMedicationsPanel participantId={id} />
                <ParticipantClinicalRecordEditor participantId={id} />
                <ParticipantRestrictedTab
                  isLoading={restrictedQuery.isLoading}
                  draft={restrictedDraft}
                  onDraftChange={setRestrictedDraft}
                  onSave={() => saveRestricted.mutate()}
                  isSaving={saveRestricted.isPending}
                />
              </div>
            </section>
          </div>
        )}

      </div>

      {isCoordinator && <Sheet open={exportOpen} onOpenChange={setExportOpen}><SheetContent className="flex w-full flex-col p-0 sm:max-w-3xl"><SheetHeader className="border-b border-cc-border p-5 pr-12"><SheetTitle>Export records</SheetTitle><SheetDescription>Download profile, shift history and invoices for {participant.full_name} as one PDF or ZIP.</SheetDescription></SheetHeader><ParticipantRecordsTab key={id} participantId={id} participantName={participant.full_name} /></SheetContent></Sheet>}
      {isCoordinator && <Sheet open={invoicesOpen} onOpenChange={setInvoicesOpen}><SheetContent className="flex w-full flex-col p-0 sm:max-w-2xl"><SheetHeader className="border-b border-cc-border p-5 pr-12"><SheetTitle>Invoices</SheetTitle><SheetDescription>Invoices for {participant.full_name}. Pick a financial year or any period, open a PDF, or tick several to download together.</SheetDescription></SheetHeader><ParticipantInvoicesPanel key={id} participantId={id} /></SheetContent></Sheet>}
      {isCoordinator && <SidePanel open={contactsOpen} onOpenChange={setContactsOpen} wide icon={Contact} title="Care contacts & support details"><ParticipantShiftContextEditor participantId={id} onSaved={() => { participantQuery.refetch(); onRefreshList(); }} /></SidePanel>}
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
  const { user: listUser } = useAuth();
  const canAddShifts = listUser?.role === "support_coordinator" || listUser?.role === "managing_director";
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder]     = useState<"asc" | "desc">("asc");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const labelInfo = useLabels();
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailFullScreen, setDetailFullScreen] = useState(false);

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

  const { data: participants, isLoading: participantsLoading, isError: participantsError, refetch } = useGetParticipants();

  const filteredParticipants = (participants ?? [])
    .filter((p: any) => {
      // Name, preferred name, NDIS number (with or without spaces), phone,
      // email, address or suburb, date of birth, or their support worker.
      const matchesSearch = matchesPerson(
        search,
        [p.full_name, p.preferred_name, p.ndis_number, p.phone, p.email, p.address, p.assigned_worker_name,
          ...labelInfo.wordsOf("participants", p.id)],
        p.date_of_birth,
      );
      const matchesStatus = statusFilter === "all" || p.plan_status === statusFilter;
      const matchesLetter = !letterFilter || p.full_name.toUpperCase().startsWith(letterFilter);
      const matchesLabel = labelInfo.has("participants", p.id, labelFilter);
      return matchesSearch && matchesStatus && matchesLetter && matchesLabel;
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
    <div className="flex h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-8rem)] gap-0 md:gap-4 overflow-hidden">

      {/* ── Left panel — participant list ─────────────────────────────── */}
      <div
        className={`${detailFullScreen ? "hidden" : showMobileDetail ? "hidden lg:flex" : "flex"} ${sidebarCollapsed ? "lg:w-14" : "lg:w-[320px] xl:w-[360px]"} w-full shrink-0 flex-col rounded-none md:rounded-2xl overflow-hidden transition-all duration-200`}
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
              <h2 className="flex items-center gap-1.5 text-[15px] font-black" style={{ color: "var(--cc-text)" }}>
                {translate("patients.title")}
                <SectionInfo text="Everyone you support: their plans, goals, sessions, and compliance, in one place." />
              </h2>
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
          <LabelFilter target="participants" value={labelFilter} onChange={setLabelFilter} className="mt-2" />

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
          ) : participantsError ? (
            <div role="alert" className="p-4 text-sm text-cc-text"><p>Participant records couldn’t be loaded.</p><button type="button" onClick={() => void refetch()} className="mt-3 min-h-11 md:min-h-9 rounded-lg border border-cc-border px-4 font-semibold">Try again</button></div>
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
              {(search || statusFilter !== "all" || letterFilter || labelFilter) && <button type="button" onClick={() => { setSearch(""); setStatusFilter("all"); setLetterFilter(null); setLabelFilter(null); }} className="min-h-11 md:min-h-9 rounded-lg border border-cc-border px-4 text-sm font-semibold text-cc-text">Clear filters</button>}
            </div>
          ) : (
            filteredParticipants.map((p: any) => {
              const inits = p.full_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              const isSelected = selectedId === p.id;
              return (
                <div key={p.id} className="group/row flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setSelectedId(p.id); setShowMobileDetail(true); }}
                  data-testid={`button-participant-${p.id}`}
                  aria-pressed={isSelected}
                  className="min-w-0 flex-1 text-left rounded-xl transition-all duration-150 flex items-center gap-3 px-3 py-2.5 border"
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
                      {labelInfo.labelsOf("participants", p.id).slice(0, 2).map((l) => (
                        <span key={l.id} className="truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--cc-soft)", color: "var(--cc-muted)" }}>
                          {l.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
                {canAddShifts && (
                  <AddShiftMenu participant={{ id: p.id, full_name: p.full_name }}>
                    <button
                      type="button"
                      aria-label={`Add a shift for ${p.full_name}`}
                      title="Add a shift"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-cc-surface opacity-100 transition-opacity hover:bg-cc-soft focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                      style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
                    >
                      <CalendarPlus size={15} />
                    </button>
                  </AddShiftMenu>
                )}
                </div>
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
              <ParticipantDetail
                key={selectedId}
                id={selectedId}
                onRefreshList={refetch}
                initialTab={deepLinkId === selectedId ? deepLinkTab ?? undefined : undefined}
                fullScreen={detailFullScreen}
                onToggleFullScreen={() => setDetailFullScreen((v) => !v)}
              />
            </div>
          </>
        ) : (
          <ParticipantDirectoryWelcome participants={participants ?? []} loading={participantsLoading} error={participantsError} onRetry={() => void refetch()} onSelect={id => { setSelectedId(id); setShowMobileDetail(true); }} />
        )}
      </div>
    </div>
  );
}
