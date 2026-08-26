import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { ClipboardList } from "lucide-react";
import { getMyClients, getMyClientNdisPlan } from "@/services/workerService";
import { SectionInfo } from "@/components/ui/section-info";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function ClientPlan({ id }: { id: string }) {
  const { translate, translateParams } = useAccessibility();
  const { data } = useOrgQuery(["worker", "plan", id], { queryFn: () => getMyClientNdisPlan(id) });
  return (
    <div className="space-y-2">
      {(data?.goals || []).slice(0, 3).map((goal, index) => (
        <div key={String((goal as any).id || index)} className="rounded-lg bg-[#F8F6FE] p-3">
          <p className="text-sm font-bold" style={{ color: TEXT }}>
            {String((goal as any).title || (goal as any).description || translateParams("ndisPlan.goalFallback", { n: String(index + 1) }))}
          </p>
          <p className="text-xs font-medium capitalize" style={{ color: MUTED }}>{String((goal as any).status || "active")}</p>
        </div>
      ))}
    </div>
  );
}

export default function WorkerNdisPlan() {
  const { translate } = useAccessibility();
  const { data = [], isLoading, error } = useOrgQuery(["worker", "my-clients"], { queryFn: getMyClients });

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="hidden" style={{ color: CORAL }}>{translate("common.supportWorker")}</p>
        <h1 className="flex items-center gap-2 text-xl font-black tracking-tight" style={{ color: TEXT }}>
          {translate("ndisPlan.title")}
          <SectionInfo text="NDIS plan details for the participants you support: funding goals and plan status." />
        </h1>
      </div>
      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList size={18} style={{ color: PLUM }} />
          <h2 className="text-lg font-black" style={{ color: TEXT }}>{translate("ndisPlan.assigned")}</h2>
        </div>
        {isLoading && (
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("ndisPlan.loading")}</p>
        )}
        {error && <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((client) => (
            <div key={client.id} className="rounded-lg border p-4" style={{ borderColor: "#EDE3FC" }}>
              <p className="text-base font-black" style={{ color: TEXT }}>{client.full_name}</p>
              <p className="mb-3 text-sm font-medium" style={{ color: MUTED }}>
                {client.plan_status || translate("ndisPlan.statusNotRecorded")} · {translate("ndisPlan.readOnly")}
              </p>
              <ClientPlan id={client.id} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
