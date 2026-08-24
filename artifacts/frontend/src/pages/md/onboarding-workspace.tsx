import { useLocation, useSearch } from "wouter";
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
  const search = useSearch();
  const active = location.startsWith("/onboard-participant") ? "participants" : "staff";

  // Hide the toggle while a participant's detail/profile view is open
  // (?intake=..., ?profile=...) or the dedicated Active Participants roster
  // or complaints list is open — all focused drill-downs, not a place to
  // jump areas from.
  const viewingDetail =
    active === "participants" &&
    (new URLSearchParams(search).has("intake") ||
      new URLSearchParams(search).has("profile") ||
      location === "/onboard-participant/active" ||
      location === "/onboard-participant/complaints");

  return (
    <HubLayout>
      <div className="space-y-5">
        {!viewingDetail && <OnboardingAreaSwitcher active={active} />}
        {active === "staff" ? <StaffOnboardingBoard /> : <ParticipantOnboardingBoard />}
      </div>
    </HubLayout>
  );
}
