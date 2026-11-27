import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, Bell, Check, Loader2, Mail, Search, Send } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import { useToast } from "@/hooks/use-toast";
import { listAdminOrganizations, type AdminOrgSummary } from "@/services/adminService";
import {
  getMessageTemplates, previewMessage, sendMessage, sendTestMessage,
  type Audience, type AudiencePreview, type MessageDraft, type MessageTemplate, type StaffRole, type StatusFilter,
} from "@/services/adminMessagesService";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "needs_attention", label: "Needs attention" },
  { value: "trial", label: "On trial" },
  { value: "paying", label: "Paying" },
  { value: "payment_trouble", label: "Payment problems or read-only" },
  { value: "free_access", label: "On free access" },
  { value: "not_billed", label: "Not billed through Stripe" },
];

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "managing_director", label: "Managing directors" },
  { value: "support_coordinator", label: "Coordinators" },
  { value: "support_worker", label: "Support workers" },
];

const inputClass =
  "w-full rounded-xl border border-cc-border bg-cc-surface px-3.5 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum";

function Card({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl bg-cc-surface p-4 shadow-[var(--cc-shadow-sm)] sm:p-5" aria-label={title}>
      <div>
        <h2 className="text-base font-semibold text-cc-text">{title}</h2>
        {info && <p className="mt-0.5 text-sm text-cc-muted">{info}</p>}
      </div>
      {children}
    </section>
  );
}

function Choice({ checked, onChange, type = "radio", title, detail }: {
  checked: boolean; onChange: () => void; type?: "radio" | "checkbox"; title: string; detail?: string;
}) {
  return (
    <label
      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 transition-colors"
      style={{ borderColor: checked ? "var(--cc-plum)" : "var(--cc-border)", background: checked ? "var(--cc-plum-subtle, var(--cc-soft))" : undefined }}
    >
      <input type={type} checked={checked} onChange={onChange} className="mt-1 h-4 w-4 accent-cc-plum" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-cc-text">{title}</span>
        {detail && <span className="block text-xs leading-snug text-cc-muted">{detail}</span>}
      </span>
    </label>
  );
}

export default function AdminMessageNewPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const presetOrg = new URLSearchParams(search).get("org");

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [orgs, setOrgs] = useState<AdminOrgSummary[]>([]);
  const [draft, setDraft] = useState<MessageDraft>({ subject: "", body: "", category: "service", channels: ["email"], button_label: "", button_url: "" });
  const [audience, setAudience] = useState<Audience>({
    orgs: presetOrg ? "selected" : "all",
    status: "needs_attention",
    org_ids: presetOrg ? [presetOrg] : [],
    roles: ["managing_director"],
  });
  const [orgQuery, setOrgQuery] = useState("");
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    getMessageTemplates().then((t) => setTemplates(t.templates)).catch(() => {});
    listAdminOrganizations().then((o) => setOrgs(o.filter((x) => x.status === "active"))).catch(() => {});
  }, []);

  // Template blanks like {date} have to be filled in before anything goes out.
  const unfilled = Array.from(new Set(
    Array.from(`${draft.subject} ${draft.body}`.matchAll(/\{([a-z_]+)\}/g)).map((m) => m[1]),
  )).filter((t) => !["first_name", "name", "organisation"].includes(t));
  const ready = unfilled.length === 0 && draft.subject.trim().length >= 3 && draft.body.trim().length >= 10 && draft.channels.length > 0 &&
    !(audience.orgs === "selected" && audience.org_ids.length === 0) && audience.roles.length > 0;
  const cleanDraft: MessageDraft = {
    ...draft,
    button_label: draft.button_label?.trim() || null,
    button_url: draft.button_label?.trim() ? draft.button_url?.trim() || null : null,
  };

  // Live preview of who it reaches, a moment after the last change.
  useEffect(() => {
    setConfirming(false);
    if (timer.current) window.clearTimeout(timer.current);
    if (!ready) { setPreview(null); return; }
    timer.current = window.setTimeout(() => {
      setPreviewing(true);
      previewMessage(cleanDraft, audience)
        .then((p) => { setPreview(p); setPreviewError(null); })
        .catch((e) => setPreviewError(e instanceof Error ? e.message : "Couldn't preview."))
        .finally(() => setPreviewing(false));
    }, 500);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cleanDraft), JSON.stringify(audience), ready]);

  const shownOrgs = useMemo(() => {
    const q = orgQuery.trim().toLowerCase();
    return orgs.filter((o) => !q || o.display_name.toLowerCase().includes(q));
  }, [orgs, orgQuery]);

  function applyTemplate(t: MessageTemplate) {
    setDraft((d) => ({ ...d, subject: t.subject, body: t.body, category: t.category }));
  }

  function toggle<T>(list: T[], value: T) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function test() {
    setBusy("test");
    try {
      const r = await sendTestMessage(cleanDraft);
      toast({
        title: r.status === "queued" ? `Test sent to ${r.to}` : "Test not sent",
        description: r.status === "queued" ? "It's addressed as if to a director at Example Provider." : r.message,
        variant: r.status === "queued" ? undefined : "destructive",
      });
    } catch (e) {
      toast({ title: "Test not sent", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!confirming) { setConfirming(true); return; }
    setBusy("send");
    try {
      const r = await sendMessage(cleanDraft, audience);
      toast({ title: `Sent to ${r.recipient_count} ${r.recipient_count === 1 ? "person" : "people"}`, description: `${r.org_count} ${r.org_count === 1 ? "provider" : "providers"}` });
      navigate(`/admin/messages/${r.id}`);
    } catch (e) {
      toast({ title: "Message not sent", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  }

  const emailOff = preview && draft.channels.includes("email") && preview.email_delivery.status !== "queued";

  return (
    <AdminShell>
      <div className="space-y-5 pb-12">
        <button type="button" onClick={() => navigate("/admin/messages")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-cc-muted">
          <ArrowLeft size={14} /> Messages
        </button>
        <header>
          <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>New message</h1>
          <p className="mt-1 text-sm text-cc-muted">Write once; each person gets it addressed to them and their organisation.</p>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
          <div className="space-y-5">
            {templates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-cc-muted">Start from:</span>
                {templates.map((t) => (
                  <button key={t.key} type="button" onClick={() => applyTemplate(t)} className={outlineClass}>{t.name}</button>
                ))}
              </div>
            )}

            <Card title="Message">
              <div className="grid gap-2 sm:grid-cols-2">
                <Choice
                  checked={draft.category === "service"}
                  onChange={() => setDraft({ ...draft, category: "service" })}
                  title="Service notice"
                  detail="Maintenance, billing, security, changes to how CareCliQ works. Always delivered."
                />
                <Choice
                  checked={draft.category === "news"}
                  onChange={() => setDraft({ ...draft, category: "news" })}
                  title="News and updates"
                  detail="New features and product news. Includes an unsubscribe link, as the law requires."
                />
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-cc-text">Subject</span>
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={150} className={`${inputClass} h-11`} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-cc-text">Message</span>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={10}
                  maxLength={8000}
                  className={`${inputClass} py-3 leading-relaxed`}
                />
                <span className="block text-xs text-cc-muted">
                  Use {"{first_name}"}, {"{name}"} and {"{organisation}"} to address each person. A blank line starts a new paragraph.
                </span>
                {unfilled.length > 0 && (
                  <span className="flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs text-cc-text" style={{ background: "var(--cc-status-warning-bg)" }}>
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-warning)" }} />
                    Fill in {unfilled.map((t) => `{${t}}`).join(", ")} before sending.
                  </span>
                )}
              </label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold text-cc-text">Button <span className="font-normal text-cc-muted">(optional)</span></span>
                  <input value={draft.button_label ?? ""} onChange={(e) => setDraft({ ...draft, button_label: e.target.value })} maxLength={40} placeholder="e.g. Open billing" className={`${inputClass} h-11`} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold text-cc-text">Button link</span>
                  <input value={draft.button_url ?? ""} onChange={(e) => setDraft({ ...draft, button_url: e.target.value })} placeholder="/settings or https://..." className={`${inputClass} h-11`} />
                </label>
              </div>
              <div className="space-y-2">
                <span className="text-sm font-semibold text-cc-text">Send as</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Choice type="checkbox" checked={draft.channels.includes("email")} onChange={() => setDraft({ ...draft, channels: toggle(draft.channels, "email") })} title="Email" />
                  <Choice type="checkbox" checked={draft.channels.includes("in_app")} onChange={() => setDraft({ ...draft, channels: toggle(draft.channels, "in_app") })} title="Notice in CareCliQ" detail="Shows in their notifications bell." />
                </div>
              </div>
            </Card>

            <Card title="Who gets it" info="Suspended providers and participant portal accounts never get these.">
              <div className="grid gap-2 sm:grid-cols-3">
                <Choice checked={audience.orgs === "all"} onChange={() => setAudience({ ...audience, orgs: "all" })} title="Every provider" />
                <Choice checked={audience.orgs === "status"} onChange={() => setAudience({ ...audience, orgs: "status" })} title="By account status" />
                <Choice checked={audience.orgs === "selected"} onChange={() => setAudience({ ...audience, orgs: "selected" })} title="Chosen providers" />
              </div>
              {audience.orgs === "status" && (
                <select value={audience.status ?? "needs_attention"} onChange={(e) => setAudience({ ...audience, status: e.target.value as StatusFilter })} className={`${inputClass} h-11`} aria-label="Account status">
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              {audience.orgs === "selected" && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cc-muted" />
                    <input value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} placeholder="Find a provider" className={`${inputClass} h-11 pl-10`} aria-label="Find a provider" />
                  </div>
                  <ul className="max-h-64 divide-y divide-cc-border overflow-y-auto rounded-xl border border-cc-border">
                    {shownOrgs.map((o) => (
                      <li key={o.organization_id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2">
                          <input type="checkbox" className="h-4 w-4 accent-cc-plum" checked={audience.org_ids.includes(o.organization_id)}
                            onChange={() => setAudience({ ...audience, org_ids: toggle(audience.org_ids, o.organization_id) })} />
                          <span className="min-w-0 flex-1 truncate text-sm text-cc-text">{o.display_name}</span>
                          <span className="shrink-0 text-xs text-cc-muted">{o.billing_label}</span>
                        </label>
                      </li>
                    ))}
                    {shownOrgs.length === 0 && <li className="px-3.5 py-3 text-sm text-cc-muted">No providers match.</li>}
                  </ul>
                  <p className="text-xs text-cc-muted">{audience.org_ids.length} chosen</p>
                </div>
              )}
              <div className="space-y-2">
                <span className="text-sm font-semibold text-cc-text">People at each provider</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {ROLE_OPTIONS.map((r) => (
                    <Choice key={r.value} type="checkbox" checked={audience.roles.includes(r.value)}
                      onChange={() => setAudience({ ...audience, roles: toggle(audience.roles, r.value) })} title={r.label} />
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* Preview: beside the form on desktop, after it on phones */}
          <aside className="space-y-4 lg:sticky lg:top-6">
            <section className="space-y-3 rounded-2xl bg-cc-surface p-4 shadow-[var(--cc-shadow-sm)] sm:p-5" aria-label="Preview">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-cc-text">Preview</h2>
                {previewing && <Loader2 size={15} className="animate-spin text-cc-muted" />}
              </div>
              {!ready ? (
                <p className="text-sm text-cc-muted">
                  {unfilled.length > 0
                    ? `Fill in ${unfilled.map((t) => `{${t}}`).join(", ")} to see the preview.`
                    : "Add a subject, a message and who it's for to see who it reaches."}
                </p>
              ) : previewError ? (
                <p className="text-sm" style={{ color: "var(--cc-status-danger)" }}>{previewError}</p>
              ) : preview ? (
                <>
                  <p className="text-sm text-cc-text">
                    <span className="text-2xl font-bold tabular-nums">{preview.recipient_count}</span>{" "}
                    {preview.recipient_count === 1 ? "person" : "people"} at {preview.org_count} {preview.org_count === 1 ? "provider" : "providers"}
                  </p>
                  <ul className="space-y-1 text-sm text-cc-muted">
                    {draft.channels.includes("email") && <li className="flex items-center gap-2"><Mail size={14} /> {preview.will_email} emailed</li>}
                    {draft.channels.includes("in_app") && <li className="flex items-center gap-2"><Bell size={14} /> {preview.recipient_count} see it in CareCliQ</li>}
                    {preview.opted_out > 0 && <li>{preview.opted_out} unsubscribed from news, so not emailed</li>}
                  </ul>
                  {preview.organizations.length > 0 && (
                    <p className="text-xs leading-relaxed text-cc-muted">
                      {preview.organizations.slice(0, 8).join(", ")}{preview.org_count > 8 ? ` and ${preview.org_count - 8} more` : ""}
                    </p>
                  )}
                  {emailOff && (
                    <p className="flex gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: "var(--cc-status-warning-bg)", color: "var(--cc-text)" }}>
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-warning)" }} />
                      Email isn't sending from this server: {preview.email_delivery.message}
                    </p>
                  )}
                  <div className="rounded-xl border border-cc-border p-3.5">
                    <p className="text-xs text-cc-muted">To {preview.sample.to || "a director"} at {preview.sample.organisation}</p>
                    <p className="mt-1 text-sm font-semibold text-cc-text">{preview.sample.subject}</p>
                    <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-cc-text">{preview.sample.text}</p>
                  </div>
                </>
              ) : (
                <div className="h-24 animate-pulse rounded-xl bg-cc-soft" />
              )}
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void test()} disabled={!ready || busy !== null || !draft.channels.includes("email")} className={ghostClass}>
                {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Send me a test
              </button>
              <button type="button" onClick={() => void send()} disabled={!ready || !preview || preview.recipient_count === 0 || busy !== null} className={`${ctaClass} flex-1 sm:flex-none`}>
                {busy === "send" ? <Loader2 size={15} className="animate-spin" /> : confirming ? <Check size={15} /> : <Send size={15} />}
                {confirming ? `Confirm: send to ${preview?.recipient_count ?? 0}` : "Send"}
              </button>
            </div>
            {confirming && <p className="text-xs text-cc-muted">This can't be unsent. Press again to send.</p>}
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
