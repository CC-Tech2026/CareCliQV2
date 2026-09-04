import { useAuth } from "@/contexts/AuthContext";

import { HubHeader } from "@/components/hub/HubHeader";
import { WorkspaceLauncher } from "@/components/hub/WorkspaceLauncher";
import { NewsFeed } from "@/components/hub/NewsFeed";
import { ComplianceCentre } from "@/components/hub/ComplianceCentre";
import { StaffCommunity } from "@/components/hub/StaffCommunity";
import { MDHubView } from "@/components/hub/MDHubView";

export default function HubPage() {
  const { user } = useAuth();

  const isMD = user?.role === "managing_director";

  return (
    <div className="pb-14">

      {/* ─────────────────────────────────────────
          WELCOME
      ───────────────────────────────────────── */}

      <HubHeader />


        {/* ─────────────────────────────────────────
            MAIN HUB
        ───────────────────────────────────────── */}

        {isMD ? (
          // MD lands directly on their overview — workspace navigation
          // lives in the sidebar (Hub / MD Workspaces), not duplicated here.
          // ComplianceCentre and StaffCommunity are deliberately not repeated
          // here: MDHubView's triage sections already cover compliance/incident/
          // invoice alerts (same /api/hub/compliance-alerts source), and a
          // social "welcome aboard" feed doesn't belong on a governance view.
          <main className="mt-6 min-w-0 space-y-5">
            <MDHubView />
            <NewsFeed />
          </main>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">

            {/* ───────── WORKSPACE ───────── */}

            <aside className="min-w-0">
              <div className="lg:sticky lg:top-24">

                <div
                  className="overflow-hidden rounded-2xl border bg-cc-surface"
                  style={{
                    borderColor: "var(--cc-border)",
                    boxShadow: "var(--cc-shadow-sm)",
                  }}
                >

                  {/* Launcher */}

                  <div className="p-2">
                    <WorkspaceLauncher />
                  </div>

                </div>

                {/* Community */}

                <div className="mt-4">
                  <StaffCommunity />
                </div>

              </div>
            </aside>


            {/* ───────── MAIN CONTENT ───────── */}

            <main className="min-w-0 space-y-5">

              {/* TODAY / ATTENTION */}

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">

                {/* News */}

                <NewsFeed />

                {/* Compliance */}

                <ComplianceCentre />

              </div>

            </main>

          </div>
        )}
    </div>
  );
}