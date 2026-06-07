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
  const isMD = user?.role === "managing_director";

  return (
    <div className="grid grid-cols-1 gap-5 pb-12 lg:grid-cols-[240px_1fr_280px] lg:items-start">

      {/* ── LEFT COLUMN ───────────────────────────────── */}
      <aside className="space-y-4">
        <WorkspaceLauncher />
        {!isMD && <StaffCommunity />}
      </aside>

      {/* ── CENTER COLUMN ─────────────────────────────── */}
      <main className="space-y-5 min-w-0">
        <HubHeader />
        {isMD && <MDHubView />}
        <NewsFeed />
      </main>

      {/* ── RIGHT COLUMN ──────────────────────────────── */}
      <aside className="space-y-4">
        <OrganizationCalendar />
        {!isMD && <ComplianceCentre />}
      </aside>

    </div>
  );
}
