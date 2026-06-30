import { useId, useState } from "react";
import {
  ChevronDown,
  Clock,
  Ear,
  Globe,
  AlertTriangle,
  Heart,
  Shield,
  Sparkles,
  MessageCircle,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantPreferences } from "@/services/shiftService";
import { isLongPreferenceContent } from "@/lib/participant-display";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  preferences?: ParticipantPreferences;
  open?: boolean;
  onToggle?: () => void;
};

const SECTION_KEYS: Array<{ key: keyof ParticipantPreferences; labelKey: string; icon: LucideIcon }> = [
  { key: "communication_style", labelKey: "shift.participant.pref.communication", icon: MessageCircle },
  { key: "likes_dislikes", labelKey: "shift.participant.pref.likes", icon: ThumbsUp },
  { key: "routines", labelKey: "shift.participant.pref.routines", icon: Clock },
  { key: "sensory_preferences", labelKey: "shift.participant.pref.sensory", icon: Ear },
  { key: "cultural_preferences", labelKey: "shift.participant.pref.cultural", icon: Globe },
  { key: "behaviour_support", labelKey: "shift.participant.pref.behaviour", icon: Heart },
  { key: "health_flags", labelKey: "shift.participant.pref.health", icon: Heart },
];

function PreferenceSection({
  label,
  icon: Icon,
  body,
  notRecorded,
  prefAria,
}: {
  label: string;
  icon: LucideIcon;
  body: string;
  notRecorded: string;
  prefAria: string;
}) {
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
    <div className="rounded-xl bg-cc-bg">
      {long ? (
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          onClick={() => setSectionOpen(!sectionOpen)}
          aria-expanded={sectionOpen ? "true" : "false"}
          aria-controls={bodyId}
          aria-label={prefAria}
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
          {body || <span style={{ color: MUTED }}>{notRecorded}</span>}
        </p>
      )}
    </div>
  );
}

export function ParticipantPreferencesCard({ preferences, open = true, onToggle }: Props) {
  const { translate, translateParams } = useAccessibility();
  const blocks = SECTION_KEYS.map(({ key, labelKey, icon }) => {
    const label = translate(labelKey);
    return {
      label,
      icon,
      body: preferences?.[key]?.trim() || "",
      prefAria: translateParams("shift.participant.prefAria", { label }),
    };
  });

  return (
    <section className="overflow-hidden rounded-2xl border bg-cc-surface shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <Heart size={16} style={{ color: PLUM }} aria-hidden />
          {translate("shift.participant.preferences")}
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} aria-hidden />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {blocks.map((block) => (
            <PreferenceSection
              key={block.label}
              label={block.label}
              icon={block.icon}
              body={block.body}
              notRecorded={translate("shift.participant.notRecorded")}
              prefAria={block.prefAria}
            />
          ))}
        </div>
      )}
    </section>
  );
}
