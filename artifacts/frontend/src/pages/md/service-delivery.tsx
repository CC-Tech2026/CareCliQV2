import { useLocation } from "wouter";
import { HubLayout } from "@/components/layout/HubLayout";
import { GovernanceTriage } from "@/components/hub/GovernanceTriage";
import { getCareAlerts } from "@/services/hubService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function routeForCareSource(source: string | undefined): string {
  if (source === "participants") return "/patients";
  if (source === "shifts" || source === "worker-notes") return "/md/staff";
  return "/md/service-delivery";
}

export default function MDServiceDeliveryPage() {
  const [, navigate] = useLocation();

  return (
    <HubLayout>
      <div className="space-y-5 pb-10">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Delivery Quality</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>
            Care delivery and participant engagement — what needs a name and a next step, not a score.
          </p>
        </div>

        <GovernanceTriage
          onNavigate={navigate}
          fetchAlerts={getCareAlerts}
          routeForSource={routeForCareSource}
          viewAllHref="/patients"
          viewAllLabel="Participants"
        />

        {/* "How we're tracking" for this tab (goal achievement trend, average visits,
            complaints volume, service mix) is deferred — most of those inputs aren't
            ready yet per the Care Triage Audit (complaints register and org-wide goal
            staleness sweep are both "Next"/"Later" work, not built in this pass). */}
        <div className="rounded-2xl border p-5 text-center" style={{ borderColor: BORDER }}>
          <p className="text-[11px] font-medium" style={{ color: MUTED }}>
            Trend and volume metrics for this tab land once the complaints register and org-wide goal-progress
            sweep are built — see the Care Triage Audit for the phased plan.
          </p>
        </div>
      </div>
    </HubLayout>
  );
}
