import { useState } from "react";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowRight, Search, ShieldCheck, Users } from "lucide-react";
import { getMyClients, type WorkerClient } from "@/services/workerService";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function initials(name?: string) {
  return (name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function safeDate(value?: string | null) {
  if (!value) return null;
  try { return format(parseISO(value), "d MMM"); } catch { return value; }
}

function statusMeta(status?: string): { label: string; cls: string } {
  if (status === "compliant")     return { label: "Compliant",    cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (status === "non_compliant") return { label: "Non-compliant", cls: "border-red-200 bg-red-50 text-red-700" };
  return { label: "Needs review", cls: "border-amber-200 bg-amber-50 text-amber-700" };
}

function ClientCard({ client }: { client: WorkerClient }) {
  const { label, cls } = statusMeta(client.compliance_status);
  const lastSeen = safeDate(client.last_seen);
  const ndis = (client as WorkerClient & { ndis_number?: string }).ndis_number;

  return (
    <Link href={`/my-clients/${client.id}`}>
      {/* Mobile: card layout; desktop: row layout */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--cc-soft)] active:bg-[var(--cc-soft)] border-b last:border-b-0"
        style={{ borderColor: BORDER }}
      >
        {/* Avatar */}
        <div
          className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-[13px] font-black text-white"
          style={{ background: PLUM }}
        >
          {initials(client.full_name)}
        </div>

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-black truncate leading-tight" style={{ color: TEXT }}>
            {client.full_name}
          </p>

          {/* NDIS number as a clear identifier */}
          {ndis && (
            <span
              className="inline-block mt-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--cc-soft)", color: MUTED }}
            >
              NDIS {ndis}
            </span>
          )}

          {/* Secondary meta */}
          <p className="text-[12px] font-medium mt-0.5 truncate" style={{ color: MUTED }}>
            {client.plan_management_type ?? "No plan type"}
            {lastSeen ? ` · Last seen ${lastSeen}` : ""}
          </p>
        </div>

        {/* Compliance badge */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls}`}>
            {label}
          </span>
          <ArrowRight size={14} strokeWidth={2} style={{ color: MUTED }} />
        </div>
      </div>
    </Link>
  );
}

export default function MyClients() {
  const [search, setSearch] = useState("");

  const { data = [], isLoading, error } = useOrgQuery(["worker", "my-clients"], {
    queryFn: getMyClients,
  });

  const filtered = data
    .filter((c) => {
      const q = search.toLowerCase();
      if (!q) return true;
      const ndis = ((c as WorkerClient & { ndis_number?: string }).ndis_number ?? "").toLowerCase();
      return c.full_name.toLowerCase().includes(q) || ndis.includes(q);
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const compliantCount    = data.filter((c) => c.compliance_status === "compliant").length;
  const needsReviewCount  = data.filter((c) => c.compliance_status !== "compliant").length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24 md:pb-10">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-black tracking-tight" style={{ color: TEXT }}>My Clients</h1>
          <p className="text-[13px] font-medium mt-0.5" style={{ color: MUTED }}>
            {data.length} assigned participant{data.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Summary strip */}
      {!isLoading && data.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3"
          style={{ background: "var(--cc-bg)", borderColor: BORDER }}
        >
          <div className="flex items-center gap-2">
            <Users size={14} style={{ color: MUTED }} />
            <span className="text-[13px] font-black" style={{ color: TEXT }}>{data.length}</span>
            <span className="text-[13px] font-medium" style={{ color: MUTED }}>assigned</span>
          </div>
          <div className="h-3.5 w-px" style={{ background: BORDER }} />
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span className="text-[13px] font-black text-emerald-700">{compliantCount}</span>
            <span className="text-[13px] font-medium" style={{ color: MUTED }}>compliant</span>
          </div>
          {needsReviewCount > 0 && (
            <>
              <div className="h-3.5 w-px" style={{ background: BORDER }} />
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} style={{ color: CORAL }} />
                <span className="text-[13px] font-black" style={{ color: CORAL }}>{needsReviewCount}</span>
                <span className="text-[13px] font-medium" style={{ color: MUTED }}>needs review</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Search */}
      {data.length > 0 && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
            style={{ color: MUTED }}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or NDIS number…"
            className="w-full h-11 pl-10 pr-4 rounded-xl text-[14px] outline-none transition-all"
            style={{
              background: "var(--cc-soft)",
              border: `1px solid ${BORDER}`,
              color: TEXT,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--cc-plum)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
          />
        </div>
      )}

      {/* Client list */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--cc-bg)", borderColor: BORDER }}
      >
        {isLoading && (
          <div className="py-8 text-center text-[13px] font-medium" style={{ color: MUTED }}>
            Loading your clients…
          </div>
        )}

        {error && (
          <div className="py-8 text-center text-[13px] font-bold text-red-600 px-4">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && data.length === 0 && (
          <div className="flex flex-col items-center py-14 gap-3 px-6 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--cc-active-bg)" }}
            >
              <Users size={22} style={{ color: PLUM, opacity: 0.4 }} />
            </div>
            <p className="text-[14px] font-bold" style={{ color: TEXT }}>No assigned clients</p>
            <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>
              Clients assigned to you by your coordinator will appear here.
            </p>
          </div>
        )}

        {!isLoading && filtered.length === 0 && data.length > 0 && (
          <div className="py-10 text-center text-[13px] font-medium px-4" style={{ color: MUTED }}>
            No clients match "{search}"
          </div>
        )}

        {filtered.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>
    </div>
  );
}
