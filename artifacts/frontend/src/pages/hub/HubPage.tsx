import { useAuth } from "@/contexts/AuthContext";
import { HubHeader } from "@/components/hub/HubHeader";
import { WorkspaceLauncher } from "@/components/hub/WorkspaceLauncher";
import { NewsFeed } from "@/components/hub/NewsFeed";
import { ComplianceCentre } from "@/components/hub/ComplianceCentre";
import { StaffCommunity } from "@/components/hub/StaffCommunity";
import { OrganizationCalendar } from "@/components/hub/OrganizationCalendar";
import { MDHubView } from "@/components/hub/MDHubView";

const BORDER = "#E2DEF2";
const MUTED  = "#7A6A9E";

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <p className="shrink-0 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
        {label}
      </p>
      <div className="h-px flex-1" style={{ background: BORDER }} />
    </div>
  );
}

export default function HubPage() {
  const { user } = useAuth();

  /* ── Managing Director view ─────────────────────── */
  if (user?.role === "managing_director") {
    return (
      <div className="space-y-6 pb-12">
        <HubHeader />
        <WorkspaceLauncher />
        <MDHubView />
        <SectionDivider label="Organisation" />
        <NewsFeed />
        <OrganizationCalendar />
      </div>
    );
  }

  /* ── Worker / Coordinator view ──────────────────── */
  return (
    <div className="space-y-6 pb-12">
      <HubHeader />
      <WorkspaceLauncher />

      <SectionDivider label="Operations" />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <NewsFeed />
        <div className="space-y-5">
          <ComplianceCentre />
          <StaffCommunity />
        </div>
      </div>

      <SectionDivider label="Organisation" />
      <OrganizationCalendar />
    </div>
  );
}
