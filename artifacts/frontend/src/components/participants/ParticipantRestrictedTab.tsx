import { Lock, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";

export type RestrictedClinicalDraft = {
  restricted_behavioural_notes: string;
  behaviour_support_plan: string;
  medications: string;
  medical_alerts: string;
};

interface ParticipantRestrictedTabProps {
  isLoading: boolean;
  draft: RestrictedClinicalDraft | null;
  onDraftChange: (next: RestrictedClinicalDraft) => void;
  onSave: () => void;
  isSaving: boolean;
}

const FIELDS = [
  { key: "restricted_behavioural_notes" as const, label: "Behavioural Notes (Restricted)", placeholder: "Document restricted behavioural observations and incidents…" },
  { key: "behaviour_support_plan"       as const, label: "Behaviour Support Plan",         placeholder: "Summarise the participant's current behaviour support plan…" },
  { key: "medications"                  as const, label: "Medications",                    placeholder: "Current medications, dosages, and administration notes…" },
  { key: "medical_alerts"               as const, label: "Medical Alerts",                 placeholder: "Known allergies, contraindications, emergency protocols…" },
];

/** "Clinical Records" facet of the participant Detail archetype — coordinator only. */
export function ParticipantRestrictedTab({
  isLoading,
  draft,
  onDraftChange,
  onSave,
  isSaving,
}: ParticipantRestrictedTabProps) {
  const { translate } = useAccessibility();

  return (
    <section className="rounded-2xl border border-orange-200/70 bg-orange-50/30 p-4 space-y-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-orange-600" />
          <p className="text-[12px] font-black uppercase tracking-[0.13em] text-orange-700">{translate("patients.restricted.title")}</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-orange-300 text-orange-600 font-semibold uppercase tracking-wide bg-orange-100">{translate("patients.restricted.coordinatorOnly")}</span>
      </div>
      <p className="text-[12px] text-orange-700/80 leading-relaxed">
        This section contains restricted information accessible only to Support Coordinators. Handle in accordance with the participant's privacy consent and NDIS guidelines.
      </p>
      {isLoading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-orange-700">{label}</p>
              <textarea
                className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 min-h-[80px]"
                placeholder={placeholder}
                value={draft?.[key] ?? ""}
                onChange={(e) => draft && onDraftChange({ ...draft, [key]: e.target.value })}
              />
            </div>
          ))}
          <Button
            size="sm"
            disabled={isSaving || !draft}
            onClick={onSave}
            className="bg-orange-600 hover:bg-orange-700 text-white gap-1.5"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {translate("patients.restricted.save")}
          </Button>
        </div>
      )}
    </section>
  );
}
