import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <section className="space-y-4 rounded-2xl border border-cc-border bg-cc-soft p-4">
      <p className="text-[12px] font-black uppercase tracking-[0.13em] text-cc-plum">{translate("participants.clinicalRecord.contactTitle")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={translate("participants.shiftContext.gpName")} value={gpName} onChange={setGpName} />
        <Field label={translate("participants.shiftContext.gpPhone")} value={gpPhone} onChange={setGpPhone} />
        <Field label={translate("participants.shiftContext.gpPractice")} value={gpPractice} onChange={setGpPractice} />
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.shiftContext.currentConditions")}</p>
        <textarea
          className="cc-field w-full rounded-xl px-3 py-2 text-sm min-h-[72px] resize-none"
          value={currentConditions}
          onChange={(e) => setCurrentConditions(e.target.value)}
        />
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.shiftContext.allergies")}</p>
        {allergies.map((item, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
            <Input
              placeholder={translate("participants.shiftContext.allergen")}
              value={item.allergen}
              onChange={(e) =>
                setAllergies((prev) => prev.map((a, j) => (j === i ? { ...a, allergen: e.target.value } : a)))
              }
            />
            <select
              className="cc-field rounded-md px-2 text-sm h-9"
              value={item.severity}
              onChange={(e) =>
                setAllergies((prev) => prev.map((a, j) => (j === i ? { ...a, severity: e.target.value } : a)))
              }
            >
              <option value="mild">{translate("participants.shiftContext.severity.mild")}</option>
              <option value="moderate">{translate("participants.shiftContext.severity.moderate")}</option>
              <option value="severe">{translate("participants.shiftContext.severity.severe")}</option>
              <option value="anaphylactic">{translate("participants.shiftContext.severity.anaphylactic")}</option>
            </select>
            <Button type="button" variant="ghost" size="icon" onClick={() => setAllergies((prev) => prev.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setAllergies((prev) => [...prev, { allergen: "", severity: "mild" }])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {translate("participants.shiftContext.addAllergy")}
        </Button>
      </div>

      <Button disabled={saving} onClick={save} className="cc-btn-primary">
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {translate("participants.clinicalRecord.save")}
      </Button>
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{label}</p>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
