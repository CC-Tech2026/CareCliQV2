import { useLocation } from "wouter";
import { Users, HeartHandshake } from "lucide-react";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";

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
 * Only the active tab is raised — plain rounded top corners, flat
 * bottom — the inactive one sits flush on the baseline, unelevated, at
 * reduced opacity but still legible (reference sketch, 2026-09-02: only
 * the open tab pops up; the other stays flat rather than being its own
 * separate raised card).
 *
 * A previous version tried the Chrome-style concave corner (two small
 * radial-gradient pieces sitting outside the tab's bottom edges) but that
 * left visible stray white triangles instead of blending in — removed
 * rather than fought further; plain rounded corners read cleanly.
 */
const CORNER = 14;

export function OnboardingAreaSwitcher({ active }: { active: "staff" | "participants" }) {
  const [, navigate] = useLocation();
  return (
    <div className="flex items-end gap-3">
      {AREAS.map((area) => {
        const Icon = area.icon;
        const isActive = area.key === active;
        return (
          <button
            key={area.key}
            onClick={() => navigate(area.href)}
            aria-pressed={isActive}
            className="relative flex items-center gap-2 px-6 py-3 text-[14px] font-black transition-opacity"
            style={{
              borderRadius: isActive ? `${CORNER}px ${CORNER}px 0 0` : "0",
              background: isActive ? "var(--cc-surface)" : "transparent",
              color: TEXT,
              // No box-shadow — --cc-shadow-sm projects downward and draws
              // a visible line right at the seam with the panel below,
              // breaking the "one continuous shape" illusion the matching
              // background color is supposed to create.
              opacity: isActive ? 1 : 0.75,
            }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: PLUM }}
            >
              <Icon size={13} style={{ color: "#fff" }} />
            </span>
            {area.label}
          </button>
        );
      })}
    </div>
  );
}
