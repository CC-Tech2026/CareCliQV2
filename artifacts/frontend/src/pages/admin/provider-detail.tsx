import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useParams } from "wouter";
import {
  AlertTriangle, ArrowLeft, CalendarPlus, Copy, CreditCard, ExternalLink, FileUp, Gift,
  KeyRound, Loader2, Mail, MoreHorizontal, ShieldAlert, ShieldCheck, UserCog, UserX, UserCheck,
} from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PLAN_LABEL, PLANS_ON_SALE, SEVERITY, activityLabel, formatDate, roleLabel, timeAgo } from "@/components/admin/adminFormat";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  activateAdminOrganization, changeAdminUserRole, deactivateAdminUser, discardAdminHeldStaff, extendAdminTrial,
  getAdminOrganization, reactivateAdminUser, sendAdminPasswordReset, suspendAdminOrganization,
  updateAdminOrganizationType, updateAdminSubscription,
  type AdminOrgDetail, type AdminOrgUser, type OrgType,
} from "@/services/adminService";

const ORG_TYPE_LABEL: Record<OrgType, string> = {
  aged_care: "Aged Care",
  disability: "Disability",
  aged_care_disability: "Aged Care & Disability",
};
const ORG_TYPE_OPTIONS: OrgType[] = ["aged_care", "disability", "aged_care_disability"];

const STATUS_CHIP = {
  active: { label: "Active", color: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" },
  suspended: { label: "Suspended", color: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)" },
  offboarded: { label: "Offboarded", color: "var(--cc-muted)", bg: "var(--cc-soft)" },
};

const inputClass =
  "h-11 md:h-9 w-full rounded-xl border border-cc-border bg-cc-surface px-3.5 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum";

/** What the open side panel is doing. Every change asks for a reason, which
 *  goes in the account's activity log. */
type Panel =
  | { kind: "plan" }
  | { kind: "free_access" }
  | { kind: "trial" }
  | { kind: "deactivate"; user: AdminOrgUser }
  | { kind: "reactivate"; user: AdminOrgUser }
  | { kind: "role"; user: AdminOrgUser }
  | { kind: "suspend" }
  | null;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-cc-text">{label}</span>
      {children}
      {hint && <span className="block text-xs leading-snug text-cc-muted">{hint}</span>}
    </label>
  );
}

function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
      <span className="w-full shrink-0 text-xs font-semibold text-cc-muted sm:w-36 sm:text-sm sm:font-normal">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-cc-text">{value}</span>
      {action}
    </li>
  );
}

function SectionTitle({ title, info, action }: { title: string; info?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-cc-text">{title}</h2>
        {info && <p className="text-sm text-cc-muted">{info}</p>}
      </div>
      {action}
    </div>
  );
}

function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function AdminProviderDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [org, setOrg] = useState<AdminOrgDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);

  // Panel form state
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<"small" | "medium">("small");
  const [until, setUntil] = useState(addDaysIso(30));
  const [trialDays, setTrialDays] = useState(14);
  const [newRole, setNewRole] = useState<"support_worker" | "support_coordinator">("support_worker");

  function load() {
    setLoadError(null);
    getAdminOrganization(organizationId)
      // Defaults keep the page working against an API that doesn't send
      // these lists yet (e.g. production before its next deploy).
      .then((o) => setOrg({
        ...o,
        users: o.users ?? [],
        pending_invitations: o.pending_invitations ?? [],
        held_staff: o.held_staff ?? [],
        admin_activity: o.admin_activity ?? [],
        billing_label: o.billing_label ?? (o.plan_tier ? "" : "No plan yet"),
      }))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load this provider."));
  }
  useEffect(load, [organizationId]);

  function open(next: Panel) {
    setReason("");
    if (next?.kind === "plan") setPlan(org?.plan_tier === "medium" ? "medium" : "small");
    if (next?.kind === "free_access") {
      const current = org?.access_override_until ? new Date(org.access_override_until) : null;
      setUntil(current && current > new Date() ? current.toISOString().slice(0, 10) : addDaysIso(30));
    }
    if (next?.kind === "trial") setTrialDays(14);
    if (next?.kind === "role") setNewRole(next.user.role === "support_worker" ? "support_coordinator" : "support_worker");
    setPanel(next);
  }

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: done });
      setPanel(null);
      load();
    } catch (err) {
      toast({ title: "That didn't go through", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleOrgType(value: OrgType) {
    setOrg((prev) => (prev ? { ...prev, org_type: value } : prev));
    try {
      await updateAdminOrganizationType(organizationId, value);
    } catch (err) {
      toast({ title: "Couldn't update org type", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
      load();
    }
  }

  const reasonOk = reason.trim().length >= 3;
  const overrideActive = Boolean(org?.access_override_until && new Date(org.access_override_until) > new Date());
  const directors = org?.users.filter((u) => u.role === "managing_director") ?? [];

  // ---- Panels --------------------------------------------------------------
  const reasonField = (
    <Field label="Reason" hint="Saved in this account's activity log.">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-cc-border bg-cc-surface px-3.5 py-2.5 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum"
        placeholder="e.g. Agreed on the call with their director"
      />
    </Field>
  );

  const panelSpec: { title: string; icon: typeof CreditCard; description: string; body: ReactNode; submit: ReactNode } | null =
    !org || !panel ? null
    : panel.kind === "plan" ? {
        title: "Change plan", icon: CreditCard,
        description: `Sets the plan CareCliQ shows and uses for limits. It doesn't change what Stripe charges; change the price in Stripe if that needs to move too.${org.plan_tier === "micro" ? " They're on Micro, which is no longer sold; once moved they can't go back to it." : ""}`,
        body: (
          <>
            <Field label="Plan">
              <select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} className={inputClass}>
                {PLANS_ON_SALE.map((p) => <option key={p.tier} value={p.tier}>{p.label}</option>)}
              </select>
            </Field>
            {reasonField}
          </>
        ),
        submit: (
          <button type="button" className={ctaClass} disabled={busy || !reasonOk || plan === org.plan_tier}
            onClick={() => run(() => updateAdminSubscription(organizationId, { plan_tier: plan, reason }), "Plan updated")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Save plan
          </button>
        ),
      }
    : panel.kind === "free_access" ? {
        title: overrideActive ? "Change free access" : "Give free access", icon: Gift,
        description: "Everything keeps working until this date, whatever their Stripe subscription says: for pilots, goodwill, or while a billing problem is sorted. Nothing is charged or refunded.",
        body: (
          <>
            <Field label="Free until" hint="Up to a year ahead. A warning shows here a week before it ends.">
              <input type="date" value={until} min={addDaysIso(1)} max={addDaysIso(365)} onChange={(e) => setUntil(e.target.value)} className={inputClass} />
            </Field>
            {reasonField}
          </>
        ),
        submit: (
          <>
            {overrideActive && (
              <button type="button" className={ghostClass} disabled={busy || !reasonOk}
                onClick={() => run(() => updateAdminSubscription(organizationId, { access_override_until: "", reason }), "Free access ended")}>
                End free access now
              </button>
            )}
            <button type="button" className={ctaClass} disabled={busy || !reasonOk || !until}
              onClick={() => run(
                () => updateAdminSubscription(organizationId, { access_override_until: until, access_override_reason: reason, reason }),
                `Free access until ${formatDate(until)}`,
              )}>
              {busy && <Loader2 size={15} className="animate-spin" />} Save
            </button>
          </>
        ),
      }
    : panel.kind === "trial" ? {
        title: "Extend trial", icon: CalendarPlus,
        description: `Moves the trial end in Stripe, so their card isn't charged until the new date. Currently ends ${formatDate(org.trial_ends_at) || "soon"}.`,
        body: (
          <>
            <Field label="Extra days" hint="1 to 60 days, counted from the current trial end.">
              <input type="number" min={1} max={60} value={trialDays}
                onChange={(e) => setTrialDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className={inputClass} />
            </Field>
            {reasonField}
          </>
        ),
        submit: (
          <button type="button" className={ctaClass} disabled={busy || !reasonOk}
            onClick={() => run(() => extendAdminTrial(organizationId, trialDays, reason), `Trial extended by ${trialDays} days`)}>
            {busy && <Loader2 size={15} className="animate-spin" />} Extend trial
          </button>
        ),
      }
    : panel.kind === "deactivate" ? {
        title: `Deactivate ${panel.user.full_name || panel.user.email}`, icon: UserX,
        description: "They're signed out everywhere straight away and can't sign in until reactivated. Their records stay.",
        body: reasonField,
        submit: (
          <button type="button" className={ctaClass} disabled={busy || !reasonOk}
            onClick={() => run(() => deactivateAdminUser(organizationId, panel.user.id, reason), "Account deactivated")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Deactivate
          </button>
        ),
      }
    : panel.kind === "reactivate" ? {
        title: `Reactivate ${panel.user.full_name || panel.user.email}`, icon: UserCheck,
        description: "They can sign in again with their existing password.",
        body: reasonField,
        submit: (
          <button type="button" className={ctaClass} disabled={busy || !reasonOk}
            onClick={() => run(() => reactivateAdminUser(organizationId, panel.user.id, reason), "Account reactivated")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Reactivate
          </button>
        ),
      }
    : panel.kind === "role" ? {
        title: `Change role for ${panel.user.full_name || panel.user.email}`, icon: UserCog,
        description: "They're signed out so the new permissions apply when they sign back in.",
        body: (
          <>
            <Field label="New role">
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)} className={inputClass}>
                <option value="support_worker">Support worker</option>
                <option value="support_coordinator">Coordinator</option>
              </select>
            </Field>
            {reasonField}
          </>
        ),
        submit: (
          <button type="button" className={ctaClass} disabled={busy || !reasonOk || newRole === panel.user.role}
            onClick={() => run(() => changeAdminUserRole(organizationId, panel.user.id, newRole, reason), "Role changed")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Change role
          </button>
        ),
      }
    : {
        title: `Suspend ${org.display_name}`, icon: ShieldAlert,
        description: `All ${org.user_count} people are signed out now and can't sign in until you reactivate the organisation. Nothing is deleted.`,
        body: null,
        submit: (
          <button type="button" className={ctaClass} disabled={busy}
            onClick={() => run(() => suspendAdminOrganization(organizationId), "Organisation suspended")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Suspend access
          </button>
        ),
      };

  // ---- Page ----------------------------------------------------------------
  return (
    <AdminShell>
      <div className="space-y-6 pb-12">
        <button type="button" onClick={() => navigate("/admin/organizations")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-cc-muted">
          <ArrowLeft size={14} /> All providers
        </button>

        {org === null && loadError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4" style={{ background: "var(--cc-status-warning-bg)" }}>
            <AlertTriangle size={16} style={{ color: "var(--cc-status-warning)" }} />
            <p className="flex-1 text-sm font-semibold text-cc-text">Couldn't load this provider: {loadError}</p>
            <button type="button" onClick={load} className={outlineClass}>Try again</button>
          </div>
        )}
        {org === null && !loadError && (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-cc-surface" />)}</div>
        )}

        {org && (
          <>
            {/* Header */}
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>{org.display_name}</h1>
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: STATUS_CHIP[org.status].bg, color: STATUS_CHIP[org.status].color }}>
                    {STATUS_CHIP[org.status].label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-cc-muted">
                  {org.billing_label}{org.plan_tier ? ` · ${PLAN_LABEL[org.plan_tier] ?? org.plan_tier} plan` : ""} · {org.active_user_count ?? org.user_count} active people · {org.participant_count ?? 0} participants · last sign-in {timeAgo(org.last_sign_in_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={ctaClass} onClick={() => navigate(`/admin/organizations/${organizationId}/import`)}>
                  <FileUp size={15} /> Bring their data across
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={outlineClass} aria-label="More actions"><MoreHorizontal size={16} /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {org.stripe_customer_id && (
                      <DropdownMenuItem onSelect={() => window.open(`https://dashboard.stripe.com/customers/${org.stripe_customer_id}`, "_blank", "noopener")}>
                        <ExternalLink size={14} className="mr-2" /> Open in Stripe
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => navigate(`/admin/messages/new?org=${organizationId}`)}>
                      <Mail size={14} className="mr-2" /> Email this provider
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { void navigator.clipboard?.writeText(organizationId); toast({ title: "Org ID copied" }); }}>
                      <Copy size={14} className="mr-2" /> Copy org ID
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {org.status === "active" ? (
                      <DropdownMenuItem onSelect={() => open({ kind: "suspend" })} style={{ color: "var(--cc-status-danger)" }}>
                        <ShieldAlert size={14} className="mr-2" /> Suspend access
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => run(() => activateAdminOrganization(organizationId), "Organisation reactivated")}>
                        <ShieldCheck size={14} className="mr-2" /> Reactivate
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            {/* What needs looking at */}
            {(org.attention?.length ?? 0) > 0 && (
              <ul className="space-y-2" aria-label="Needs attention">
                {org.attention!.map((a) => (
                  <li key={a.code} className="flex flex-wrap items-start gap-3 rounded-2xl px-5 py-3.5" style={{ background: SEVERITY[a.severity].bg }}>
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: SEVERITY[a.severity].color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-cc-text">{a.title}</p>
                      <p className="text-sm text-cc-muted">{a.detail} <span className="text-cc-text">{a.action}.</span></p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Subscription */}
            <section className="space-y-3" aria-label="Subscription">
              <SectionTitle title="Subscription" info="CareCliQ-side settings. Prices, refunds and cancellations are done in Stripe." />
              <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
                <Row
                  label="Plan"
                  value={org.plan_tier ? PLAN_LABEL[org.plan_tier] ?? org.plan_tier : "Not chosen"}
                  action={<button type="button" className={outlineClass} onClick={() => open({ kind: "plan" })}>Change</button>}
                />
                <Row
                  label="Billing"
                  value={
                    <>
                      {org.billing_label}
                      {org.subscription_status && (org.stripe_customer_id || org.stripe_subscription_id) && (
                        <span className="text-cc-muted"> · Stripe status {org.subscription_status.replace(/_/g, " ")}</span>
                      )}
                      {org.access?.state === "grace" && <span className="text-cc-muted"> · read-only from {formatDate(org.access.grace_ends_at)}</span>}
                      {org.access?.state === "read_only" && <span style={{ color: "var(--cc-status-danger)" }}> · records are read-only</span>}
                    </>
                  }
                />
                {org.subscription_status === "trialing" && (
                  <Row
                    label="Trial ends"
                    value={formatDate(org.trial_ends_at) || "Unknown"}
                    action={<button type="button" className={outlineClass} onClick={() => open({ kind: "trial" })}>Extend</button>}
                  />
                )}
                <Row
                  label="Free access"
                  value={
                    overrideActive
                      ? <>Until {formatDate(org.access_override_until)}{org.access_override_reason && <span className="text-cc-muted"> · {org.access_override_reason}</span>}</>
                      : <span className="text-cc-muted">None</span>
                  }
                  action={<button type="button" className={outlineClass} onClick={() => open({ kind: "free_access" })}>{overrideActive ? "Change" : "Give"}</button>}
                />
                <Row
                  label="Org type"
                  value={
                    <Select value={org.org_type ?? undefined} onValueChange={(v) => void handleOrgType(v as OrgType)}>
                      <SelectTrigger className="h-10 w-full max-w-[240px] rounded-xl text-sm shadow-none"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        {ORG_TYPE_OPTIONS.map((o) => <SelectItem key={o} value={o}>{ORG_TYPE_LABEL[o]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  }
                />
              </ul>
            </section>

            {/* Team */}
            <section className="space-y-3" aria-label="Team">
              <SectionTitle title={`Team (${org.users.length})`} info="Their staff accounts. Password resets go by email; we never see or set passwords." />
              <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
                {org.users.length === 0 && <li className="px-5 py-4 text-sm text-cc-muted">No accounts yet.</li>}
                {org.users.map((u) => {
                  const inactive = u.is_active === false;
                  const onlyDirector = u.role === "managing_director" && directors.filter((d) => d.is_active !== false).length <= 1;
                  return (
                    <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="truncate text-sm font-semibold text-cc-text">
                          {u.full_name || u.email}
                          {inactive && <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "var(--cc-soft)", color: "var(--cc-muted)" }}>Deactivated</span>}
                        </p>
                        <p className="text-xs text-cc-muted">
                          <span className="block truncate sm:inline">{u.email}</span>
                          <span className="hidden sm:inline"> · </span>
                          <span className="block sm:inline">{roleLabel(u.role)} · last sign-in {timeAgo(u.last_login)}</span>
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className={ghostClass} aria-label={`Actions for ${u.full_name || u.email}`}><MoreHorizontal size={16} /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => run(() => sendAdminPasswordReset(organizationId, u.id), `Password reset sent to ${u.email}`)}>
                            <KeyRound size={14} className="mr-2" /> Send password reset
                          </DropdownMenuItem>
                          {(u.role === "support_worker" || u.role === "support_coordinator") && (
                            <DropdownMenuItem onSelect={() => open({ kind: "role", user: u })}>
                              <UserCog size={14} className="mr-2" /> Change role
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {inactive ? (
                            <DropdownMenuItem onSelect={() => open({ kind: "reactivate", user: u })}>
                              <UserCheck size={14} className="mr-2" /> Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem disabled={onlyDirector} onSelect={() => open({ kind: "deactivate", user: u })} style={{ color: onlyDirector ? undefined : "var(--cc-status-danger)" }}>
                              <UserX size={14} className="mr-2" /> {onlyDirector ? "Only director: suspend the org instead" : "Deactivate"}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Invitations */}
            {(org.held_staff.length > 0 || org.pending_invitations.length > 0) && (
              <section className="space-y-3" aria-label="Invitations">
                <SectionTitle
                  title="Invitations"
                  action={org.held_staff.length > 0 ? (
                    <button type="button" className={ghostClass} disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove the ${org.held_staff.length} invitations we prepared? Nobody has been emailed.`)) {
                          void run(() => discardAdminHeldStaff(organizationId), "Prepared invitations removed");
                        }
                      }}>
                      Remove prepared invitations
                    </button>
                  ) : undefined}
                />
                <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
                  {org.held_staff.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-cc-text">{h.full_name || h.email}</p>
                        <p className="truncate text-xs text-cc-muted">{h.email} · {roleLabel(h.role)}</p>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: "var(--cc-status-info)" }}>Waiting for their director to send</span>
                    </li>
                  ))}
                  {org.pending_invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-cc-text">{i.email}</p>
                        <p className="truncate text-xs text-cc-muted">{roleLabel(i.role)} · sent {timeAgo(i.created_at)}</p>
                      </div>
                      <span className="text-xs text-cc-muted">Expires {formatDate(i.expires_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Activity */}
            <section className="space-y-3" aria-label="What CareCliQ has done">
              <SectionTitle title="What we've done" info="Every change CareCliQ staff make to this account." />
              <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
                {org.admin_activity.length === 0 && <li className="px-5 py-4 text-sm text-cc-muted">Nothing yet.</li>}
                {org.admin_activity.map((a, i) => (
                  <li key={`${a.created_at}-${i}`} className="px-4 py-3 sm:px-5">
                    <p className="text-sm text-cc-text">{activityLabel(a)}</p>
                    <p className="text-xs text-cc-muted">
                      {a.actor_name} · {formatDate(a.created_at)}{a.details?.reason ? ` · "${a.details.reason}"` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>

      {panelSpec && (
        <SidePanel
          open={panel !== null}
          onOpenChange={(o) => { if (!o && !busy) setPanel(null); }}
          icon={panelSpec.icon}
          eyebrow={org?.display_name}
          title={panelSpec.title}
          description={panelSpec.description}
          footer={
            <>
              <button type="button" className={ghostClass} onClick={() => setPanel(null)} disabled={busy}>Cancel</button>
              {panelSpec.submit}
            </>
          }
        >
          {panelSpec.body}
        </SidePanel>
      )}
    </AdminShell>
  );
}
