import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Clock, Loader2, PhoneCall, Siren } from "lucide-react";
import { createIncident } from "@/services/incidentService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, ctaClass, ghostClass } from "@/components/layout/PageKit";
import { inputClass, textareaClass } from "@/pages/md/vault/components/PanelKit";

// -- Design tokens -------------------------------------------------------------
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";
const DANGER = "var(--cc-danger-text)";
const DANGER_BG = "var(--cc-status-danger-bg)";

const INCIDENT_TYPES = [
  { value: "injury", labelKey: "incidents.type.injury" },
  { value: "medication_error", labelKey: "incidents.type.medicationError" },
  { value: "behaviour_of_concern", labelKey: "incidents.type.behaviourOfConcern" },
  { value: "property_damage", labelKey: "incidents.type.propertyDamage" },
  { value: "abuse_neglect", labelKey: "incidents.type.abuseNeglect" },
  { value: "restrictive_practice", labelKey: "incidents.type.restrictivePractice" },
  { value: "environmental", labelKey: "incidents.type.environmental" },
  { value: "elopement", labelKey: "incidents.type.elopement" },
  { value: "near_miss", labelKey: "incidents.type.nearMiss" },
  { value: "other", labelKey: "incidents.type.other" },
] as const;

const SEVERITIES = [
  { value: "low", labelKey: "incidents.new.severityLow", color: "var(--cc-green)" },
  { value: "medium", labelKey: "incidents.new.severityMedium", color: "var(--cc-amber)" },
  { value: "high", labelKey: "incidents.new.severityHigh", color: "var(--cc-status-danger)" },
  { value: "critical", labelKey: "incidents.new.severityCritical", color: "var(--cc-status-critical)" },
] as const;

const INJURY_MEDICAL_ATTENTION = [
  { value: "ambulance", labelKey: "incidents.new.injuryMedicalAmbulance" },
  { value: "hospital_self_transport", labelKey: "incidents.new.injuryMedicalHospitalSelf" },
  { value: "gp", labelKey: "incidents.new.injuryMedicalGp" },
  { value: "none", labelKey: "incidents.new.injuryMedicalNone" },
] as const;

const HARMED_OPTIONS = [
  { value: "yes", labelKey: "incidents.new.participantHarmedYes" },
  { value: "no", labelKey: "incidents.new.participantHarmedNo" },
] as const;

const EMERGENCY_SERVICES_OPTIONS = [
  { value: "triple_zero", labelKey: "incidents.new.emergency000" },
  { value: "sa_ambulance_only", labelKey: "incidents.new.emergencySaAmbulance" },
  { value: "no", labelKey: "incidents.new.emergencyNo" },
] as const;

const FAMILY_NOTIFIED_OPTIONS = [
  { value: "yes", labelKey: "incidents.new.familyNotifiedYes" },
  { value: "not_yet", labelKey: "incidents.new.familyNotifiedNotYet" },
  { value: "not_applicable", labelKey: "incidents.new.familyNotifiedNa" },
] as const;

const MD_NOTIFIED_OPTIONS = [
  { value: "yes", labelKey: "incidents.new.mdNotifiedYes" },
  { value: "not_yet", labelKey: "incidents.new.mdNotifiedNotYet" },
] as const;

const REPORTABLE_CATEGORIES = [
  { value: "unexpected_death", labelKey: "incidents.new.reportable.unexpectedDeath" },
  { value: "serious_injury", labelKey: "incidents.new.reportable.seriousInjury" },
  { value: "abuse_neglect", labelKey: "incidents.new.reportable.abuseNeglect" },
  { value: "unlawful_contact", labelKey: "incidents.new.reportable.unlawfulContact" },
  { value: "sexual_misconduct", labelKey: "incidents.new.reportable.sexualMisconduct" },
  { value: "unauthorised_restrictive_practice", labelKey: "incidents.new.reportable.restrictivePractice" },
  { value: "none", labelKey: "incidents.new.reportable.none" },
] as const;

const SECTIONS = [
  { number: 1, titleKey: "incidents.new.section1Title" },
  { number: 2, titleKey: "incidents.new.section2Title" },
  { number: 3, titleKey: "incidents.new.section3Title" },
  { number: 4, titleKey: "incidents.new.section4Title" },
  { number: 5, titleKey: "incidents.new.section5Title" },
  { number: 6, titleKey: "incidents.new.section6Title" },
] as const;

const NDIS_REPORTABLE_TYPES = new Set(["abuse_neglect", "restrictive_practice"]);

// "Fill it later": the only fields that can be deferred instead of blocking submission.
// Everything else on the form stays required at submit time.
const DEFERRABLE_FIELDS = ["description", "participant_impact", "worker_actions", "injury_nature"] as const;
type DeferrableField = (typeof DEFERRABLE_FIELDS)[number];

/** Something still missing before the report can be sent. */
type Need = { id: string; section: number };

/** Older translations still number their section titles ("Phần 1 — ..."); the card shows the number itself. */
function plainSectionTitle(title: string) {
  return title.includes(" — ") ? title.slice(title.indexOf(" — ") + 3) : title;
}

/** "Low: minimal impact" becomes ["Low", "minimal impact"] so each part can be styled. */
function splitOption(label: string): [string, string | undefined] {
  const match = label.match(/^(.+?)(?::\s+|\s+[-–—]\s+)(.+)$/);
  return match ? [match[1], match[2].charAt(0).toUpperCase() + match[2].slice(1)] : [label, undefined];
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum";

function FormSection({ number, title, subtitle, children }: { number: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={`incident-section-${number}`} className="scroll-mt-40 rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="flex items-start gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: BORDER }}>
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{ background: PURPLE_SOFT, color: PURPLE }}
        >
          {number}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>{plainSectionTitle(title)}</h2>
          {subtitle && <p className="mt-0.5 text-sm leading-6" style={{ color: MUTED }}>{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-5 p-5 sm:p-6">{children}</div>
    </section>
  );
}

function Field({
  label, htmlFor, required, optionalLabel, hint, error, action, children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  /** Shown beside the label for fields that can be left blank. */
  optionalLabel?: string;
  hint?: ReactNode;
  error?: string;
  /** A small control on the right of the label row, e.g. "Fill in later". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-sm font-medium" style={{ color: TEXT }}>
          <span>
            {label}
            {required && (
              <>
                <span aria-hidden="true" style={{ color: DANGER }}> *</span>
                <span className="sr-only"> (required)</span>
              </>
            )}
          </span>
          {optionalLabel && <span className="text-xs font-normal" style={{ color: MUTED }}>{optionalLabel}</span>}
        </label>
        {action}
      </div>
      {hint && <p className="text-xs leading-5" style={{ color: MUTED }}>{hint}</p>}
      {children}
      {error && <p className="text-xs font-medium" style={{ color: DANGER }}>{error}</p>}
    </div>
  );
}

/** One answer from a few, shown as pills. Used in place of checkboxes for single-choice questions. */
function ChoicePills({
  id, label, value, options, onChange, invalid,
}: {
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <div id={id} tabIndex={-1} role="radiogroup" aria-label={label} aria-invalid={invalid || undefined} className="flex flex-wrap gap-2 outline-none">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition hover:bg-cc-soft ${focusRing}`}
            style={{
              borderColor: selected ? PURPLE : invalid ? DANGER : BORDER,
              background: selected ? PURPLE_SOFT : undefined,
              color: selected ? PURPLE : TEXT,
            }}
          >
            {selected && <Check size={14} strokeWidth={3} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function DeferrableTextarea({
  field, id, label, required, placeholder, value, onChange, pending, onTogglePending, rows = 3, help, error,
}: {
  field: DeferrableField;
  id: string;
  label: string;
  required?: boolean;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  onTogglePending: (field: DeferrableField, v: boolean) => void;
  rows?: number;
  help?: string;
  error?: string;
}) {
  const { translate } = useAccessibility();
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required && !pending}
      hint={help}
      error={pending ? undefined : error}
      action={
        <button
          type="button"
          aria-pressed={pending}
          onClick={() => onTogglePending(field, !pending)}
          className={`inline-flex items-center gap-1.5 rounded-full text-xs font-semibold underline-offset-4 hover:underline ${focusRing}`}
          style={{ color: PURPLE }}
        >
          <Clock size={13} />
          {pending ? translate("incidents.new.writeNow") : translate("incidents.new.fillItLater")}
        </button>
      }
    >
      {pending ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm"
          style={{ borderColor: PURPLE, background: PURPLE_SOFT, color: TEXT }}
        >
          <Clock size={15} className="shrink-0" style={{ color: PURPLE }} />
          {translate("incidents.new.fillItLaterNote")}
        </div>
      ) : (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={!!error || undefined}
          className={`resize-y ${textareaClass}`}
          style={{ borderColor: error ? DANGER : BORDER, color: TEXT }}
        />
      )}
    </Field>
  );
}

const emptyForm = {
  participant_id: "",
  incident_type: "injury",
  incident_type_other: "",
  severity: "medium",
  title: "",
  description: "",
  location: "",
  witnesses: "",
  support_workers_present: "",
  other_persons_involved: "",
  participant_harmed: "" as "" | "yes" | "no",
  injury_nature: "",
  injury_medical_attention: "",
  participant_impact: "",
  worker_actions: "",
  emergency_services_called: "" as "" | "no" | "triple_zero" | "sa_ambulance_only",
  family_notified: "" as "" | "yes" | "not_yet" | "not_applicable",
  md_notified: "" as "" | "yes" | "not_yet",
  staff_declaration_name: "",
  staff_declaration_signature: "",
  incident_date: new Date().toISOString().slice(0, 16),
  follow_up_required: false,
};

export default function IncidentNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [reportableCategories, setReportableCategories] = useState<string[]>([]);
  const [pendingFields, setPendingFields] = useState<DeferrableField[]>([]);

  // Whoever is signed in is usually the one reporting: start with their name.
  useEffect(() => {
    if (user?.full_name) setForm((prev) => (prev.staff_declaration_name ? prev : { ...prev, staff_declaration_name: user.full_name ?? "" }));
  }, [user?.full_name]);

  function toggleDeferred(field: DeferrableField, deferred: boolean) {
    setPendingFields((prev) => (deferred ? [...new Set([...prev, field])] : prev.filter((f) => f !== field)));
  }

  const { data: participantsData } = useGetParticipants({});
  const participants = (participantsData as { data?: Array<{ id: string; full_name: string; ndis_number?: string | null }> } | undefined)?.data ?? [];
  const selectedParticipant = participants.find((p) => p.id === form.participant_id);

  const ndisReportable =
    NDIS_REPORTABLE_TYPES.has(form.incident_type) ||
    form.severity === "critical" ||
    reportableCategories.some((c) => c !== "none");
  const isOtherType = form.incident_type === "other";
  const participantHarmed = form.participant_harmed === "yes";
  const deferred = (field: DeferrableField) => pendingFields.includes(field);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleReportableCategory(value: string, checked: boolean) {
    setReportableCategories((prev) => {
      if (value === "none") {
        return checked ? ["none"] : [];
      }
      const withoutNone = prev.filter((c) => c !== "none");
      return checked ? [...withoutNone, value] : withoutNone.filter((c) => c !== value);
    });
  }

  // Everything the form marks as required, in the order it appears.
  const needs: Need[] = [];
  if (!form.title.trim()) needs.push({ id: "incident-title", section: 1 });
  if (!form.participant_harmed) needs.push({ id: "incident-harmed", section: 2 });
  if (participantHarmed && !deferred("injury_nature") && !form.injury_nature.trim()) needs.push({ id: "incident-injury-nature", section: 2 });
  if (participantHarmed && !form.injury_medical_attention) needs.push({ id: "incident-medical", section: 2 });
  if (!deferred("description") && !form.description.trim()) needs.push({ id: "incident-description", section: 3 });
  if (!deferred("worker_actions") && !form.worker_actions.trim()) needs.push({ id: "incident-actions", section: 4 });
  if (!form.emergency_services_called) needs.push({ id: "incident-emergency", section: 4 });
  if (!form.family_notified) needs.push({ id: "incident-family", section: 4 });
  if (!form.md_notified) needs.push({ id: "incident-md", section: 4 });
  if (!form.staff_declaration_name.trim()) needs.push({ id: "incident-staff-name", section: 6 });
  if (!form.staff_declaration_signature.trim()) needs.push({ id: "incident-signature", section: 6 });

  const neededHint = translate("incidents.new.neededHint");
  const errorFor = (id: string) => (showErrors && needs.some((n) => n.id === id) ? neededHint : undefined);
  const isMissing = (id: string) => showErrors && needs.some((n) => n.id === id);
  const toGo = (n: number) => translate("incidents.new.progressLeft").replace("{n}", String(n));

  async function handleSubmit() {
    if (needs.length) {
      setShowErrors(true);
      toast({ title: translate("incidents.new.missingToast"), variant: "destructive" });
      const first = document.getElementById(needs[0].id);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus({ preventScroll: true });
      return;
    }
    setSaving(true);
    try {
      const activePendingFields = pendingFields.filter(
        (f) => f !== "injury_nature" || participantHarmed
      );
      const data = await createIncident<{ id: string }>({
        ...form,
        participant_id: form.participant_id || undefined,
        participant_harmed: form.participant_harmed || undefined,
        injury_nature: participantHarmed
          ? (pendingFields.includes("injury_nature") ? "" : form.injury_nature || undefined)
          : undefined,
        injury_medical_attention: participantHarmed && form.injury_medical_attention
          ? (form.injury_medical_attention as "ambulance" | "hospital_self_transport" | "gp" | "none")
          : undefined,
        incident_type_other: isOtherType ? form.incident_type_other || undefined : undefined,
        emergency_services_called: form.emergency_services_called || undefined,
        family_notified: form.family_notified || undefined,
        md_notified: form.md_notified || undefined,
        reportable_categories: reportableCategories.length ? reportableCategories : undefined,
        staff_declaration_name: form.staff_declaration_name,
        staff_declaration_signature: form.staff_declaration_signature,
        pending_fields: activePendingFields.length ? activePendingFields : undefined,
        incident_date: new Date(form.incident_date).toISOString(),
      });
      toast({
        title: activePendingFields.length
          ? translate("incidents.new.loggedWithPending")
          : translate("incidents.new.logged"),
      });
      navigate(`/incidents/${data.id}`);
    } catch {
      toast({ title: translate("incidents.new.logFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const textInput = (id: string, key: keyof typeof form, placeholder?: string, extra?: { invalid?: boolean; className?: string; style?: React.CSSProperties }) => (
    <input
      id={id}
      value={form[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      placeholder={placeholder}
      aria-invalid={extra?.invalid || undefined}
      className={`${inputClass} ${extra?.className ?? ""}`}
      style={{ borderColor: extra?.invalid ? DANGER : BORDER, color: TEXT, ...extra?.style }}
    />
  );

  const options = (list: readonly { value: string; labelKey: string }[]) =>
    list.map((o) => ({ value: o.value, label: translate(o.labelKey) }));

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow={translate("incidents.new.breadcrumbParent")}
        title={translate("incidents.new.pageTitle")}
        description={translate("incidents.new.standard")}
        back={
          <button type="button" onClick={() => navigate("/incidents")} className={`${ghostClass} -ml-4`}>
            <ArrowLeft size={15} /> {translate("incidents.new.breadcrumbParent")}
          </button>
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: DANGER_BG, color: DANGER }} aria-hidden="true">
          <PhoneCall size={15} />
        </span>
        <p className="self-center text-sm font-medium" style={{ color: TEXT }}>{translate("incidents.new.safetyFirst")}</p>
      </div>

      {ndisReportable && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: DANGER_BG }} role="status">
          <Siren size={17} className="mt-0.5 shrink-0" style={{ color: DANGER }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: DANGER }}>{translate("incidents.new.ndisReportable")}</p>
            <p className="mt-0.5 text-sm" style={{ color: DANGER }}>
              {translate("incidents.new.ndisReportableBody")}
              {form.severity === "critical" && ` ${translate("incidents.new.ndisCritical24h")}`}
            </p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {/* SECTION 1: Incident details */}
          <FormSection number={1} title={translate("incidents.new.section1Title")}>
            <Field label={translate("incidents.new.incidentTitleLabel")} htmlFor="incident-title" required error={errorFor("incident-title")}>
              {textInput("incident-title", "title", translate("incidents.new.titlePlaceholder"), { invalid: isMissing("incident-title") })}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={translate("incidents.new.dateTime")} required>
                <DateTimePicker value={form.incident_date} onChange={(v) => set("incident_date", v)} />
              </Field>
              <Field label={translate("incidents.new.location")} htmlFor="incident-location" optionalLabel={translate("common.optional")}>
                {textInput("incident-location", "location", translate("incidents.new.locationPlaceholder"))}
              </Field>
            </div>
            <Field label={translate("incidents.new.severity")} required>
              <div role="radiogroup" aria-label={translate("incidents.new.severity")} className="grid gap-2 sm:grid-cols-2">
                {SEVERITIES.map((s) => {
                  const [name, detail] = splitOption(translate(s.labelKey));
                  const selected = form.severity === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set("severity", s.value)}
                      className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition hover:bg-cc-soft ${focusRing}`}
                      style={{
                        borderColor: selected ? s.color : BORDER,
                        boxShadow: selected ? `0 0 0 1px ${s.color}` : undefined,
                        background: selected ? `color-mix(in srgb, ${s.color} 8%, transparent)` : undefined,
                      }}
                    >
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold" style={{ color: TEXT }}>{name}</span>
                        {detail && <span className="mt-0.5 block text-xs leading-5" style={{ color: MUTED }}>{detail}</span>}
                      </span>
                      {selected && <Check size={16} strokeWidth={3} className="mt-0.5 shrink-0" style={{ color: s.color }} />}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={translate("incidents.new.type")} required>
              <ChoicePills
                label={translate("incidents.new.type")}
                value={form.incident_type}
                options={options(INCIDENT_TYPES)}
                onChange={(v) => set("incident_type", v)}
              />
            </Field>
            {isOtherType && (
              <Field label={translate("incidents.new.incidentTypeOther")} htmlFor="incident-type-other">
                {textInput("incident-type-other", "incident_type_other", translate("incidents.new.incidentTypeOtherPlaceholder"))}
              </Field>
            )}
          </FormSection>

          {/* SECTION 2: People involved */}
          <FormSection number={2} title={translate("incidents.new.section2Title")}>
            <Field
              label={translate("incidents.new.participantOptional")}
              htmlFor="incident-participant"
              optionalLabel={translate("common.optional")}
            >
              <Select value={form.participant_id} onValueChange={(v) => set("participant_id", v)}>
                <SelectTrigger id="incident-participant" className="h-11 rounded-xl px-4 text-sm" style={{ borderColor: BORDER }}>
                  <SelectValue placeholder={translate("incidents.new.selectParticipant")} />
                </SelectTrigger>
                <SelectContent>
                  {participants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedParticipant?.ndis_number && (
                <p className="text-xs" style={{ color: MUTED }}>
                  {translate("incidents.new.participantNdisNumber")}: <span className="font-medium" style={{ color: TEXT }}>{selectedParticipant.ndis_number}</span>
                </p>
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={translate("incidents.new.supportWorkersPresent")} htmlFor="incident-workers" optionalLabel={translate("common.optional")}>
                {textInput("incident-workers", "support_workers_present", translate("incidents.new.supportWorkersPresentPlaceholder"))}
              </Field>
              <Field label={translate("incidents.new.otherPersonsInvolved")} htmlFor="incident-others" optionalLabel={translate("common.optional")}>
                {textInput("incident-others", "other_persons_involved", translate("incidents.new.otherPersonsInvolvedPlaceholder"))}
              </Field>
            </div>
            <Field label={translate("incidents.new.witnesses")} htmlFor="incident-witnesses" optionalLabel={translate("common.optional")}>
              {textInput("incident-witnesses", "witnesses", translate("incidents.new.witnessesPlaceholder"))}
            </Field>
            <Field label={translate("incidents.new.participantHarmed")} required error={errorFor("incident-harmed")}>
              <ChoicePills
                id="incident-harmed"
                label={translate("incidents.new.participantHarmed")}
                value={form.participant_harmed}
                options={options(HARMED_OPTIONS)}
                onChange={(v) => set("participant_harmed", v as "yes" | "no")}
                invalid={isMissing("incident-harmed")}
              />
            </Field>
            {participantHarmed && (
              <div className="space-y-5 rounded-2xl border p-4 sm:p-5" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
                <DeferrableTextarea
                  field="injury_nature"
                  id="incident-injury-nature"
                  label={translate("incidents.new.injuryNature")}
                  required
                  rows={2}
                  value={form.injury_nature}
                  onChange={(v) => set("injury_nature", v)}
                  placeholder={translate("incidents.new.injuryNaturePlaceholder")}
                  pending={deferred("injury_nature")}
                  onTogglePending={toggleDeferred}
                  error={errorFor("incident-injury-nature")}
                />
                <Field label={translate("incidents.new.injuryMedicalAttention")} required error={errorFor("incident-medical")}>
                  <ChoicePills
                    id="incident-medical"
                    label={translate("incidents.new.injuryMedicalAttention")}
                    value={form.injury_medical_attention}
                    options={options(INJURY_MEDICAL_ATTENTION)}
                    onChange={(v) => set("injury_medical_attention", v)}
                    invalid={isMissing("incident-medical")}
                  />
                </Field>
              </div>
            )}
          </FormSection>

          {/* SECTION 3: What happened */}
          <FormSection number={3} title={translate("incidents.new.section3Title")}>
            <DeferrableTextarea
              field="description"
              id="incident-description"
              label={translate("incidents.new.whatHappened")}
              required
              rows={6}
              value={form.description}
              onChange={(v) => set("description", v)}
              placeholder={translate("incidents.new.whatHappenedPlaceholder")}
              help={translate("incidents.new.section3Help")}
              pending={deferred("description")}
              onTogglePending={toggleDeferred}
              error={errorFor("incident-description")}
            />
            <DeferrableTextarea
              field="participant_impact"
              id="incident-impact"
              label={translate("incidents.new.participantImpact")}
              rows={3}
              value={form.participant_impact}
              onChange={(v) => set("participant_impact", v)}
              placeholder={translate("incidents.new.participantImpactPlaceholder")}
              pending={deferred("participant_impact")}
              onTogglePending={toggleDeferred}
            />
          </FormSection>

          {/* SECTION 4: Immediate actions */}
          <FormSection number={4} title={translate("incidents.new.section4Title")}>
            <DeferrableTextarea
              field="worker_actions"
              id="incident-actions"
              label={translate("incidents.new.immediateActions")}
              required
              rows={3}
              value={form.worker_actions}
              onChange={(v) => set("worker_actions", v)}
              placeholder={translate("incidents.new.immediateActionsPlaceholder")}
              pending={deferred("worker_actions")}
              onTogglePending={toggleDeferred}
              error={errorFor("incident-actions")}
            />
            <Field label={translate("incidents.new.emergencyServicesCalled")} required error={errorFor("incident-emergency")}>
              <ChoicePills
                id="incident-emergency"
                label={translate("incidents.new.emergencyServicesCalled")}
                value={form.emergency_services_called}
                options={options(EMERGENCY_SERVICES_OPTIONS)}
                onChange={(v) => set("emergency_services_called", v as typeof form.emergency_services_called)}
                invalid={isMissing("incident-emergency")}
              />
            </Field>
            <Field label={translate("incidents.new.familyNotified")} required error={errorFor("incident-family")}>
              <ChoicePills
                id="incident-family"
                label={translate("incidents.new.familyNotified")}
                value={form.family_notified}
                options={options(FAMILY_NOTIFIED_OPTIONS)}
                onChange={(v) => set("family_notified", v as typeof form.family_notified)}
                invalid={isMissing("incident-family")}
              />
            </Field>
            <Field
              label={translate("incidents.new.mdNotified")}
              required
              error={errorFor("incident-md")}
              hint={form.md_notified === "yes" ? translate("incidents.new.mdNotifiedTimeNote") : undefined}
            >
              <ChoicePills
                id="incident-md"
                label={translate("incidents.new.mdNotified")}
                value={form.md_notified}
                options={options(MD_NOTIFIED_OPTIONS)}
                onChange={(v) => set("md_notified", v as typeof form.md_notified)}
                invalid={isMissing("incident-md")}
              />
            </Field>
          </FormSection>

          {/* SECTION 5: Reportable incident check */}
          <FormSection
            number={5}
            title={translate("incidents.new.section5Title")}
            subtitle={translate("incidents.new.section5Subtitle")}
          >
            <div className="space-y-2">
              {REPORTABLE_CATEGORIES.map((c) => {
                const checked = reportableCategories.includes(c.value);
                return (
                  <label
                    key={c.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition hover:bg-cc-soft ${c.value === "none" ? "mt-3" : ""}`}
                    style={{
                      borderColor: checked ? (c.value === "none" ? PURPLE : DANGER) : BORDER,
                      background: checked ? (c.value === "none" ? PURPLE_SOFT : DANGER_BG) : undefined,
                      color: TEXT,
                    }}
                  >
                    <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(v) => toggleReportableCategory(c.value, v === true)} />
                    <span>{translate(c.labelKey)}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-sm leading-6" style={{ color: MUTED }}>
              <span className="font-semibold" style={{ color: TEXT }}>{translate("incidents.new.reportable.calloutLabel")}</span>{" "}
              {translate("incidents.new.reportable.calloutBody")}
            </p>
          </FormSection>

          {/* SECTION 6: Declaration */}
          <FormSection number={6} title={translate("incidents.new.section6Title")}>
            <p className="text-sm leading-6" style={{ color: TEXT }}>
              {translate("incidents.new.declarationText")}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={translate("incidents.new.staffMemberName")} htmlFor="incident-staff-name" required error={errorFor("incident-staff-name")}>
                {textInput("incident-staff-name", "staff_declaration_name", undefined, { invalid: isMissing("incident-staff-name") })}
              </Field>
              <Field
                label={translate("incidents.new.signature")}
                htmlFor="incident-signature"
                required
                error={errorFor("incident-signature")}
              >
                {textInput("incident-signature", "staff_declaration_signature", translate("incidents.new.signaturePlaceholder"), {
                  invalid: isMissing("incident-signature"),
                  className: "text-base italic",
                  style: { fontFamily: "cursive" },
                })}
                <p className="text-xs" style={{ color: MUTED }}>{translate("incidents.new.signatureHelp")}</p>
              </Field>
            </div>
          </FormSection>
        </div>

        {/* Progress and submit: beside the form on wide screens, after it on phones. */}
        <aside className="rounded-2xl border p-5 lg:sticky lg:top-40" style={{ background: SURFACE, borderColor: BORDER }}>
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>{translate("incidents.new.progressTitle")}</h2>
          <ol className="mt-3 space-y-0.5">
            {SECTIONS.map((section) => {
              const left = needs.filter((n) => n.section === section.number).length;
              // The reportable check is optional: only "done" once something is ticked.
              const untouched = section.number === 5 && reportableCategories.length === 0;
              const done = !left && !untouched;
              return (
                <li key={section.number}>
                  <button
                    type="button"
                    onClick={() => document.getElementById(`incident-section-${section.number}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition hover:bg-cc-soft ${focusRing}`}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                      style={done ? { background: "var(--cc-green)", color: "#fff" } : { border: `1px solid ${BORDER}`, color: MUTED }}
                    >
                      {done ? <Check size={13} strokeWidth={3} /> : section.number}
                    </span>
                    <span className="min-w-0 flex-1 leading-5" style={{ color: TEXT }}>{plainSectionTitle(translate(section.titleKey))}</span>
                    <span className="shrink-0 text-xs" style={{ color: done ? "var(--cc-green)" : left && showErrors ? DANGER : MUTED }}>
                      {left ? toGo(left) : done ? translate("incidents.new.progressDone") : translate("common.optional")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: BORDER }}>
            <p className="text-xs" style={{ color: needs.length ? MUTED : "var(--cc-green)" }} aria-live="polite">
              {needs.length ? toGo(needs.length) : translate("incidents.new.readyToSubmit")}
            </p>
            <button type="button" onClick={handleSubmit} disabled={saving} className={`${ctaClass} w-full`}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Siren size={15} />}
              {saving ? translate("incidents.new.saving") : translate("incidents.new.submit")}
            </button>
            <button type="button" onClick={() => navigate("/incidents")} className={`${ghostClass} w-full`}>
              {translate("common.cancel")}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
