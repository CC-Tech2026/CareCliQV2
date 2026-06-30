import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch } from "@/services/http";
import type { ParticipantAllergy, ParticipantContext } from "@/services/shiftService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type ShiftContextPayload = {
  profile?: { preferred_name?: string; case_manager?: { name?: string; phone?: string } };
  preferences?: {
    likes_dislikes?: string;
    sensory_preferences?: string;
    cultural_preferences?: string;
    communication_style?: string;
  };
  context?: ParticipantContext;
  background_summary?: string | null;
  briefing_alerts?: string[];
};

type Props = {
  participantId: string;
};

export function ParticipantShiftContextEditor({ participantId }: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferredName, setPreferredName] = useState("");
  const [caseManagerName, setCaseManagerName] = useState("");
  const [caseManagerPhone, setCaseManagerPhone] = useState("");
  const [likesDislikes, setLikesDislikes] = useState("");
  const [sensory, setSensory] = useState("");
  const [cultural, setCultural] = useState("");
  const [communicationStyle, setCommunicationStyle] = useState("");
  const [communicationGuidance, setCommunicationGuidance] = useState("");
  const [previousVisitNotes, setPreviousVisitNotes] = useState("");
  const [currentConditions, setCurrentConditions] = useState("");
  const [activities, setActivities] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<ParticipantAllergy[]>([]);
  const [behaviouralNotes, setBehaviouralNotes] = useState([{ title: translate("participants.shiftContext.defaultNoteTitle"), body: "" }]);
  const [backgroundSummary, setBackgroundSummary] = useState("");
  const [briefingAlerts, setBriefingAlerts] = useState<string[]>([]);

  const hydrateForm = (data: ShiftContextPayload) => {
    setPreferredName(data.profile?.preferred_name ?? "");
    setCaseManagerName(data.profile?.case_manager?.name ?? "");
    setCaseManagerPhone(data.profile?.case_manager?.phone ?? "");
    setLikesDislikes(data.preferences?.likes_dislikes ?? "");
    setSensory(data.preferences?.sensory_preferences ?? "");
    setCultural(data.preferences?.cultural_preferences ?? "");
    setCommunicationStyle(data.preferences?.communication_style ?? "");
    setCommunicationGuidance(data.context?.communication_guidance ?? "");
    setPreviousVisitNotes(data.context?.previous_visit_notes ?? "");
    setCurrentConditions(data.context?.medical?.conditions ?? "");
    setActivities(data.context?.preferred_activities ?? []);
    setAllergies(data.context?.medical?.allergies ?? []);
    setBehaviouralNotes(
      data.context?.behavioural_notes?.length
        ? data.context.behavioural_notes
        : [{ title: translate("participants.shiftContext.defaultNoteTitle"), body: "" }],
    );
    setBackgroundSummary(data.background_summary ?? "");
    setBriefingAlerts(data.briefing_alerts?.length ? data.briefing_alerts : []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await jsonFetch<ShiftContextPayload>(`/api/participants/${participantId}/shift-context`);
        if (cancelled) return;
        hydrateForm(data);
      } catch (err) {
        if (!cancelled) {
          toast({
            title: translate("participants.shiftContext.loadFailed"),
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
      const saved = await jsonFetch<ShiftContextPayload>(`/api/participants/${participantId}/shift-context`, {
        method: "PATCH",
        body: JSON.stringify({
          preferred_name: preferredName || null,
          case_manager_name: caseManagerName || null,
          case_manager_phone: caseManagerPhone || null,
          likes_dislikes: likesDislikes || null,
          sensory_preferences: sensory || null,
          cultural_preferences: cultural || null,
          communication_preferences: communicationStyle || null,
          communication_guidance: communicationGuidance || null,
          previous_visit_notes: previousVisitNotes || null,
          current_conditions: currentConditions || null,
          preferred_activities: activities.filter(Boolean),
          behavioural_notes: behaviouralNotes.filter((n) => n.body.trim()),
          allergies: allergies.filter((a) => a.allergen.trim()),
          background_summary: backgroundSummary || null,
          briefing_alerts: briefingAlerts.filter(Boolean),
        }),
      });
      hydrateForm(saved);
      toast({ title: translate("participants.shiftContext.saved") });
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
    return <div className="py-6 text-sm text-muted-foreground">{translate("participants.shiftContext.loading")}</div>;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-cc-border bg-cc-soft p-4">
      <p className="text-[12px] font-black uppercase tracking-[0.13em] text-cc-plum">{translate("participants.shiftContext.title")}</p>
      <p className="text-[12px] text-cc-muted">
        {translate("participants.shiftContext.hint")}
      </p>

      <div className="rounded-xl border border-cc-border bg-cc-surface p-3 space-y-3">
        <p className="text-[11px] font-black uppercase tracking-wide text-cc-plum">{translate("participants.shiftContext.briefing")}</p>
        <TextArea
          label={translate("participants.shiftContext.aboutParticipant")}
          value={backgroundSummary}
          onChange={setBackgroundSummary}
        />
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cc-muted">
            {translate("participants.shiftContext.criticalAlerts")}
          </p>
          {briefingAlerts.map((alert, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input
                placeholder={translate("participants.shiftContext.alertPlaceholder")}
                value={alert}
                onChange={(e) =>
                  setBriefingAlerts((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setBriefingAlerts((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={briefingAlerts.length >= 3}
            onClick={() => setBriefingAlerts((prev) => [...prev, ""])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> {translate("participants.shiftContext.addAlert")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={translate("participants.shiftContext.preferredName")} value={preferredName} onChange={setPreferredName} />
        <Field label={translate("participants.shiftContext.caseManagerName")} value={caseManagerName} onChange={setCaseManagerName} />
        <Field label={translate("participants.shiftContext.caseManagerPhone")} value={caseManagerPhone} onChange={setCaseManagerPhone} />
      </div>

      <TextArea label={translate("participants.shiftContext.likesDislikes")} value={likesDislikes} onChange={setLikesDislikes} />
      <TextArea label={translate("participants.shiftContext.sensory")} value={sensory} onChange={setSensory} />
      <TextArea label={translate("participants.shiftContext.cultural")} value={cultural} onChange={setCultural} />
      <TextArea label={translate("participants.shiftContext.communicationStyle")} value={communicationStyle} onChange={setCommunicationStyle} />
      <TextArea label={translate("participants.shiftContext.communicationGuidance")} value={communicationGuidance} onChange={setCommunicationGuidance} />
      <TextArea label={translate("participants.shiftContext.currentConditions")} value={currentConditions} onChange={setCurrentConditions} />
      <TextArea label={translate("participants.shiftContext.previousVisits")} value={previousVisitNotes} onChange={setPreviousVisitNotes} />

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.shiftContext.preferredActivities")}</p>
        {activities.map((item, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <Input value={item} onChange={(e) => setActivities((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))} />
            <Button type="button" variant="ghost" size="icon" onClick={() => setActivities((prev) => prev.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setActivities((prev) => [...prev, ""])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {translate("participants.shiftContext.addActivity")}
        </Button>
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

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cc-muted">{translate("participants.shiftContext.behaviouralNotes")}</p>
        {behaviouralNotes.map((note, i) => (
          <div key={i} className="mb-2 space-y-1">
            <Input
              placeholder={translate("participants.shiftContext.noteTitle")}
              value={note.title}
              onChange={(e) =>
                setBehaviouralNotes((prev) => prev.map((n, j) => (j === i ? { ...n, title: e.target.value } : n)))
              }
            />
            <textarea
              className="cc-field w-full rounded-xl px-3 py-2 text-sm min-h-[72px]"
              placeholder={translate("participants.shiftContext.notePlaceholder")}
              value={note.body}
              onChange={(e) =>
                setBehaviouralNotes((prev) => prev.map((n, j) => (j === i ? { ...n, body: e.target.value } : n)))
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setBehaviouralNotes((prev) => [...prev, { title: translate("participants.shiftContext.defaultNoteTitle"), body: "" }])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> {translate("participants.shiftContext.addNote")}
        </Button>
      </div>

      <Button disabled={saving} onClick={save} className="cc-btn-primary">
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {translate("participants.shiftContext.save")}
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

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">{label}</p>
      <textarea
        className="cc-field w-full rounded-xl px-3 py-2 text-sm min-h-[72px] resize-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
