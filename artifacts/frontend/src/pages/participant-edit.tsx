import { useLocation } from "wouter";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetParticipant } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SmartInput } from "@/components/SmartInput";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Edit, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

const schema = z.object({
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

type FormValues = z.infer<typeof schema>;

export default function ParticipantEdit({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: participantData, isLoading } = useGetParticipant(id, {});
  const participant = (participantData as { data?: Record<string, unknown> } | undefined)?.data ?? null;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "",
      ndis_number: "",
      date_of_birth: "",
      email: "",
      phone: "",
      primary_disability: "",
      biological_sex: "unspecified",
      plan_status: "active",
      plan_start_date: "",
      plan_end_date: "",
      total_budget: 0,
    },
  });

  useEffect(() => {
    if (!participant) return;
    form.reset({
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
    });
  }, [participant, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.email) delete payload.email;
      if (!payload.phone) delete payload.phone;
      if (!payload.primary_disability) delete payload.primary_disability;
      if (!payload.plan_start_date) delete payload.plan_start_date;
      if (!payload.plan_end_date) delete payload.plan_end_date;

      const res = await fetch(`/api/participants/${id}`, {
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
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!participant) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 text-slate-500">
        Participant not found.{" "}
        <button onClick={() => navigate("/patients")} className="underline text-[#5271FF]">
          Back to Participants
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/patients")}
          className="gap-1.5 text-slate-500 hover:text-[#0D0D55] -ml-2 rounded-xl"
        >
          <ArrowLeft size={15} />
          Participants
        </Button>
        <span className="text-slate-300">/</span>
        <span className="text-sm text-slate-500 truncate max-w-[160px]">
          {String(participant.full_name ?? "")}
        </span>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-[#0D0D55]">Edit</span>
      </div>

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-[#FA879F]/20 flex items-center justify-center">
          <Edit size={18} className="text-[#0D0D55]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#0D0D55]">Edit Participant</h1>
          <p className="text-sm text-slate-500">{String(participant.full_name ?? "")} · NDIS {String(participant.ndis_number ?? "")}</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => updateMutation.mutate(d))} className="space-y-5">
          {/* Personal details */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-600">Personal Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="full_name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Full Name <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="Jane Smith" data-testid="input-full-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ndis_number" render={({ field }) => (
                <FormItem>
                  <FormLabel>NDIS Number <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="430012345" data-testid="input-ndis-number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="date_of_birth" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Birth <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input type="date" data-testid="input-date-of-birth" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="jane@email.com" data-testid="input-email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="0412 345 678" data-testid="input-phone" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="primary_disability" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Primary Disability</FormLabel>
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
              <FormField control={form.control} name="biological_sex" render={({ field }) => (
                <FormItem>
                  <FormLabel>Biological Sex</FormLabel>
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
            </CardContent>
          </Card>

          {/* NDIS Plan */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-600">NDIS Plan</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="plan_status" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Plan Status <span className="text-destructive">*</span></FormLabel>
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
                  <FormLabel>Plan Start Date</FormLabel>
                  <FormControl><Input type="date" data-testid="input-plan-start-date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="plan_end_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan End Date</FormLabel>
                  <FormControl><Input type="date" data-testid="input-plan-end-date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="total_budget" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Total Budget ($)</FormLabel>
                  <FormControl><Input type="number" placeholder="50000" data-testid="input-total-budget" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/patients")}
              className="rounded-xl border-slate-200"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-[#0D0D55] hover:bg-[#1a1a77] text-white rounded-xl gap-2"
            >
              {updateMutation.isPending
                ? <Loader2 size={15} className="animate-spin" />
                : <Edit size={15} />}
              Save Changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
