import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowRight, ShieldCheck, Users } from "lucide-react";
import { getMyClients, type WorkerClient } from "@/services/workerService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

function initials(name?: string) {
  return (name || "Client").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function safeDate(value?: string | null) {
  if (!value) return "Not seen yet";
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

function statusClass(status?: string) {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "non_compliant") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function ClientRow({ client }: { client: WorkerClient }) {
  return (
    <Link href={`/my-clients/${client.id}`}>
      <div className="flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: BORDER }}>
        <div className="grid h-12 w-12 place-items-center rounded-full text-sm font-black text-white" style={{ background: PLUM }}>
          {initials(client.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-black" style={{ color: TEXT }}>{client.full_name}</p>
          <p className="truncate text-sm font-medium" style={{ color: MUTED }}>
            {client.plan_management_type || "Plan details not recorded"} · Last seen {safeDate(client.last_seen)}
          </p>
        </div>
        <span className={`hidden rounded-full border px-3 py-1 text-xs font-bold capitalize sm:inline-flex ${statusClass(client.compliance_status)}`}>
          {client.compliance_status?.replace("_", " ")}
        </span>
        <button className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-black" style={{ background: "#F5F3FC", color: PLUM }}>
          View <ArrowRight size={14} strokeWidth={2.5} />
        </button>
      </div>
    </Link>
  );
}

export default function MyClients() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ["worker", "my-clients"], queryFn: getMyClients });

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>My Clients</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <Users size={22} style={{ color: PLUM }} />
          <p className="mt-3 text-2xl font-black" style={{ color: TEXT }}>{data.length}</p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Assigned clients</p>
        </section>
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <ShieldCheck size={22} style={{ color: PLUM }} />
          <p className="mt-3 text-2xl font-black" style={{ color: TEXT }}>
            {data.filter((client) => client.compliance_status === "compliant").length}
          </p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Currently compliant</p>
        </section>
        <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <AlertTriangle size={22} style={{ color: CORAL }} />
          <p className="mt-3 text-2xl font-black" style={{ color: TEXT }}>
            {data.filter((client) => client.compliance_status !== "compliant").length}
          </p>
          <p className="text-sm font-bold" style={{ color: MUTED }}>Needs review</p>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black" style={{ color: TEXT }}>Assigned Clients</h2>
          <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: "#F5F3FC", color: PLUM }}>
            Own caseload only
          </span>
        </div>
        {isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading clients...</p>}
        {error && <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>}
        {!isLoading && data.length === 0 && <p className="text-sm font-medium" style={{ color: MUTED }}>No assigned clients were returned for this account.</p>}
        <div className="space-y-3">
          {(data as WorkerClient[]).map((client) => <ClientRow key={client.id} client={client} />)}
        </div>
      </section>
    </div>
  );
}
