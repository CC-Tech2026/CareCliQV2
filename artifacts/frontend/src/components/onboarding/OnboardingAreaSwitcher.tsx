import { Link } from "wouter";

const AREAS = [
  { key: "staff", label: "Staff", href: "/md/staff-onboarding" },
  { key: "participants", label: "Participants", href: "/onboard-participant" },
] as const;

/**
 * Staff / Participants tabs at the top of both onboarding pages. The two
 * pipelines have distinct data models (staff hiring vs. participant
 * intake) and stay separate pages/components; this makes them read as one
 * "Onboarding" area. Same tab strip as Roster | Live and Staff's
 * Overview | Team & invites, so every section with sibling pages looks alike.
 */
export function OnboardingAreaSwitcher({ active }: { active: "staff" | "participants" }) {
  return (
    <nav
      aria-label="Onboarding pages"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--cc-border)]"
    >
      {AREAS.map((area) => {
        const isActive = area.key === active;
        return (
          <Link
            key={area.key}
            href={area.href}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex min-h-11 md:min-h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
              isActive
                ? "border-[var(--cc-brand-purple)] text-[var(--cc-brand-purple)]"
                : "border-transparent text-[var(--cc-muted)] hover:text-[var(--cc-text)]"
            }`}
          >
            {area.label}
          </Link>
        );
      })}
    </nav>
  );
}
