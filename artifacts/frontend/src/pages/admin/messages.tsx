import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Bell, ChevronRight, Mail, Plus } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatDate } from "@/components/admin/adminFormat";
import { ctaClass } from "@/components/layout/PageKit";
import { listMessages, type SentMessage } from "@/services/adminMessagesService";

const ROLE_SHORT: Record<string, string> = {
  managing_director: "directors",
  support_coordinator: "coordinators",
  support_worker: "support workers",
};

export function audienceLabel(m: Pick<SentMessage, "audience" | "org_count">) {
  const a = m.audience ?? { orgs: "all", roles: [] };
  const who = (a.roles ?? []).map((r) => ROLE_SHORT[r] ?? r).join(", ") || "directors";
  const where =
    a.orgs === "selected"
      ? `${m.org_count} chosen ${m.org_count === 1 ? "provider" : "providers"}`
      : a.orgs === "status"
        ? `providers ${String(a.status ?? "").replace(/_/g, " ")}`
        : "every provider";
  return `${who[0].toUpperCase()}${who.slice(1)} at ${where}`;
}

export function deliveryLine(d: SentMessage["delivery"]) {
  const parts: string[] = [];
  if (d.sent) parts.push(`${d.sent} emailed`);
  if (d.queued) parts.push(`${d.queued} sending`);
  if (d.failed) parts.push(`${d.failed} failed`);
  if (d.opted_out) parts.push(`${d.opted_out} unsubscribed`);
  if (d.in_app_only) parts.push(`${d.in_app_only} in CareCliQ only`);
  return parts.join(" · ");
}

export default function AdminMessagesPage() {
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<SentMessage[] | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMessages()
      .then((r) => { setMessages(r.messages); setNeedsMigration(r.needs_migration); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Couldn't load messages."); setMessages([]); });
  }, []);

  return (
    <AdminShell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>Messages</h1>
            <p className="mt-1 text-sm text-cc-muted">Email and in-app notices from CareCliQ to the providers on the platform.</p>
          </div>
          <button type="button" onClick={() => navigate("/admin/messages/new")} className={ctaClass}>
            <Plus size={16} /> New message
          </button>
        </header>

        {(error || needsMigration) && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl px-4 py-3 sm:px-5" style={{ background: "var(--cc-status-warning-bg)" }}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-warning)" }} />
            <p className="text-sm text-cc-text">{error ?? "Messages need database migration 274, which arrives with the next API deploy."}</p>
          </div>
        )}

        <section aria-label="Sent messages" className="overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
          {messages === null ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-cc-soft" />)}</div>
          ) : messages.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Mail size={24} className="mx-auto text-cc-muted" />
              <p className="mt-3 text-sm font-semibold text-cc-text">Nothing sent yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-cc-muted">Let providers know about maintenance, new features or billing, by email, in the app, or both.</p>
            </div>
          ) : (
            <ul className="divide-y divide-cc-border">
              {messages.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => navigate(`/admin/messages/${m.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-cc-soft sm:px-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]">
                      {m.channels.includes("email") ? <Mail size={16} /> : <Bell size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                        <span className="truncate text-sm font-semibold text-cc-text">{m.subject}</span>
                        <span className="shrink-0 rounded-full bg-cc-soft px-2 py-0.5 text-[11px] font-semibold text-cc-muted">
                          {m.category === "news" ? "News" : "Service"}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-cc-muted">
                        {formatDate(m.created_at)} · {audienceLabel(m)} · {m.recipient_count} people
                      </span>
                      <span className="block truncate text-xs" style={{ color: m.delivery.failed ? "var(--cc-status-danger)" : "var(--cc-muted)" }}>
                        {deliveryLine(m.delivery)}
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-cc-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
