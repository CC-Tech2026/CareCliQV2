import { Lock, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { HELP, LABEL, PRIMARY_BUTTON, SUBHEADING, SUBSECTION, TEXTAREA } from "@/components/participants/recordUi";

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
  { key: "restricted_behavioural_notes" as const, label: "Behaviour notes", placeholder: "Behaviours of concern seen, and what was done" },
  { key: "behaviour_support_plan"       as const, label: "Behaviour support plan",  placeholder: "A summary of the current behaviour support plan, including any regulated restrictive practices" },
  { key: "medical_alerts"               as const, label: "Medical alerts",          placeholder: "Contraindications, emergency protocols and other alerts not covered by allergies" },
  { key: "medications"                  as const, label: "Older medication notes",  placeholder: "Free-text medication notes from before the medication chart. Kept for the record." },
];

/** Restricted clinical information: seen only by care coordinators and the
 * managing director. */
export function ParticipantRestrictedTab({
  isLoading,
  draft,
  onDraftChange,
  onSave,
  isSaving,
}: ParticipantRestrictedTabProps) {
  const { translate } = useAccessibility();

  return (
    <section aria-labelledby="restricted-heading" className={SUBSECTION}>
      <div className="space-y-1">
        <h4 id="restricted-heading" className={`${SUBHEADING} flex items-center gap-2`}>
          <Lock className="h-4 w-4 text-cc-muted" aria-hidden />
          {translate("patients.restricted.title")}
        </h4>
        <p className={HELP}>
          Only care coordinators and the managing director can see this. Handle it under the participant's privacy consent.
        </p>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {FIELDS.map(({ key, label, placeholder }) => (
            <label key={key} className="block space-y-1.5">
              <span className={LABEL}>{label}</span>
              <textarea
                className={TEXTAREA}
                placeholder={placeholder}
                value={draft?.[key] ?? ""}
                onChange={(e) => draft && onDraftChange({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <button type="button" disabled={isSaving || !draft} onClick={onSave} className={PRIMARY_BUTTON}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {translate("patients.restricted.save")}
          </button>
        </div>
      )}
    </section>
  );
}
