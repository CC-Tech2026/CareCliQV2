import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { SEVERITY, timeAgo } from "@/components/admin/adminFormat";
import { useAuth } from "@/contexts/AuthContext";
import { listAdminOrganizations, type AdminOrgSummary, type AttentionItem } from "@/services/adminService";
import { getSystemStatus, type SystemStatus } from "@/services/adminMessagesService";

const TODAY_LABEL = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

type Flagged = AttentionItem & { org: AdminOrgSummary };

export default function AdminDashboardPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const firstName = (user?.full_name || "").trim().split(/\s+/)[0];

  // No dummy-data fallback: a failed fetch must read as a failure, never as
  // made-up providers that could be mistaken for real customers.
  function load() {
    setLoadError(null);
    listAdminOrganizations()
      .then(setOrgs)
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : "Could not load providers.");
        setOrgs([]);
      });
  }
  useEffect(load, []);
  useEffect(() => { getSystemStatus().then(setSystem).catch(() => {}); }, []);

  // Problems with the platform itself, ahead of any one provider's.
  const platformIssues: string[] = [];
  if (system && system.email.status !== "queued") platformIssues.push(`Email isn't sending: ${system.email.message}`);
  if (system?.database.checked && system.database.up_to_date === false) {
    platformIssues.push("The database is missing a migration. Deploy the API to apply it.");
  }

  const flagged = useMemo<Flagged[]>(() => {
    const items = (orgs ?? []).flatMap((org) => (org.attention ?? []).map((a) => ({ ...a, org })));
    return items.sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);
  }, [orgs]);

  const orgsNeedingUs = new Set(flagged.map((f) => f.org.organization_id)).size;
  const people = (orgs ?? []).reduce((sum, o) => sum + (o.active_user_count ?? o.user_count), 0);
  const recent = useMemo(
    () => [...(orgs ?? [])].sort((a, b) => (b.last_sign_in_at || "").localeCompare(a.last_sign_in_at || "")).slice(0, 8),
    [orgs],
  );

  return (
    <AdminShell>
      <div className="space-y-6">
        <header>
          <p className="text-xs font-semibold text-cc-muted">{TODAY_LABEL}</p>
          <h1 className="mt-0.5 text-xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>
            {firstName ? `Hello, ${firstName}` : "Hello"}
          </h1>
          <p className="mt-1 text-sm text-cc-muted">
            {orgs === null
              ? "Loading providers"
              : `${orgs.length} ${orgs.length === 1 ? "provider" : "providers"} · ${people} active accounts · ${
                  orgsNeedingUs === 0 ? "nothing needs you right now" : `${orgsNeedingUs} ${orgsNeedingUs === 1 ? "needs" : "need"} a look`
                }`}
          </p>
        </header>

        {loadError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4" style={{ background: "var(--cc-status-warning-bg)" }}>
            <AlertTriangle size={16} style={{ color: "var(--cc-status-warning)" }} />
            <p className="flex-1 text-sm font-semibold text-cc-text">Couldn't load providers: {loadError}</p>
            <button type="button" onClick={load} className="min-h-10 md:min-h-8 rounded-full border border-cc-border px-4 text-sm font-semibold">Try again</button>
          </div>
        )}

        <section aria-label="Needs attention" className="space-y-3">
          <h2 className="text-lg font-semibold text-cc-text">Needs attention</h2>
          {platformIssues.map((issue) => (
            <button
              key={issue}
              type="button"
              onClick={() => navigate("/admin/system")}
              className="flex w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-left sm:px-5"
              style={{ background: "var(--cc-status-danger-bg)" }}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-danger)" }} />
              <span className="min-w-0 flex-1 text-sm text-cc-text"><span className="font-semibold">CareCliQ platform</span> · {issue}</span>
              <ArrowRight size={15} className="mt-1 shrink-0 text-cc-muted" />
            </button>
          ))}
          {orgs === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-cc-surface" />)}</div>
          ) : flagged.length === 0 && !loadError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-cc-surface px-5 py-4">
              <CheckCircle2 size={18} style={{ color: "var(--cc-status-success)" }} />
              <p className="text-sm text-cc-text">Every provider is set up, paying or trialling, and signing in.</p>
            </div>
          ) : (
            <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
              {flagged.map((f) => (
                <li key={`${f.org.organization_id}-${f.code}`}>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/organizations/${f.org.organization_id}`)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left sm:px-5 transition-colors hover:bg-cc-soft"
                  >
                    <span
                      className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: SEVERITY[f.severity].bg, color: SEVERITY[f.severity].color }}
                    >
                      {SEVERITY[f.severity].label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-cc-text">
                        {f.org.display_name} <span className="font-normal text-cc-muted">· {f.title}</span>
                      </span>
                      <span className="block text-sm text-cc-muted">{f.detail} <span className="text-cc-text">{f.action}.</span></span>
                    </span>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-cc-muted" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recently active providers" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-cc-text">Recently active</h2>
            <button type="button" onClick={() => navigate("/admin/organizations")} className="inline-flex items-center gap-1 text-sm font-semibold text-cc-plum">
              All providers <ArrowRight size={14} />
            </button>
          </div>
          {orgs !== null && recent.length === 0 ? (
            <p className="rounded-2xl bg-cc-surface px-5 py-4 text-sm text-cc-muted">No providers yet.</p>
          ) : (
            <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
              {recent.map((o) => (
                <li key={o.organization_id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/organizations/${o.organization_id}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5 transition-colors hover:bg-cc-soft"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]">
                      <Building2 size={15} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-cc-text">{o.display_name}</span>
                      <span className="block truncate text-xs text-cc-muted">
                        {o.billing_label ?? "Unknown"} · {o.active_user_count ?? o.user_count} people · last sign-in {timeAgo(o.last_sign_in_at)}
                      </span>
                    </span>
                    {(o.attention?.length ?? 0) > 0 && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                        style={{ background: SEVERITY[o.attention![0].severity].bg, color: SEVERITY[o.attention![0].severity].color }}
                      >
                        {o.attention!.length} to check
                      </span>
                    )}
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
