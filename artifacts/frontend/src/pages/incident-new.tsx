import { useState } from "react";
import { useLocation } from "wouter";
import { useGetParticipants } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, Loader2, Siren } from "lucide-react";

const INCIDENT_TYPES = [
  { value: "injury", label: "Injury" },
  { value: "medication_error", label: "Medication Error" },
  { value: "behaviour_of_concern", label: "Behaviour of Concern" },
  { value: "property_damage", label: "Property Damage" },
  { value: "abuse_neglect", label: "Abuse / Neglect" },
  { value: "restrictive_practice", label: "Restrictive Practice" },
  { value: "environmental", label: "Environmental Hazard" },
  { value: "elopement", label: "Elopement" },
  { value: "near_miss", label: "Near Miss" },
  { value: "other", label: "Other" },
];

const SEVERITIES = [
  { value: "low", label: "Low — minimal impact, no injury" },
  { value: "medium", label: "Medium — some impact, minor injury" },
  { value: "high", label: "High — significant impact or injury" },
  { value: "critical", label: "Critical — life-threatening, requires immediate action" },
];

const NDIS_REPORTABLE_TYPES = new Set(["abuse_neglect", "restrictive_practice"]);

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
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          participant_id: form.participant_id || undefined,
          incident_date: new Date(form.incident_date).toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Failed to log incident");
      const data = await res.json();
      toast({ title: "Incident logged successfully" });
      navigate(`/incidents/${data.id}`);
    } catch {
      toast({ title: "Failed to log incident", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/incidents")}
          className="gap-1.5 text-slate-500 hover:text-[#0D0D55] -ml-2 rounded-xl"
        >
          <ArrowLeft size={15} />
          Incidents
        </Button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-[#0D0D55]">Log Incident</span>
      </div>

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-orange-100 flex items-center justify-center">
          <AlertTriangle size={18} className="text-orange-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#0D0D55]">Log Incident</h1>
          <p className="text-sm text-slate-500">NDIS Practice Standard 2.3 — Incident management</p>
        </div>
      </div>

      {/* NDIS reportable warning */}
      {ndisReportable && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <Siren size={16} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-800">NDIS Reportable Incident</p>
            <p className="text-xs text-red-700 mt-0.5">
              This incident type and/or severity requires notification to the NDIS Quality &amp; Safeguards Commission.
              {form.severity === "critical" && " Critical incidents must be reported within 24 hours."}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {/* Classification */}
        <Card className="border-slate-100 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-600">Incident Classification</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">Incident Type <span className="text-destructive">*</span></Label>
              <Select value={form.incident_type} onValueChange={(v) => set("incident_type", v)}>
                <SelectTrigger className="h-10 text-sm rounded-xl border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">Severity <span className="text-destructive">*</span></Label>
              <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                <SelectTrigger className="h-10 text-sm rounded-xl border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">Participant (optional)</Label>
              <Select value={form.participant_id} onValueChange={(v) => set("participant_id", v)}>
                <SelectTrigger className="h-10 text-sm rounded-xl border-slate-200">
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
              <Label className="text-xs text-slate-500 mb-1.5 block">Date &amp; Time <span className="text-destructive">*</span></Label>
              <Input
                type="datetime-local"
                value={form.incident_date}
                onChange={(e) => set("incident_date", e.target.value)}
                className="h-10 text-sm rounded-xl border-slate-200"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-slate-500 mb-1.5 block">Incident Title <span className="text-destructive">*</span></Label>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Brief descriptive title of what occurred…"
                className="h-10 text-sm rounded-xl border-slate-200"
              />
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card className="border-slate-100 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-600">Incident Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">What happened? <span className="text-destructive">*</span></Label>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Describe the incident in full detail — who, what, when, where, how…"
                className="text-sm resize-none rounded-xl border-slate-200"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-slate-500 mb-1.5 block">Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Where did it occur?"
                  className="h-10 text-sm rounded-xl border-slate-200"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1.5 block">Witnesses</Label>
                <Input
                  value={form.witnesses}
                  onChange={(e) => set("witnesses", e.target.value)}
                  placeholder="Names of witnesses"
                  className="h-10 text-sm rounded-xl border-slate-200"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">Participant Impact</Label>
              <Textarea
                rows={2}
                value={form.participant_impact}
                onChange={(e) => set("participant_impact", e.target.value)}
                placeholder="How was the participant affected physically, emotionally, or behaviourally?"
                className="text-sm resize-none rounded-xl border-slate-200"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">Immediate Actions Taken</Label>
              <Textarea
                rows={2}
                value={form.worker_actions}
                onChange={(e) => set("worker_actions", e.target.value)}
                placeholder="What actions did you take immediately — first aid, calling emergency services, notifying supervisor…"
                className="text-sm resize-none rounded-xl border-slate-200"
              />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/incidents")}
            className="rounded-xl border-slate-200"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[#0D0D55] hover:bg-[#1a1a77] text-white rounded-xl gap-2"
          >
            {saving
              ? <Loader2 size={15} className="animate-spin" />
              : <AlertTriangle size={15} />}
            Log Incident
          </Button>
        </div>
      </div>
    </div>
  );
}
