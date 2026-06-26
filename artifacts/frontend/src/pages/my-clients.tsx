import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowRight, ShieldCheck, Users } from "lucide-react";
import { getMyClients, type WorkerClient } from "@/services/workerService";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

function initials(name?: string) {
  return (name || "Client").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function ClientRow({ client, lastSeenLabel, viewLabel }: { client: WorkerClient; lastSeenLabel: string; viewLabel: string }) {
  return (
    <Link href={`/my-clients/${client.id}`}>
      <div
        className="flex items-center gap-4 rounded-lg border bg-[var(--cc-surface)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        style={{ borderColor: BORDER }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-full text-sm font-black text-white" style={{ background: PLUM }}>
          {initials(client.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-black text-safe" style={{ color: TEXT }}>{client.full_name}</p>
          <p className="truncate text-sm font-medium text-safe" style={{ color: MUTED }}>
            {client.plan_management_type || "—"} · {lastSeenLabel}
          </p>
        </div>
        <span className="hidden rounded-full border px-3 py-1 text-xs font-bold capitalize sm:inline-flex border-cc-border bg-[var(--cc-bg)] text-cc-muted">
          {client.compliance_status?.replace("_", " ")}
        </span>
        <span
          className="touch-target inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-black"
          style={{ background: SOFT, color: PLUM }}
        >
          {viewLabel} <ArrowRight size={14} strokeWidth={2.5} aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export default function MyClients() {
  const { translate } = useAccessibility();
  const { data = [], isLoading, error } = useOrgQuery(["worker", "my-clients"], { queryFn: getMyClients });

  function formatLastSeen(value?: string | null) {
    if (!value) return translate("clients.notSeenYet");
    try {
      return `${translate("clients.lastSeen")} ${format(parseISO(value), "MMM d")}`;
    } catch {
      return value;
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10 text-safe">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          {translate("common.supportWorker")}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          {translate("clients.title")}
        </h1>
        <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
          {translate("clients.subtitle")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <Users size={22} style={{ color: PLUM }} aria-hidden />
          <p className="mt-3 text-2xl font-black" style={{ color: TEXT }}>{data.length}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("clients.title")}</p>
        </section>
        <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <ShieldCheck size={22} style={{ color: PLUM }} aria-hidden />
          <p className="mt-3 text-2xl font-black" style={{ color: TEXT }}>
            {data.filter((client) => client.compliance_status === "compliant").length}
          </p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("compliance.status.compliant")}</p>
        </section>
        <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <AlertTriangle size={22} style={{ color: CORAL }} aria-hidden />
          <p className="mt-3 text-2xl font-black" style={{ color: TEXT }}>
            {data.filter((client) => client.compliance_status !== "compliant").length}
          </p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("shiftHistory.band.needsAttention")}</p>
        </section>
      </div>

      <section className="rounded-lg border bg-[var(--cc-surface)] p-5 shadow-sm" style={{ borderColor: BORDER }}>
        {isLoading && (
          <p className="text-sm font-bold" style={{ color: MUTED }} role="status">
            {translate("common.loading")}
          </p>
        )}
        {error && <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>}
        {!isLoading && data.length === 0 && (
          <p className="text-sm font-medium" style={{ color: MUTED }}>{translate("clients.empty")}</p>
        )}
        <div className="space-y-3">
          {(data as WorkerClient[]).map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              lastSeenLabel={formatLastSeen(client.last_seen)}
              viewLabel={translate("clients.view")}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
