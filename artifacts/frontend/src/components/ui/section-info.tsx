import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Click-triggered (not hover-only) info popover for a page or section title —
 *  a Tooltip wouldn't work on touch/click, so this uses Popover throughout. */
export function SectionInfo({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What does this show?"
          className="flex h-4 w-4 items-center justify-center rounded-full hover:opacity-70"
          style={{ color: "var(--cc-muted)" }}
        >
          <Info size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[260px] p-3 text-[11px] leading-relaxed">
        <p>{text}</p>
      </PopoverContent>
    </Popover>
  );
}
