import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Loader2, Megaphone, Plus, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatDate } from "@/components/admin/adminFormat";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import { useToast } from "@/hooks/use-toast";
import { createBanner, endBanner, getSystemStatus, listBanners, type Banner, type SystemStatus } from "@/services/adminMessagesService";

type Health = "good" | "warn" | "bad";

const HEALTH: Record<Health, { icon: typeof CheckCircle2; color: string }> = {
  good: { icon: CheckCircle2, color: "var(--cc-status-success)" },
  warn: { icon: CircleAlert, color: "var(--cc-status-warning)" },
  bad: { icon: AlertTriangle, color: "var(--cc-status-danger)" },
};

function Check({ health, title, detail }: { health: Health; title: string; detail: ReactNode }) {
  const { icon: Icon, color } = HEALTH[health];
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-cc-text">{title}</p>
        <p className="text-sm text-cc-muted">{detail}</p>
      </div>
    </li>
  );
}

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputClass = "h-11 w-full rounded-xl border border-cc-border bg-cc-surface px-3.5 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum";

export default function AdminSystemPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    message: "",
    tone: "info" as Banner["tone"],
    audience: "everyone" as Banner["audience"],
    link_label: "",
    link_url: "",
    starts_at: localInput(new Date()),
    ends_at: localInput(new Date(Date.now() + 24 * 3600 * 1000)),
  });

  function loadStatus() {
    setStatus(null);
    setStatusError(null);
    getSystemStatus().then(setStatus).catch((e) => setStatusError(e instanceof Error ? e.message : "Couldn't check."));
  }
  function loadBanners() {
    listBanners().then((r) => { setBanners(r.banners); setNeedsMigration(r.needs_migration); }).catch(() => setBanners([]));
  }
  useEffect(() => { loadStatus(); loadBanners(); }, []);

  async function save() {
    setSaving(true);
    try {
      await createBanner({
        message: form.message.trim(),
        tone: form.tone,
        audience: form.audience,
        link_label: form.link_label.trim() || null,
        link_url: form.link_label.trim() ? form.link_url.trim() || null : null,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
      });
      toast({ title: "Banner scheduled" });
      setPanelOpen(false);
      loadBanners();
    } catch (e) {
      toast({ title: "Banner not saved", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function stop(id: string) {
    try {
      await endBanner(id);
      toast({ title: "Banner taken down" });
      loadBanners();
    } catch (e) {
      toast({ title: "Couldn't take it down", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }

  const now = Date.now();
  const live = (banners ?? []).filter((b) => new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() > now);
  const upcoming = (banners ?? []).filter((b) => new Date(b.starts_at).getTime() > now);
  const past = (banners ?? []).filter((b) => new Date(b.ends_at).getTime() <= now).slice(0, 5);

  const emailHealth: Health = status?.email.status === "queued" ? ((status.email.queue.failed ?? 0) > 0 ? "warn" : "good") : "bad";
  const dbHealth: Health = !status?.database.checked ? "warn" : status.database.up_to_date ? "good" : "bad";

  return (
    <AdminShell>
      <div className="space-y-6 pb-12">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>System</h1>
            <p className="mt-1 text-sm text-cc-muted">How this server is running, and the notice shown across the app.</p>
          </div>
          <button type="button" onClick={loadStatus} className={outlineClass}><RefreshCw size={15} /> Check again</button>
        </header>

        <section className="space-y-3" aria-label="Health">
          <h2 className="text-lg font-semibold text-cc-text">Health</h2>
          {statusError ? (
            <p role="alert" className="text-sm" style={{ color: "var(--cc-status-danger)" }}>{statusError}</p>
          ) : !status ? (
            <div className="h-48 animate-pulse rounded-2xl bg-cc-surface" />
          ) : (
            <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
              <Check
                health={emailHealth}
                title="Email"
                detail={
                  status.email.status === "queued"
                    ? `Sending. ${status.email.queue.pending ?? 0} waiting, ${status.email.queue.sent ?? 0} sent and ${status.email.queue.failed ?? 0} failed since the server started.`
                    : status.email.message
                }
              />
              <Check
                health={dbHealth}
                title="Database"
                detail={
                  !status.database.checked
                    ? "Couldn't check which migrations have run."
                    : status.database.up_to_date
                      ? `Up to date (latest migration ${status.database.latest_migration}).`
                      : `${status.database.pending.length} migration${status.database.pending.length === 1 ? "" : "s"} not applied: ${status.database.pending.join(", ") || "the newest columns aren't visible yet"}. Deploy the API to apply them.`
                }
              />
              <Check
                health={status.stripe.mode === "not_set" ? "bad" : "good"}
                title="Payments (Stripe)"
                detail={status.stripe.mode === "live" ? "Live: real cards are charged." : status.stripe.mode === "test" ? "Test mode: no real charges." : "No Stripe key set: sign-ups and billing won't work."}
              />
              <Check
                health={status.reminders.scheduler_on ? "good" : "warn"}
                title="Reminders and scheduled emails"
                detail={status.reminders.scheduler_on ? "On." : "Off on this server (expected on the test server, not on production)."}
              />
              <Check
                health="good"
                title="Platform"
                detail={`${status.counts.organizations ?? "?"} providers, ${status.counts.active_staff} active staff accounts. Site: ${status.site.url}`}
              />
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-label="Site banner">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-cc-text">Site banner</h2>
              <p className="text-sm text-cc-muted">A one-line notice across the top of CareCliQ for providers' staff, for a set time.</p>
            </div>
            <button type="button" className={ctaClass} disabled={needsMigration} onClick={() => setPanelOpen(true)}>
              <Plus size={16} /> New banner
            </button>
          </div>
          {needsMigration && (
            <p className="rounded-2xl px-4 py-3 text-sm text-cc-text" style={{ background: "var(--cc-status-warning-bg)" }}>
              Banners need database migration 274, which arrives with the next API deploy.
            </p>
          )}
          <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
            {banners === null && <li className="h-16 animate-pulse bg-cc-soft" />}
            {banners !== null && live.length + upcoming.length + past.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-cc-muted">No banners in the last 60 days.</li>
            )}
            {[...live.map((b) => ["Showing now", b] as const), ...upcoming.map((b) => ["Scheduled", b] as const), ...past.map((b) => ["Ended", b] as const)].map(([state, b]) => (
              <li key={b.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                <Megaphone size={17} className="mt-0.5 shrink-0" style={{ color: b.tone === "warning" ? "var(--cc-status-warning)" : "var(--cc-status-info)" }} />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm text-cc-text">{b.message}</p>
                  <p className="text-xs text-cc-muted">
                    <span className="font-semibold" style={{ color: state === "Showing now" ? "var(--cc-status-success)" : undefined }}>{state}</span>
                    {" · "}{formatDate(b.starts_at)} to {formatDate(b.ends_at)} · {b.audience === "directors" ? "Directors only" : "Everyone"}
                  </p>
                </div>
                {state !== "Ended" && (
                  <button type="button" className={ghostClass} onClick={() => void stop(b.id)}>{state === "Scheduled" ? "Cancel" : "Take down"}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <SidePanel
        open={panelOpen}
        onOpenChange={(o) => { if (!saving) setPanelOpen(o); }}
        icon={Megaphone}
        title="New banner"
        description="Shows across the top of CareCliQ between these times. Keep it to one sentence."
        footer={
          <>
            <button type="button" className={ghostClass} onClick={() => setPanelOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className={ctaClass} onClick={() => void save()} disabled={saving || form.message.trim().length < 5}>
              {saving && <Loader2 size={15} className="animate-spin" />} Schedule banner
            </button>
          </>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-cc-text">Message</span>
          <textarea value={form.message} maxLength={280} rows={3} onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="e.g. CareCliQ will be down for maintenance on Sunday from 10pm to 11pm."
            className="w-full rounded-xl border border-cc-border bg-cc-surface px-3.5 py-2.5 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-cc-text">Style</span>
            <select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value as Banner["tone"] })} className={inputClass}>
              <option value="info">Information</option>
              <option value="warning">Warning</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-cc-text">Who sees it</span>
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as Banner["audience"] })} className={inputClass}>
              <option value="everyone">Everyone at every provider</option>
              <option value="directors">Managing directors only</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-cc-text">From</span>
            <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-cc-text">Until</span>
            <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-cc-text">Link <span className="font-normal text-cc-muted">(optional)</span></span>
            <input value={form.link_label} maxLength={40} onChange={(e) => setForm({ ...form, link_label: e.target.value })} placeholder="e.g. Read more" className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-cc-text">Link to</span>
            <input value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://... or /page" className={inputClass} />
          </label>
        </div>
      </SidePanel>
    </AdminShell>
  );
}
