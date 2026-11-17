/**
 * Settings > Integrations > API and webhooks (managing directors).
 *
 * For systems such as CORA Workforce: API keys (made here, shown once, revoked
 * any time) to read this organisation's workers, credentials and training
 * through /api/v1, and webhooks that tell those systems when something
 * changes. Ends with a short guide for the other system's developers.
 */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, KeyRound, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { IntegrationPage } from "./IntegrationPage";
import { apiTileStatus } from "./integrationStatus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { formatAppDate, formatAppTime } from "@/lib/datetime";
import {
  createApiKey,
  createWebhook,
  deleteWebhook,
  getWebhookDeliveries,
  revokeApiKey,
  testWebhook,
  updateWebhook,
  type ApiKey,
  type ApiOverview,
  type WebhookEndpoint,
} from "@/services/integrationsService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";

const SCOPE_LABELS: Record<string, string> = {
  "workers:read": "Workers",
  "credentials:read": "Credentials",
  "training:read": "Training",
};
const EVENT_LABELS: Record<string, string> = {
  "worker.created": "Worker added",
  "worker.updated": "Worker changed",
  "worker.deactivated": "Worker deactivated",
  "credential.created": "Credential added",
  "credential.updated": "Credential changed",
  "credential.deleted": "Credential removed",
  "training.completed": "Training completed or reviewed",
};

function when(iso?: string | null) {
  if (!iso) return null;
  return `${formatAppDate(iso, null, { day: "numeric", month: "short" })}, ${formatAppTime(iso)}`;
}

function apiBase() {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
  return configured || (typeof window !== "undefined" ? window.location.origin : "");
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : undefined;
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-[13px] font-semibold" style={{ color: TEXT }}>{children}</h4>
      {action}
    </div>
  );
}

/** A secret shown this once, with Copy. */
function ShowOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-2 rounded-xl p-4" style={{ background: PURPLE_SOFT }}>
      <p className="text-[13px] font-semibold" style={{ color: TEXT }}>{label}</p>
      <p className="text-xs" style={{ color: MUTED }}>Copy it now and keep it somewhere safe. You won't be able to see it again.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-cc-border bg-cc-surface px-3 py-2 text-xs" style={{ color: TEXT }}>
          {value}
        </code>
        <Button size="sm" variant="outline" onClick={() => void copy()} className="shrink-0 gap-1.5">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onDone} style={{ color: PURPLE }}>I've saved it</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function KeysSection({ overview, refresh }: { overview: ApiOverview; refresh: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(overview.scopes.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const active = overview.keys.filter((k) => !k.revoked_at);
  const revoked = overview.keys.filter((k) => k.revoked_at);

  const create = async () => {
    setBusy(true);
    try {
      const made = await createApiKey(name.trim(), scopes);
      setNewKey(made.key);
      setAdding(false);
      setName("");
      refresh();
    } catch (err) {
      toast({ title: "Couldn't create the key", description: errorText(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (key: ApiKey) => {
    try {
      await revokeApiKey(key.id);
      toast({ title: `${key.name} revoked`, description: "It stops working straight away." });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't revoke the key", description: errorText(err), variant: "destructive" });
    }
  };

  return (
    <section className="space-y-3">
      <SectionTitle
        action={!adding && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> New key
          </Button>
        )}
      >
        API keys
      </SectionTitle>

      {newKey && <ShowOnce label="Your new API key" value={newKey} onDone={() => setNewKey(null)} />}

      {adding && (
        <div className="space-y-3 rounded-xl border border-cc-border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="api-key-name" className="text-[13px]">Name</Label>
            <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CORA Workforce" maxLength={80} />
            <p className="text-xs" style={{ color: MUTED }}>The system it's for, so you know which key to revoke later.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium" style={{ color: TEXT }}>It can read</legend>
            {overview.scopes.map((scope) => (
              <label key={scope.id} className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={scopes.includes(scope.id)}
                  onCheckedChange={(v) => setScopes((s) => (v ? [...s, scope.id] : s.filter((x) => x !== scope.id)))}
                  className="mt-0.5"
                />
                <span className="text-[13px]" style={{ color: TEXT }}>
                  {SCOPE_LABELS[scope.id] ?? scope.id}
                  <span className="block text-xs" style={{ color: MUTED }}>{scope.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || !name.trim() || scopes.length === 0}
              onClick={() => void create()}
              className="gap-1.5"
              style={{ background: "var(--cc-cta)", color: "#fff" }}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create key
            </Button>
          </div>
        </div>
      )}

      {active.length === 0 && !adding ? (
        <p className="text-sm" style={{ color: MUTED }}>No keys yet. Create one for each system that needs CareCliQ data.</p>
      ) : (
        active.length > 0 && (
          <ul className="divide-y divide-cc-border rounded-xl border border-cc-border">
            {active.map((key) => (
              <li key={key.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: TEXT }}>
                    <KeyRound className="h-3.5 w-3.5 shrink-0" style={{ color: PURPLE }} />
                    <span className="truncate">{key.name}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs" style={{ color: MUTED }}>
                    <code>{key.prefix}...</code> · Reads {key.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(", ")}
                  </p>
                  <p className="text-xs" style={{ color: MUTED }}>
                    {key.last_used_at ? `Last used ${when(key.last_used_at)}` : "Not used yet"} · Created {when(key.created_at)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRevoking(key)} style={{ color: "var(--cc-danger-text)" }}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )
      )}

      {revoked.length > 0 && (
        <button type="button" onClick={() => setShowRevoked((v) => !v)} className="flex items-center gap-1 text-xs font-medium" style={{ color: MUTED }}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRevoked ? "rotate-180" : ""}`} />
          {showRevoked ? "Hide" : "Show"} revoked keys ({revoked.length})
        </button>
      )}
      {showRevoked && (
        <ul className="space-y-1">
          {revoked.map((key) => (
            <li key={key.id} className="text-xs" style={{ color: MUTED }}>
              {key.name} <code>{key.prefix}...</code>, revoked {when(key.revoked_at)}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The key stops working straight away, and the system using it can no longer read CareCliQ data. This can't be
              undone; you can create a new key instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revoking && void revoke(revoking)}
              style={{ background: "var(--cc-danger-text)", color: "#fff" }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function webhookHealth(hook: WebhookEndpoint) {
  if (!hook.active) return { label: "Paused", fg: MUTED, bg: "var(--cc-soft)" };
  if (hook.failure_count > 0) return { label: "Failing", fg: "var(--cc-danger-text)", bg: "var(--cc-status-danger-bg)" };
  return { label: "Active", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" };
}

function Deliveries({ hookId }: { hookId: string }) {
  const query = useOrgQuery(["integrations", "api", "deliveries", hookId], {
    queryFn: () => getWebhookDeliveries(hookId),
    staleTime: 15_000,
  });
  if (query.isLoading) return <p className="text-xs" style={{ color: MUTED }}>Loading deliveries...</p>;
  const rows = query.data ?? [];
  if (!rows.length) return <p className="text-xs" style={{ color: MUTED }}>Nothing sent yet.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-2 text-xs" style={{ color: MUTED }}>
          <span
            className="rounded px-1.5 font-semibold"
            style={d.status === "delivered"
              ? { color: "var(--cc-status-success)", background: "var(--cc-status-success-bg)" }
              : d.status === "failed"
                ? { color: "var(--cc-danger-text)", background: "var(--cc-status-danger-bg)" }
                : { color: MUTED, background: "var(--cc-soft)" }}
          >
            {d.status === "delivered" ? "Delivered" : d.status === "failed" ? "Failed" : "Retrying"}
          </span>
          <span style={{ color: TEXT }}>{EVENT_LABELS[d.event_type] ?? d.event_type}</span>
          <span>{when(d.created_at)}</span>
          {d.response_status ? <span>· answered {d.response_status}</span> : null}
          {d.status !== "delivered" && d.error ? <span>· {d.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function WebhookRow({ hook, refresh }: { hook: WebhookEndpoint; refresh: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const health = webhookHealth(hook);

  const test = async () => {
    setTesting(true);
    try {
      const result = await testWebhook(hook.id);
      toast(result.ok
        ? { title: "Test delivered", description: `The address answered ${result.status}.` }
        : { title: "Test didn't get through", description: result.message ?? undefined, variant: "destructive" });
    } catch (err) {
      toast({ title: "Couldn't send the test", description: errorText(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };
  const toggle = async () => {
    try {
      await updateWebhook(hook.id, { active: !hook.active });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't change the webhook", description: errorText(err), variant: "destructive" });
    }
  };
  const remove = async () => {
    try {
      await deleteWebhook(hook.id);
      toast({ title: "Webhook removed" });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't remove the webhook", description: errorText(err), variant: "destructive" });
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium" style={{ color: TEXT }} title={hook.url}>{hook.url}</p>
          <p className="truncate text-xs" style={{ color: MUTED }}>
            {hook.description ? `${hook.description} · ` : ""}
            {hook.events.length} {hook.events.length === 1 ? "event" : "events"}
            {hook.last_delivery_at ? ` · last sent ${when(hook.last_delivery_at)}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: health.fg, background: health.bg }}>
          {health.label}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" disabled={testing || !hook.active} onClick={() => void test()}>
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send test
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void toggle()}>
          {hook.active ? "Pause" : "Resume"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} /> Recent deliveries
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs" style={{ color: "var(--cc-danger-text)" }} onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-3 w-3" /> Remove
        </Button>
      </div>
      {open && <div className="mt-2 rounded-lg border border-cc-border p-3"><Deliveries hookId={hook.id} /></div>}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this webhook?</AlertDialogTitle>
            <AlertDialogDescription>{hook.url} will stop hearing about changes. Its delivery history goes too.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} style={{ background: "var(--cc-danger-text)", color: "#fff" }}>
              Remove webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function WebhooksSection({ overview, refresh }: { overview: ApiOverview; refresh: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(overview.events.map((e) => e.id));
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const made = await createWebhook(url.trim(), events, description.trim() || undefined);
      setSecret(made.secret);
      setAdding(false);
      setUrl("");
      setDescription("");
      refresh();
    } catch (err) {
      toast({ title: "Couldn't add the webhook", description: errorText(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <SectionTitle
        action={!adding && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add webhook
          </Button>
        )}
      >
        Webhooks
      </SectionTitle>

      {secret && <ShowOnce label="The webhook's signing secret" value={secret} onDone={() => setSecret(null)} />}

      {adding && (
        <div className="space-y-3 rounded-xl border border-cc-border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url" className="text-[13px]">Address</Label>
            <Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." inputMode="url" />
            <p className="text-xs" style={{ color: MUTED }}>The https address the other system gave you for CareCliQ updates.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-description" className="text-[13px]">Note (optional)</Label>
            <Input id="webhook-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="CORA Workforce" maxLength={200} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium" style={{ color: TEXT }}>Send these changes</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {overview.events.map((event) => (
                <label key={event.id} className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={events.includes(event.id)}
                    onCheckedChange={(v) => setEvents((s) => (v ? [...s, event.id] : s.filter((x) => x !== event.id)))}
                  />
                  <span className="text-[13px]" style={{ color: TEXT }} title={event.description}>{EVENT_LABELS[event.id] ?? event.id}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || !url.trim() || events.length === 0}
              onClick={() => void create()}
              className="gap-1.5"
              style={{ background: "var(--cc-cta)", color: "#fff" }}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add webhook
            </Button>
          </div>
        </div>
      )}

      {overview.webhooks.length === 0 && !adding ? (
        <p className="text-sm" style={{ color: MUTED }}>No webhooks yet. Add one so another system hears about changes as they happen.</p>
      ) : (
        overview.webhooks.length > 0 && (
          <ul className="divide-y divide-cc-border rounded-xl border border-cc-border">
            {overview.webhooks.map((hook) => <WebhookRow key={hook.id} hook={hook} refresh={refresh} />)}
          </ul>
        )
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The guide for the other system's developers
// ---------------------------------------------------------------------------

function DeveloperGuide() {
  const base = `${apiBase()}/api/v1`;
  const endpoints: Array<[string, string]> = [
    ["GET /organisation", "Which organisation the key is for (test a key)"],
    ["GET /workers", "Staff, active by default (status=all, role=...)"],
    ["GET /workers/{id}", "One worker"],
    ["GET /workers/{id}/credentials", "A worker's credentials"],
    ["GET /credentials", "All credentials (updated_since, expiring_before, type, status)"],
    ["GET /training/modules", "Training modules"],
    ["GET /training/completions", "Completions (worker_id, completed_since, status)"],
  ];
  return (
    <section className="space-y-3">
      <SectionTitle>Connecting a system</SectionTitle>
      <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>
        Share this with the other system's developers, with a key from above. Lists take <code>limit</code> (up to 500)
        and <code>offset</code>, and return <code>data</code>, <code>has_more</code> and <code>next_offset</code>.
      </p>
      <pre className="overflow-x-auto rounded-xl border border-cc-border bg-cc-soft p-3 text-[11.5px] leading-relaxed" style={{ color: TEXT }}>
{`curl ${base}/workers \\
  -H "Authorization: Bearer cc_live_..."`}
      </pre>
      <ul className="divide-y divide-cc-border rounded-xl border border-cc-border text-xs">
        {endpoints.map(([path, what]) => (
          <li key={path} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 px-3 py-2">
            <code style={{ color: TEXT }}>{path}</code>
            <span style={{ color: MUTED }}>{what}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
        Webhooks are POSTed as JSON with <code>CareCliQ-Event</code> and <code>CareCliQ-Signature: t=...,v1=...</code>,
        where v1 is the HMAC-SHA256 of <code>t.body</code> with the signing secret. Answer with any 2xx within 10
        seconds; anything else is retried for up to a day. Up to 300 API requests a minute per key.
      </p>
    </section>
  );
}

/** API and webhooks' own page inside Settings > Integrations (?integration=api). */
export function ApiAccessPage({ overview, onBack }: { overview: ApiOverview; onBack: () => void }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
  return (
    <IntegrationPage
      onBack={onBack}
      title="API and webhooks"
      status={apiTileStatus(overview)}
      subtitle="For developers · For systems such as CORA Workforce. Keys only ever read this organisation's data, and you can revoke them at any time."
    >
      <div className="max-w-3xl space-y-6">
        <KeysSection overview={overview} refresh={refresh} />
        <WebhooksSection overview={overview} refresh={refresh} />
        <DeveloperGuide />
      </div>
    </IntegrationPage>
  );
}
