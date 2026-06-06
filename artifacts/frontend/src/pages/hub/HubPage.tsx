import { useAuth } from "@/contexts/AuthContext";
import { HubHeader } from "@/components/hub/HubHeader";
import { WorkspaceLauncher } from "@/components/hub/WorkspaceLauncher";
import { WorkerKPIs } from "@/components/hub/WorkerKPIs";
import { NewsFeed } from "@/components/hub/NewsFeed";
import { ComplianceCentre } from "@/components/hub/ComplianceCentre";
import { StaffCommunity } from "@/components/hub/StaffCommunity";
import { OrganizationCalendar } from "@/components/hub/OrganizationCalendar";

export default function HubPage() {
  const { user } = useAuth();
  const role = user?.role;

  const isWorker = role === "support_worker";
  const isCoordinator = role === "support_coordinator";
  const isFullView = !isWorker && !isCoordinator;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      {/* Always visible: header */}
      <HubHeader />

      {/* Always visible: workspace launcher */}
      <WorkspaceLauncher />

      {/* Support Worker: personal KPIs + compliance + community + news */}
      {isWorker && (
        <>
          <WorkerKPIs />
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-6">
              <ComplianceCentre />
            </div>
            <div className="space-y-6">
              <StaffCommunity />
              <NewsFeed />
            </div>
          </div>
        </>
      )}

      {/* Support Coordinator: team compliance + news + calendar */}
      {isCoordinator && (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <ComplianceCentre />
            <NewsFeed />
          </div>
          <OrganizationCalendar />
        </>
      )}

      {/* Allied health / default: full executive layout */}
      {isFullView && (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <NewsFeed />
            <div className="space-y-6">
              <ComplianceCentre />
              <StaffCommunity />
            </div>
          </div>
          <OrganizationCalendar />
        </>
      )}
    </div>
  );
}
