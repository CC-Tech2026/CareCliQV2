import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetParticipant } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SmartInput } from "@/components/SmartInput";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";
import { ArrowLeft, Edit, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM        = "#542269";
const CORAL       = "#F1738A";
const T1          = "#1C1626";
const T2          = "#4A3D5A";
const T3          = "#7A6A8A";
const BORDER      = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

const schema = z.object({
  full_name:          z.string().min(1, "Name is required"),
  ndis_number:        z.string().min(1, "NDIS Number is required"),
  date_of_birth:      z.string().min(1, "Date of birth is required"),
  email:              z.string().email("Invalid email").optional().or(z.literal("")),
  phone:              z.string().optional(),
  emergency_contact:  z.string().optional(),
  primary_disability: z.string().optional(),
  biological_sex:     z.string().optional(),
  plan_status:        z.string().min(1, "Plan status is required"),
  plan_start_date:    z.string().optional(),
  plan_end_date:      z.string().optional(),
  total_budget:       z.coerce.number().min(0).optional(),
});
type FormValues = z.infer<typeof schema>;

// Updated FormCard: Changed to single column flow on mobile, 2 columns on tablet/desktop
function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
      <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>{title}</p>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

export default function ParticipantEdit({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: participantData, isLoading } = useGetParticipant(id, {});
  const participant = (participantData as { data?: Record<string, unknown> } | undefined)?.data ?? null;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "", ndis_number: "", date_of_birth: "", email: "", phone: "", emergency_contact: "",
      primary_disability: "", biological_sex: "unspecified", plan_status: "active",
      plan_start_date: "", plan_end_date: "", total_budget: 0,
    },
  });

  useEffect(() => {
    if (!participant) return;
    form.reset({
      full_name:          String(participant.full_name ?? ""),
      ndis_number:        String(participant.ndis_number ?? ""),
      date_of_birth:      participant.date_of_birth ? String(participant.date_of_birth).slice(0, 10) : "",
      email:              String(participant.email ?? ""),
      phone:              String(participant.phone ?? ""),
      emergency_contact:  String(participant.emergency_contact ?? ""),
      primary_disability: String(participant.primary_disability ?? ""),
      biological_sex:     String(participant.biological_sex ?? "unspecified"),
      plan_status:        String(participant.plan_status ?? "active"),
      plan_start_date:    participant.plan_start_date ? String(participant.plan_start_date).slice(0, 10) : "",
      plan_end_date:      participant.plan_end_date ? String(participant.plan_end_date).slice(0, 10) : "",
      total_budget:       Number(participant.total_budget ?? 0),
    });
  }, [participant, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.email)              delete payload.email;
      if (!payload.phone)              delete payload.phone;
      if (!payload.emergency_contact)  delete payload.emergency_contact;
      if (!payload.primary_disability) delete payload.primary_disability;
      if (!payload.plan_start_date)    delete payload.plan_start_date;
      if (!payload.plan_end_date)      delete payload.plan_end_date;

      const res = await apiFetch(`/api/participants/${id}`, {
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
      navigate("/patients");
    },
    onError: (err: Error) => {
      toast({ title: err.message || "Update failed", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 p-4 md:p-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-64 rounded-xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-60 w-full rounded-2xl" />
      </div>
    );
  }

  if (!participant) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 px-4" style={{ color: T2 }}>
        Participant not found.{" "}
        <button onClick={() => navigate("/patients")} className="underline font-medium" style={{ color: CORAL }}>
          Back to Participants
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4 md:p-8">

      {/* Breadcrumb - Touch-friendly tap targets */}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/patients")}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70 py-1.5 -my-1.5"
          style={{ color: T3 }}
        >
          <ArrowLeft size={14} /> Participants
        </button>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="truncate max-w-[120px] sm:max-w-[200px]" style={{ color: T2 }}>
          {String(participant.full_name ?? "")}
        </span>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="font-medium" style={{ color: T1 }}>Edit</span>
      </div>

      {/* Header Info Banner */}
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: `${CORAL}15` }}>
          <Edit size={18} style={{ color: PLUM }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight truncate" style={{ color: T1 }}>Edit Participant</h1>
          <p className="text-[13px] mt-0.5 truncate" style={{ color: T2 }}>
            {String(participant.full_name ?? "")} · <span className="font-medium">NDIS:</span> {String(participant.ndis_number ?? "")}
          </p>
        </div>
      </div>

      <Form {...(form as any)}>
        <form onSubmit={form.handleSubmit((d: any) => updateMutation.mutate(d))} className="space-y-5">

          {/* SECTION 1: Personal Details */}
          <FormCard title="Personal Details">
            <FormField control={form.control as any} name="full_name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Full Name <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input className="h-10 text-[14px] rounded-xl" placeholder="Jane Smith" data-testid="input-full-name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="ndis_number" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>NDIS Number <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input className="h-10 text-[14px] rounded-xl" placeholder="430012345" data-testid="input-ndis-number" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="date_of_birth" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Date of Birth <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input type="date" className="h-10 text-[14px] rounded-xl native-calendar-picker" data-testid="input-date-of-birth" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Email</FormLabel>
                <FormControl><Input type="email" className="h-10 text-[14px] rounded-xl" placeholder="jane@email.com" data-testid="input-email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Phone</FormLabel>
                <FormControl><Input type="tel" className="h-10 text-[14px] rounded-xl" placeholder="0412 345 678" data-testid="input-phone" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="emergency_contact" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Emergency Contact</FormLabel>
                <FormControl><Input className="h-10 text-[14px] rounded-xl" placeholder="Name / Phone / Relationship" data-testid="input-emergency-contact" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="primary_disability" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Primary Disability</FormLabel>
                <FormControl>
                  <SmartInput
                    placeholder="e.g. Autism Spectrum Disorder"
                    data-testid="input-primary-disability"
                    value={field.value ?? ""}
                    onChange={(v) => field.onChange(v)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="biological_sex" render={({ field }) => (
              <FormItem className="sm:col-span-2 md:col-span-1">
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Biological Sex</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? "unspecified"}>
                  <FormControl>
                    <SelectTrigger className="h-10 text-[14px] rounded-xl bg-white" data-testid="select-biological-sex" style={{ borderColor: BORDER }}>
                      <SelectValue />
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
            )} />
          </FormCard>

          {/* SECTION 2: NDIS Plan */}
          <FormCard title="NDIS Plan">
            <FormField control={form.control as any} name="plan_status" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Plan Status <span className="text-red-500">*</span></FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="h-10 text-[14px] rounded-xl bg-white" data-testid="select-plan-status" style={{ borderColor: BORDER }}>
                      <SelectValue />
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
            )} />

            <FormField control={form.control as any} name="plan_start_date" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Plan Start Date</FormLabel>
                <FormControl><Input type="date" className="h-10 text-[14px] rounded-xl native-calendar-picker" data-testid="input-plan-start-date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="plan_end_date" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Plan End Date</FormLabel>
                <FormControl><Input type="date" className="h-10 text-[14px] rounded-xl native-calendar-picker" data-testid="input-plan-end-date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control as any} name="total_budget" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-[12px] font-medium" style={{ color: T2 }}>Total Budget ($)</FormLabel>
                <FormControl><Input type="number" className="h-10 text-[14px] rounded-xl" placeholder="50000" data-testid="input-total-budget" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </FormCard>

          {/* Form Actions Layout - Clean spacing for thumb tabs */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate("/patients")}
              className="h-11 sm:h-10 px-5 rounded-xl text-[13px] font-semibold border transition-colors hover:bg-[#F6F4FB] text-center"
              style={{ borderColor: BORDER, color: T2 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="flex items-center justify-center gap-2 h-11 sm:h-10 px-6 rounded-xl text-white text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Edit size={14} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Form>
    </div>
  );
}
