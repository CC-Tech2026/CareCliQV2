import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateParticipant, type CreateParticipantBody } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SmartInput } from "@/components/SmartInput";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  ArrowLeft, UserPlus, Loader2, User, ClipboardList, ShieldCheck,
  Cake, Mail, Phone, HeartPulse, MessagesSquare, Wallet, CalendarRange,
} from "lucide-react";

// -- Design tokens -------------------------------------------------------------
const PLUM   = "var(--cc-plum)";
const T1     = "#1C1626";
const T2     = "#374151";
const T3     = "#7A6A8A";
const BORDER = "var(--cc-border)";
const CARD_SHADOW = "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

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

const PLAN_STATUS_TONE: Record<string, { bg: string; color: string }> = {
  active:   { bg: "#ECFDF5", color: "#166534" },
  pending:  { bg: "#FFFBEB", color: "#92400E" },
  inactive: { bg: "#F3F4F6", color: "#6A6A77" },
  expired:  { bg: "#FEF2F2", color: "#B91C1C" },
};

function SectionCard({
  title, icon: Icon, children,
}: { title: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="bg-cc-surface rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
        <Icon size={14} style={{ color: PLUM }} />
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>{title}</p>
      </div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">{children}</div>
    </div>
  );
}

function FieldLabel({ icon: Icon, children, required }: { icon?: typeof User; children: React.ReactNode; required?: boolean }) {
  return (
    <FormLabel className="flex items-center gap-1.5" style={{ color: T2, fontSize: 12 }}>
      {Icon && <Icon size={11} style={{ color: T3 }} />}
      {children} {required && <span className="text-red-500">*</span>}
    </FormLabel>
  );
}

export default function ParticipantNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const createParticipant = useCreateParticipant();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "", ndis_number: "", date_of_birth: "", email: "", phone: "",
      primary_disability: "", allergies: "", communication_preferences: "",
      biological_sex: "unspecified", plan_status: "active",
      plan_start_date: "", plan_end_date: "", total_budget: 0,
    },
  });

  const watched = form.watch();
  const previewInitials = (watched.full_name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
  const planTone = PLAN_STATUS_TONE[watched.plan_status] ?? PLAN_STATUS_TONE.active;

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
      await createParticipant.mutateAsync({ data: payload as unknown as CreateParticipantBody });
      toast({ title: translate("patients.toast.added") });
      navigate("/patients");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : translate("patients.toast.addFailed");
      toast({ title: msg, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 pb-10">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/patients")}
          className="flex items-center gap-1.5 transition-colors hover:opacity-80"
          style={{ color: T3 }}
        >
          <ArrowLeft size={14} /> {translate("patients.title")}
        </button>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="font-medium" style={{ color: T1 }}>{translate("patients.addTitle")}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: `${PLUM}12` }}>
          <UserPlus size={18} style={{ color: PLUM }} />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>{translate("patients.addTitle")}</h1>
          <p className="text-[13px]" style={{ color: T2 }}>{translate("patients.addSubtitle")}</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
            {/* ── Main form column ───────────────────────────────────────── */}
            <div className="space-y-5 min-w-0">
              <SectionCard title={translate("patients.section.personalDetails")} icon={User}>
                <FormField control={form.control} name="full_name" render={({ field }) => (
                  <FormItem className="sm:col-span-2 lg:col-span-3">
                    <FieldLabel icon={User} required>{translate("patients.field.fullName")}</FieldLabel>
                    <FormControl><Input placeholder={translate("patients.placeholder.fullName")} data-testid="input-full-name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ndis_number" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={ShieldCheck} required>{translate("patients.field.ndisNumber")}</FieldLabel>
                    <FormControl><Input placeholder={translate("patients.placeholder.ndisNumber")} data-testid="input-ndis-number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="date_of_birth" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={Cake} required>{translate("patients.field.dateOfBirth")}</FieldLabel>
                    <FormControl><Input type="date" data-testid="input-date-of-birth" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="biological_sex" render={({ field }) => (
                  <FormItem>
                    <FieldLabel>{translate("patients.field.biologicalSex")}</FieldLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "unspecified"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-biological-sex"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="unspecified">{translate("patients.sex.unspecified")}</SelectItem>
                        <SelectItem value="male">{translate("patients.sex.male")}</SelectItem>
                        <SelectItem value="female">{translate("patients.sex.female")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={Mail}>{translate("patients.field.email")}</FieldLabel>
                    <FormControl><Input type="email" placeholder={translate("patients.placeholder.email")} data-testid="input-email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={Phone}>{translate("patients.field.phone")}</FieldLabel>
                    <FormControl><Input placeholder={translate("patients.placeholder.phone")} data-testid="input-phone" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="primary_disability" render={({ field }) => (
                  <FormItem className="sm:col-span-2 lg:col-span-3">
                    <FieldLabel icon={HeartPulse}>{translate("patients.field.primaryDisability")}</FieldLabel>
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
                )} />
                <FormField control={form.control} name="allergies" render={({ field }) => (
                  <FormItem className="sm:col-span-2 lg:col-span-3">
                    <FieldLabel>{translate("patients.field.allergies")}</FieldLabel>
                    <FormControl>
                      <SmartInput
                        placeholder={translate("patients.placeholder.allergies")}
                        data-testid="input-allergies"
                        value={field.value ?? ""}
                        onChange={(v) => field.onChange(v)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="communication_preferences" render={({ field }) => (
                  <FormItem className="sm:col-span-2 lg:col-span-3">
                    <FieldLabel icon={MessagesSquare}>{translate("patients.field.communicationPreferences")}</FieldLabel>
                    <FormControl>
                      <SmartInput
                        placeholder={translate("patients.placeholder.communicationPreferences")}
                        data-testid="input-communication-preferences"
                        value={field.value ?? ""}
                        onChange={(v) => field.onChange(v)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </SectionCard>

              <SectionCard title={translate("patients.section.ndisPlan")} icon={ClipboardList}>
                <FormField control={form.control} name="plan_status" render={({ field }) => (
                  <FormItem>
                    <FieldLabel required>{translate("patients.field.planStatus")}</FieldLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-plan-status"><SelectValue /></SelectTrigger>
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
                )} />
                <FormField control={form.control} name="total_budget" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={Wallet}>{translate("patients.field.totalBudget")}</FieldLabel>
                    <FormControl><Input type="number" placeholder={translate("patients.placeholder.totalBudget")} data-testid="input-total-budget" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="hidden lg:block" />
                <FormField control={form.control} name="plan_start_date" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={CalendarRange}>{translate("patients.field.planStartDate")}</FieldLabel>
                    <FormControl><Input type="date" data-testid="input-plan-start-date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="plan_end_date" render={({ field }) => (
                  <FormItem>
                    <FieldLabel icon={CalendarRange}>{translate("patients.field.planEndDate")}</FieldLabel>
                    <FormControl><Input type="date" data-testid="input-plan-end-date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </SectionCard>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => navigate("/patients")}
                  className="px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors hover:bg-[#F6F4FB]"
                  style={{ borderColor: BORDER, color: T2 }}
                >
                  {translate("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={createParticipant.isPending}
                  data-testid="button-add-participant"
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: "var(--cc-cta)" }}
                >
                  {createParticipant.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <UserPlus size={14} />}
                  {translate("patients.addButton")}
                </button>
              </div>
            </div>

            {/* ── Sidebar: live preview + guidance ───────────────────────── */}
            <div className="space-y-4 lg:sticky lg:top-4">
              <div className="rounded-2xl overflow-hidden" style={{ background: "var(--cc-surface)", boxShadow: CARD_SHADOW }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>
                    {translate("patients.newParticipant.previewTitle")}
                  </p>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 text-[15px] font-black text-white"
                      style={{ background: PLUM }}
                    >
                      {previewInitials || <User size={18} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-black truncate" style={{ color: T1 }}>
                        {watched.full_name?.trim() || translate("patients.newParticipant.previewNamePlaceholder")}
                      </p>
                      <p className="text-[12px] truncate" style={{ color: T3 }}>
                        {watched.ndis_number?.trim()
                          ? translate("patients.newParticipant.previewNdisPrefix") + watched.ndis_number
                          : translate("patients.newParticipant.previewNoNdis")}
                      </p>
                    </div>
                  </div>

                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                    style={{ background: planTone.bg, color: planTone.color }}
                  >
                    {translate(`patients.planStatus.${watched.plan_status || "active"}`)}
                  </span>

                  <div className="space-y-2 pt-1 border-t" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                    {[
                      [translate("patients.field.dateOfBirth"), watched.date_of_birth || "—"],
                      [translate("patients.field.phone"), watched.phone?.trim() || "—"],
                      [translate("patients.field.totalBudget"), watched.total_budget ? `$${Number(watched.total_budget).toLocaleString()}` : "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3 text-[12px] pt-2 first:pt-0">
                        <span style={{ color: T3 }}>{label}</span>
                        <span className="font-semibold text-right truncate" style={{ color: T2 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl p-5" style={{ background: `${PLUM}0A`, border: `1px solid ${PLUM}22` }}>
                <p className="text-[12px] font-black mb-1.5" style={{ color: PLUM }}>
                  {translate("patients.newParticipant.tipsTitle")}
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: T2 }}>
                  {translate("patients.newParticipant.tipsBody")}
                </p>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
