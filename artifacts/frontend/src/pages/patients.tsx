import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useGetParticipants,
  useGetParticipant,
  useGetParticipantSessions,
  useGetAISummary,
  useUpdateParticipant,
  type NDISGoal,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  UserPlus,
  Calendar,
  Activity,
  Target,
  ShieldCheck,
  Clock,
  FileText,
  Loader2,
  Users,
  Edit,
  DollarSign,
  BarChart3,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  PlusCircle,
  Archive,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { SmartInput } from "@/components/SmartInput";
import { BodyMarkerHistory } from "@/components/BodyMarkerHistory";
import { type BodyMarker } from "@/components/BodyMap";
import { MapPin } from "lucide-react";

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
// Add Participant Form (shared between Add and Edit dialogs)
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
                  <Input
                    placeholder="Jane Smith"
                    data-testid="input-full-name"
                    {...field}
                  />
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
                  <Input
                    placeholder="430012345"
                    data-testid="input-ndis-number"
                    {...field}
                  />
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
                  <Input
                    type="date"
                    data-testid="input-date-of-birth"
                    {...field}
                  />
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
                  <Input
                    type="email"
                    placeholder="jane@email.com"
                    data-testid="input-email"
                    {...field}
                  />
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
                  <Input
                    placeholder="0412 345 678"
                    data-testid="input-phone"
                    {...field}
                  />
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
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? "unspecified"}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-biological-sex">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="unspecified">
                      Prefer not to say
                    </SelectItem>
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
                  <Input
                    type="number"
                    placeholder="50000"
                    data-testid="input-total-budget"
                    {...field}
                  />
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
                  <Input
                    type="date"
                    data-testid="input-plan-start-date"
                    {...field}
                  />
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
                  <Input
                    type="date"
                    data-testid="input-plan-end-date"
                    {...field}
                  />
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
          <Button
            type="submit"
            data-testid="button-add-participant"
            disabled={isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Patients() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const { toast } = useToast();

  const {
    data: participants,
    isLoading: participantsLoading,
    refetch,
  } = useGetParticipants();

  const filteredParticipants =
    participants?.filter((p) => {
      const matchesSearch =
        p.full_name.toLowerCase().includes(search.toLowerCase()) ||
        p.ndis_number.includes(search);
      const matchesStatus =
        statusFilter === "all" || p.plan_status === statusFilter;
      return matchesSearch && matchesStatus;
    }) || [];

  return (
    <div className="flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-8rem)] gap-4 md:gap-6 overflow-hidden">
      {/* Left panel — participant list */}
      <div
        className={`${showMobileDetail ? "hidden md:flex" : "flex"} w-full md:w-1/3 flex-col gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm`}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Participants</h2>
            <Link href="/participants/new">
              <Button size="sm" variant="outline" className="h-8 gap-1">
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add</span>
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search name or NDIS..."
                className="pl-9 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-participants"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-slate-50 dark:bg-slate-950 h-9">
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
            <div className="text-center py-8 text-slate-500">
              No participants found
            </div>
          ) : (
            filteredParticipants.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedId(p.id);
                  setShowMobileDetail(true);
                }}
                data-testid={`button-participant-${p.id}`}
                className={`w-full text-left p-3 rounded-lg transition-colors flex flex-col gap-1.5 ${
                  selectedId === p.id
                    ? "bg-primary/10 border-primary/20 border"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent"
                }`}
              >
                <div className="flex justify-between items-start w-full">
                  <span className="font-medium text-sm">{p.full_name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusBadge(p.plan_status)}`}
                  >
                    {p.plan_status}
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  {p.ndis_number}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — participant detail */}
      <div
        className={`${showMobileDetail ? "flex" : "hidden md:flex"} flex-1 flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-y-auto shadow-sm`}
      >
        {selectedId ? (
          <>
            <button
              className="md:hidden flex items-center gap-2 text-sm text-indigo-600 font-medium px-4 py-3 border-b border-slate-100 hover:bg-slate-50 shrink-0"
              onClick={() => {
                setShowMobileDetail(false);
              }}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back to Participants
            </button>
            <div className="flex-1 overflow-y-auto">
              <ParticipantDetail id={selectedId} onRefreshList={refetch} />
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
            <Users className="h-12 w-12 opacity-20" />
            <p>Select a participant to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Participant Dialog
// ---------------------------------------------------------------------------

function EditParticipantDialog({
  participant,
  onSaved,
}: {
  participant: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const editForm = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: {
      full_name: String(participant.full_name ?? ""),
      ndis_number: String(participant.ndis_number ?? ""),
      date_of_birth: participant.date_of_birth
        ? String(participant.date_of_birth).slice(0, 10)
        : "",
      email: String(participant.email ?? ""),
      phone: String(participant.phone ?? ""),
      primary_disability: String(participant.primary_disability ?? ""),
      biological_sex: String(participant.biological_sex ?? "unspecified"),
      plan_status: String(participant.plan_status ?? "active"),
      plan_start_date: participant.plan_start_date
        ? String(participant.plan_start_date).slice(0, 10)
        : "",
      plan_end_date: participant.plan_end_date
        ? String(participant.plan_end_date).slice(0, 10)
        : "",
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
        throw new Error(
          (err as { detail?: string }).detail ?? "Failed to update",
        );
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          editForm.reset({
            full_name: String(participant.full_name ?? ""),
            ndis_number: String(participant.ndis_number ?? ""),
            date_of_birth: participant.date_of_birth
              ? String(participant.date_of_birth).slice(0, 10)
              : "",
            email: String(participant.email ?? ""),
            phone: String(participant.phone ?? ""),
            primary_disability: String(participant.primary_disability ?? ""),
            biological_sex: String(participant.biological_sex ?? "unspecified"),
            plan_status: String(participant.plan_status ?? "active"),
            plan_start_date: participant.plan_start_date
              ? String(participant.plan_start_date).slice(0, 10)
              : "",
            plan_end_date: participant.plan_end_date
              ? String(participant.plan_end_date).slice(0, 10)
              : "",
            total_budget: Number(participant.total_budget ?? 0),
          });
        }
      }}
    >
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
      const res = await fetch(`/api/participants/${participantId}/plan`, {
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
    onError: () =>
      toast({ title: "Failed to save plan", variant: "destructive" }),
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
          <form
            onSubmit={planForm.handleSubmit((d) => createPlan.mutate(d))}
            className="space-y-4"
          >
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createPlan.isPending}>
                {createPlan.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
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
// Compliance rule badge
// ---------------------------------------------------------------------------

function RuleBadge({ status }: { status: string }) {
  if (status === "pass")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === "warning")
    return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

// ---------------------------------------------------------------------------
// Goals Management Card (NDIS goal linking)
// ---------------------------------------------------------------------------

function GoalsManagementCard({
  participantId,
  goals,
  onUpdated,
}: {
  participantId: string;
  goals: NDISGoal[];
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const updateGoals = useMutation({
    mutationFn: async (updatedGoals: NDISGoal[]) => {
      const res = await fetch(`/api/participants/${participantId}/goals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: updatedGoals }),
      });
      if (!res.ok) throw new Error("Failed to update goals");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["getParticipant", participantId],
      });
      queryClient.invalidateQueries({ queryKey: ["getParticipants"] });
      onUpdated();
    },
    onError: () => {
      toast({ title: "Failed to update goals", variant: "destructive" });
    },
  });

  function addGoal() {
    const trimmed = newGoalTitle.trim();
    if (!trimmed) return;
    const newGoal: NDISGoal = {
      id: `goal_${Date.now()}`,
      title: trimmed,
      status: "active",
    };
    updateGoals.mutate([...goals, newGoal], {
      onSuccess: () => {
        setNewGoalTitle("");
        setIsAdding(false);
        toast({ title: "Goal added" });
      },
    });
  }

  function startEditing(goal: NDISGoal) {
    setEditingId(goal.id);
    setEditingTitle(goal.title);
  }

  function saveEdit() {
    const trimmed = editingTitle.trim();
    if (!trimmed || !editingId) {
      setEditingId(null);
      return;
    }
    updateGoals.mutate(
      goals.map((g) => (g.id === editingId ? { ...g, title: trimmed } : g)),
      {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Goal updated" });
        },
      },
    );
  }

  function archiveGoal(id: string) {
    updateGoals.mutate(
      goals.map((g) =>
        g.id === id ? { ...g, status: "archived" as const } : g,
      ),
      { onSuccess: () => toast({ title: "Goal archived" }) },
    );
  }

  function restoreGoal(id: string) {
    updateGoals.mutate(
      goals.map((g) => (g.id === id ? { ...g, status: "active" as const } : g)),
      { onSuccess: () => toast({ title: "Goal restored" }) },
    );
  }

  const activeGoals = goals.filter((g) => g.status === "active");
  const archivedGoals = goals.filter((g) => g.status === "archived");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <Target className="h-4 w-4" /> NDIS Goals
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => setIsAdding(true)}
            disabled={isAdding}
            data-testid="button-add-goal"
          >
            <Plus className="h-3.5 w-3.5" /> Add Goal
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isAdding && (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="e.g. Improve independent mobility"
              value={newGoalTitle}
              onChange={(e) => setNewGoalTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addGoal();
                if (e.key === "Escape") {
                  setIsAdding(false);
                  setNewGoalTitle("");
                }
              }}
              data-testid="input-goal-title"
              className="flex-1 text-sm"
            />
            <Button
              size="sm"
              onClick={addGoal}
              disabled={updateGoals.isPending || !newGoalTitle.trim()}
              data-testid="button-save-goal"
            >
              {updateGoals.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setNewGoalTitle("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {activeGoals.length === 0 && !isAdding ? (
          <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg text-slate-400">
            <Target className="h-6 w-6 mx-auto mb-2 opacity-30" />
            <p className="text-xs">
              No active goals — click "Add Goal" to add funded support goals
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {activeGoals.map((goal) => (
              <li
                key={goal.id}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 group"
                data-testid={`goal-item-${goal.id}`}
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                {editingId === goal.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 text-sm h-7 py-1"
                      data-testid={`input-edit-goal-${goal.id}`}
                    />
                    <Button
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={saveEdit}
                      disabled={updateGoals.isPending}
                    >
                      {updateGoals.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs px-2"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm flex-1 text-slate-800 dark:text-slate-200">
                      {goal.title}
                    </span>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition-all">
                      <button
                        className="text-slate-400 hover:text-indigo-600 text-xs"
                        onClick={() => startEditing(goal)}
                        title="Edit goal"
                        data-testid={`button-edit-goal-${goal.id}`}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="text-slate-400 hover:text-amber-600 text-xs flex items-center gap-1"
                        onClick={() => archiveGoal(goal.id)}
                        disabled={updateGoals.isPending}
                        data-testid={`button-archive-goal-${goal.id}`}
                        title="Archive goal"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {archivedGoals.length > 0 && (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mt-1 mb-2"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showArchived ? "Hide" : "Show"} archived ({archivedGoals.length})
            </button>
            {showArchived && (
              <ul className="space-y-2">
                {archivedGoals.map((goal) => (
                  <li
                    key={goal.id}
                    className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50/50 border border-dashed border-slate-200 group"
                  >
                    <XCircle className="h-4 w-4 text-slate-300 shrink-0" />
                    <span className="text-sm flex-1 text-slate-400 line-through">
                      {goal.title}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-emerald-600 transition-all text-xs"
                      onClick={() => restoreGoal(goal.id)}
                      disabled={updateGoals.isPending}
                      title="Restore goal"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Participant Detail (tabbed)
// ---------------------------------------------------------------------------

interface SessionRecord {
  id: string;
  session_date?: string | null;
  session_type?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  status?: string | null;
  compliance_score?: number | null;
  tags?: string[];
  body_markers?: BodyMarker[];
}

interface ParticipantRecord {
  full_name?: string;
  biological_sex?: "male" | "female" | "unspecified";
  [key: string]: unknown;
}

function ParticipantDetail({
  id,
  onRefreshList,
}: {
  id: string;
  onRefreshList: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    data: participant,
    isLoading,
    refetch: refetchParticipant,
  } = useGetParticipant(id, {
    query: { enabled: !!id, queryKey: ["getParticipant", id] },
  });
  const { data: sessions, isLoading: sessionsLoading } =
    useGetParticipantSessions(id, {
      query: { enabled: !!id, queryKey: ["getParticipantSessions", id] },
    });
  const { data: aiSummary } = useGetAISummary(id, {
    query: { enabled: !!id, queryKey: ["getAISummary", id] },
  });

  const { data: budgetSummary, refetch: refetchBudget } = useQuery({
    queryKey: ["budgetSummary", id],
    queryFn: async () => {
      const res = await fetch(`/api/participants/${id}/budget-summary`);
      if (!res.ok) return null;
      return res.json() as Promise<{
        has_plan: boolean;
        plan_number?: string;
        plan_start?: string;
        plan_end?: string;
        status?: string;
        total_funding?: number;
        budgets?: Array<{
          category: string;
          category_label: string;
          allocated: number;
          used: number;
          remaining: number;
          percent_used: number;
        }>;
      }>;
    },
    enabled: !!id,
  });

  const typedSessions = sessions as unknown as SessionRecord[] | undefined;
  const typedParticipant = participant as unknown as
    | ParticipantRecord
    | undefined;

  const [historySearch, setHistorySearch] = useState("");

  const handleSaved = () => {
    refetchParticipant();
    onRefreshList();
    queryClient.invalidateQueries({ queryKey: ["budgetSummary", id] });
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!participant)
    return <div className="p-8 text-slate-500">Participant not found</div>;

  const budgetPct =
    participant.total_budget && participant.used_budget
      ? Math.min(
          100,
          Math.round(
            (participant.used_budget / participant.total_budget) * 100,
          ),
        )
      : 0;

  const filteredHistory =
    typedSessions?.filter(
      (s) =>
        !historySearch ||
        s.session_type?.toLowerCase().includes(historySearch.toLowerCase()) ||
        s.notes?.toLowerCase().includes(historySearch.toLowerCase()),
    ) ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight mb-1">
              {participant.full_name}
            </h2>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs">
                {participant.ndis_number}
              </span>
              <span className="hidden sm:inline">•</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> DOB:{" "}
                {safeFormat(participant.date_of_birth)}
              </span>
              {participant.email && (
                <span className="text-xs">{String(participant.email)}</span>
              )}
              {participant.phone && (
                <span className="text-xs">{String(participant.phone)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={`/participants/${id}/edit`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Edit className="h-3.5 w-3.5" /> Edit
              </Button>
            </Link>
            <Link href={`/sessions/new?participantId=${id}`}>
              <Button size="sm">New Session</Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        defaultValue="overview"
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-6 pt-3 border-b border-slate-200 dark:border-slate-800">
          <TabsList className="h-9 bg-transparent gap-1 p-0">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-2 px-3 text-sm font-medium"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="ndis-plan"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-2 px-3 text-sm font-medium"
            >
              NDIS Plan
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-2 px-3 text-sm font-medium"
            >
              Client History
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Overview Tab ── */}
        <TabsContent
          value="overview"
          className="flex-1 overflow-y-auto p-6 space-y-6 mt-0"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <FileText className="h-4 w-4" /> Plan Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Status</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border font-medium ${statusBadge(participant.plan_status ?? "")}`}
                  >
                    {String(participant.plan_status ?? "")
                      .charAt(0)
                      .toUpperCase() +
                      String(participant.plan_status ?? "").slice(1)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Plan Period</span>
                  <span className="font-medium text-right">
                    {safeFormat(participant.plan_start_date, "MMM yyyy")} –{" "}
                    {safeFormat(participant.plan_end_date, "MMM yyyy")}
                  </span>
                </div>
                <div className="pt-1">
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-slate-500">Budget Used</span>
                    <span className="font-medium">{budgetPct}%</span>
                  </div>
                  <Progress
                    value={budgetPct}
                    className={`h-2 ${budgetPct >= 90 ? "[&>div]:bg-red-500" : budgetPct >= 75 ? "[&>div]:bg-amber-500" : ""}`}
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>
                      $
                      {(participant.used_budget as number)?.toLocaleString() ??
                        "0"}{" "}
                      used
                    </span>
                    <span>
                      $
                      {(participant.total_budget as number)?.toLocaleString() ??
                        "0"}{" "}
                      total
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <Activity className="h-4 w-4" /> Clinical Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <span className="text-slate-500 block mb-1">
                    Primary Disability
                  </span>
                  <span className="font-medium">
                    {String(participant.primary_disability || "Not specified")}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <GoalsManagementCard
            participantId={id}
            goals={(participant.goals as NDISGoal[]) ?? []}
            onUpdated={handleSaved}
          />

          {aiSummary?.summary && (
            <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-800 dark:text-blue-300">
                  <ShieldCheck className="h-4 w-4" /> AI Clinical Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {aiSummary.summary}
                </p>
                <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-3 font-medium">
                  Based on {aiSummary.sessions_count} recent sessions
                </p>
              </CardContent>
            </Card>
          )}

          <div>
            <h3 className="font-semibold text-base mb-4">Recent Sessions</h3>
            {sessionsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !sessions?.length ? (
              <div className="text-center p-8 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 bg-slate-50 dark:bg-slate-900/50">
                No sessions recorded yet
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.slice(0, 5).map((s) => (
                  <Link key={s.id} href={`/sessions/${s.id}`}>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                      <div className="flex justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm group-hover:text-primary transition-colors">
                            {s.session_type}
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {s.duration_minutes} min
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.status === "draft" && (
                            <Badge
                              variant="outline"
                              className="text-amber-600 bg-amber-50 text-[10px]"
                            >
                              Draft
                            </Badge>
                          )}
                          {s.compliance_score != null && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${Number(s.compliance_score) >= 80 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}`}
                            >
                              {Number(s.compliance_score).toFixed(0)}%
                            </Badge>
                          )}
                          <span className="text-xs text-slate-500">
                            {safeFormat(s.session_date)}
                          </span>
                        </div>
                      </div>
                      {s.notes && (
                        <p className="text-xs text-slate-500 line-clamp-1 mt-1">
                          {s.notes}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── NDIS Plan Tab ── */}
        <TabsContent
          value="ndis-plan"
          className="flex-1 overflow-y-auto p-6 space-y-6 mt-0"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" /> NDIS Plan &
              Funding
            </h3>
            <SetupPlanDialog
              participantId={id}
              onSaved={() => {
                refetchBudget();
                handleSaved();
              }}
            />
          </div>

          {/* Overall budget from patient record */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Plan Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-slate-500 block mb-0.5 text-xs uppercase tracking-wide">
                    Status
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border font-medium ${statusBadge(participant.plan_status ?? "")}`}
                  >
                    {String(participant.plan_status ?? "")
                      .charAt(0)
                      .toUpperCase() +
                      String(participant.plan_status ?? "").slice(1)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-xs uppercase tracking-wide">
                    Plan Start
                  </span>
                  <span className="font-medium">
                    {safeFormat(participant.plan_start_date, "dd MMM yyyy")}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-xs uppercase tracking-wide">
                    Plan End
                  </span>
                  <span className="font-medium">
                    {safeFormat(participant.plan_end_date, "dd MMM yyyy")}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-xs uppercase tracking-wide">
                    Total Funding
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    $
                    {(participant.total_budget as number)?.toLocaleString() ??
                      "0"}
                  </span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-500">
                    Overall Budget Utilisation
                  </span>
                  <span className="font-semibold">{budgetPct}%</span>
                </div>
                <Progress
                  value={budgetPct}
                  className={`h-3 ${budgetPct >= 90 ? "[&>div]:bg-red-500" : budgetPct >= 75 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>
                    $
                    {(participant.used_budget as number)?.toLocaleString() ??
                      "0"}{" "}
                    used
                  </span>
                  <span>
                    $
                    {Math.max(
                      0,
                      ((participant.total_budget as number) ?? 0) -
                        ((participant.used_budget as number) ?? 0),
                    ).toLocaleString()}{" "}
                    remaining
                  </span>
                </div>
              </div>
              {budgetPct >= 80 && (
                <div
                  className={`flex items-start gap-2 text-sm p-3 rounded-lg ${budgetPct >= 100 ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {budgetPct >= 100
                      ? "Budget fully exhausted. No further services can be funded under this plan."
                      : `Budget is ${budgetPct}% utilised. Consider reviewing upcoming services.`}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Category budget breakdown */}
          {budgetSummary?.has_plan &&
          budgetSummary.budgets &&
          budgetSummary.budgets.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Budget by Support Category
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {budgetSummary.budgets.map((b) => (
                  <div key={b.category}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div>
                        <span className="font-medium text-sm">
                          {b.category_label}
                        </span>
                        <span
                          className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                            b.percent_used >= 100
                              ? "bg-red-50 text-red-700 border-red-200"
                              : b.percent_used >= 80
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {b.percent_used.toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-right text-sm">
                        <span className="font-semibold">
                          ${b.used.toLocaleString()}
                        </span>
                        <span className="text-slate-400">
                          {" "}
                          / ${b.allocated.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <Progress
                      value={Math.min(100, b.percent_used)}
                      className={`h-2 ${
                        b.percent_used >= 100
                          ? "[&>div]:bg-red-500"
                          : b.percent_used >= 80
                            ? "[&>div]:bg-amber-500"
                            : "[&>div]:bg-emerald-500"
                      }`}
                    />
                    <div className="text-xs text-slate-500 mt-0.5 text-right">
                      ${b.remaining.toLocaleString()} remaining
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <div className="border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center text-slate-400">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">
                No detailed budget plan set up
              </p>
              <p className="text-xs">
                Use "Set Up NDIS Plan" to configure category budgets
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Client History Tab ── */}
        <TabsContent
          value="history"
          className="flex-1 overflow-y-auto p-6 space-y-4 mt-0"
        >
          {typedSessions && typedSessions.length > 0 && (
            <BodyMarkerHistory
              sessions={typedSessions.map((s) => ({
                id: s.id,
                session_date: s.session_date,
                session_type: s.session_type,
                body_markers: Array.isArray(s.body_markers)
                  ? s.body_markers
                  : [],
              }))}
              bodyType={typedParticipant?.biological_sex}
            />
          )}

          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-base flex items-center gap-2 shrink-0">
              <History className="h-4 w-4 text-primary" /> Session History
              {typedSessions && (
                <span className="text-slate-400 font-normal text-sm">
                  ({typedSessions.length})
                </span>
              )}
            </h3>
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search sessions..."
                className="pl-8 h-8 text-sm"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>
          </div>

          {sessionsLoading ? (
            <div className="space-y-3">
              {Array(4)
                .fill(0)
                .map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {historySearch
                  ? "No sessions match your search"
                  : "No sessions recorded yet"}
              </p>
              {!historySearch && (
                <Link href={`/sessions/new?participantId=${id}`}>
                  <Button size="sm" variant="outline" className="mt-4">
                    Record First Session
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((s) => (
                <Link key={s.id} href={`/sessions/${s.id}`}>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm group-hover:text-primary transition-colors truncate">
                            {s.session_type || "Session"}
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0">
                            <Clock className="h-3 w-3" />
                            {s.duration_minutes} min
                          </span>
                        </div>
                        {s.notes && (
                          <p className="text-xs text-slate-500 line-clamp-2">
                            {s.notes}
                          </p>
                        )}
                        {Array.isArray(s.tags) && s.tags.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {s.tags.map((t: string) => (
                              <span
                                key={t}
                                className="text-[10px] uppercase tracking-wide font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 px-1.5 py-0.5 rounded"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {Array.isArray(s.body_markers) &&
                          s.body_markers.length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5">
                              <MapPin className="h-2.5 w-2.5 text-indigo-500" />
                              <span className="text-[10px] text-indigo-600 font-medium">
                                {s.body_markers.length} body finding
                                {s.body_markers.length !== 1 ? "s" : ""}{" "}
                                recorded
                              </span>
                            </div>
                          )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="text-xs text-slate-500">
                          {safeFormat(s.session_date)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {s.status === "draft" ? (
                            <Badge
                              variant="outline"
                              className="text-amber-600 bg-amber-50 border-amber-200 text-[10px]"
                            >
                              Draft
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-emerald-600 bg-emerald-50 border-emerald-200 text-[10px]"
                            >
                              Completed
                            </Badge>
                          )}
                          {s.compliance_score != null && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                Number(s.compliance_score) >= 80
                                  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                  : Number(s.compliance_score) >= 60
                                    ? "text-amber-700 bg-amber-50 border-amber-200"
                                    : "text-red-700 bg-red-50 border-red-200"
                              }`}
                            >
                              {Number(s.compliance_score).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
