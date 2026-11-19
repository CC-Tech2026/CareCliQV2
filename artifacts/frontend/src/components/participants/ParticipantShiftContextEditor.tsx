import { STAFF_SEARCH, staffOption } from "@/lib/person-options";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { HELP, INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON, SUBHEADING, SUBSECTION, TEXTAREA } from "@/components/participants/recordUi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch } from "@/services/http";
import type { ParticipantContext } from "@/services/shiftService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getCoordinatorWorkerStats } from "@/services/coordinatorService";

// Allergies, conditions, and GP contact live in ParticipantClinicalRecordEditor now —
// clinical/health data belongs in the Clinical Record tab, not this operational briefing tab.
type ContactPerson = {
  name?: string | null;
  phone?: string | null;
  relationship?: string | null;
};

type ShiftContextPayload = {
  profile?: {
    preferred_name?: string;
    case_manager?: { name?: string; phone?: string };
    // Structured reference to an internal coordinator/MD account — distinct
    // from case_manager above, which is the free-text NDIS plan-management
    // billing contact and is untouched by this field.
    care_coordinator?: { id?: string; name?: string } | null;
    emergency_contact?: ContactPerson | null;
    next_of_kin?: ContactPerson | null;
  };
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
  onSaved?: () => void;
  participantId: string;
};

export function ParticipantShiftContextEditor({
  participantId,
  onSaved,
}: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferredName, setPreferredName] = useState("");
  const [caseManagerName, setCaseManagerName] = useState("");
  const [caseManagerPhone, setCaseManagerPhone] = useState("");
  const [careCoordinatorId, setCareCoordinatorId] = useState<string | null>(
    null,
  );
  const { data: coordinators = [] } = useOrgQuery(
    ["org-coordinators", "care-coordinator-picker"],
    {
      queryFn: () =>
        getCoordinatorWorkerStats().then((list) =>
          list.filter(
            (w) =>
              w.role === "support_coordinator" ||
              w.role === "managing_director",
          ),
        ),
    },
  );
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyContactRelationship, setEmergencyContactRelationship] =
    useState("");
  const [nextOfKinName, setNextOfKinName] = useState("");
  const [nextOfKinPhone, setNextOfKinPhone] = useState("");
  const [nextOfKinRelationship, setNextOfKinRelationship] = useState("");
  const [likesDislikes, setLikesDislikes] = useState("");
  const [sensory, setSensory] = useState("");
  const [cultural, setCultural] = useState("");
  const [communicationStyle, setCommunicationStyle] = useState("");
  const [communicationGuidance, setCommunicationGuidance] = useState("");
  const [previousVisitNotes, setPreviousVisitNotes] = useState("");
  const [activities, setActivities] = useState<string[]>([]);
  const [behaviouralNotes, setBehaviouralNotes] = useState([
    {
      title: translate("participants.shiftContext.defaultNoteTitle"),
      body: "",
    },
  ]);
  const [backgroundSummary, setBackgroundSummary] = useState("");
  const [briefingAlerts, setBriefingAlerts] = useState<string[]>([]);

  const hydrateForm = (data: ShiftContextPayload) => {
    setPreferredName(data.profile?.preferred_name ?? "");
    setCaseManagerName(data.profile?.case_manager?.name ?? "");
    setCaseManagerPhone(data.profile?.case_manager?.phone ?? "");
    setCareCoordinatorId(data.profile?.care_coordinator?.id ?? null);
    setEmergencyContactName(data.profile?.emergency_contact?.name ?? "");
    setEmergencyContactPhone(data.profile?.emergency_contact?.phone ?? "");
    setEmergencyContactRelationship(
      data.profile?.emergency_contact?.relationship ?? "",
    );
    setNextOfKinName(data.profile?.next_of_kin?.name ?? "");
    setNextOfKinPhone(data.profile?.next_of_kin?.phone ?? "");
    setNextOfKinRelationship(data.profile?.next_of_kin?.relationship ?? "");
    setLikesDislikes(data.preferences?.likes_dislikes ?? "");
    setSensory(data.preferences?.sensory_preferences ?? "");
    setCultural(data.preferences?.cultural_preferences ?? "");
    setCommunicationStyle(data.preferences?.communication_style ?? "");
    setCommunicationGuidance(data.context?.communication_guidance ?? "");
    setPreviousVisitNotes(data.context?.previous_visit_notes ?? "");
    setActivities(data.context?.preferred_activities ?? []);
    setBehaviouralNotes(
      data.context?.behavioural_notes?.length
        ? data.context.behavioural_notes
        : [
            {
              title: translate("participants.shiftContext.defaultNoteTitle"),
              body: "",
            },
          ],
    );
    setBackgroundSummary(data.background_summary ?? "");
    setBriefingAlerts(data.briefing_alerts?.length ? data.briefing_alerts : []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await jsonFetch<ShiftContextPayload>(
          `/api/participants/${participantId}/shift-context`,
        );
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

  const contactPayload = (name: string, phone: string, relationship: string) =>
    name || phone || relationship
      ? {
          name: name || null,
          phone: phone || null,
          relationship: relationship || null,
        }
      : null;

  const save = async () => {
    setSaving(true);
    try {
      const saved = await jsonFetch<ShiftContextPayload>(
        `/api/participants/${participantId}/shift-context`,
        {
          method: "PATCH",
          body: JSON.stringify({
            preferred_name: preferredName || null,
            case_manager_name: caseManagerName || null,
            case_manager_phone: caseManagerPhone || null,
            care_coordinator_id: careCoordinatorId || null,
            emergency_contact: contactPayload(
              emergencyContactName,
              emergencyContactPhone,
              emergencyContactRelationship,
            ),
            next_of_kin: contactPayload(
              nextOfKinName,
              nextOfKinPhone,
              nextOfKinRelationship,
            ),
            likes_dislikes: likesDislikes || null,
            sensory_preferences: sensory || null,
            cultural_preferences: cultural || null,
            communication_preferences: communicationStyle || null,
            communication_guidance: communicationGuidance || null,
            previous_visit_notes: previousVisitNotes || null,
            preferred_activities: activities.filter(Boolean),
            behavioural_notes: behaviouralNotes.filter((n) => n.body.trim()),
            background_summary: backgroundSummary || null,
            briefing_alerts: briefingAlerts.filter(Boolean),
          }),
        },
      );
      hydrateForm(saved);
      onSaved?.();
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
    return (
      <div className="py-6 text-sm text-muted-foreground">
        {translate("participants.shiftContext.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="briefing-heading" className={SUBSECTION}>
        <div>
          <h4 id="briefing-heading" className={SUBHEADING}>{translate("participants.shiftContext.briefing")}</h4>
          <p className={HELP}>{translate("participants.shiftContext.hint")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={translate("participants.shiftContext.preferredName")}
            value={preferredName}
            onChange={setPreferredName}
          />
        </div>
        <TextArea
          label={translate("participants.shiftContext.aboutParticipant")}
          value={backgroundSummary}
          onChange={setBackgroundSummary}
        />
        <ListEditor
          label={translate("participants.shiftContext.criticalAlerts")}
          items={briefingAlerts}
          setItems={setBriefingAlerts}
          placeholder={translate("participants.shiftContext.alertPlaceholder")}
          addLabel={translate("participants.shiftContext.addAlert")}
          max={3}
        />
      </section>

      <section aria-labelledby="contacts-heading" className={SUBSECTION}>
        <h4 id="contacts-heading" className={SUBHEADING}>Key contacts</h4>
        <div className="max-w-sm space-y-1.5">
          <p className={LABEL} id="care-coordinator-label">{translate("participants.shiftContext.careCoordinator")}</p>
          <SearchableSelect
            value={careCoordinatorId ?? "unassigned"}
            onValueChange={(value) => setCareCoordinatorId(value === "unassigned" ? null : value)}
            options={[
              { value: "unassigned", label: translate("participants.shiftContext.unassigned"), keywords: "none" },
              ...coordinators.map(staffOption),
            ]}
            placeholder={translate("participants.shiftContext.unassigned")}
            searchPlaceholder={STAFF_SEARCH}
            emptyText="No one matches"
          />
          <p className={HELP}>{translate("participants.shiftContext.careCoordinatorHint")}</p>
        </div>

        <fieldset className="space-y-2">
          <legend className={LABEL}>{translate("participants.shiftContext.billingContactHeading")}</legend>
          <p className={HELP}>{translate("participants.shiftContext.billingContactHint")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={translate("participants.shiftContext.caseManagerName")} value={caseManagerName} onChange={setCaseManagerName} />
            <Field label={translate("participants.shiftContext.caseManagerPhone")} value={caseManagerPhone} onChange={setCaseManagerPhone} type="tel" />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={LABEL}>{translate("participants.shiftContext.emergencyContactHeading")}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={translate("participants.shiftContext.emergencyContactName")} value={emergencyContactName} onChange={setEmergencyContactName} />
            <Field label={translate("participants.shiftContext.emergencyContactPhone")} value={emergencyContactPhone} onChange={setEmergencyContactPhone} type="tel" />
            <Field label={translate("participants.shiftContext.emergencyContactRelationship")} value={emergencyContactRelationship} onChange={setEmergencyContactRelationship} />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={LABEL}>{translate("participants.shiftContext.nextOfKinHeading")}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={translate("participants.shiftContext.nextOfKinName")} value={nextOfKinName} onChange={setNextOfKinName} />
            <Field label={translate("participants.shiftContext.nextOfKinPhone")} value={nextOfKinPhone} onChange={setNextOfKinPhone} type="tel" />
            <Field label={translate("participants.shiftContext.nextOfKinRelationship")} value={nextOfKinRelationship} onChange={setNextOfKinRelationship} />
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="preferences-heading" className={SUBSECTION}>
        <h4 id="preferences-heading" className={SUBHEADING}>Preferences and communication</h4>
        <div className="grid gap-4 lg:grid-cols-2">
          <TextArea label={translate("participants.shiftContext.likesDislikes")} value={likesDislikes} onChange={setLikesDislikes} />
          <TextArea label={translate("participants.shiftContext.sensory")} value={sensory} onChange={setSensory} />
          <TextArea label={translate("participants.shiftContext.cultural")} value={cultural} onChange={setCultural} />
          <TextArea label={translate("participants.shiftContext.communicationStyle")} value={communicationStyle} onChange={setCommunicationStyle} />
        </div>
        <TextArea label={translate("participants.shiftContext.communicationGuidance")} value={communicationGuidance} onChange={setCommunicationGuidance} />
      </section>

      <section aria-labelledby="activities-heading" className={SUBSECTION}>
        <h4 id="activities-heading" className={SUBHEADING}>Activities and behaviour support</h4>
        <ListEditor
          label={translate("participants.shiftContext.preferredActivities")}
          items={activities}
          setItems={setActivities}
          addLabel={translate("participants.shiftContext.addActivity")}
        />
        <TextArea label={translate("participants.shiftContext.previousVisits")} value={previousVisitNotes} onChange={setPreviousVisitNotes} />
        <div className="space-y-3">
          <p className={LABEL}>{translate("participants.shiftContext.behaviouralNotes")}</p>
          {behaviouralNotes.map((note, i) => (
            <div key={i} className="space-y-2">
              <input
                aria-label={`${translate("participants.shiftContext.noteTitle")} ${i + 1}`}
                className={INPUT}
                placeholder={translate("participants.shiftContext.noteTitle")}
                value={note.title}
                onChange={(e) => setBehaviouralNotes((prev) => prev.map((n, j) => (j === i ? { ...n, title: e.target.value } : n)))}
              />
              <textarea
                aria-label={`${note.title || translate("participants.shiftContext.noteTitle")} ${i + 1}`}
                className={TEXTAREA}
                placeholder={translate("participants.shiftContext.notePlaceholder")}
                value={note.body}
                onChange={(e) => setBehaviouralNotes((prev) => prev.map((n, j) => (j === i ? { ...n, body: e.target.value } : n)))}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setBehaviouralNotes((prev) => [...prev, { title: translate("participants.shiftContext.defaultNoteTitle"), body: "" }])
            }
            className={SECONDARY_BUTTON}
          >
            <Plus className="h-4 w-4" aria-hidden /> {translate("participants.shiftContext.addNote")}
          </button>
        </div>
      </section>

      <div className="border-t border-cc-border pt-5">
        <button type="button" disabled={saving} onClick={save} className={PRIMARY_BUTTON}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {translate("participants.shiftContext.save")}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className={LABEL}>{label}</span>
      <input type={type} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className={LABEL}>{label}</span>
      <textarea className={TEXTAREA} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ListEditor({
  items,
  setItems,
  placeholder,
  addLabel,
  max,
  label,
}: {
  items: string[];
  setItems: (update: (prev: string[]) => string[]) => void;
  placeholder?: string;
  addLabel: string;
  max?: number;
  label: string;
}) {
  return (
  <div className="space-y-2">
    <p className={LABEL}>{label}</p>
    {items.map((item, i) => (
      <div key={i} className="flex gap-2">
        <input
          aria-label={`${label} ${i + 1}`}
          className={INPUT}
          placeholder={placeholder}
          value={item}
          onChange={(e) => setItems((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
        />
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
          onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-cc-muted hover:bg-cc-soft hover:text-cc-text"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ))}
    <button
      type="button"
      disabled={max != null && items.length >= max}
      onClick={() => setItems((prev) => [...prev, ""])}
      className={SECONDARY_BUTTON}
    >
      <Plus className="h-4 w-4" aria-hidden /> {addLabel}
    </button>
  </div>
);
}
