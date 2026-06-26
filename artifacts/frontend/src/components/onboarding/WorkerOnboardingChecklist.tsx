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
    <div className="divide-y divide-[#EEEAFB] rounded-2xl border border-cc-border bg-cc-surface">
      {items.map((item) => (
        <label key={item.key} className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-cc-bg">
          <input
            type="checkbox"
            className="sr-only"
            checked={item.completed}
            onChange={(event) => onToggle(item.key, event.target.checked)}
          />
          {item.completed ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : (
            <Circle className="h-5 w-5 text-cc-muted" />
          )}
          <span className="text-sm font-bold text-cc-text">{item.label}</span>
        </label>
      ))}
    </div>
  );
}
