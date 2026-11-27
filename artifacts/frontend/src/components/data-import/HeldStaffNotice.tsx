import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { ctaClass, ghostClass } from "@/components/layout/PageKit";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";

type Held = { id: string; email: string; full_name: string | null; role: string };

/** Staff CareCliQ imported for this organisation. Nobody has been emailed:
 *  the managing director decides when their team hears about CareCliQ.
 *  Renders nothing when there's nothing waiting (or the user isn't the MD). */
export function HeldStaffNotice({ onSent }: { onSent?: () => void }) {
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const [held, setHeld] = useState<Held[]>([]);
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/data-import/held-staff");
        if (!res.ok) return;
        const data = (await res.json()) as { held?: Held[] };
        if (!cancelled) setHeld(data.held ?? []);
      } catch {
        // Not the MD, or the feature isn't on this server yet: show nothing.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (held.length === 0) return <>{modal}</>;

  async function post(path: "send" | "discard") {
    const res = await apiFetch(`/api/data-import/held-staff/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.detail === "string" ? body.detail : "That didn't work. Try again.");
    }
    return res.json();
  }

  async function send() {
    setBusy("send");
    try {
      const result = (await requireReAuth(() => post("send"))) as { sent: number; skipped: number } | undefined;
      if (!result) return;
      setHeld([]);
      toast({
        title: `${result.sent} ${result.sent === 1 ? "invitation" : "invitations"} sent`,
        description: result.skipped ? `${result.skipped} already on your team or invited, so not emailed again.` : undefined,
      });
      onSent?.();
    } catch (err) {
      toast({ title: "Invitations not sent", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!window.confirm(`Remove all ${held.length} prepared invitations? Nobody has been emailed.`)) return;
    setBusy("discard");
    try {
      await post("discard");
      setHeld([]);
      toast({ title: "Prepared invitations removed" });
    } catch (err) {
      toast({ title: "Couldn't remove them", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const shown = showAll ? held : held.slice(0, 5);

  return (
    <section
      className="max-w-4xl rounded-2xl px-5 py-4"
      style={{ background: "var(--cc-status-info-bg)" }}
      aria-label="Invitations prepared by CareCliQ"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Mail size={18} className="mt-0.5 shrink-0 text-cc-plum" aria-hidden="true" />
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-semibold text-cc-text">
            CareCliQ prepared {held.length} {held.length === 1 ? "invitation" : "invitations"} for your team
          </p>
          <p className="mt-0.5 text-sm leading-6 text-cc-muted">
            We brought your staff list across. Nobody has been emailed yet; send the invitations when you're ready for your team to join.
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-cc-text">
            {shown.map((h) => (
              <li key={h.id} className="truncate">
                {h.full_name || h.email}
                <span className="text-cc-muted">
                  {h.full_name ? ` · ${h.email}` : ""} · {h.role === "support_coordinator" ? "Coordinator" : "Support worker"}
                </span>
              </li>
            ))}
          </ul>
          {held.length > 5 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-sm font-semibold text-cc-plum">
              {showAll ? "Show fewer" : `Show all ${held.length}`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void discard()} disabled={busy !== null} className={ghostClass}>
            {busy === "discard" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
            Remove
          </button>
          <button type="button" onClick={() => void send()} disabled={busy !== null} className={ctaClass}>
            {busy === "send" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
            Send {held.length} {held.length === 1 ? "invitation" : "invitations"}
          </button>
        </div>
      </div>
      {modal}
    </section>
  );
}
