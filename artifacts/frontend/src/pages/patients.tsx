import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useGetParticipants,
  useGetParticipant,
  useGetParticipantSessions,
  useGetAISummary,
  useUpdateParticipant,
  NDISGoalCategory,
  type NDISGoal,
  type NDISGoalProgressEntry,
} from "@workspace/api-client-react";

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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
    <div className="flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-8rem)] gap-4 md:gap-5 overflow-hidden">

      {/* ── Left panel: participant list ── */}
      <div
        className={`${showMobileDetail ? "hidden md:flex" : "flex"} w-full md:w-[260px] md:shrink-0 flex-col bg-white rounded-2xl overflow-hidden`}
        style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b flex items-center justify-between"
          style={{ borderColor: "rgba(232,213,232,0.5)" }}>
          <h2 className="font-semibold text-[16px]" style={{ color: "#1C1626" }}>Participants</h2>
          <Link href="/participants/new">
            <button
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(84,34,105,0.07)]"
              style={{ color: "#542269" }}
              data-testid="button-add-participant"
              title="Add participant"
            >
              <Plus className="h-4 w-4" />
            </button>
          </Link>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5" style={{ color: "#7A6A8A" }} />
            <Input
              placeholder="Search name or NDIS..."
              className="pl-8 h-8 text-[13px] rounded-lg"
              style={{ background: "#F6F4FB", borderColor: "rgba(232,213,232,0.5)" }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-participants"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {participantsLoading ? (
            Array(5).fill(0).map((_, i) => (
              <div key={i} className="px-3 py-2.5 space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))
          ) : filteredParticipants.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 px-4 text-center">
              <Users className="h-5 w-5 mx-auto" style={{ color: "#542269", opacity: 0.25 }} />
              <p className="text-[12px]" style={{ color: "#7A6A8A" }}>No participants found</p>
            </div>
          ) : (
            filteredParticipants.map((p) => {
              const isSelected = selectedId === p.id;
              const dotColor =
                p.plan_status === "active" ? "#22C55E"
                : p.plan_status === "pending" ? "#F59E0B"
                : "#9CA3AF";
              const ndisFormatted = p.ndis_number.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setShowMobileDetail(true); }}
                  data-testid={`button-participant-${p.id}`}
                  className="w-full text-left px-4 py-2.5 transition-all duration-100"
                  style={{
                    background: isSelected ? "rgba(84,34,105,0.06)" : "transparent",
                    borderLeft: isSelected ? "2px solid #542269" : "2px solid transparent",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[13px] truncate" style={{ color: "#1C1626" }}>
                      {p.full_name}
                    </span>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
                  </div>
                  <span className="text-[11px] font-mono block mt-0.5" style={{ color: "#7A6A8A" }}>
                    NDIS: {ndisFormatted}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right panel: participant detail ── */}
      <div
        className={`${showMobileDetail ? "flex" : "hidden md:flex"} flex-1 flex-col bg-white rounded-2xl overflow-hidden`}
        style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}
      >
        {selectedId ? (
          <>
            <button
              className="md:hidden flex items-center gap-2 text-[13px] font-medium px-4 py-3 border-b hover:bg-gray-50 shrink-0 transition-colors"
              style={{ color: "#542269", borderColor: "rgba(232,213,232,0.5)" }}
              onClick={() => setShowMobileDetail(false)}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Participants
            </button>
            <div className="flex-1 overflow-hidden">
              <ParticipantDetail id={selectedId} onRefreshList={refetch} />
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(84,34,105,0.07)" }}>
              <Users className="h-7 w-7" style={{ color: "#542269", opacity: 0.4 }} />
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: "#4A3D5A" }}>Select a participant</p>
              <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "#7A6A8A" }}>
                Choose a participant to view their clinical goals, session history, and NDIS compliance status.
              </p>
            </div>
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
// ---------------------------------------------------------------------------
// Goals Management Card — category badges, progress bars, history popover
// ---------------------------------------------------------------------------

const GOAL_CATEGORIES = {
  core:              { label: "Core Supports",     bg: "rgba(241,115,138,0.10)", color: "#C0365A", border: "rgba(241,115,138,0.3)"  },
  capacity_building: { label: "Capacity Building", bg: "rgba(84,34,105,0.08)",  color: "#542269", border: "rgba(84,34,105,0.2)"    },
  capital:           { label: "Capital",           bg: "rgba(59,130,246,0.08)", color: "#1D4ED8", border: "rgba(59,130,246,0.2)"   },
  general:           { label: "General",           bg: "rgba(107,114,128,0.07)",color: "#4B5563", border: "rgba(107,114,128,0.15)" },
} as const;

type GoalCategory = keyof typeof GOAL_CATEGORIES;

function catCfg(cat?: string | null) {
  return GOAL_CATEGORIES[(cat as GoalCategory) ?? "general"] ?? GOAL_CATEGORIES.general;
}

function pctColor(p: number) {
  return p >= 70 ? "#16A34A" : p >= 40 ? "#D97706" : "#DC2626";
}

function fmtGoalDate(d?: string | null) {
  if (!d) return null;
  try { return format(parseISO(d), "d MMM yyyy"); } catch { return d; }
}

function GoalsManagementCard({
  participantId,
  goals,
  onUpdated,
}: {
  participantId: string;
  goals: NDISGoal[];
  onUpdated: () => void;
}) {
  const { toast }    = useToast();
  const queryClient  = useQueryClient();

  const [showArchived,  setShowArchived ] = useState(false);
  const [isAdding,      setIsAdding     ] = useState(false);
  const [newTitle,      setNewTitle     ] = useState("");
  const [newCategory,   setNewCategory  ] = useState("general");
  const [newTargetDate, setNewTargetDate] = useState("");
  const [newProgress,   setNewProgress  ] = useState(0);

  const [editingId,     setEditingId    ] = useState<string | null>(null);
  const [editTitle,     setEditTitle    ] = useState("");
  const [editCategory,  setEditCategory ] = useState("general");
  const [editTarget,    setEditTarget   ] = useState("");
  const [editPct,       setEditPct      ] = useState(0);

  const [logGoalId,     setLogGoalId    ] = useState<string | null>(null);
  const [logPct,        setLogPct       ] = useState(0);
  const [logNote,       setLogNote      ] = useState("");

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
      queryClient.invalidateQueries({ queryKey: ["getParticipant", participantId] });
      queryClient.invalidateQueries({ queryKey: ["getParticipants"] });
      onUpdated();
    },
    onError: () => { toast({ title: "Failed to update goals", variant: "destructive" }); },
  });

  function addGoal() {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const today = new Date().toISOString().split("T")[0];
    const initHistory: NDISGoalProgressEntry[] = newProgress > 0
      ? [{ date: today, percentage: newProgress }]
      : [];
    const newGoal: NDISGoal = {
      id: `goal_${Date.now()}`,
      title: trimmed,
      status: "active",
      category: newCategory as NDISGoalCategory,
      progress_percentage: newProgress,
      target_date: newTargetDate || null,
      progress_history: initHistory,
    };
    updateGoals.mutate([...goals, newGoal], {
      onSuccess: () => {
        setNewTitle(""); setNewCategory("general"); setNewTargetDate(""); setNewProgress(0);
        setIsAdding(false);
        toast({ title: "Goal added" });
      },
    });
  }

  function startEditing(goal: NDISGoal) {
    setEditingId(goal.id);
    setEditTitle(goal.title);
    setEditCategory(goal.category ?? "general");
    setEditTarget(goal.target_date ?? "");
    setEditPct(goal.progress_percentage ?? 0);
  }

  function saveEdit() {
    const trimmed = editTitle.trim();
    if (!trimmed || !editingId) { setEditingId(null); return; }
    updateGoals.mutate(
      goals.map(g => g.id === editingId
        ? { ...g, title: trimmed, category: editCategory as NDISGoalCategory, target_date: editTarget || null, progress_percentage: editPct }
        : g),
      { onSuccess: () => { setEditingId(null); toast({ title: "Goal updated" }); } },
    );
  }

  function saveProgress(goalId: string) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    const today = new Date().toISOString().split("T")[0];
    const entry = { date: today, percentage: logPct, ...(logNote.trim() ? { note: logNote.trim() } : {}) };
    const history = [...(goal.progress_history ?? []), entry];
    updateGoals.mutate(
      goals.map(g => g.id === goalId ? { ...g, progress_percentage: logPct, progress_history: history } : g),
      { onSuccess: () => { setLogGoalId(null); setLogPct(0); setLogNote(""); toast({ title: "Progress logged" }); } },
    );
  }

  function archiveGoal(id: string) {
    updateGoals.mutate(
      goals.map(g => g.id === id ? { ...g, status: "archived" as const } : g),
      { onSuccess: () => toast({ title: "Goal archived" }) },
    );
  }

  function restoreGoal(id: string) {
    updateGoals.mutate(
      goals.map(g => g.id === id ? { ...g, status: "active" as const } : g),
      { onSuccess: () => toast({ title: "Goal restored" }) },
    );
  }

  const activeGoals   = goals.filter(g => g.status === "active");
  const archivedGoals = goals.filter(g => g.status === "archived");

  return (
    <div className="rounded-2xl overflow-hidden bg-white"
      style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: "1px solid rgba(232,213,232,0.5)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(84,34,105,0.07)" }}>
            <Target className="h-3.5 w-3.5" style={{ color: "#542269" }} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold leading-tight" style={{ color: "#1C1626" }}>Outcome Framework</h3>
            <p className="text-[11px]" style={{ color: "#7A6A8A" }}>NDIS funded support goals and progress</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs rounded-lg"
          style={{ borderColor: "rgba(232,213,232,0.5)" }}
          onClick={() => setIsAdding(v => !v)}
          data-testid="button-add-goal"
        >
          <Plus className="h-3 w-3" /> Add Goal
        </Button>
      </div>
      {/* ── Add Goal Form ── */}
      {isAdding && (
        <div className="px-5 pt-4 pb-1 space-y-3"
          style={{ borderBottom: "1px solid rgba(232,213,232,0.5)", background: "rgba(246,244,251,0.5)" }}>
          <Input
            autoFocus
            placeholder="e.g. Improve independent mobility and transition to community activities"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addGoal(); if (e.key === "Escape") setIsAdding(false); }}
            className="text-sm"
            data-testid="input-goal-title"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "#7A6A8A" }}>
                Funding Category
              </label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="core">Core Supports</SelectItem>
                  <SelectItem value="capacity_building">Capacity Building</SelectItem>
                  <SelectItem value="capital">Capital</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "#7A6A8A" }}>
                Target Date
              </label>
              <Input type="date" className="h-8 text-xs" value={newTargetDate} onChange={e => setNewTargetDate(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#7A6A8A" }}>
                Initial Progress
              </label>
              <span className="text-[10px] font-bold" style={{ color: "#542269" }}>{newProgress}%</span>
            </div>
            <input type="range" min={0} max={100} step={5}
              value={newProgress} onChange={e => setNewProgress(Number(e.target.value))}
              className="w-full h-1.5 rounded-full accent-[#542269]" />
          </div>
          <div className="flex gap-2 pb-3">
            <Button size="sm" onClick={addGoal} disabled={updateGoals.isPending || !newTitle.trim()}
              className="text-xs h-7" data-testid="button-save-goal">
              {updateGoals.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Goal"}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7"
              onClick={() => { setIsAdding(false); setNewTitle(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Goal List ── */}
      <div className="p-5 space-y-3">
        {activeGoals.length === 0 && !isAdding && (
          <div className="text-center py-8 rounded-xl border-2 border-dashed"
            style={{ borderColor: "rgba(232,213,232,0.5)" }}>
            <Target className="h-6 w-6 mx-auto mb-2" style={{ color: "rgba(84,34,105,0.2)" }} />
            <p className="text-[12px] mb-1" style={{ color: "#7A6A8A" }}>No goals linked to this plan yet</p>
            <p className="text-[11px]" style={{ color: "#C4A8CC" }}>Add funded support goals to enable compliance tracking</p>
          </div>
        )}

        {activeGoals.map(goal => {
          const cat     = catCfg(goal.category);
          const pct     = goal.progress_percentage ?? 0;
          const pc      = pctColor(pct);
          const history = goal.progress_history ?? [];
          const isEditing = editingId === goal.id;
          const isLogging = logGoalId === goal.id;

          return (
            <div key={goal.id} className="rounded-xl border overflow-hidden"
              style={{ borderColor: "rgba(232,213,232,0.5)", background: "rgba(246,244,251,0.4)" }}
              data-testid={`goal-item-${goal.id}`}>

              {isEditing ? (
                /* ── Edit form ── */
                <div className="p-4 space-y-3">
                  <Input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                    className="text-sm" data-testid={`input-edit-goal-${goal.id}`} />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={editCategory} onValueChange={setEditCategory}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="core">Core Supports</SelectItem>
                        <SelectItem value="capacity_building">Capacity Building</SelectItem>
                        <SelectItem value="capital">Capital</SelectItem>
                        <SelectItem value="general">General</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="date" className="h-8 text-xs" value={editTarget} onChange={e => setEditTarget(e.target.value)} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#7A6A8A" }}>Progress</span>
                      <span className="text-[10px] font-bold" style={{ color: "#542269" }}>{editPct}%</span>
                    </div>
                    <input type="range" min={0} max={100} step={5}
                      value={editPct} onChange={e => setEditPct(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full accent-[#542269]" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="text-xs h-7" onClick={saveEdit} disabled={updateGoals.isPending}>
                      {updateGoals.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                /* ── Goal card ── */
                <div className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    {/* Status circle */}
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5"
                      style={{ borderColor: pct >= 100 ? "#22C55E" : "rgba(84,34,105,0.3)" }}>
                      {pct >= 100 && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Category + date row */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                          style={{ background: cat.bg, color: cat.color }}>
                          {cat.label}
                        </span>
                        {goal.target_date && (
                          <span className="text-[10px] shrink-0" style={{ color: "#9CA3AF" }}>
                            Ends {fmtGoalDate(goal.target_date)}
                          </span>
                        )}
                      </div>

                      {/* Goal title */}
                      <p className="text-[13px] font-medium mb-3 leading-snug" style={{ color: "#1C1626" }}>{goal.title}</p>

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#9CA3AF" }}>Progress</span>
                          <span className="text-[10px] font-bold" style={{ color: "#542269" }}>{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(232,213,232,0.5)" }}>
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: "#542269" }} />
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* Progress history popover */}
                      <Popover open={isLogging} onOpenChange={open => {
                        setLogGoalId(open ? goal.id : null);
                        if (open) { setLogPct(pct); setLogNote(""); }
                      }}>
                        <PopoverTrigger asChild>
                          <button className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white"
                            style={{ color: "#7A6A8A" }} title="Log progress">
                            <TrendingUp className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-0" align="end">
                          <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(232,213,232,0.5)" }}>
                            <p className="text-[13px] font-semibold" style={{ color: "#1C1626" }}>Log Progress</p>
                            <p className="text-[11px] truncate" style={{ color: "#7A6A8A" }}>{goal.title}</p>
                          </div>

                          {/* Sparkline history */}
                          {history.length > 0 && (
                            <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(232,213,232,0.5)" }}>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#7A6A8A" }}>History</p>
                              <div className="flex items-end gap-0.5 h-9 mb-2.5">
                                {history.slice(-12).map((h, i) => (
                                  <div key={i} className="flex-1 rounded-sm"
                                    style={{
                                      height: `${Math.max(4, (h.percentage / 100) * 36)}px`,
                                      background: pctColor(h.percentage),
                                      opacity: 0.5 + (i / history.slice(-12).length) * 0.5,
                                    }}
                                    title={`${h.date}: ${h.percentage}%`} />
                                ))}
                              </div>
                              {history.slice(-3).reverse().map((h, i) => (
                                <div key={i} className="flex items-center justify-between py-0.5">
                                  <span className="text-[10px]" style={{ color: "#7A6A8A" }}>{fmtGoalDate(h.date)}</span>
                                  <div className="flex items-center gap-2">
                                    {h.note && <span className="text-[10px] italic truncate max-w-28" style={{ color: "#4A3D5A" }}>{h.note}</span>}
                                    <span className="text-[10px] font-bold" style={{ color: pctColor(h.percentage) }}>{h.percentage}%</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Log new progress */}
                          <div className="px-4 py-3 space-y-2.5">
                            <div>
                              <div className="flex justify-between mb-1">
                                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#7A6A8A" }}>New Progress</label>
                                <span className="text-[10px] font-bold" style={{ color: "#542269" }}>{logPct}%</span>
                              </div>
                              <input type="range" min={0} max={100} step={5}
                                value={logPct} onChange={e => setLogPct(Number(e.target.value))}
                                className="w-full h-1.5 rounded-full accent-[#542269]" />
                            </div>
                            <Input placeholder="Note (optional)" value={logNote}
                              onChange={e => setLogNote(e.target.value)} className="h-8 text-xs" />
                            <Button size="sm" className="w-full text-xs h-8 text-white"
                              style={{ background: "linear-gradient(135deg, #F1738A 0%, #542269 100%)" }}
                              onClick={() => saveProgress(goal.id)} disabled={updateGoals.isPending}>
                              {updateGoals.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Progress"}
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>

                      <button className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white"
                        style={{ color: "#7A6A8A" }}
                        onClick={() => startEditing(goal)} title="Edit goal"
                        data-testid={`button-edit-goal-${goal.id}`}>
                        <Edit className="h-3.5 w-3.5" />
                      </button>

                      <button className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-amber-50"
                        style={{ color: "#7A6A8A" }}
                        onClick={() => archiveGoal(goal.id)} disabled={updateGoals.isPending}
                        title="Archive goal" data-testid={`button-archive-goal-${goal.id}`}>
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Archived goals */}
        {archivedGoals.length > 0 && (
          <div>
            <button className="flex items-center gap-1 text-[12px] mt-1 mb-2 hover:opacity-70 transition-opacity"
              style={{ color: "#7A6A8A" }} onClick={() => setShowArchived(v => !v)}>
              {showArchived ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showArchived ? "Hide" : "Show"} archived ({archivedGoals.length})
            </button>
            {showArchived && (
              <ul className="space-y-2">
                {archivedGoals.map(goal => (
                  <li key={goal.id}
                    className="flex items-center gap-2 p-3 rounded-xl border border-dashed group"
                    style={{ borderColor: "rgba(232,213,232,0.5)" }}>
                    <XCircle className="h-4 w-4 shrink-0" style={{ color: "#D1D5DB" }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] line-through block truncate" style={{ color: "#7A6A8A" }}>{goal.title}</span>
                      <span className="text-[10px]" style={{ color: catCfg(goal.category).color }}>
                        {catCfg(goal.category).label}
                      </span>
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-[12px] font-medium transition-all hover:text-emerald-600"
                      style={{ color: "#7A6A8A" }}
                      onClick={() => restoreGoal(goal.id)} disabled={updateGoals.isPending} title="Restore goal">
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
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

  // Right-sidebar computed values
  const lastSession = typedSessions?.[0] ?? null;
  const daysUntilPlanEnd = (() => {
    const d = participant?.plan_end_date ? String(participant.plan_end_date) : null;
    if (!d) return null;
    try { return Math.floor((parseISO(d).getTime() - Date.now()) / 86400000); }
    catch { return null; }
  })();
  const draftCount = typedSessions?.filter(s => s.status === "draft").length ?? 0;
  const sessionsWithScores = typedSessions?.filter(s => s.compliance_score != null) ?? [];
  const avgCompliance = sessionsWithScores.length > 0
    ? sessionsWithScores.reduce((a, s) => a + Number(s.compliance_score), 0) / sessionsWithScores.length
    : null;
  const activeGoalsList = ((participant?.goals ?? []) as NDISGoal[]).filter(g => g.status === "active");
  const lowProgressGoalsList = activeGoalsList.filter(g => (g.progress_percentage ?? 0) < 30);
  const goalCoverage = activeGoalsList.length > 0
    ? Math.round(activeGoalsList.filter(g => (g.progress_percentage ?? 0) >= 50).length / activeGoalsList.length * 100)
    : 0;
  const complianceAlerts: string[] = [
    ...(daysUntilPlanEnd !== null && daysUntilPlanEnd >= 0 && daysUntilPlanEnd <= 60
      ? [`Progress Report for NDIS Review is due in ${daysUntilPlanEnd} days. Current outcome data covers ${goalCoverage}% of goals.`]
      : []),
    ...(draftCount > 0
      ? [`${draftCount} session${draftCount > 1 ? "s" : ""} ${draftCount > 1 ? "have" : "has"} missing clinical notes.`]
      : []),
    ...(avgCompliance !== null && avgCompliance < 70
      ? [`Average compliance score is ${avgCompliance.toFixed(0)}%. Review flagged sessions.`]
      : []),
    ...(lowProgressGoalsList.length > 0
      ? [`${lowProgressGoalsList.length} goal${lowProgressGoalsList.length > 1 ? "s" : ""} below 30% progress. Update outcome documentation.`]
      : []),
  ];
  const TAB_CLS = "data-[state=active]:border-b-2 data-[state=active]:border-[#542269] data-[state=active]:text-[#542269] rounded-none pb-2 px-3 text-[13px] font-medium text-[#7A6A8A] hover:text-[#1C1626] transition-colors";

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 shrink-0"
        style={{ borderBottom: "1px solid rgba(232,213,232,0.5)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
              <h2 className="text-[22px] font-bold tracking-tight" style={{ color: "#1C1626" }}>
                {participant.full_name}
              </h2>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${statusBadge(String(participant.plan_status ?? ""))}`}>
                {String(participant.plan_status ?? "").charAt(0).toUpperCase() + String(participant.plan_status ?? "").slice(1)}
              </span>
            </div>
            {lastSession?.session_date ? (
              <div className="flex items-center gap-1.5 text-[13px]" style={{ color: "#7A6A8A" }}>
                <Calendar className="h-3.5 w-3.5" />
                <span>Last clinical session: <span className="font-medium" style={{ color: "#4A3D5A" }}>{safeFormat(lastSession.session_date)}</span></span>
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "#9CA3AF" }}>No sessions recorded yet</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            <Link href={`/sessions/new?participantId=${id}`}>
              <Button size="sm" variant="outline" className="rounded-xl text-[13px] h-9"
                style={{ borderColor: "rgba(232,213,232,0.5)", color: "#4A3D5A" }}>
                Create Service Note
              </Button>
            </Link>
            <Link href={`/participants/${id}/edit`}>
              <Button size="sm" className="rounded-xl text-[13px] h-9 text-white"
                style={{ background: "#542269", border: "none" }}>
                Edit Profile
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Body: Tabs + Right Sidebar ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Center: tabs */}
        <Tabs defaultValue="goals" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 border-b" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
            <TabsList className="h-10 bg-transparent gap-0 p-0">
              <TabsTrigger value="goals" className={TAB_CLS}>Clinical Goals</TabsTrigger>
              <TabsTrigger value="history" className={TAB_CLS}>Session History</TabsTrigger>
              <TabsTrigger value="files" className={TAB_CLS}>Files</TabsTrigger>
            </TabsList>
          </div>

          {/* ── Clinical Goals Tab ── */}
          <TabsContent value="goals" className="flex-1 overflow-y-auto p-6 space-y-5 mt-0">
            <GoalsManagementCard
              participantId={id}
              goals={(participant.goals as NDISGoal[]) ?? []}
              onUpdated={handleSaved}
            />
            {aiSummary?.summary && (
              <div className="rounded-2xl p-5" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="h-4 w-4" style={{ color: "#542269" }} />
                  <p className="text-[13px] font-semibold" style={{ color: "#542269" }}>AI Clinical Summary</p>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: "#4A3D5A" }}>{aiSummary.summary}</p>
                <p className="text-[11px] font-medium mt-3" style={{ color: "#7A6A8A" }}>Based on {aiSummary.sessions_count} recent sessions</p>
              </div>
            )}
          </TabsContent>

          {/* ── Session History Tab ── */}
          <TabsContent value="history" className="flex-1 overflow-y-auto p-6 space-y-4 mt-0">
            {typedSessions && typedSessions.length > 0 && (
              <BodyMarkerHistory
                sessions={typedSessions.map((s) => ({
                  id: s.id,
                  session_date: s.session_date,
                  session_type: s.session_type,
                  body_markers: Array.isArray(s.body_markers) ? s.body_markers : [],
                }))}
                bodyType={typedParticipant?.biological_sex}
              />
            )}
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-[14px] flex items-center gap-2 shrink-0" style={{ color: "#1C1626" }}>
                <History className="h-4 w-4" style={{ color: "#542269" }} />
                Session History
                {typedSessions && (
                  <span className="text-[12px] font-normal" style={{ color: "#7A6A8A" }}>({typedSessions.length})</span>
                )}
              </h3>
              <div className="relative max-w-[200px] w-full">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5" style={{ color: "#7A6A8A" }} />
                <Input
                  placeholder="Search sessions..."
                  className="pl-8 h-8 text-[13px]"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
              </div>
            </div>
            {sessionsLoading ? (
              <div className="space-y-3">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center p-12 border-2 border-dashed rounded-2xl"
                style={{ borderColor: "rgba(232,213,232,0.5)" }}>
                <FileText className="h-8 w-8 mx-auto mb-3" style={{ color: "rgba(84,34,105,0.2)" }} />
                <p className="text-[13px]" style={{ color: "#7A6A8A" }}>
                  {historySearch ? "No sessions match your search" : "No sessions recorded yet"}
                </p>
                {!historySearch && (
                  <Link href={`/sessions/new?participantId=${id}`}>
                    <Button size="sm" variant="outline" className="mt-4 rounded-xl">Record First Session</Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredHistory.map((s) => (
                  <Link key={s.id} href={`/sessions/${s.id}`}>
                    <div className="border rounded-xl p-4 hover:border-[rgba(84,34,105,0.25)] transition-colors cursor-pointer group"
                      style={{ borderColor: "rgba(232,213,232,0.5)" }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-[13px] group-hover:text-[#542269] transition-colors truncate" style={{ color: "#1C1626" }}>
                              {s.session_type || "Session"}
                            </span>
                            <span className="text-[11px] flex items-center gap-1 shrink-0" style={{ color: "#7A6A8A" }}>
                              <Clock className="h-3 w-3" /> {s.duration_minutes} min
                            </span>
                          </div>
                          {s.notes && (
                            <p className="text-[12px] line-clamp-2" style={{ color: "#7A6A8A" }}>{s.notes}</p>
                          )}
                          {Array.isArray(s.tags) && s.tags.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {s.tags.map((t: string) => (
                                <span key={t} className="text-[10px] uppercase tracking-wide font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          {Array.isArray(s.body_markers) && s.body_markers.length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5">
                              <MapPin className="h-2.5 w-2.5 text-indigo-500" />
                              <span className="text-[10px] text-indigo-600 font-medium">
                                {s.body_markers.length} body finding{s.body_markers.length !== 1 ? "s" : ""} recorded
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-[11px]" style={{ color: "#7A6A8A" }}>{safeFormat(s.session_date)}</span>
                          <div className="flex items-center gap-1.5">
                            {s.status === "draft" ? (
                              <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200 text-[10px]">Draft</Badge>
                            ) : (
                              <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-200 text-[10px]">Completed</Badge>
                            )}
                            {s.compliance_score != null && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                Number(s.compliance_score) >= 80 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                : Number(s.compliance_score) >= 60 ? "text-amber-700 bg-amber-50 border-amber-200"
                                : "text-red-700 bg-red-50 border-red-200"
                              }`}>
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

          {/* ── Files Tab ── */}
          <TabsContent value="files" className="flex-1 overflow-y-auto p-6 mt-0">
            <div className="text-center py-16 rounded-2xl border-2 border-dashed"
              style={{ borderColor: "rgba(232,213,232,0.5)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(84,34,105,0.06)" }}>
                <FileText className="h-5 w-5" style={{ color: "rgba(84,34,105,0.25)" }} />
              </div>
              <p className="text-[14px] font-medium mb-1" style={{ color: "#4A3D5A" }}>No files uploaded yet</p>
              <p className="text-[12px]" style={{ color: "#7A6A8A" }}>
                Clinical documents, reports and evidence files will appear here
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Right Sidebar ── */}
        <div className="w-[216px] shrink-0 overflow-y-auto p-4 space-y-5"
          style={{ borderLeft: "1px solid rgba(232,213,232,0.5)" }}>

          {/* Financial Snapshot */}
          <div>
            <h4 className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: "#7A6A8A" }}>
              Financial Snapshot
            </h4>
            <div className="rounded-xl p-3 space-y-3"
              style={{ border: "1px solid rgba(232,213,232,0.5)", background: "rgba(246,244,251,0.4)" }}>
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <DollarSign className="h-3 w-3" style={{ color: "#542269" }} />
                  <span className="text-[11px] font-medium" style={{ color: "#4A3D5A" }}>NDIS Funding Utilisation</span>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-[13px] font-bold" style={{ color: "#1C1626" }}>
                    ${(participant.used_budget as number)?.toLocaleString() ?? "0"}
                  </span>
                  <span className="text-[11px]" style={{ color: "#7A6A8A" }}>
                    / ${(participant.total_budget as number)?.toLocaleString() ?? "0"}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(232,213,232,0.5)" }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${budgetPct}%`, background: budgetPct >= 90 ? "#EF4444" : "#542269" }} />
                </div>
                <p className="text-[9px] mt-1.5 italic leading-relaxed" style={{ color: "#9CA3AF" }}>
                  Calculated based on approved service bookings and invoiced hours.
                </p>
              </div>
              <div className="space-y-2 pt-2" style={{ borderTop: "1px solid rgba(232,213,232,0.4)" }}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px]" style={{ color: "#7A6A8A" }}>Service Agreement</span>
                  <span className={`text-[11px] font-semibold ${String(participant.plan_status) === "active" ? "text-emerald-600" : "text-amber-600"}`}>
                    {String(participant.plan_status) === "active" ? "Signed & Active" : String(participant.plan_status ?? "Unknown")}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px]" style={{ color: "#7A6A8A" }}>Provider</span>
                  <span className="text-[11px] font-medium" style={{ color: "#542269" }}>NDIS Provider</span>
                </div>
                {participant.plan_end_date && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px]" style={{ color: "#7A6A8A" }}>Plan Ends</span>
                    <span className="text-[11px] font-medium"
                      style={{ color: daysUntilPlanEnd !== null && daysUntilPlanEnd <= 30 ? "#EF4444" : "#1C1626" }}>
                      {safeFormat(String(participant.plan_end_date))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Compliance Alerts */}
          <div>
            <h4 className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: "#7A6A8A" }}>
              Compliance Alerts
            </h4>
            {complianceAlerts.length > 0 ? (
              <div className="rounded-xl p-3 space-y-2"
                style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.35)" }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700">Attention Needed</span>
                </div>
                <div className="space-y-2">
                  {complianceAlerts.map((alert, i) => (
                    <p key={i} className="text-[11px] leading-relaxed" style={{ color: "#92400E" }}>{alert}</p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-3 flex items-center gap-2"
                style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="text-[11px] text-emerald-700">All checks passed</span>
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-[9px] font-bold uppercase tracking-widest mb-2.5" style={{ color: "#7A6A8A" }}>
              Quick Links
            </h4>
            <div className="space-y-0.5">
              <Link href={`/sessions/new?participantId=${id}`}>
                <button className="w-full text-left text-[12px] px-2 py-1.5 rounded-lg transition-colors hover:bg-[rgba(84,34,105,0.06)]"
                  style={{ color: "#542269" }}>
                  + New Session
                </button>
              </Link>
              <Link href="/compliance">
                <button className="w-full text-left text-[12px] px-2 py-1.5 rounded-lg transition-colors hover:bg-[rgba(84,34,105,0.06)]"
                  style={{ color: "#542269" }}>
                  Compliance Centre
                </button>
              </Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

