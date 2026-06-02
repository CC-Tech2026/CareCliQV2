import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileCheck2, ShieldCheck } from "lucide-react";
import { getCoordinatorComplianceOverview, getCoordinatorRpFlags } from "@/services/coordinatorService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

export default function AuditPack() {
  const compliance = useQuery({ queryKey: ["coordinator", "compliance-overview"], queryFn: getCoordinatorComplianceOverview });
  const flags = useQuery({ queryKey: ["coordinator", "rp-flags"], queryFn: getCoordinatorRpFlags });

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Coordinator</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Audit Pack</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <ShieldCheck size={22} style={{ color: PLUM }} />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{compliance.data?.average_score ?? 0}%</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Team compliance</p>
        </section>
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <FileCheck2 size={22} style={{ color: PLUM }} />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{compliance.data?.total_sessions ?? 0}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Session records</p>
        </section>
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <AlertTriangle size={22} style={{ color: CORAL }} />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{flags.data?.length ?? 0}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>RP flags</p>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-4 text-lg font-black" style={{ color: TEXT }}>Restrictive Practice Flags</h2>
        {(compliance.error || flags.error) && <p className="text-sm font-bold text-red-600">Audit data could not be loaded.</p>}
        <div className="space-y-3">
          {(flags.data || []).length === 0 && <p className="text-sm font-medium" style={{ color: MUTED }}>No restrictive practice flags are currently recorded.</p>}
          {(flags.data || []).map((flag, index) => (
            <div key={`${flag.session_id}-${index}`} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
              <p className="text-sm font-black" style={{ color: TEXT }}>{flag.participant_name || "Participant"}</p>
              <p className="text-sm font-medium" style={{ color: MUTED }}>{flag.category || "restrictive practice"} · {flag.severity || "review"}</p>
              {flag.suggestion && <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>{flag.suggestion}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
