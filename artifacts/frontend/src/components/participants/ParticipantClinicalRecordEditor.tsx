import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { HELP, INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON, SUBHEADING, SUBSECTION, TEXTAREA } from "@/components/participants/recordUi";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch } from "@/services/http";
import type { ParticipantAllergy } from "@/services/shiftService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

/** Only the clinical/health-relevant slice of the shift-context payload — same backend
 * endpoint as ParticipantShiftContextEditor, which owns the operational/preference fields. */
type ClinicalPayload = {
  profile?: { gp?: { name?: string; phone?: string; practice?: string } };
  context?: { medical?: { conditions?: string; allergies?: ParticipantAllergy[] } };
};

type Props = {
  participantId: string;
};

export function ParticipantClinicalRecordEditor({ participantId }: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gpName, setGpName] = useState("");
  const [gpPhone, setGpPhone] = useState("");
  const [gpPractice, setGpPractice] = useState("");
  const [currentConditions, setCurrentConditions] = useState("");
  const [allergies, setAllergies] = useState<ParticipantAllergy[]>([]);

  const hydrateForm = (data: ClinicalPayload) => {
    setGpName(data.profile?.gp?.name ?? "");
    setGpPhone(data.profile?.gp?.phone ?? "");
    setGpPractice(data.profile?.gp?.practice ?? "");
    setCurrentConditions(data.context?.medical?.conditions ?? "");
    setAllergies(data.context?.medical?.allergies ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await jsonFetch<ClinicalPayload>(`/api/participants/${participantId}/shift-context`);
        if (cancelled) return;
        hydrateForm(data);
      } catch (err) {
        if (!cancelled) {
          toast({
            title: translate("participants.clinicalRecord.loadFailed"),
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [participantId, toast]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await jsonFetch<ClinicalPayload>(`/api/participants/${participantId}/shift-context`, {
        method: "PATCH",
        body: JSON.stringify({
          gp_name: gpName || null,
          gp_phone: gpPhone || null,
          gp_practice: gpPractice || null,
          current_conditions: currentConditions || null,
          allergies: allergies.filter((a) => a.allergen.trim()),
        }),
      });
      hydrateForm(saved);
      toast({ title: translate("participants.clinicalRecord.saved") });
    } catch (err) {
      toast({
        title: translate("common.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-6 text-sm text-muted-foreground">{translate("participants.clinicalRecord.loading")}</div>;
  }

  return (
    <section aria-labelledby="health-heading" className={SUBSECTION}>
      <h4 id="health-heading" className={SUBHEADING}>{translate("participants.clinicalRecord.contactTitle")}</h4>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={translate("participants.shiftContext.gpName")} value={gpName} onChange={setGpName} />
        <Field label={translate("participants.shiftContext.gpPhone")} value={gpPhone} onChange={setGpPhone} type="tel" />
        <Field label={translate("participants.shiftContext.gpPractice")} value={gpPractice} onChange={setGpPractice} />
      </div>

      <label className="block space-y-1.5">
        <span className={LABEL}>{translate("participants.shiftContext.currentConditions")}</span>
        <textarea className={TEXTAREA} value={currentConditions} onChange={(e) => setCurrentConditions(e.target.value)} />
      </label>

      <div className="space-y-2">
        <p className={LABEL}>{translate("participants.shiftContext.allergies")}</p>
        {allergies.length === 0 && <p className={HELP}>No allergies recorded.</p>}
        {allergies.map((item, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
            <input
              aria-label={`${translate("participants.shiftContext.allergen")} ${i + 1}`}
              className={INPUT}
              placeholder={translate("participants.shiftContext.allergen")}
              value={item.allergen}
              onChange={(e) => setAllergies((prev) => prev.map((a, j) => (j === i ? { ...a, allergen: e.target.value } : a)))}
            />
            <select
              aria-label={`Severity ${i + 1}`}
              className={INPUT}
              value={item.severity}
              onChange={(e) => setAllergies((prev) => prev.map((a, j) => (j === i ? { ...a, severity: e.target.value } : a)))}
            >
              <option value="mild">{translate("participants.shiftContext.severity.mild")}</option>
              <option value="moderate">{translate("participants.shiftContext.severity.moderate")}</option>
              <option value="severe">{translate("participants.shiftContext.severity.severe")}</option>
              <option value="anaphylactic">{translate("participants.shiftContext.severity.anaphylactic")}</option>
            </select>
            <button
              type="button"
              aria-label={`Remove allergy ${i + 1}`}
              onClick={() => setAllergies((prev) => prev.filter((_, j) => j !== i))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-cc-muted hover:bg-cc-soft hover:text-cc-text"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setAllergies((prev) => [...prev, { allergen: "", severity: "mild" }])} className={SECONDARY_BUTTON}>
          <Plus className="h-4 w-4" aria-hidden /> {translate("participants.shiftContext.addAllergy")}
        </button>
      </div>

      <button type="button" disabled={saving} onClick={save} className={PRIMARY_BUTTON}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {translate("participants.clinicalRecord.save")}
      </button>
    </section>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className={LABEL}>{label}</span>
      <input type={type} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
