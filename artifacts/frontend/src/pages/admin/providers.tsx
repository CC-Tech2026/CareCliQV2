import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Building2, ChevronRight, Plus, Search, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PLAN_LABEL, SEVERITY, timeAgo } from "@/components/admin/adminFormat";
import { ctaClass } from "@/components/layout/PageKit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAdminOrganizations, type AdminOrgSummary, type OrgType } from "@/services/adminService";

// Access state first (suspended/offboarded), then billing: a provider on a
// Stripe trial, or with no plan and no subscription yet, is "On trial".
type ProviderStatusKey = "active" | "trial" | "suspended" | "offboarded";

function getProviderStatusKey(org: AdminOrgSummary): ProviderStatusKey {
  if (org.status === "suspended") return "suspended";
  if (org.status === "offboarded") return "offboarded";
  if (org.subscription_status === "trialing") return "trial";
  if (!org.plan_tier && !org.subscription_status) return "trial";
  return "active";
}

const STATUS_STYLE: Record<ProviderStatusKey, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--cc-status-success)" },
  trial: { label: "On trial", color: "var(--cc-status-info)" },
  suspended: { label: "Suspended", color: "var(--cc-status-warning)" },
  offboarded: { label: "Offboarded", color: "var(--cc-muted)" },
};

const ORG_TYPE_LABEL: Record<OrgType, string> = {
  aged_care: "Aged care",
  disability: "Disability",
  aged_care_disability: "Aged care & disability",
};

type StatusFilter = "all" | "attention" | ProviderStatusKey;

const triggerClass = "h-11 w-full rounded-full border-cc-border bg-cc-surface text-sm shadow-none sm:w-44";

function StatusDot({ org }: { org: AdminOrgSummary }) {
  const st = STATUS_STYLE[getProviderStatusKey(org)];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: st.color }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.color }} />
      {st.label}
    </span>
  );
}

function AttentionChip({ org }: { org: AdminOrgSummary }) {
  const items = org.attention ?? [];
  if (!items.length) return null;
  const sev = SEVERITY[items[0].severity];
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: sev.bg, color: sev.color }} title={items.map((i) => i.title).join(", ")}>
      {items.length} to check
    </span>
  );
}

export default function AdminProvidersPage() {
  const [, navigate] = useLocation();
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [orgTypeFilter, setOrgTypeFilter] = useState<"all" | OrgType>("all");

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

  const trialCount = orgs?.filter((o) => getProviderStatusKey(o) === "trial").length ?? 0;
  const attentionCount = orgs?.filter((o) => (o.attention?.length ?? 0) > 0).length ?? 0;

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (orgs ?? []).filter((o) => {
        const matchesSearch = !q || o.display_name.toLowerCase().includes(q) || o.organization_id.toLowerCase().includes(q);
        const matchesPlan = planFilter === "all" || o.plan_tier === planFilter;
        const matchesStatus =
          statusFilter === "all" || (statusFilter === "attention" ? (o.attention?.length ?? 0) > 0 : getProviderStatusKey(o) === statusFilter);
        const matchesType = orgTypeFilter === "all" || o.org_type === orgTypeFilter;
        return matchesSearch && matchesPlan && matchesStatus && matchesType;
      }),
    [orgs, q, planFilter, statusFilter, orgTypeFilter],
  );

  const filtered = Boolean(search) || planFilter !== "all" || statusFilter !== "all" || orgTypeFilter !== "all";
  const open = (id: string) => navigate(`/admin/organizations/${id}`);

  return (
    <AdminShell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>Providers</h1>
            {orgs !== null && !loadError && (
              <p className="mt-1 text-sm text-cc-muted">
                {orgs.length} {orgs.length === 1 ? "provider" : "providers"} · {trialCount} on trial
                {attentionCount > 0 && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => setStatusFilter("attention")} className="font-semibold text-cc-plum underline-offset-2 hover:underline">
                      {attentionCount} need a look
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
          <button type="button" onClick={() => navigate("/admin/onboarding")} className={ctaClass}>
            <Plus size={16} aria-hidden="true" /> New provider
          </button>
        </header>

        {/* Search and filters: stacked on phones, one row from tablet up */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 sm:flex-1 sm:basis-64">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cc-muted" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or org ID"
              aria-label="Search providers"
              className="h-11 md:h-9 w-full rounded-full border border-cc-border bg-cc-surface pl-11 pr-10 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-cc-soft" aria-label="Clear search">
                <X size={14} className="text-cc-muted" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className={triggerClass} aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="attention">Needs attention</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="trial">On trial</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className={triggerClass} aria-label="Plan"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any plan</SelectItem>
                {Object.entries(PLAN_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={orgTypeFilter} onValueChange={(v) => setOrgTypeFilter(v as "all" | OrgType)}>
              <SelectTrigger className={`${triggerClass} col-span-2 sm:col-span-1`} aria-label="Org type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any org type</SelectItem>
                {(Object.keys(ORG_TYPE_LABEL) as OrgType[]).map((t) => <SelectItem key={t} value={t}>{ORG_TYPE_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
            {filtered && (
              <button
                type="button"
                onClick={() => { setSearch(""); setPlanFilter("all"); setStatusFilter("all"); setOrgTypeFilter("all"); }}
                className="col-span-2 inline-flex h-11 md:h-9 items-center justify-center gap-1 rounded-full px-4 text-sm font-semibold text-cc-muted hover:bg-cc-soft sm:col-span-1"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>

        <section aria-label="Provider list" className="overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
          {/* Column heads, tablet and up */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_88px] gap-4 border-b border-cc-border px-5 py-3 text-xs font-semibold text-cc-muted md:grid">
            <span>Provider</span>
            <span>Status</span>
            <span>Billing</span>
            <span>Last sign-in</span>
            <span className="text-right">People</span>
          </div>

          {orgs === null ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-cc-soft" />)}</div>
          ) : loadError ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <AlertTriangle size={22} style={{ color: "var(--cc-status-warning)" }} />
              <p className="text-sm font-semibold text-cc-text">Couldn't load providers</p>
              <p className="max-w-sm text-sm text-cc-muted">{loadError}</p>
              <button type="button" onClick={load} className="min-h-10 rounded-full border border-cc-border px-4 text-sm font-semibold">Try again</button>
            </div>
          ) : visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-cc-muted">{orgs.length === 0 ? "No providers yet." : "No providers match these filters."}</p>
          ) : (
            <ul className="divide-y divide-cc-border">
              {visible.map((org) => {
                const people = org.active_user_count ?? org.user_count;
                const plan = org.plan_tier ? PLAN_LABEL[org.plan_tier] ?? org.plan_tier : "No plan";
                return (
                  <li key={org.organization_id}>
                    <button
                      type="button"
                      onClick={() => open(org.organization_id)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3.5 text-left transition-colors hover:bg-cc-soft sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_88px] md:gap-4"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]">
                          <Building2 size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-semibold text-cc-text">{org.display_name}</span>
                            <AttentionChip org={org} />
                          </span>
                          {/* Phone summary line; tablet up shows these as columns */}
                          <span className="block truncate text-xs text-cc-muted md:hidden">
                            {STATUS_STYLE[getProviderStatusKey(org)].label} · {plan} · {people} people
                          </span>
                          {org.org_type && <span className="hidden truncate text-xs text-cc-muted md:block">{ORG_TYPE_LABEL[org.org_type]}</span>}
                        </span>
                      </span>
                      <ChevronRight size={16} className="text-cc-muted md:hidden" aria-hidden="true" />
                      <span className="hidden md:block"><StatusDot org={org} /></span>
                      <span className="hidden min-w-0 md:block">
                        <span className="block truncate text-sm text-cc-text">{plan}</span>
                        <span className="block truncate text-xs text-cc-muted" title={org.billing_label}>{org.billing_label ?? ""}</span>
                      </span>
                      <span className="hidden text-sm text-cc-muted md:block">{timeAgo(org.last_sign_in_at)}</span>
                      <span className="hidden text-right text-sm font-semibold tabular-nums text-cc-text md:block">{people}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
