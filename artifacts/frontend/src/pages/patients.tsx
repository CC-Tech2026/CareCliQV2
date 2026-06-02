import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useGetParticipants } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import {
  Search,
  UserPlus,
  Loader2,
  Users,
  Edit,
  DollarSign,
  PlusCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CalendarDays,
  ClipboardList,
  FileText,
  ShieldCheck,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SmartInput } from "@/components/SmartInput";
import { TranslationAuditView } from "@/components/TranslationAuditView";
import { apiFetch } from "@/lib/api-fetch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string; message?: string }).detail ?? (err as { message?: string }).message ?? `Request failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
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
                  Full Name <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Jane Smith" data-testid="input-full-name" {...field} />
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
                  NDIS Number <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="430012345" data-testid="input-ndis-number" {...field} />
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
                  Date of Birth <span className="text-destructive">*</span>
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
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="jane@email.com" data-testid="input-email" {...field} />
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
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input placeholder="0412 345 678" data-testid="input-phone" {...field} />
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
                <FormLabel>Primary Disability</FormLabel>
                <FormControl>
                  <SmartInput
                    placeholder="e.g. Autism Spectrum Disorder — or tap the mic to speak"
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
                <FormLabel>Biological Sex</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? "unspecified"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-biological-sex">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="unspecified">Prefer not to say</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
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
                <FormLabel>Plan Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-plan-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
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
                <FormLabel>Total Budget ($)</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="50000" data-testid="input-total-budget" {...field} />
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
                <FormLabel>Plan Start Date</FormLabel>
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
                <FormLabel>Plan End Date</FormLabel>
                <FormControl>
                  <Input type="date" data-testid="input-plan-end-date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" data-testid="button-add-participant" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Edit Participant Dialog
// ---------------------------------------------------------------------------

function EditParticipantDialog({
  participant,
  onSaved,
}: {
  participant: any;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

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
      toast({ title: "Participant updated successfully" });
      setOpen(false);
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: err.message || "Update failed", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Edit className="h-3.5 w-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Participant</DialogTitle>
        </DialogHeader>
        <ParticipantForm
          form={editForm}
          onSubmit={(data) => updateMutation.mutate(data)}
          isPending={updateMutation.isPending}
          onCancel={() => setOpen(false)}
          submitLabel="Save Changes"
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// NDIS Plan Setup Dialog
// ---------------------------------------------------------------------------

function SetupPlanDialog({
  participantId,
  onSaved,
}: {
  participantId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

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
      toast({ title: "NDIS plan saved" });
      setOpen(false);
      onSaved();
    },
    onError: () => toast({ title: "Failed to save plan", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <PlusCircle className="h-3.5 w-3.5" /> Set Up NDIS Plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set Up NDIS Plan</DialogTitle>
        </DialogHeader>
        <Form {...planForm}>
          <form onSubmit={planForm.handleSubmit((d) => createPlan.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={planForm.control}
                name="plan_number"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Plan Reference Number</FormLabel>
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
                      Plan Start <span className="text-destructive">*</span>
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
                      Plan End <span className="text-destructive">*</span>
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
                    <FormLabel>Total Funding ($)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="50000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="col-span-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" /> Budget by Support Category
                </p>
              </div>
              <FormField
                control={planForm.control}
                name="core_budget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Core Supports ($)</FormLabel>
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
                    <FormLabel>Capacity Building ($)</FormLabel>
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
                    <FormLabel>Capital Supports ($)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPlan.isPending}>
                {createPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Plan
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail Wrapper Component
// ---------------------------------------------------------------------------

function ParticipantDetail({ id, onRefreshList }: { id: string; onRefreshList: () => void }) {
  const participantQuery = useQuery({
    queryKey: ["participant", id],
    queryFn: () => fetchJson<ParticipantRecord>(`/api/participants/${id}`),
  });
  const sessionsQuery = useQuery({
    queryKey: ["participant", id, "sessions"],
    queryFn: () => fetchJson<SessionRecord[]>(`/api/sessions/participant/${id}`),
  });
  const budgetQuery = useQuery({
    queryKey: ["participant", id, "budget-summary"],
    queryFn: () => fetchJson<BudgetSummary>(`/api/participants/${id}/budget-summary`),
  });
  const complianceQuery = useQuery({
    queryKey: ["participant", id, "compliance-history"],
    queryFn: () => fetchJson<ComplianceHistoryItem[]>(`/api/participants/${id}/compliance-history`),
  });

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
          {(participantQuery.error as Error)?.message || "Unable to load participant details."}
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
  const latestSessions = sessions.slice(0, 5);

  const metricCards = [
    {
      label: "Plan Status",
      value: participant.plan_status || "Not recorded",
      icon: CheckCircle2,
      tone: statusBadge(participant.plan_status || ""),
    },
    {
      label: "Budget Remaining",
      value: money(remainingBudget),
      icon: DollarSign,
      tone: "bg-purple-50 text-[#542269] border-purple-100",
    },
    {
      label: "Sessions",
      value: String(sessions.length),
      icon: CalendarDays,
      tone: "bg-sky-50 text-sky-700 border-sky-100",
    },
    {
      label: "Compliance",
      value: averageCompliance == null ? "No score" : `${averageCompliance}%`,
      icon: ShieldCheck,
      tone: complianceTone(averageCompliance),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between border-b pb-4 border-purple-100/50">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#F03060]">Participant Profile</p>
          <h3 className="mt-1 text-xl font-black text-slate-900">{participant.full_name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            NDIS {participant.ndis_number || "not recorded"} · Clinical profile, NDIS plan, sessions, and compliance history.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <EditParticipantDialog participant={participant} onSaved={() => {
            participantQuery.refetch();
            onRefreshList();
          }} />
          <SetupPlanDialog participantId={id} onSaved={onRefreshList} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className={`rounded-2xl border p-4 ${metric.tone}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-75">{metric.label}</p>
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-3 text-xl font-black capitalize">{metric.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-2xl border border-purple-100/70 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#5533CC]" />
            <h4 className="font-black text-[#1C1626]">Basic Profile</h4>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["Date of birth", safeFormat(participant.date_of_birth)],
              ["Biological sex", participant.biological_sex || "Not recorded"],
              ["Primary disability", participant.primary_disability || "Not recorded"],
              ["Phone", participant.phone || "Not recorded"],
              ["Email", participant.email || "Not recorded"],
              ["Plan period", `${safeFormat(participant.plan_start_date)} - ${safeFormat(participant.plan_end_date)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-[#F6F4FB] p-3">
                <dt className="text-[10px] font-black uppercase tracking-wider text-[#7A6A8A]">{label}</dt>
                <dd className="mt-1 text-sm font-bold text-[#1C1626]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-purple-100/70 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-[#5533CC]" />
            <h4 className="font-black text-[#1C1626]">NDIS Funding</h4>
          </div>
          {!budgetQuery.isLoading && budget?.has_plan === false ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
              No active NDIS plan has been saved for this participant yet.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#F6F4FB] p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[#7A6A8A]">Total</p>
                  <p className="mt-1 text-sm font-black text-[#1C1626]">{money(totalBudget || budget?.total_funding)}</p>
                </div>
                <div className="rounded-xl bg-[#F6F4FB] p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[#7A6A8A]">Used</p>
                  <p className="mt-1 text-sm font-black text-[#1C1626]">{money(usedBudget)}</p>
                </div>
                <div className="rounded-xl bg-[#F6F4FB] p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[#7A6A8A]">Remaining</p>
                  <p className="mt-1 text-sm font-black text-[#1C1626]">{money(remainingBudget)}</p>
                </div>
              </div>
              {(budget?.budgets || []).map((item) => (
                <div key={item.category || item.category_label} className="rounded-xl border border-purple-100/70 p-3">
                  <div className="flex items-center justify-between gap-3 text-sm font-bold">
                    <span className="text-[#1C1626]">{item.category_label || item.category}</span>
                    <span className="text-[#7A6A8A]">{item.percent_used ?? 0}% used</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#EEEAFB]">
                    <div className="h-2 rounded-full bg-[#5533CC]" style={{ width: `${Math.min(100, Math.max(0, item.percent_used ?? 0))}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-medium text-[#7A6A8A]">
                    {money(item.used)} used of {money(item.allocated)} · {money(item.remaining)} remaining
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-purple-100/70 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[#5533CC]" />
          <h4 className="font-black text-[#1C1626]">NDIS Goals</h4>
        </div>
        {goals.length === 0 ? (
          <p className="rounded-xl bg-[#F6F4FB] p-4 text-sm font-medium text-[#7A6A8A]">No goals have been recorded for this participant.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {goals.map((goal, index) => (
              <div key={String(goal.id || index)} className="rounded-xl border border-purple-100/70 p-4">
                <p className="font-black text-[#1C1626]">{normalizeGoalTitle(goal, index)}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-[#7A6A8A]">{String(goal.status || "active")}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-purple-100/70 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[#5533CC]" />
              <h4 className="font-black text-[#1C1626]">Session History</h4>
            </div>
            <span className="rounded-full bg-[#F6F4FB] px-3 py-1 text-xs font-black text-[#5533CC]">{sessions.length} total</span>
          </div>
          {sessionsQuery.isLoading ? (
            <Skeleton className="h-28 w-full rounded-2xl" />
          ) : latestSessions.length === 0 ? (
            <p className="rounded-xl bg-[#F6F4FB] p-4 text-sm font-medium text-[#7A6A8A]">No sessions have been recorded for this participant.</p>
          ) : (
            <div className="space-y-3">
              {latestSessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-purple-100/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black capitalize text-[#1C1626]">{(session.session_type || "session").replace("_", " ")}</p>
                      <p className="mt-1 text-xs font-medium text-[#7A6A8A]">
                        {safeFormat(session.session_date)} · {session.duration_minutes || 0} min
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${statusBadge(session.status || "")}`}>
                      {session.status || "draft"}
                    </span>
                  </div>
                  {(session.translated_english_note || session.compliance_input_text || session.notes) && (
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#7A6A8A]">
                      {session.translated_english_note || session.compliance_input_text || session.notes}
                    </p>
                  )}
                  {(session.original_language_input || session.translated_english_note) && (
                    <div className="mt-4">
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
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-purple-100/70 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#5533CC]" />
            <h4 className="font-black text-[#1C1626]">Compliance History</h4>
          </div>
          {complianceQuery.isLoading ? (
            <Skeleton className="h-28 w-full rounded-2xl" />
          ) : complianceHistory.length === 0 ? (
            <p className="rounded-xl bg-[#F6F4FB] p-4 text-sm font-medium text-[#7A6A8A]">No compliance audit history has been recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {complianceHistory.slice(0, 5).map((item) => {
                const score = item.latest_audit?.score ?? item.latest_audit?.compliance_score;
                return (
                  <div key={item.session_id} className="rounded-xl border border-purple-100/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black capitalize text-[#1C1626]">{(item.session_type || "session").replace("_", " ")}</p>
                        <p className="mt-1 text-xs font-medium text-[#7A6A8A]">{safeFormat(item.session_date)}</p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${complianceTone(score)}`}>
                        {score == null ? "Audit" : `${score}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Patients Management Workspace Layout
// ---------------------------------------------------------------------------

export default function Patients() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  const { data: participants, isLoading: participantsLoading, refetch } = useGetParticipants();

  const filteredParticipants =
    participants?.filter((p) => {
      const matchesSearch =
        p.full_name.toLowerCase().includes(search.toLowerCase()) || p.ndis_number.includes(search);
      const matchesStatus = statusFilter === "all" || p.plan_status === statusFilter;
      return matchesSearch && matchesStatus;
    }) || [];

  return (
    <div className="flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-8rem)] gap-4 md:gap-6 overflow-hidden">
      {/* Left panel — participant list */}
      <div
        className={`${showMobileDetail ? "hidden md:flex" : "flex"} w-full md:w-1/3 flex-col bg-white rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(84,34,105,0.06),0_0_0_1px_rgba(232,213,232,0.5)]`}
      >
        <div className="p-4 border-b border-purple-100/50 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[16px] text-[#1C1626]">Participants</h2>
            <Link href="/participants/new">
              <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl border-purple-100/50">
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add</span>
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#7A6A8A]" />
              <Input
                placeholder="Search name or NDIS..."
                className="pl-9 rounded-xl bg-[#F6F4FB] border-purple-100/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-participants"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 rounded-xl bg-[#F6F4FB] border-purple-100/50">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {participantsLoading ? (
            Array(5)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="p-3 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))
          ) : filteredParticipants.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-purple-900/10">
                <Users className="h-5 w-5 text-[#542269] opacity-50" />
              </div>
              <p className="text-[13px] font-medium text-[#4A3D5A]">No participants found</p>
              <p className="text-[12px] text-center leading-relaxed text-[#7A6A8A]">
                Try adjusting your search or add a new participant
              </p>
            </div>
          ) : (
            filteredParticipants.map((p) => {
              const initials = p.full_name
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              const isSelected = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setShowMobileDetail(true);
                  }}
                  data-testid={`button-participant-${p.id}`}
                  className={`w-full text-left p-3 rounded-xl transition-all duration-150 flex items-center gap-3 border ${
                    isSelected ? "bg-purple-900/10 border-purple-900/20" : "bg-transparent border-transparent"
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0 ${
                      isSelected ? "bg-gradient-to-br from-[#F1738A] to-[#542269] text-white" : "bg-purple-900/10 text-[#542269]"
                    }`}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-1">
                      <span className={`text-[13px] font-semibold truncate ${isSelected ? "text-[#542269]" : "text-[#1C1626]"}`}>
                        {p.full_name}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${statusBadge(p.plan_status)}`}>
                        {p.plan_status}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono block mt-0.5 text-[#7A6A8A]">
                      {p.ndis_number}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — participant detail workspace view */}
      <div
        className={`${showMobileDetail ? "flex" : "hidden md:flex"} flex-1 flex-col bg-white rounded-2xl overflow-y-auto shadow-[0_1px_4px_rgba(84,34,105,0.06),0_0_0_1px_rgba(232,213,232,0.5)]`}
      >
        {selectedId ? (
          <>
            <button
              className="md:hidden flex items-center gap-2 text-[13px] font-medium px-4 py-3 border-b border-purple-100/50 hover:bg-gray-50 shrink-0 transition-colors text-[#542269]"
              onClick={() => setShowMobileDetail(false)}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Participants
            </button>
            <div className="flex-1 overflow-y-auto">
              <ParticipantDetail id={selectedId} onRefreshList={refetch} />
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-purple-900/10">
              <Users className="h-7 w-7 text-[#542269] opacity-40" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-[#4A3D5A]">Select a participant</p>
              <p className="text-[13px] mt-1.5 leading-relaxed text-[#7A6A8A]">
                Choose someone from the list to view their clinical profile, NDIS plan, and session history.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
