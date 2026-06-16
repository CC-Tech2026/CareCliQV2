import { ChevronDown, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantPreferences } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  preferences?: ParticipantPreferences;
  open?: boolean;
  onToggle?: () => void;
};

const SECTIONS: Array<{ key: keyof ParticipantPreferences; label: string }> = [
  { key: "communication_style", label: "Communication style" },
  { key: "likes_dislikes", label: "Likes / dislikes & sensitivities" },
  { key: "routines", label: "Routines & visit notes" },
  { key: "behaviour_support", label: "Behaviour support plan" },
  { key: "restricted_notes", label: "Restricted behavioural notes" },
  { key: "health_flags", label: "Health flags" },
];

export function ParticipantPreferencesCard({ preferences, open = true, onToggle }: Props) {
  const blocks = SECTIONS.map(({ key, label }) => ({
    label,
    body: preferences?.[key]?.trim(),
  })).filter((b) => b.body);

  if (!blocks.length) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <Heart size={16} style={{ color: PLUM }} />
          Participant Preferences
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {blocks.map((block) => (
            <div key={block.label} className="rounded-xl bg-[#F8F6FE] px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                {block.label}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
                {block.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
