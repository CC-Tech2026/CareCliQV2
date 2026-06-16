import { useState } from "react";
import { AlertTriangle, ChevronDown, Phone, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createIncident } from "@/services/incidentService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const INCIDENT_TYPES = [
  { value: "injury", label: "Fall" },
  { value: "medication_error", label: "Medication Error" },
  { value: "behaviour_of_concern", label: "Behaviour of Concern" },
  { value: "property_damage", label: "Property Damage" },
  { value: "near_miss", label: "Near Miss" },
  { value: "other", label: "Other" },
] as const;

type Props = {
  participantId?: string;
  participantName?: string;
  sessionId?: string | null;
  shiftAddress?: string;
  open?: boolean;
  onToggle?: () => void;
  officePhone?: string;
};

export function DuringShiftAccordion({
  participantId,
  participantName,
  sessionId,
  shiftAddress,
  open = false,
  onToggle,
  officePhone = "1300 000 000",
}: Props) {
  const { toast } = useToast();
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentType, setIncidentType] = useState("injury");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitIncident = async () => {
    if (!description.trim()) {
      toast({ title: "Description required", description: "Describe what happened.", variant: "destructive" });
      return;
    }
    const typeLabel = INCIDENT_TYPES.find((t) => t.value === incidentType)?.label ?? "Incident";
    setSubmitting(true);
    try {
      await createIncident({
        participant_id: participantId,
        session_id: sessionId ?? undefined,
        incident_type: incidentType,
        severity: incidentType === "injury" ? "medium" : "low",
        title: `${typeLabel} — ${participantName ?? "shift"}`,
        description: description.trim(),
        location: shiftAddress,
        incident_date: new Date().toISOString(),
      });
      toast({
        title: "Incident reported",
        description: "Your report has been submitted to the office.",
      });
      setDescription("");
      setShowIncidentForm(false);
    } catch (err) {
      toast({
        title: "Could not submit report",
        description: (err as Error).message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <Sparkles size={16} style={{ color: PLUM }} />
          During Shift
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-4" style={{ borderColor: BORDER }}>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-11 rounded-xl text-xs font-bold text-red-600",
                showIncidentForm && "border-red-200 bg-red-50 text-red-700",
              )}
              onClick={() => setShowIncidentForm((v) => !v)}
            >
              <AlertTriangle size={14} className="mr-1.5 shrink-0" />
              Report Incident
            </Button>
            <a href={`tel:${officePhone.replace(/\s/g, "")}`} className="block">
              <Button type="button" variant="outline" className="h-11 w-full rounded-xl text-xs font-bold text-green-600">
                <Phone size={14} className="mr-1.5 shrink-0 text-emerald-600" />
                Contact Office
              </Button>
            </a>
          </div>

          <a href="tel:000" className="block">
            <Button
              type="button"
              className="h-12 w-full rounded-xl border-0 text-sm font-black text-white"
              style={{ background: CORAL }}
            >
              Emergency Services (000)
            </Button>
          </a>

          {showIncidentForm && (
            <div className="rounded-xl border bg-[#FFFBFB] p-4" style={{ borderColor: "#FECDD3" }}>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black" style={{ color: TEXT }}>
                  Report an Incident
                </p>
                <button
                  type="button"
                  onClick={() => setShowIncidentForm(false)}
                  className="rounded-full p-1 hover:bg-black/5"
                  style={{ color: MUTED }}
                  aria-label="Close incident form"
                >
                  <X size={16} />
                </button>
              </div>

              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Incident type
              </label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger className="mb-3 h-10 rounded-xl text-sm font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Describe what happened
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened…"
                className="min-h-[100px] resize-none rounded-xl text-sm"
              />

              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  className="flex-1 rounded-full font-bold text-white"
                  style={{ background: CORAL }}
                  disabled={submitting}
                  onClick={handleSubmitIncident}
                >
                  {submitting ? "Submitting…" : "Submit Report"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full font-bold"
                  onClick={() => {
                    setShowIncidentForm(false);
                    setDescription("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
