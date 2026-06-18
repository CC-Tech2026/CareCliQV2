import { useId, useState } from "react";
import {
  ChevronDown,
  Clock,
  Ear,
  Globe,
  Heart,
  MessageCircle,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantPreferences } from "@/services/shiftService";
import { isLongPreferenceContent } from "@/lib/participant-display";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

type Props = {
  preferences?: ParticipantPreferences;
  open?: boolean;
  onToggle?: () => void;
};

const SECTIONS: Array<{ key: keyof ParticipantPreferences; label: string; icon: LucideIcon }> = [
  { key: "communication_style", label: "Communication style", icon: MessageCircle },
  { key: "likes_dislikes", label: "Likes / dislikes", icon: ThumbsUp },
  { key: "routines", label: "Routines", icon: Clock },
  { key: "sensory_preferences", label: "Sensory preferences", icon: Ear },
  { key: "cultural_preferences", label: "Cultural preferences", icon: Globe },
  { key: "behaviour_support", label: "Behaviour support plan", icon: Heart },
  { key: "health_flags", label: "Health flags", icon: Heart },
];

function PreferenceSection({ label, icon: Icon, body }: { label: string; icon: LucideIcon; body: string }) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const long = isLongPreferenceContent(body);
  const labelId = useId();
  const bodyId = useId();

  const header = (
    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
      <Icon size={12} aria-hidden />
      <span id={labelId}>{label}</span>
    </span>
  );

  return (
    <div className="rounded-xl bg-[#F8F6FE]">
      {long ? (
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          onClick={() => setSectionOpen(!sectionOpen)}
          aria-expanded={sectionOpen}
          aria-controls={bodyId}
          aria-label={`${label} preferences`}
        >
          {header}
          <ChevronDown size={14} className={cn("transition", sectionOpen && "rotate-180")} style={{ color: MUTED }} aria-hidden />
        </button>
      ) : (
        <div className="px-3 py-2.5" role="group" aria-labelledby={labelId}>
          {header}
        </div>
      )}
      {sectionOpen && (
        <p
          id={bodyId}
          className="whitespace-pre-wrap px-3 pb-3 text-sm font-medium leading-relaxed"
          style={{ color: TEXT }}
        >
          {body || <span style={{ color: MUTED }}>Not recorded</span>}
        </p>
      )}
    </div>
  );
}

export function ParticipantPreferencesCard({ preferences, open = true, onToggle }: Props) {
  const blocks = SECTIONS.map(({ key, label, icon }) => ({
    label,
    icon,
    body: preferences?.[key]?.trim() || "",
  }));

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <Heart size={16} style={{ color: PLUM }} aria-hidden />
          Participant Preferences
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} aria-hidden />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {blocks.map((block) => (
            <PreferenceSection key={block.label} label={block.label} icon={block.icon} body={block.body} />
          ))}
        </div>
      )}
    </section>
  );
}
