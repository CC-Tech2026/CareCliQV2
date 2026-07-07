import { CheckCircle2, Circle } from "lucide-react";
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
    <div className="divide-y divide-[#EDE3FC] rounded-2xl border border-[#E8E8EA] bg-white">
      {items.map((item) => (
        <label key={item.key} className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-[#F8F6FE]">
          <input
            type="checkbox"
            className="sr-only"
            checked={item.completed}
            onChange={(event) => onToggle(item.key, event.target.checked)}
          />
          {item.completed ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : (
            <Circle className="h-5 w-5 text-[#6A6A77]" />
          )}
          <span className="text-sm font-bold text-[#1A1A2E]">{checklistLabel(item, translate)}</span>
        </label>
      ))}
    </div>
  );
}
