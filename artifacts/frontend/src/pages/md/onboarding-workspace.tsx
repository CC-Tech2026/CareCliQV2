import { useLocation } from "wouter";
import { HubLayout } from "@/components/layout/HubLayout";
import { OnboardingAreaSwitcher } from "@/components/onboarding/OnboardingAreaSwitcher";
import StaffOnboardingBoard from "@/pages/md/staff-onboarding";
import ParticipantOnboardingBoard from "@/pages/onboard-participant";

/**
 * Shared shell for /md/staff-onboarding and /onboard-participant. Both
 * routes render this same component so HubLayout (sidebar nav, org
 * branding fetch, collapsed-group state) mounts once and stays mounted
 * across the toggle — only the board content below the switcher swaps.
 *
 * Previously each page wrapped itself in its own <HubLayout>, so every
 * toggle click fully unmounted and remounted the entire sidebar chrome,
 * not just the board. Registering the identical component tree
 * (ProtectedRoute > OnboardingWorkspace) for both routes lets React
 * reconcile instead of remount when the URL changes between them.
 */
export default function OnboardingWorkspace() {
  const [location] = useLocation();
  const active = location.startsWith("/onboard-participant") ? "participants" : "staff";

  return (
    <HubLayout>
      <div className="space-y-5">
        <OnboardingAreaSwitcher active={active} />
        {active === "staff" ? <StaffOnboardingBoard /> : <ParticipantOnboardingBoard />}
      </div>
    </HubLayout>
  );
}
