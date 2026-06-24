import { useState } from "react";
import { ChevronDown, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShiftSupportInstruction } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  instructions?: ShiftSupportInstruction[];
  open?: boolean;
  onToggle?: () => void;
  sectionId?: string;
};

function isCriticalLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("⛔") || trimmed.toLowerCase().startsWith("critical:");
}

function InstructionBody({ body, sectionCritical }: { body: string; sectionCritical: boolean }) {
  const lines = body.split("\n");

  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        const critical = sectionCritical || isCriticalLine(line);
        if (!line.trim()) {
          return <div key={index} className="h-1" />;
        }
        return (
          <p
            key={index}
            className={cn(
              "whitespace-pre-wrap text-sm leading-relaxed",
              critical ? "font-black text-red-900" : "font-medium",
            )}
            style={critical ? undefined : { color: TEXT }}
          >
            {line}
          </p>
        );
      })}
    </div>
  );
}

function InstructionSection({ section, defaultOpen }: { section: ShiftSupportInstruction; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const critical = section.critical === "true" || section.critical === true;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        critical ? "border-red-200 bg-red-50/80" : "border-[#E2DEF2] bg-[#F8F6FE]",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        onClick={() => setOpen(!open)}
      >
        <p
          className={cn(
            "text-[10px] font-black uppercase tracking-wider",
            critical ? "text-red-700" : undefined,
          )}
          style={critical ? undefined : { color: MUTED }}
        >
          {section.category}
          {critical && " · Critical"}
        </p>
        <ChevronDown size={16} className={cn("shrink-0 transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3" style={{ borderColor: critical ? "#FECACA" : BORDER }}>
          <InstructionBody body={section.body} sectionCritical={critical} />
          {section.image_url && (
            <img
              src={section.image_url}
              alt={`${section.category} diagram`}
              className="max-h-48 w-full rounded-lg border object-contain"
              style={{ borderColor: BORDER }}
              loading="lazy"
            />
          )}
        </div>
      )}
    </div>
  );
}

export function SupportInstructionsAccordion({ instructions, open = true, onToggle, sectionId }: Props) {
  if (!instructions?.length) return null;

  return (
    <section
      id={sectionId}
      className="overflow-hidden rounded-2xl border bg-white shadow-sm"
      style={{ borderColor: BORDER }}
    >
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
        <div className="border-t" style={{ borderColor: BORDER }}>
          <div className="max-h-[min(50vh,20rem)] space-y-2 overflow-y-auto px-4 py-3">
            {instructions.map((section, i) => (
              <InstructionSection
                key={`${section.category}-${i}`}
                section={section}
                defaultOpen={i === 0 || section.critical === "true" || section.critical === true}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
