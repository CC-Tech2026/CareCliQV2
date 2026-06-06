import { useAuth } from "@/contexts/AuthContext";
import { HubHeader } from "@/components/hub/HubHeader";
import { WorkspaceLauncher } from "@/components/hub/WorkspaceLauncher";
import { NewsFeed } from "@/components/hub/NewsFeed";
import { ComplianceCentre } from "@/components/hub/ComplianceCentre";
import { StaffCommunity } from "@/components/hub/StaffCommunity";
import { OrganizationCalendar } from "@/components/hub/OrganizationCalendar";
import { MDHubView } from "@/components/hub/MDHubView";

export default function HubPage() {
  const { user } = useAuth();

  if (user?.role === "managing_director") {
    return (
      <div className="space-y-6 pb-10">
        <HubHeader />
        <WorkspaceLauncher />
        <MDHubView />
        <NewsFeed />
        <OrganizationCalendar />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <HubHeader />
      <WorkspaceLauncher />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <NewsFeed />
        <div className="space-y-6">
          <ComplianceCentre />
          <StaffCommunity />
        </div>
      </div>

      <OrganizationCalendar />
    </div>
  );
}
