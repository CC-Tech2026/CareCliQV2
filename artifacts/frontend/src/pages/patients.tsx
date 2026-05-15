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
  ArrowLeft,
  FileText,
  Target,
  Stethoscope,
  UserCheck,
  Trash2,
  Plus,
  ChevronRight,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SmartInput } from "@/components/SmartInput";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    expired: "bg-red-50 text-red-700 border-red-200",
  };
  return map[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
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

      const res = await fetch(`/api/participants/${participant.id}`, {
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
// Native Inline NDIS Plan Setup View (Replaces Dialog)
// ---------------------------------------------------------------------------

function InlineSetupPlan({
  participantId,
  onCancel,
  onSaved,
}: {
  participantId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
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
      const res = await fetch(`/api/participants/${participantId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save plan");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "NDIS plan saved successfully" });
      onSaved();
    },
    onError: () => toast({ title: "Failed to save plan", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b pb-4 border-slate-100">
        <Button size="icon" variant="ghost" onClick={onCancel} className="h-8 w-8 rounded-lg">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </Button>
        <div>
          <h3 className="text-base font-bold text-slate-900">Set Up NDIS Plan</h3>
          <p className="text-xs text-slate-500">Configure insurance brackets and localized standard categories.</p>
        </div>
      </div>

      <Form {...planForm}>
        <form onSubmit={planForm.handleSubmit((d) => createPlan.mutate(d))} className="space-y-6">
          <div className="bg-slate-50 border border-slate-100/80 rounded-xl p-4 grid grid-cols-2 gap-4">
            <FormField
              control={planForm.control}
              name="plan_number"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel className="text-slate-700 font-medium">Plan Reference Number</FormLabel>
                  <FormControl>
                    <Input className="bg-white" placeholder="e.g. 2024-ABC-001" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={planForm.control}
              name="plan_start"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700 font-medium">
                    Plan Start <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input className="bg-white" type="date" {...field} />
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
                  <FormLabel className="text-slate-700 font-medium">
                    Plan End <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input className="bg-white" type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="border border-purple-100/70 rounded-xl p-5 space-y-4">
            <FormField
              control={planForm.control}
              name="total_funding"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-900 font-semibold flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-purple-700" /> Total Funding Amount ($)
                  </FormLabel>
                  <FormControl>
                    <Input className="text-base font-medium border-purple-200 focus-visible:ring-purple-600" type="number" placeholder="50000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" /> Budget Splits by Support Category
              </p>
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={planForm.control}
                  name="core_budget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-600 text-xs">Core Supports</FormLabel>
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
                      <FormLabel className="text-slate-600 text-xs">Capacity Building</FormLabel>
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
                      <FormLabel className="text-slate-600 text-xs">Capital Supports</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={createPlan.isPending} className="bg-purple-950 hover:bg-purple-900">
              {createPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save NDIS Plan
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan Goals Panel
// ---------------------------------------------------------------------------

function PlanGoalsPanel({ participantId }: { participantId: string }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [newTargetDate, setNewTargetDate] = useState("");

  const { data: goals = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["plan-goals", participantId],
    queryFn: async () => {
      const res = await fetch(`/api/participants/${participantId}/plan-goals`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const addGoal = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/participants/${participantId}/plan-goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: newDesc,
          category: newCategory,
          target_date: newTargetDate || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).detail ?? "Failed to add goal");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Goal added" });
      setNewDesc("");
      setNewTargetDate("");
      setShowAdd(false);
      void refetch();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const toggleAchieved = useMutation({
    mutationFn: async ({ goalId, achieved }: { goalId: string; achieved: boolean }) => {
      const res = await fetch(`/api/participants/${participantId}/plan-goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_achieved: achieved }),
      });
      if (!res.ok) throw new Error("Failed to update goal");
      return res.json();
    },
    onSuccess: () => void refetch(),
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const deleteGoal = useMutation({
    mutationFn: async (goalId: string) => {
      await fetch(`/api/participants/${participantId}/plan-goals/${goalId}`, { method: "DELETE" });
    },
    onSuccess: () => { toast({ title: "Goal removed" }); void refetch(); },
  });

  const CATEGORY_LABELS: Record<string, string> = {
    core: "Core",
    capacity_building: "Capacity Building",
    capital: "Capital",
    general: "General",
  };

  const CATEGORY_COLORS: Record<string, string> = {
    core: "bg-blue-50 text-blue-700 border-blue-200",
    capacity_building: "bg-purple-50 text-purple-700 border-purple-200",
    capital: "bg-amber-50 text-amber-700 border-amber-200",
    general: "bg-slate-100 text-slate-600 border-slate-200",
  };

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{goals.length} goal{goals.length !== 1 ? "s" : ""} linked to active plan</p>
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3.5 w-3.5" /> Add Goal
        </Button>
      </div>

      {showAdd && (
        <div className="border border-purple-200/60 rounded-xl p-4 bg-purple-50/30 space-y-3">
          <p className="text-xs font-semibold text-slate-700">New Plan Goal</p>
          <Textarea
            placeholder="Describe the NDIS goal…"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="text-sm min-h-[72px]"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Support Category</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="core">Core Supports</SelectItem>
                  <SelectItem value="capacity_building">Capacity Building</SelectItem>
                  <SelectItem value="capital">Capital Supports</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Target Date</label>
              <Input type="date" className="h-8 text-xs" value={newTargetDate} onChange={(e) => setNewTargetDate(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => addGoal.mutate()} disabled={!newDesc.trim() || addGoal.isPending} className="h-8 text-xs bg-purple-950 hover:bg-purple-900">
              {addGoal.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save Goal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-8 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {goals.length === 0 && !showAdd && (
        <div className="text-center py-10 text-slate-400">
          <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No plan goals yet.</p>
          <p className="text-xs mt-1">Set up an NDIS plan first, then add goals linked to it.</p>
        </div>
      )}

      <div className="space-y-2">
        {goals.map((g: any) => (
          <div key={g.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${g.is_achieved ? "bg-emerald-50/50 border-emerald-100" : "bg-white border-slate-100"}`}>
            <button
              onClick={() => toggleAchieved.mutate({ goalId: g.id, achieved: !g.is_achieved })}
              className="mt-0.5 shrink-0"
              title={g.is_achieved ? "Mark incomplete" : "Mark achieved"}
            >
              {g.is_achieved
                ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                : <div className="h-5 w-5 rounded-full border-2 border-slate-300 hover:border-emerald-400 transition-colors" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${g.is_achieved ? "line-through text-slate-400" : "text-slate-800"}`}>{g.description}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[g.category] ?? CATEGORY_COLORS.general}`}>
                  {CATEGORY_LABELS[g.category] ?? g.category}
                </span>
                {g.target_date && (
                  <span className="text-[10px] text-slate-400">Due {safeFormat(g.target_date)}</span>
                )}
                {g.goal_code && (
                  <span className="text-[10px] text-slate-400 font-mono">{g.goal_code}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => deleteGoal.mutate(g.id)}
              className="shrink-0 text-slate-300 hover:text-red-400 transition-colors p-1"
              title="Remove goal"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Practitioner Allocations Panel
// ---------------------------------------------------------------------------

function AllocationsPanel({ participantId }: { participantId: string }) {
  const { toast } = useToast();

  const { data: allocations = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["allocations", participantId],
    queryFn: async () => {
      const res = await fetch(`/api/participants/${participantId}/allocations`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const removeAllocation = useMutation({
    mutationFn: async (allocationId: string) => {
      await fetch(`/api/participants/${participantId}/allocations/${allocationId}`, { method: "DELETE" });
    },
    onSuccess: () => { toast({ title: "Allocation removed" }); void refetch(); },
  });

  const ROLE_LABELS: Record<string, string> = {
    primary_ot: "Primary OT",
    support_worker: "Support Worker",
    supervisor: "Supervisor",
  };

  const ROLE_COLORS: Record<string, string> = {
    primary_ot: "bg-indigo-50 text-indigo-700 border-indigo-200",
    support_worker: "bg-blue-50 text-blue-700 border-blue-200",
    supervisor: "bg-amber-50 text-amber-700 border-amber-200",
  };

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{allocations.length} practitioner{allocations.length !== 1 ? "s" : ""} allocated</p>
      </div>

      {allocations.length === 0 && (
        <div className="text-center py-10 text-slate-400">
          <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No practitioners allocated.</p>
          <p className="text-xs mt-1">Allocations are managed via the user administration panel or by assigning a worker during onboarding.</p>
        </div>
      )}

      <div className="space-y-2">
        {allocations.map((a: any) => {
          const user = a.user ?? {};
          const name = user.full_name || user.email || "Unknown";
          return (
            <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl border ${a.is_active ? "bg-white border-slate-100" : "bg-slate-50 border-slate-100 opacity-60"}`}>
              <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-purple-700">{name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                {user.email && user.full_name && (
                  <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ROLE_COLORS[a.allocated_role] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                  {ROLE_LABELS[a.allocated_role] ?? a.allocated_role}
                </span>
                {!a.is_active && <Badge variant="secondary" className="text-[10px] py-0">Inactive</Badge>}
              </div>
              <button
                onClick={() => removeAllocation.mutate(a.id)}
                className="shrink-0 text-slate-300 hover:text-red-400 transition-colors p-1"
                title="Remove allocation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget Summary Panel
// ---------------------------------------------------------------------------

function BudgetPanel({ participantId }: { participantId: string }) {
  const { data: budget, isLoading } = useQuery<any>({
    queryKey: ["budget-summary", participantId],
    queryFn: async () => {
      const res = await fetch(`/api/participants/${participantId}/budget-summary`);
      if (!res.ok) return { has_plan: false };
      return res.json();
    },
  });

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;

  if (!budget?.has_plan) {
    return (
      <div className="text-center py-10 text-slate-400">
        <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No active NDIS plan found.</p>
        <p className="text-xs mt-1">Set up a plan to track budget by support category.</p>
      </div>
    );
  }

  const PILLAR_COLORS: Record<string, { bar: string; badge: string }> = {
    core: { bar: "bg-blue-500", badge: "bg-blue-50 text-blue-700 border-blue-200" },
    capacity_building: { bar: "bg-purple-500", badge: "bg-purple-50 text-purple-700 border-purple-200" },
    capital: { bar: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p className="font-medium text-slate-500">Plan Number</p>
          <p className="text-slate-800 font-semibold mt-0.5">{budget.plan_number || "—"}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p className="font-medium text-slate-500">Status</p>
          <p className={`font-semibold mt-0.5 capitalize ${budget.status === "active" ? "text-emerald-600" : "text-slate-700"}`}>{budget.status}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p className="font-medium text-slate-500">Plan Period</p>
          <p className="text-slate-800 font-semibold mt-0.5">{safeFormat(budget.plan_start)} – {safeFormat(budget.plan_end)}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p className="font-medium text-slate-500">Total Funding</p>
          <p className="text-slate-800 font-semibold mt-0.5">${Number(budget.total_funding ?? 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">3 NDIS Support Pillars</p>
        {(budget.budgets ?? []).map((b: any) => {
          const colors = PILLAR_COLORS[b.category] ?? { bar: "bg-slate-400", badge: "bg-slate-100 text-slate-600 border-slate-200" };
          const pct = Math.min(b.percent_used ?? 0, 100);
          return (
            <div key={b.category} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors.badge}`}>{b.category_label}</span>
                <span className="text-xs text-slate-500">${Number(b.used ?? 0).toLocaleString()} / ${Number(b.allocated ?? 0).toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${colors.bar} ${pct >= 90 ? "opacity-80" : ""}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] text-right text-slate-400">{pct}% used · ${Number(b.remaining ?? 0).toLocaleString()} remaining</p>
            </div>
          );
        })}
        {(budget.budgets ?? []).length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">No budget allocations set. Edit the NDIS plan to add Core, Capacity Building, and Capital splits.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail Wrapper Component
// ---------------------------------------------------------------------------

function ParticipantDetail({ id, onRefreshList }: { id: string; onRefreshList: () => void }) {
  const [currentView, setCurrentView] = useState<"profile" | "setup_plan">("profile");
  const { data: participant } = useQuery<any>({
    queryKey: ["participant", id],
    queryFn: async () => {
      const res = await fetch(`/api/participants/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (currentView === "setup_plan") {
    return (
      <div className="p-6">
        <InlineSetupPlan
          participantId={id}
          onCancel={() => setCurrentView("profile")}
          onSaved={() => {
            onRefreshList();
            setCurrentView("profile");
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between border-b pb-4 border-purple-100/50">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900 truncate">{participant?.full_name ?? "Participant"}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            NDIS {participant?.ndis_number ?? "—"} · {participant?.primary_disability ?? "No disability recorded"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs border-purple-200 text-purple-950 hover:bg-purple-50/50"
            onClick={() => setCurrentView("setup_plan")}
          >
            <PlusCircle className="h-3.5 w-3.5" /> Set Up Plan
          </Button>
          <Link href={`/participants/${id}`}>
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1">
              Full Profile <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="goals">
        <TabsList className="w-full grid grid-cols-3 h-9 bg-slate-100/70 rounded-xl">
          <TabsTrigger value="goals" className="text-xs rounded-lg gap-1.5">
            <Target className="h-3.5 w-3.5" /> Plan Goals
          </TabsTrigger>
          <TabsTrigger value="budget" className="text-xs rounded-lg gap-1.5">
            <DollarSign className="h-3.5 w-3.5" /> Budget
          </TabsTrigger>
          <TabsTrigger value="allocations" className="text-xs rounded-lg gap-1.5">
            <UserCheck className="h-3.5 w-3.5" /> Team
          </TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="mt-4">
          <PlanGoalsPanel participantId={id} />
        </TabsContent>

        <TabsContent value="budget" className="mt-4">
          <BudgetPanel participantId={id} />
        </TabsContent>

        <TabsContent value="allocations" className="mt-4">
          <AllocationsPanel participantId={id} />
        </TabsContent>
      </Tabs>
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