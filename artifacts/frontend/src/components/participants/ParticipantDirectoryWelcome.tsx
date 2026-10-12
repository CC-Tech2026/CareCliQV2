import { ArrowRight, Users, FileCheck2, CalendarDays } from "lucide-react";

interface DirectoryParticipant { id: string; full_name: string; plan_status?: string; ndis_number?: string | null }

export function ParticipantDirectoryWelcome({ participants, onSelect, loading, error, onRetry }: {
  participants: DirectoryParticipant[]; onSelect: (id: string) => void; loading: boolean; error: boolean; onRetry: () => void;
}) {
  if (loading) return <div role="status" className="p-8 text-sm text-cc-muted">Loading participant directory…</div>;
  if (error) return <div role="alert" className="p-8"><h2 className="text-lg font-semibold text-cc-text">Participant records couldn’t be loaded</h2><p className="mt-2 text-sm text-cc-muted">Try loading the directory again.</p><button onClick={onRetry} className="mt-4 min-h-11 rounded-lg border border-cc-border px-4 text-sm font-semibold">Try again</button></div>;
  const active = participants.filter(p => p.plan_status === "active").length;
  const review = participants.filter(p => p.plan_status === "review" || p.plan_status === "expired").length;
  return <div className="space-y-6 overflow-y-auto p-5 sm:p-7">
    <header>
      <p className="text-xs font-medium uppercase tracking-wider text-cc-muted">Participant workspace</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-cc-text">People, plans and support</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-cc-muted">Choose a participant to review their care information, plan, goals and delivered support. Search by name or NDIS number in the directory.</p>
    </header>
    <dl className="grid gap-3 sm:grid-cols-3">
      {[{ label: "Participants", value: participants.length, icon: Users }, { label: "Active plans", value: active, icon: FileCheck2 }, { label: "Review or expired", value: review, icon: CalendarDays }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-cc-border bg-cc-surface p-4"><dt className="flex items-center gap-2 text-xs text-cc-muted"><Icon size={15} />{label}</dt><dd className="mt-3 text-3xl font-semibold tabular-nums text-cc-text">{value}</dd></div>)}
    </dl>
    <section className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
      <div className="border-b border-cc-border p-5"><h2 className="text-base font-semibold text-cc-text">Open a participant record</h2><p className="mt-1 text-xs text-cc-muted">An alphabetical starting point. Use the directory for your full caseload.</p></div>
      {participants.length === 0 ? <p className="p-5 text-sm leading-6 text-cc-muted">Your directory is empty. Use Add in the participant list to create the first record.</p> : [...participants].sort((a,b) => a.full_name.localeCompare(b.full_name)).slice(0,5).map(p => <button key={p.id} onClick={() => onSelect(p.id)} className="flex min-h-16 w-full items-center justify-between gap-3 border-b border-cc-border px-5 py-4 text-left last:border-0 hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-cc-text">{p.full_name}</span><span className="mt-1 block text-xs capitalize text-cc-muted">{p.plan_status || "Plan status not recorded"}</span></span><ArrowRight size={16} className="shrink-0 text-cc-muted" /></button>)}
    </section>
  </div>;
}
