import type { ChecklistItem } from "@/services/onboardingService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const ITEM_LABEL_KEYS: Record<string, string> = {
  verify_email: "onboarding.item.verifyEmail",
  complete_profile: "onboarding.item.completeProfile",
  upload_profile_photo: "onboarding.profilePhoto",
  add_credential_wallet_items: "onboarding.addCredentials",
  review_assigned_clients: "onboarding.reviewClients",
  read_ndis_note_writing_guide: "onboarding.item.readNdisGuide",
  acknowledge_note_writing_rules: "onboarding.item.acknowledgeNoteRules",
  confirm_readiness: "onboarding.confirmReadiness",
};

function checklistLabel(item: ChecklistItem, translate: (key: string) => string): string {
  const key = ITEM_LABEL_KEYS[item.key];
  return key ? translate(key) : item.label;
}

export function WorkerOnboardingChecklist({
  items,
  onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (key: string, completed: boolean) => void;
}) {
  const { translate } = useAccessibility();

  return (
    <fieldset className="min-w-0 overflow-hidden rounded-xl border border-cc-border bg-cc-surface">
      <legend className="sr-only">Onboarding checklist</legend>
      {items.map((item) => {
        const label = checklistLabel(item, translate);
        return (
          <label
            key={item.key}
            className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-cc-border px-4 py-3 transition-colors last:border-b-0 hover:bg-cc-soft focus-within:bg-cc-soft"
          >
            <input
              type="checkbox"
              checked={item.completed}
              aria-label={label}
              onChange={(event) => onToggle(item.key, event.target.checked)}
              className="h-5 w-5 shrink-0 cursor-pointer rounded accent-[#7C3AED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
            />
            <span className={`min-w-0 flex-1 break-words text-sm leading-snug ${item.completed ? "text-cc-muted line-through" : "font-medium text-cc-text"}`}>
              {label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
