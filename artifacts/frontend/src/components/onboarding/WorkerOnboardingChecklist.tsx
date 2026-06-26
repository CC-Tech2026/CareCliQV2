import { CheckCircle2, Circle } from "lucide-react";
import type { ChecklistItem } from "@/services/onboardingService";

export function WorkerOnboardingChecklist({
  items,
  onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (key: string, completed: boolean) => void;
}) {
  return (
    <div className="divide-y divide-[#EEEAFB] rounded-2xl border border-[#E5E7EB] bg-white">
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
            <Circle className="h-5 w-5 text-[#6B7280]" />
          )}
          <span className="text-sm font-bold text-[#111827]">{item.label}</span>
        </label>
      ))}
    </div>
  );
}
