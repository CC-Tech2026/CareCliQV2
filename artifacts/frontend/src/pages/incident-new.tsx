import { useState } from "react";
import { useLocation } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, Loader2, Siren } from "lucide-react";
import { createIncident } from "@/services/incidentService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

// -- Design tokens -------------------------------------------------------------
const BORDER = "var(--cc-border)";

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
  { value: "low", labelKey: "incidents.new.severityLow" },
  { value: "medium", labelKey: "incidents.new.severityMedium" },
  { value: "high", labelKey: "incidents.new.severityHigh" },
  { value: "critical", labelKey: "incidents.new.severityCritical" },
] as const;

const INJURY_MEDICAL_ATTENTION = [
  { value: "ambulance", labelKey: "incidents.new.injuryMedicalAmbulance" },
  { value: "hospital_self_transport", labelKey: "incidents.new.injuryMedicalHospitalSelf" },
  { value: "gp", labelKey: "incidents.new.injuryMedicalGp" },
  { value: "none", labelKey: "incidents.new.injuryMedicalNone" },
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

const NDIS_REPORTABLE_TYPES = new Set(["abuse_neglect", "restrictive_practice"]);

function FormCard({ number, title, subtitle, children }: { number: number; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="cc-surface-card">
      <div className="cc-card-header flex items-start gap-3">
        <span
          className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5"
          style={{ background: "var(--cc-cta)" }}
        >
          {number}
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest cc-card-muted">{title}</p>
          {subtitle && <p className="text-[12px] cc-card-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="text-[12px] font-medium mb-1.5 block text-cc-text">
      {children} {required && <span className="text-red-500">*</span>}
    </Label>
  );
}

function CheckboxRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-cc-text cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {children}
    </label>
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
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [reportableCategories, setReportableCategories] = useState<string[]>([]);

  const { data: participantsData } = useGetParticipants({});
  const participants = (participantsData as { data?: Array<{ id: string; full_name: string; ndis_number?: string | null }> } | undefined)?.data ?? [];
  const selectedParticipant = participants.find((p) => p.id === form.participant_id);

  const ndisReportable =
    NDIS_REPORTABLE_TYPES.has(form.incident_type) ||
    form.severity === "critical" ||
    reportableCategories.some((c) => c !== "none");
  const isOtherType = form.incident_type === "other";
  const participantHarmed = form.participant_harmed === "yes";

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

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast({ title: translate("incidents.new.titleRequired"), variant: "destructive" });
      return;
    }
    if (!form.description.trim()) {
      toast({ title: translate("incidents.new.descriptionRequired"), variant: "destructive" });
      return;
    }
    if (participantHarmed && !form.injury_nature.trim()) {
      toast({ title: translate("incidents.new.injuryNatureRequired"), variant: "destructive" });
      return;
    }
    if (participantHarmed && !form.injury_medical_attention) {
      toast({ title: translate("incidents.new.injuryMedicalAttentionRequired"), variant: "destructive" });
      return;
    }
    if (!form.staff_declaration_name.trim()) {
      toast({ title: translate("incidents.new.staffNameRequired"), variant: "destructive" });
      return;
    }
    if (!form.staff_declaration_signature.trim()) {
      toast({ title: translate("incidents.new.signatureRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data = await createIncident<{ id: string }>({
        ...form,
        participant_id: form.participant_id || undefined,
        participant_harmed: form.participant_harmed || undefined,
        injury_nature: participantHarmed ? form.injury_nature || undefined : undefined,
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
        incident_date: new Date(form.incident_date).toISOString(),
      });
      toast({ title: translate("incidents.new.logged") });
      navigate(`/incidents/${data.id}`);
    } catch {
      toast({ title: translate("incidents.new.logFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/incidents")}
          className="flex items-center gap-1.5 text-cc-muted transition-opacity hover:opacity-70"
        >
          <ArrowLeft size={14} /> {translate("incidents.new.breadcrumbParent")}
        </button>
        <span className="text-cc-muted/60">/</span>
        <span className="font-medium text-cc-text">{translate("incidents.new.breadcrumb")}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 bg-orange-50">
          <AlertTriangle size={18} className="text-orange-600" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold text-cc-text">{translate("incidents.new.log")}</h1>
          <p className="text-[13px] text-cc-muted">{translate("incidents.new.standard")}</p>
        </div>
      </div>

      {/* NDIS reportable banner */}
      {ndisReportable && (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3.5 border"
          style={{ background: "var(--cc-status-danger-bg)", borderColor: "color-mix(in srgb, var(--cc-status-danger) 25%, transparent)" }}
        >
          <Siren size={16} className="shrink-0 mt-0.5" style={{ color: "var(--cc-status-danger)" }} />
          <div>
            <p className="text-[13px] font-bold" style={{ color: "var(--cc-status-danger)" }}>{translate("incidents.new.ndisReportable")}</p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--cc-status-danger)" }}>
              {translate("incidents.new.ndisReportableBody")}
              {form.severity === "critical" && ` ${translate("incidents.new.ndisCritical24h")}`}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-5">

        {/* SECTION 1 — Incident Details */}
        <FormCard number={1} title={translate("incidents.new.section1Title")}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FieldLabel required>{translate("incidents.new.dateTime")}</FieldLabel>
              <DateTimePicker value={form.incident_date} onChange={(v) => set("incident_date", v)} />
            </div>
            <div>
              <FieldLabel>{translate("incidents.new.severity")} <span className="text-red-500">*</span></FieldLabel>
              <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{translate(s.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>{translate("incidents.new.location")}</FieldLabel>
              <Input
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder={translate("incidents.new.locationPlaceholder")}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div className="col-span-2">
              <FieldLabel required>{translate("incidents.new.incidentTitleLabel")}</FieldLabel>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder={translate("incidents.new.titlePlaceholder")}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
          </div>
          <div>
            <FieldLabel required>{translate("incidents.new.type")}</FieldLabel>
            <Select value={form.incident_type} onValueChange={(v) => set("incident_type", v)}>
              <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ borderColor: BORDER }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INCIDENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{translate(t.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isOtherType && (
            <div>
              <FieldLabel>{translate("incidents.new.incidentTypeOther")}</FieldLabel>
              <Input
                value={form.incident_type_other}
                onChange={(e) => set("incident_type_other", e.target.value)}
                placeholder={translate("incidents.new.incidentTypeOtherPlaceholder")}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
          )}
        </FormCard>

        {/* SECTION 2 — People Involved */}
        <FormCard number={2} title={translate("incidents.new.section2Title")}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>{translate("incidents.new.participantOptional")}</FieldLabel>
              <Select value={form.participant_id} onValueChange={(v) => set("participant_id", v)}>
                <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue placeholder={translate("incidents.new.selectParticipant")} />
                </SelectTrigger>
                <SelectContent>
                  {participants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>{translate("incidents.new.participantNdisNumber")}</FieldLabel>
              <Input
                value={selectedParticipant?.ndis_number ?? ""}
                readOnly
                placeholder={translate("incidents.new.participantNdisNumberPlaceholder")}
                className="h-10 text-[13px] rounded-xl bg-cc-soft"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div>
              <FieldLabel>{translate("incidents.new.supportWorkersPresent")}</FieldLabel>
              <Input
                value={form.support_workers_present}
                onChange={(e) => set("support_workers_present", e.target.value)}
                placeholder={translate("incidents.new.supportWorkersPresentPlaceholder")}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div>
              <FieldLabel>{translate("incidents.new.otherPersonsInvolved")}</FieldLabel>
              <Input
                value={form.other_persons_involved}
                onChange={(e) => set("other_persons_involved", e.target.value)}
                placeholder={translate("incidents.new.otherPersonsInvolvedPlaceholder")}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
          </div>
          <div>
            <FieldLabel>{translate("incidents.new.witnesses")}</FieldLabel>
            <Input
              value={form.witnesses}
              onChange={(e) => set("witnesses", e.target.value)}
              placeholder={translate("incidents.new.witnessesPlaceholder")}
              className="h-10 text-[13px] rounded-xl"
              style={{ borderColor: BORDER }}
            />
          </div>
          <div>
            <FieldLabel required>{translate("incidents.new.participantHarmed")}</FieldLabel>
            <div className="flex gap-5 mt-1">
              <CheckboxRow checked={form.participant_harmed === "yes"} onChange={(v) => set("participant_harmed", v ? "yes" : "")}>
                {translate("incidents.new.participantHarmedYes")}
              </CheckboxRow>
              <CheckboxRow checked={form.participant_harmed === "no"} onChange={(v) => set("participant_harmed", v ? "no" : "")}>
                {translate("incidents.new.participantHarmedNo")}
              </CheckboxRow>
            </div>
          </div>
          {participantHarmed && (
            <div
              className="rounded-xl border p-4 space-y-4"
              style={{ borderColor: BORDER, background: "var(--cc-soft)" }}
            >
              <div>
                <FieldLabel required>{translate("incidents.new.injuryNature")}</FieldLabel>
                <Textarea
                  rows={2}
                  value={form.injury_nature}
                  onChange={(e) => set("injury_nature", e.target.value)}
                  placeholder={translate("incidents.new.injuryNaturePlaceholder")}
                  className="text-[13px] resize-none rounded-xl bg-white"
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div>
                <FieldLabel required>{translate("incidents.new.injuryMedicalAttention")}</FieldLabel>
                <Select value={form.injury_medical_attention} onValueChange={(v) => set("injury_medical_attention", v)}>
                  <SelectTrigger className="h-10 text-[13px] rounded-xl bg-white" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder={translate("incidents.new.injuryMedicalAttentionPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {INJURY_MEDICAL_ATTENTION.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{translate(o.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </FormCard>

        {/* SECTION 3 — Description */}
        <FormCard number={3} title={translate("incidents.new.section3Title")}>
          <div>
            <FieldLabel required>{translate("incidents.new.whatHappened")}</FieldLabel>
            <p className="text-[12px] text-cc-muted mb-2">{translate("incidents.new.section3Help")}</p>
            <Textarea
              rows={5}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={translate("incidents.new.whatHappenedPlaceholder")}
              className="text-[13px] resize-none rounded-xl"
              style={{ borderColor: BORDER }}
            />
          </div>
          <div>
            <FieldLabel>{translate("incidents.new.participantImpact")}</FieldLabel>
            <Textarea
              rows={2}
              value={form.participant_impact}
              onChange={(e) => set("participant_impact", e.target.value)}
              placeholder={translate("incidents.new.participantImpactPlaceholder")}
              className="text-[13px] resize-none rounded-xl"
              style={{ borderColor: BORDER }}
            />
          </div>
        </FormCard>

        {/* SECTION 4 — Immediate Actions Taken */}
        <FormCard number={4} title={translate("incidents.new.section4Title")}>
          <div>
            <FieldLabel required>{translate("incidents.new.immediateActions")}</FieldLabel>
            <Textarea
              rows={3}
              value={form.worker_actions}
              onChange={(e) => set("worker_actions", e.target.value)}
              placeholder={translate("incidents.new.immediateActionsPlaceholder")}
              className="text-[13px] resize-none rounded-xl"
              style={{ borderColor: BORDER }}
            />
          </div>
          <div>
            <FieldLabel required>{translate("incidents.new.emergencyServicesCalled")}</FieldLabel>
            <div className="flex gap-5 mt-1">
              {EMERGENCY_SERVICES_OPTIONS.map((o) => (
                <CheckboxRow
                  key={o.value}
                  checked={form.emergency_services_called === o.value}
                  onChange={(v) => set("emergency_services_called", v ? o.value : "")}
                >
                  {translate(o.labelKey)}
                </CheckboxRow>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{translate("incidents.new.familyNotified")}</FieldLabel>
              <div className="flex flex-col gap-2 mt-1">
                {FAMILY_NOTIFIED_OPTIONS.map((o) => (
                  <CheckboxRow
                    key={o.value}
                    checked={form.family_notified === o.value}
                    onChange={(v) => set("family_notified", v ? o.value : "")}
                  >
                    {translate(o.labelKey)}
                  </CheckboxRow>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel required>{translate("incidents.new.mdNotified")}</FieldLabel>
              <div className="flex flex-col gap-2 mt-1">
                {MD_NOTIFIED_OPTIONS.map((o) => (
                  <CheckboxRow
                    key={o.value}
                    checked={form.md_notified === o.value}
                    onChange={(v) => set("md_notified", v ? o.value : "")}
                  >
                    {translate(o.labelKey)}
                  </CheckboxRow>
                ))}
              </div>
              {form.md_notified === "yes" && (
                <p className="text-[11px] text-cc-muted mt-1.5">{translate("incidents.new.mdNotifiedTimeNote")}</p>
              )}
            </div>
          </div>
        </FormCard>

        {/* SECTION 5 — Reportable Incident Assessment */}
        <FormCard
          number={5}
          title={translate("incidents.new.section5Title")}
          subtitle={translate("incidents.new.section5Subtitle")}
        >
          <div className="flex flex-col gap-2.5">
            {REPORTABLE_CATEGORIES.map((c) => (
              <CheckboxRow
                key={c.value}
                checked={reportableCategories.includes(c.value)}
                onChange={(v) => toggleReportableCategory(c.value, v)}
              >
                {translate(c.labelKey)}
              </CheckboxRow>
            ))}
          </div>
          <div
            className="rounded-xl px-4 py-3 border text-[12px] leading-relaxed"
            style={{ background: "var(--cc-status-danger-bg)", borderColor: "color-mix(in srgb, var(--cc-status-danger) 25%, transparent)", color: "var(--cc-status-danger)" }}
          >
            <b>{translate("incidents.new.reportable.calloutLabel")}</b> {translate("incidents.new.reportable.calloutBody")}
          </div>
        </FormCard>

        {/* SECTION 6 — Staff Declaration */}
        <FormCard number={6} title={translate("incidents.new.section6Title")}>
          <p className="text-[13px] text-cc-text leading-relaxed">
            {translate("incidents.new.declarationText")}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{translate("incidents.new.staffMemberName")}</FieldLabel>
              <Input
                value={form.staff_declaration_name}
                onChange={(e) => set("staff_declaration_name", e.target.value)}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div>
              <FieldLabel required>{translate("incidents.new.signature")}</FieldLabel>
              <Input
                value={form.staff_declaration_signature}
                onChange={(e) => set("staff_declaration_signature", e.target.value)}
                placeholder={translate("incidents.new.signaturePlaceholder")}
                className="h-10 text-[13px] rounded-xl italic"
                style={{ borderColor: BORDER, fontFamily: "cursive" }}
              />
              <p className="text-[11px] text-cc-muted mt-1">{translate("incidents.new.signatureHelp")}</p>
            </div>
          </div>
        </FormCard>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => navigate("/incidents")}
            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold border border-cc-border text-cc-text transition-colors hover:bg-cc-soft"
          >
            {translate("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--cc-cta)" }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            {saving ? translate("incidents.new.saving") : translate("incidents.new.log")}
          </button>
        </div>
      </div>
    </div>
  );
}
