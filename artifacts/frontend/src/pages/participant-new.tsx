import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateParticipant } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SmartInput } from "@/components/SmartInput";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, UserPlus, Loader2 } from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "#542269";
const CORAL  = "#F1738A";
const T1     = "#1C1626";
const T2     = "#4A3D5A";
const T3     = "#7A6A8A";
const BORDER = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

const schema = z.object({
  full_name:                  z.string().min(1, "Name is required"),
  ndis_number:                z.string().min(1, "NDIS Number is required"),
  date_of_birth:              z.string().min(1, "Date of birth is required"),
  email:                      z.string().email("Invalid email").optional().or(z.literal("")),
  phone:                      z.string().optional(),
  primary_disability:         z.string().optional(),
  allergies:                  z.string().optional(),
  communication_preferences:  z.string().optional(),
  biological_sex:             z.string().optional(),
  plan_status:                z.string().min(1, "Plan status is required"),
  plan_start_date:            z.string().optional(),
  plan_end_date:              z.string().optional(),
  total_budget:               z.coerce.number().min(0).optional(),
});
type FormValues = z.infer<typeof schema>;

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>{title}</p>
      </div>
      <div className="p-6 grid grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

export default function ParticipantNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createParticipant = useCreateParticipant();
  const { token } = useAuth();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "", ndis_number: "", date_of_birth: "", email: "", phone: "",
      primary_disability: "", allergies: "", communication_preferences: "",
      biological_sex: "unspecified", plan_status: "active",
      plan_start_date: "", plan_end_date: "", total_budget: 0,
    },
  });

  async function onSubmit(data: FormValues) {
    const payload: Record<string, unknown> = { ...data };
    if (!payload.email)                      delete payload.email;
    if (!payload.phone)                      delete payload.phone;
    if (!payload.primary_disability)         delete payload.primary_disability;
    if (!payload.allergies)                  delete payload.allergies;
    if (!payload.communication_preferences)  delete payload.communication_preferences;
    if (!payload.plan_start_date)            delete payload.plan_start_date;
    if (!payload.plan_end_date)              delete payload.plan_end_date;
    if (!payload.total_budget)               delete payload.total_budget;

    try {
      const created = await createParticipant.mutateAsync(payload as Parameters<typeof createParticipant.mutateAsync>[0]);

      // If plan dates provided, create initial NDIS plan (require both dates)
      const start = (data.plan_start_date || "").toString().trim();
      const end = (data.plan_end_date || "").toString().trim();
      if (created?.id && start && end) {
        try {
          const headers: Record<string,string> = { "Content-Type": "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          await fetch(`/api/participants/${created.id}/plan`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              status: data.plan_status,
              plan_start: start,
              plan_end: end,
              total_funding: data.total_budget ?? null,
            }),
          });
        } catch (err) {
          console.warn("Failed to create initial plan", err);
        }
      }

      toast({ title: "Participant added successfully" });
      navigate("/patients");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add participant";
      toast({ title: msg, variant: "destructive" });
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/patients")}
          className="flex items-center gap-1.5 transition-colors hover:opacity-80"
          style={{ color: T3 }}
        >
          <ArrowLeft size={14} /> Participants
        </button>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="font-medium" style={{ color: T1 }}>Add Participant</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: `${PLUM}12` }}>
          <UserPlus size={18} style={{ color: PLUM }} />
        </div>
        <div>
          <h1 className="text-[22px] font-bold" style={{ color: T1 }}>Add Participant</h1>
          <p className="text-[13px]" style={{ color: T2 }}>Create a new NDIS participant record</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

          <FormCard title="Personal Details">
            <FormField control={form.control} name="full_name" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel style={{ color: T2, fontSize: 12 }}>Full Name <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input placeholder="Jane Smith" data-testid="input-full-name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="ndis_number" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>NDIS Number <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input placeholder="430012345" data-testid="input-ndis-number" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="date_of_birth" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>Date of Birth <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input type="date" data-testid="input-date-of-birth" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>Email</FormLabel>
                <FormControl><Input type="email" placeholder="jane@email.com" data-testid="input-email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>Phone</FormLabel>
                <FormControl><Input placeholder="0412 345 678" data-testid="input-phone" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="primary_disability" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel style={{ color: T2, fontSize: 12 }}>Primary Disability</FormLabel>
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
            )} />
            <FormField control={form.control} name="allergies" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel style={{ color: T2, fontSize: 12 }}>Known Allergies / Contraindications</FormLabel>
                <FormControl>
                  <SmartInput
                    placeholder="e.g. Penicillin, latex — leave blank if none"
                    data-testid="input-allergies"
                    value={field.value ?? ""}
                    onChange={(v) => field.onChange(v)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="communication_preferences" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel style={{ color: T2, fontSize: 12 }}>Communication Preferences</FormLabel>
                <FormControl>
                  <SmartInput
                    placeholder="e.g. Uses AAC device, prefers visual cues, responds to short sentences"
                    data-testid="input-communication-preferences"
                    value={field.value ?? ""}
                    onChange={(v) => field.onChange(v)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="biological_sex" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>Biological Sex</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? "unspecified"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-biological-sex"><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="unspecified">Prefer not to say</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </FormCard>

          <FormCard title="NDIS Plan">
            <FormField control={form.control} name="plan_status" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel style={{ color: T2, fontSize: 12 }}>Plan Status <span className="text-red-500">*</span></FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-plan-status"><SelectValue /></SelectTrigger>
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
            )} />
            <FormField control={form.control} name="plan_start_date" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>Plan Start Date</FormLabel>
                <FormControl><Input type="date" data-testid="input-plan-start-date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="plan_end_date" render={({ field }) => (
              <FormItem>
                <FormLabel style={{ color: T2, fontSize: 12 }}>Plan End Date</FormLabel>
                <FormControl><Input type="date" data-testid="input-plan-end-date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="total_budget" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel style={{ color: T2, fontSize: 12 }}>Total Budget ($)</FormLabel>
                <FormControl><Input type="number" placeholder="50000" data-testid="input-total-budget" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </FormCard>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => navigate("/patients")}
              className="px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors hover:bg-[#F6F4FB]"
              style={{ borderColor: BORDER, color: T2 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createParticipant.isPending}
              data-testid="button-add-participant"
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {createParticipant.isPending
                ? <Loader2 size={14} className="animate-spin" />
                : <UserPlus size={14} />}
              Add Participant
            </button>
          </div>
        </form>
      </Form>
    </div>
  );
}
