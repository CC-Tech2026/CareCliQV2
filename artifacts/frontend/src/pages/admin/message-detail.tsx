import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2, RotateCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatDate, roleLabel } from "@/components/admin/adminFormat";
import { outlineClass } from "@/components/layout/PageKit";
import { useToast } from "@/hooks/use-toast";
import { getMessage, retryMessage, type MessageDetail, type MessageRecipient } from "@/services/adminMessagesService";
import { audienceLabel, deliveryLine } from "./messages";

const STATUS: Record<MessageRecipient["status"], { label: string; color: string }> = {
  sent: { label: "Emailed", color: "var(--cc-status-success)" },
  queued: { label: "Sending", color: "var(--cc-status-info)" },
  failed: { label: "Failed", color: "var(--cc-status-danger)" },
  opted_out: { label: "Unsubscribed", color: "var(--cc-muted)" },
  in_app_only: { label: "In CareCliQ", color: "var(--cc-muted)" },
};

type Filter = "all" | MessageRecipient["status"];

export default function AdminMessageDetailPage() {
  const { messageId } = useParams<{ messageId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [retrying, setRetrying] = useState(false);

  function load() {
    getMessage(messageId).then(setMsg).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this message."));
  }
  useEffect(load, [messageId]);
  // While emails are still going out, refresh every few seconds.
  useEffect(() => {
    if (!msg?.delivery.queued) return;
    const t = window.setTimeout(load, 4000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const shown = useMemo(() => (msg?.recipients ?? []).filter((r) => filter === "all" || r.status === filter), [msg, filter]);

  async function retry() {
    setRetrying(true);
    try {
      const r = await retryMessage(messageId);
      toast({ title: r.requeued ? `${r.requeued} sending again` : "Nothing to retry" });
      load();
    } catch (e) {
      toast({ title: "Couldn't retry", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  }

  const counts = msg?.delivery ?? {};
  const filters: [Filter, string][] = [
    ["all", `All ${msg?.recipients.length ?? 0}`],
    ...(Object.keys(STATUS) as MessageRecipient["status"][])
      .filter((s) => counts[s])
      .map((s) => [s, `${STATUS[s].label} ${counts[s]}`] as [Filter, string]),
  ];

  return (
    <AdminShell>
      <div className="space-y-5 pb-12">
        <button type="button" onClick={() => navigate("/admin/messages")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-cc-muted">
          <ArrowLeft size={14} /> Messages
        </button>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--cc-status-danger)" }}>{error}</p>}
        {!msg && !error && <div className="h-40 animate-pulse rounded-2xl bg-cc-surface" />}
        {msg && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="break-words text-xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>{msg.subject}</h1>
                <p className="mt-1 text-sm text-cc-muted">
                  {msg.category === "news" ? "News" : "Service notice"} · {formatDate(msg.created_at)} · {audienceLabel(msg)}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: counts.failed ? "var(--cc-status-danger)" : "var(--cc-muted)" }}>{deliveryLine(counts)}</p>
              </div>
              {(counts.failed ?? 0) + (counts.queued ?? 0) > 0 && msg.channels.includes("email") && (
                <button type="button" onClick={() => void retry()} disabled={retrying} className={outlineClass}>
                  {retrying ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />} Retry unsent
                </button>
              )}
            </header>

            <section className="rounded-2xl bg-cc-surface p-4 shadow-[var(--cc-shadow-sm)] sm:p-5" aria-label="Message">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-cc-text">{msg.body}</p>
              {msg.button_label && msg.button_url && (
                <p className="mt-3 text-sm text-cc-muted">Button: {msg.button_label} → <span className="break-all">{msg.button_url}</span></p>
              )}
            </section>

            <section className="space-y-3" aria-label="Recipients">
              <div className="flex flex-wrap gap-1.5">
                {filters.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className="min-h-9 rounded-full px-3.5 text-sm font-medium"
                    style={filter === value ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { boxShadow: "inset 0 0 0 1px var(--cc-border)", color: "var(--cc-text)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
                {shown.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate text-sm font-semibold text-cc-text">{r.full_name || r.email}</p>
                      <p className="truncate text-xs text-cc-muted">{r.email} · {r.organization_name}{r.role ? ` · ${roleLabel(r.role)}` : ""}</p>
                      {r.error && <p className="text-xs" style={{ color: "var(--cc-status-danger)" }}>{r.error}</p>}
                    </div>
                    <span className="shrink-0 text-xs font-semibold" style={{ color: STATUS[r.status]?.color }}>{STATUS[r.status]?.label ?? r.status}</span>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-5 py-6 text-center text-sm text-cc-muted">Nobody here.</li>}
              </ul>
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
