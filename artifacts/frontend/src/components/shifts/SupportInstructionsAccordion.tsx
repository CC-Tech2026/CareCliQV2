import { ChevronDown, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShiftSupportInstruction } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  instructions?: ShiftSupportInstruction[];
  open?: boolean;
  onToggle?: () => void;
};

export function SupportInstructionsAccordion({ instructions, open = true, onToggle }: Props) {
  if (!instructions?.length) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <LifeBuoy size={16} style={{ color: PLUM }} />
          Support Instructions
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {instructions.map((section, i) => {
            const critical = section.critical === "true";
            return (
              <div
                key={`${section.category}-${i}`}
                className={cn(
                  "rounded-xl border px-3 py-3",
                  critical ? "border-red-200 bg-red-50/80" : "border-[#E2DEF2] bg-[#F8F6FE]",
                )}
              >
                <p
                  className={cn(
                    "mb-1 text-[10px] font-black uppercase tracking-wider",
                    critical ? "text-red-700" : undefined,
                  )}
                  style={critical ? undefined : { color: MUTED }}
                >
                  {section.category}
                  {critical && " · Critical"}
                </p>
                <p
                  className={cn("whitespace-pre-wrap text-sm font-medium leading-relaxed", critical && "text-red-900")}
                  style={critical ? undefined : { color: TEXT }}
                >
                  {section.body}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
