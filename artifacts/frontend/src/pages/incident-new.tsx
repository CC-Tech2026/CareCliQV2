import { useState } from "react";
import { useLocation } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, Loader2, Siren } from "lucide-react";
import { createIncident } from "@/services/incidentService";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "var(--cc-plum)";
const CORAL  = "#F1738A";
const T1     = "#1C1626";
const T2     = "#374151";
const T3     = "#7A6A8A";
const BORDER = "var(--cc-border)";
const CARD_SHADOW = "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

const INCIDENT_TYPES = [
  { value: "injury",               label: "Injury" },
  { value: "medication_error",     label: "Medication Error" },
  { value: "behaviour_of_concern", label: "Behaviour of Concern" },
  { value: "property_damage",      label: "Property Damage" },
  { value: "abuse_neglect",        label: "Abuse / Neglect" },
  { value: "restrictive_practice", label: "Restrictive Practice" },
  { value: "environmental",        label: "Environmental Hazard" },
  { value: "elopement",            label: "Elopement" },
  { value: "near_miss",            label: "Near Miss" },
  { value: "other",                label: "Other" },
];

const SEVERITIES = [
  { value: "low",      label: "Low — minimal impact, no injury" },
  { value: "medium",   label: "Medium — some impact, minor injury" },
  { value: "high",     label: "High — significant impact or injury" },
  { value: "critical", label: "Critical — life-threatening, requires immediate action" },
];

const NDIS_REPORTABLE_TYPES = new Set(["abuse_neglect", "restrictive_practice"]);

function FormCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-cc-surface rounded-2xl overflow-hidden ${className ?? ""}`} style={{ boxShadow: CARD_SHADOW }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>{title}</p>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[12px] font-medium mb-1.5 block" style={{ color: T2 }}>
      {children}
    </Label>
  );
}

export default function IncidentNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    participant_id: "",
    incident_type: "injury",
    severity: "medium",
    title: "",
    description: "",
    location: "",
    witnesses: "",
    participant_impact: "",
    worker_actions: "",
    incident_date: new Date().toISOString().slice(0, 16),
    follow_up_required: false,
  });

  const { data: participantsData } = useGetParticipants({});
  const participants = (participantsData as { data?: Array<{ id: string; full_name: string }> } | undefined)?.data ?? [];

  const ndisReportable =
    NDIS_REPORTABLE_TYPES.has(form.incident_type) || form.severity === "critical";

  function set(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!form.description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data = await createIncident<{ id: string }>({
        ...form,
        participant_id: form.participant_id || undefined,
        incident_date: new Date(form.incident_date).toISOString(),
      });
      toast({ title: "Incident logged successfully" });
      navigate(`/incidents/${data.id}`);
    } catch {
      toast({ title: "Failed to log incident", variant: "destructive" });
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
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: T3 }}
        >
          <ArrowLeft size={14} /> Incidents
        </button>
        <span style={{ color: "rgba(232,213,232,0.8)" }}>/</span>
        <span className="font-medium" style={{ color: T1 }}>Log Incident</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(234,88,12,0.10)" }}>
          <AlertTriangle size={18} className="text-orange-600" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold" style={{ color: T1 }}>Log Incident</h1>
          <p className="text-[13px]" style={{ color: T2 }}>NDIS Practice Standard 2.3 — Incident management</p>
        </div>
      </div>

      {/* NDIS reportable banner */}
      {ndisReportable && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5 border border-red-200"
          style={{ background: "rgba(254,242,242,0.8)" }}>
          <Siren size={16} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-bold text-red-800">NDIS Reportable Incident</p>
            <p className="text-[12px] text-red-700 mt-0.5">
              This incident type and/or severity requires notification to the NDIS Quality &amp; Safeguards Commission.
              {form.severity === "critical" && " Critical incidents must be reported within 24 hours."}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {/* Classification */}
        <FormCard title="Incident Classification">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Incident Type <span className="text-red-500">*</span></FieldLabel>
              <Select value={form.incident_type} onValueChange={(v) => set("incident_type", v)}>
                <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>Severity <span className="text-red-500">*</span></FieldLabel>
              <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>Participant (optional)</FieldLabel>
              <Select value={form.participant_id} onValueChange={(v) => set("participant_id", v)}>
                <SelectTrigger className="h-10 text-[13px] rounded-xl" style={{ borderColor: BORDER }}>
                  <SelectValue placeholder="Select participant…" />
                </SelectTrigger>
                <SelectContent>
                  {participants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>Date &amp; Time <span className="text-red-500">*</span></FieldLabel>
              <Input
                type="datetime-local"
                value={form.incident_date}
                onChange={(e) => set("incident_date", e.target.value)}
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div className="col-span-2">
              <FieldLabel>Incident Title <span className="text-red-500">*</span></FieldLabel>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Brief descriptive title of what occurred…"
                className="h-10 text-[13px] rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
          </div>
        </FormCard>

        {/* Details */}
        <FormCard title="Incident Details">
          <div className="space-y-4">
            <div>
              <FieldLabel>What happened? <span className="text-red-500">*</span></FieldLabel>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Describe the incident in full detail — who, what, when, where, how…"
                className="text-[13px] resize-none rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Location</FieldLabel>
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Where did it occur?"
                  className="h-10 text-[13px] rounded-xl"
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div>
                <FieldLabel>Witnesses</FieldLabel>
                <Input
                  value={form.witnesses}
                  onChange={(e) => set("witnesses", e.target.value)}
                  placeholder="Names of witnesses"
                  className="h-10 text-[13px] rounded-xl"
                  style={{ borderColor: BORDER }}
                />
              </div>
            </div>
            <div>
              <FieldLabel>Participant Impact</FieldLabel>
              <Textarea
                rows={2}
                value={form.participant_impact}
                onChange={(e) => set("participant_impact", e.target.value)}
                placeholder="How was the participant affected physically, emotionally, or behaviourally?"
                className="text-[13px] resize-none rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
            <div>
              <FieldLabel>Immediate Actions Taken</FieldLabel>
              <Textarea
                rows={2}
                value={form.worker_actions}
                onChange={(e) => set("worker_actions", e.target.value)}
                placeholder="What actions did you take immediately — first aid, calling emergency services, notifying supervisor…"
                className="text-[13px] resize-none rounded-xl"
                style={{ borderColor: BORDER }}
              />
            </div>
          </div>
        </FormCard>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => navigate("/incidents")}
            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors hover:bg-[#F6F4FB]"
            style={{ borderColor: BORDER, color: T2 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: PLUM }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            Log Incident
          </button>
        </div>
      </div>
    </div>
  );
}
