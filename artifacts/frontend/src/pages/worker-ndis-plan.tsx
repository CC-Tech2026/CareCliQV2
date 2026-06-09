import { useOrgQuery } from "@/hooks/useOrgQuery";
import { ClipboardList } from "lucide-react";
import { getMyClients, getMyClientNdisPlan } from "@/services/workerService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

function ClientPlan({ id }: { id: string }) {
  const { data } = useOrgQuery(["worker", "plan", id], { queryFn: () => getMyClientNdisPlan(id) });
  return (
    <div className="space-y-2">
      {(data?.goals || []).slice(0, 3).map((goal, index) => (
        <div key={String((goal as any).id || index)} className="rounded-lg bg-[#F8F6FE] p-3">
          <p className="text-sm font-bold" style={{ color: TEXT }}>{String((goal as any).title || (goal as any).description || `Goal ${index + 1}`)}</p>
          <p className="text-xs font-medium capitalize" style={{ color: MUTED }}>{String((goal as any).status || "active")}</p>
        </div>
      ))}
    </div>
  );
}

export default function WorkerNdisPlan() {
  const { data = [], isLoading, error } = useOrgQuery(["worker", "my-clients"], { queryFn: getMyClients });

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>NDIS Plan</h1>
      </div>
      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList size={18} style={{ color: PLUM }} />
          <h2 className="text-lg font-black" style={{ color: TEXT }}>Assigned Client Plans</h2>
        </div>
        {isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading plans...</p>}
        {error && <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((client) => (
            <div key={client.id} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
              <p className="text-base font-black" style={{ color: TEXT }}>{client.full_name}</p>
              <p className="mb-3 text-sm font-medium" style={{ color: MUTED }}>
                {client.plan_status || "Plan status not recorded"} · Read only
              </p>
              <ClientPlan id={client.id} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
