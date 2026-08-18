import { useLocation } from "wouter";
import { Users, HeartHandshake } from "lucide-react";

const MUTED = "var(--cc-muted)";
const PLUM = "var(--cc-plum)";
const BORDER = "var(--cc-border)";

const AREAS = [
  { key: "staff", label: "Staff", href: "/md/staff-onboarding", icon: Users },
  { key: "participants", label: "Participants", href: "/onboard-participant", icon: HeartHandshake },
] as const;

/**
 * Segmented Staff/Participants switcher shown at the top of both onboarding
 * pages. The two pipelines have distinct data models (staff hiring vs.
 * participant intake) and stay separate pages/components — this just makes
 * them feel like one connected "Onboarding" area instead of two unrelated
 * destinations. Same visual pattern as the Board/List toggle on Staff
 * Onboarding.
 */
export function OnboardingAreaSwitcher({ active }: { active: "staff" | "participants" }) {
  const [, navigate] = useLocation();
  return (
    <div className="inline-flex h-15 w-fit shrink-0 items-center gap-0.5 rounded-xl p-1" style={{ background: "#F8F7F4", border: `1.5px solid ${BORDER}` }}>
      {AREAS.map((area) => {
        const Icon = area.icon;
        const isActive = area.key === active;
        return (
          <button
            key={area.key}
            onClick={() => navigate(area.href)}
            aria-pressed={isActive}
            className="flex h-12.5 items-center justify-center gap-2.5 rounded-lg px-5 text-[15px] font-black transition-all"
            style={{
              background: isActive ? "white" : "transparent",
              color: isActive ? PLUM : MUTED,
              boxShadow: isActive ? "var(--cc-shadow-sm)" : "none",
            }}
          >
            <Icon size={35} /> {area.label}
          </button>
        );
      })}
    </div>
  );
}
