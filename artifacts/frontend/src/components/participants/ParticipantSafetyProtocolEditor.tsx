import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  getCoordinatorSafetyProtocol,
  updateCoordinatorSafetyProtocol,
  type DeescalationTechnique,
  type EscalationContact,
  type PhysicalSafetyNote,
  type SafetyScenario,
} from "@/services/safetyProtocolService";

type Props = {
  participantId: string;
};

const DEFAULT_CONTACTS: EscalationContact[] = [
  { role: "coordinator", label: "Coordinator", phone: "", sort_order: 0 },
  { role: "on_call", label: "On-call", phone: "", sort_order: 1 },
  { role: "emergency", label: "Emergency services", phone: "000", sort_order: 2 },
];

const CONTACT_LABEL_KEYS: Record<string, string> = {
  coordinator: "participants.safety.contact.coordinator",
  on_call: "participants.safety.contact.onCall",
  emergency: "participants.safety.contact.emergency",
};

export function ParticipantSafetyProtocolEditor({ participantId }: Props) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [safetyCard, setSafetyCard] = useState("");
  const [scenarios, setScenarios] = useState<SafetyScenario[]>([]);
  const [techniques, setTechniques] = useState<DeescalationTechnique[]>([]);
  const [physicalNotes, setPhysicalNotes] = useState<PhysicalSafetyNote[]>([]);
  const [contacts, setContacts] = useState<EscalationContact[]>(DEFAULT_CONTACTS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getCoordinatorSafetyProtocol(participantId);
        if (cancelled) return;
        setSafetyCard(data.safety_card_body || "");
        setScenarios(data.scenarios?.length ? data.scenarios : []);
        setTechniques(data.deescalation_techniques?.length ? data.deescalation_techniques : []);
        setPhysicalNotes(data.physical_safety_notes?.length ? data.physical_safety_notes : []);
        setContacts(
          data.escalation_contacts?.length ? data.escalation_contacts : DEFAULT_CONTACTS,
        );
      } catch (err) {
        if (!cancelled) {
          toast({
            title: translate("participants.safety.loadFailed"),
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCoordinatorSafetyProtocol(participantId, {
        safety_card_body: safetyCard,
        scenarios: scenarios.filter((s) => s.trigger.trim() && s.response.trim()).slice(0, 8),
        deescalation_techniques: techniques
          .filter((t) => t.title.trim() && t.steps.some((step) => step.trim()))
          .map((t) => ({ ...t, steps: t.steps.filter((step) => step.trim()).slice(0, 5) })),
        physical_safety_notes: physicalNotes.filter((n) => n.note.trim()),
        escalation_contacts: contacts.filter((c) => c.phone.trim()),
      });
      toast({ title: translate("participants.safety.saved") });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading safety protocol…
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-2xl border bg-cc-surface p-6 shadow-sm">
      <div>
        <h3 className="text-sm font-black uppercase tracking-wider text-violet-800">{translate("participants.safety.cardTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Mandatory read for workers before first clock-in with this participant.
        </p>
        <Textarea
          className="mt-3 min-h-[120px]"
          value={safetyCard}
          onChange={(e) => setSafetyCard(e.target.value)}
          placeholder={translate("participants.safety.cardPlaceholder")}
          spellCheck
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wider text-violet-800">
            If-then scenarios (max 8)
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={scenarios.length >= 8}
            onClick={() => setScenarios((prev) => [...prev, { trigger: "", response: "", sort_order: prev.length }])}
          >
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>
        {scenarios.map((item, i) => (
          <div key={i} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1fr_1fr_auto]">
            <Input
              value={item.trigger}
              onChange={(e) =>
                setScenarios((prev) =>
                  prev.map((row, idx) => (idx === i ? { ...row, trigger: e.target.value } : row)),
                )
              }
              placeholder={translate("participants.safety.triggerPlaceholder")}
            />
            <Input
              value={item.response}
              onChange={(e) =>
                setScenarios((prev) =>
                  prev.map((row, idx) => (idx === i ? { ...row, response: e.target.value } : row)),
                )
              }
              placeholder={translate("participants.safety.responsePlaceholder")}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => setScenarios((prev) => prev.filter((_, idx) => idx !== i))}>
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wider text-violet-800">
            De-escalation techniques
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setTechniques((prev) => [...prev, { title: "", steps: [""], sort_order: prev.length }])
            }
          >
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>
        {techniques.map((tech, i) => (
          <div key={i} className="space-y-2 rounded-xl border p-3">
            <div className="flex gap-2">
              <Input
                value={tech.title}
                onChange={(e) =>
                  setTechniques((prev) =>
                    prev.map((row, idx) => (idx === i ? { ...row, title: e.target.value } : row)),
                  )
                }
                placeholder={translate("participants.safety.techniquePlaceholder")}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => setTechniques((prev) => prev.filter((_, idx) => idx !== i))}>
                <Trash2 size={16} />
              </Button>
            </div>
            {tech.steps.map((step, si) => (
              <Input
                key={si}
                value={step}
                onChange={(e) =>
                  setTechniques((prev) =>
                    prev.map((row, idx) =>
                      idx === i
                        ? {
                            ...row,
                            steps: row.steps.map((s, j) => (j === si ? e.target.value : s)),
                          }
                        : row,
                    ),
                  )
                }
                placeholder={translateParams("participants.safety.stepPlaceholder", { n: String(si + 1) })}
              />
            ))}
            {tech.steps.length < 5 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setTechniques((prev) =>
                    prev.map((row, idx) =>
                      idx === i ? { ...row, steps: [...row.steps, ""] } : row,
                    ),
                  )
                }
              >
                Add step
              </Button>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wider text-orange-800">
            Physical safety notes
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPhysicalNotes((prev) => [...prev, { note: "", sort_order: prev.length }])}
          >
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>
        {physicalNotes.map((item, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={item.note}
              onChange={(e) =>
                setPhysicalNotes((prev) =>
                  prev.map((row, idx) => (idx === i ? { ...row, note: e.target.value } : row)),
                )
              }
              placeholder={translate("participants.safety.physicalPlaceholder")}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => setPhysicalNotes((prev) => prev.filter((_, idx) => idx !== i))}>
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-black uppercase tracking-wider text-violet-800">
          Escalation contacts
        </h3>
        {contacts.map((contact, i) => (
          <div key={contact.role} className="grid gap-2 md:grid-cols-3">
            <Input value={translate(CONTACT_LABEL_KEYS[contact.role] ?? contact.role)} readOnly className="bg-muted/40" />
            <Input
              value={contact.phone}
              onChange={(e) =>
                setContacts((prev) =>
                  prev.map((row, idx) => (idx === i ? { ...row, phone: e.target.value } : row)),
                )
              }
              placeholder={translate("participants.safety.phonePlaceholder")}
            />
            <span className="self-center text-xs font-semibold capitalize text-muted-foreground">
              {contact.role.replace("_", " ")}
            </span>
          </div>
        ))}
      </section>

      <Button type="button" className="w-full font-bold" disabled={saving} onClick={() => void handleSave()}>
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          translate("participants.safety.save")
        )}
      </Button>
    </div>
  );
}
