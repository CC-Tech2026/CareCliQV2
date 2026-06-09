import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { getMyCompliance } from "@/services/workerService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

function safeDate(value?: string) {
  if (!value) return "Not recorded";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function badgeClass(status?: string) {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "non_compliant") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function MyCompliance() {
  const { data, isLoading, error } = useOrgQuery(["worker", "my-compliance"], { queryFn: getMyCompliance });

  if (isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading compliance...</div>;
  if (error) return <div className="p-6 text-sm font-bold text-red-600">{(error as Error).message}</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>My Compliance</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <ShieldCheck size={22} style={{ color: PLUM }} />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{data?.average_score ?? 0}%</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Average score</p>
        </section>
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <CheckCircle2 size={22} className="text-emerald-600" />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{data?.reviewed_sessions ?? 0}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Reviewed records</p>
        </section>
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <AlertTriangle size={22} style={{ color: CORAL }} />
          <p className="mt-3 text-3xl font-black" style={{ color: TEXT }}>{data?.at_risk ?? 0}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Needs attention</p>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black" style={{ color: TEXT }}>Worker-Owned Compliance Records</h2>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${badgeClass(data?.status)}`}>
            {data?.status.replace("_", " ")}
          </span>
        </div>
        <div className="space-y-3">
          {(data?.sessions || []).map((session) => (
            <div key={session.id} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black capitalize" style={{ color: TEXT }}>{(session.session_type || "session").replace("_", " ")}</p>
                  <p className="text-sm font-medium" style={{ color: MUTED }}>{safeDate(session.session_date)}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${badgeClass(session.compliance_status)}`}>
                  {session.compliance_score ?? "Draft"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
