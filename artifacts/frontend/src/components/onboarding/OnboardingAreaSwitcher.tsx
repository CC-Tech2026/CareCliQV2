import { useLocation } from "wouter";
import { Users, HeartHandshake } from "lucide-react";

const PLUM = "var(--cc-plum)";

const AREAS = [
  { key: "staff", label: "Staff", href: "/md/staff-onboarding", icon: Users },
  { key: "participants", label: "Participants", href: "/onboard-participant", icon: HeartHandshake },
] as const;

/**
 * Segmented Staff/Participants switcher shown at the top of both onboarding
 * pages. The two pipelines have distinct data models (staff hiring vs.
 * participant intake) and stay separate pages/components — this just makes
 * them feel like one connected "Onboarding" area instead of two unrelated
 * destinations.
 *
 * Styled as a raised tab bar — active tab in solid white text with a small
 * rounded "tongue" dropping from the bar into the page below it, pointing
 * at whichever area is open, rather than the plain pill-on-beige switcher
 * this replaced.
 */
export function OnboardingAreaSwitcher({ active }: { active: "staff" | "participants" }) {
  const [, navigate] = useLocation();
  return (
    <div className="w-fit" style={{ filter: "drop-shadow(var(--cc-shadow-sm))" }}>
      <div className="relative flex items-center gap-1 rounded-[26px] px-2 py-2" style={{ background: PLUM }}>
        {AREAS.map((area) => {
          const Icon = area.icon;
          const isActive = area.key === active;
          return (
            <button
              key={area.key}
              onClick={() => navigate(area.href)}
              aria-pressed={isActive}
              className="relative flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-black transition-colors"
              style={{ color: isActive ? "#fff" : "rgba(255,255,255,0.62)" }}
            >
              <Icon size={15} />
              {area.label}
              {isActive && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-full h-3 w-9 -translate-x-1/2 rounded-b-full"
                  style={{ background: PLUM }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
