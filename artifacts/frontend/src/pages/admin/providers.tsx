import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Activity, AlertTriangle, Building2, CreditCard, HeartHandshake, Search, User, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAdminOrganizations, type AdminOrgSummary, type OrgType } from "@/services/adminService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";
const SLATE = "#5B655F";
// CareCliQ has no blue token (see AdminShell/dashboard notes elsewhere) — the
// reference design's blue accents map to the brand's coral instead, kept
// distinct from the plum used for the company avatar and users count.
const TRIAL = "var(--cc-coral)";
// The list endpoint only returns a user_count, not individual staff with
// photos, so the stacked circles are generic placeholders, not real
// avatars — alternated across these two tints for a little visual
// variety instead of one flat repeated color.
const AVATAR_TINTS = ["var(--cc-plum-soft)", "var(--cc-coral-soft)"];
const AVATAR_STACK_MAX = 3;

// "Trial" isn't a real status field yet — derived from plan_tier being
// unset, per the product call (2026-09-02): a provider with no plan tier
// is still on trial; picking a tier (even "micro") makes them Active.
// Suspended/offboarded still win over that since access being cut off
// matters more than billing state. Split into a key (for filtering) and a
// style lookup (for display) so the row badge and the Status filter can't
// drift out of sync with each other.
type ProviderStatusKey = "active" | "trial" | "suspended" | "offboarded";

function getProviderStatusKey(org: AdminOrgSummary): ProviderStatusKey {
  if (org.status === "suspended") return "suspended";
  if (org.status === "offboarded") return "offboarded";
  if (!org.plan_tier) return "trial";
  return "active";
}

const PROVIDER_STATUS_STYLE: Record<ProviderStatusKey, { label: string; color: string }> = {
  active: { label: "Active", color: GREEN },
  trial: { label: "On Trial", color: TRIAL },
  suspended: { label: "Suspended", color: AMBER },
  offboarded: { label: "Offboarded", color: SLATE },
};

// Matches stripe_service.PLAN_TIERS / platform-billing.tsx — migration
// 159_platform_subscription.sql renamed the old starter/growth/enterprise
// tiers to these; this filter had drifted and never actually matched a
// real organisation's plan_tier value.
const PLAN_FILTER_OPTIONS = [
  { value: "micro", label: "Micro" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
];

// Only the three statuses asked for are selectable filters — "offboarded"
// providers still show up under "All statuses", just without a dedicated
// filter option of their own.
const STATUS_FILTER_OPTIONS: { value: ProviderStatusKey; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "trial", label: "On Trial" },
  { value: "suspended", label: "Suspended" },
];

const ORG_TYPE_LABEL: Record<OrgType, string> = {
  aged_care: "Aged Care",
  disability: "Disability",
  aged_care_disability: "Aged Care & Disability",
};
const ORG_TYPE_FILTER_OPTIONS: OrgType[] = ["aged_care", "disability", "aged_care_disability"];

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl p-6" style={{ background: "var(--cc-plum-soft)" 
     }}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-2 text-6xl font-black" style={{ color: PLUM }}>{value}</p>
    </div>
  );
}

export default function AdminProvidersPage() {
  const [, navigate] = useLocation();
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ProviderStatusKey>("all");
  const [orgTypeFilter, setOrgTypeFilter] = useState<"all" | OrgType>("all");

  // No dummy-data fallback — a real fetch failure needs to read as a real
  // failure (see loadError below), not silently show fabricated providers
  // that could be mistaken for actual customers.
  useEffect(() => {
    let cancelled = false;
    listAdminOrganizations()
      .then((data) => { if (!cancelled) setOrgs(data); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load providers.");
        setOrgs([]);
      });
    return () => { cancelled = true; };
  }, []);

  const trialCount = orgs?.filter((o) => !o.plan_tier).length ?? 0;
  const activeCount = orgs?.filter((o) => o.plan_tier && o.status === "active").length ?? 0;

  const q = search.trim().toLowerCase();
  const visibleOrgs = orgs?.filter((o) => {
    const matchesSearch =
      !q ||
      o.display_name.toLowerCase().includes(q) ||
      (o.provider_type || "").toLowerCase().includes(q) ||
      o.organization_id.toLowerCase().includes(q);
    const matchesPlan = planFilter === "all" || o.plan_tier === planFilter;
    const matchesStatus = statusFilter === "all" || getProviderStatusKey(o) === statusFilter;
    const matchesOrgType = orgTypeFilter === "all" || o.org_type === orgTypeFilter;
    return matchesSearch && matchesPlan && matchesStatus && matchesOrgType;
  }) ?? null;

  const hasActiveFilters = Boolean(search) || planFilter !== "all" || statusFilter !== "all" || orgTypeFilter !== "all";
  function clearFilters() {
    setSearch("");
    setPlanFilter("all");
    setStatusFilter("all");
    setOrgTypeFilter("all");
  }


  const ROW_GRID = "grid-cols-[1.1fr_1.6fr_0.9fr_1.1fr_1fr_110px]";

  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Providers</h1>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total providers" value={orgs === null ? "—" : orgs.length} />
          <StatCard label="Trial providers" value={orgs === null ? "—" : trialCount} />
          <StatCard label="Active providers" value={orgs === null ? "—" : activeCount} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center" style={{ borderColor: BORDER, background: SURFACE }}>
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or Org ID"
              className="h-11 rounded-xl border-0 pl-11 text-[13px] shadow-none focus-visible:ring-1"
              style={{ background: SOFT }}
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5">
                <X size={14} style={{ color: MUTED }} />
              </button>
            )}
          </div>

          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[160px]" style={{ background: SOFT }}>
              <CreditCard size={14} className="mr-1.5" style={{ color: MUTED }} />
              <SelectValue placeholder="All plans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {PLAN_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | ProviderStatusKey)}>
            <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[160px]" style={{ background: SOFT }}>
              <Activity size={14} className="mr-1.5" style={{ color: MUTED }} />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Status</SelectItem>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={orgTypeFilter} onValueChange={(v) => setOrgTypeFilter(v as "all" | OrgType)}>
            <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[190px]" style={{ background: SOFT }}>
              <HeartHandshake size={14} className="mr-1.5" style={{ color: MUTED }} />
              <SelectValue placeholder="Org Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Org Type</SelectItem>
              {ORG_TYPE_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>{ORG_TYPE_LABEL[opt]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-[11px] font-bold hover:bg-black/5"
              style={{ color: MUTED }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* The header row is always visible, even while loading or on
            error — a Super Admin should still recognise this as the
            Providers directory rather than stare at a bare error card
            that could belong to any page. Only the body below it (rows,
            skeleton, error, empty state) varies. */}
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
          <div className={`grid ${ROW_GRID} gap-4 px-5 py-3 text-[10px] font-black uppercase tracking-wide`} style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
            <span>Org ID</span>
            <span>Company</span>
            <span>Status</span>
            <span>Org Type</span>
            <span>Subscription Type</span>
            <span className="text-right">Users</span>
          </div>

          {orgs === null ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: SOFT }} />)}
            </div>
          ) : loadError ? (
            <div className="p-10 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "#FBF2E6" }}>
                <AlertTriangle size={20} style={{ color: AMBER }} />
              </span>
              <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Couldn't load providers</p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>{loadError}</p>
            </div>
          ) : orgs.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[13px] font-black" style={{ color: TEXT }}>No providers yet.</p>
            </div>
          ) : visibleOrgs && visibleOrgs.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[13px] font-black" style={{ color: TEXT }}>No providers match these filters.</p>
            </div>
          ) : (
            (visibleOrgs ?? []).map((org, i) => {
              const st = PROVIDER_STATUS_STYLE[getProviderStatusKey(org)];
              return (
                <div
                  key={org.organization_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/admin/organizations/${org.organization_id}`)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    navigate(`/admin/organizations/${org.organization_id}`);
                  }}
                  className={`grid w-full cursor-pointer ${ROW_GRID} items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-cc-soft`}
                  style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : undefined }}
                >
                  <span className="truncate font-mono text-[11px]" style={{ color: MUTED }}>{org.organization_id}</span>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                      <Building2 size={15} style={{ color: PLUM }} />
                    </span>
                    <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{org.display_name}</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: st.color }}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.color }} />
                    {st.label}
                  </span>
                  {org.org_type ? (
                    <span
                      className="w-fit truncate rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{ background: "var(--cc-plum-soft)", color: PLUM }}
                    >
                      {ORG_TYPE_LABEL[org.org_type]}
                    </span>
                  ) : (
                    <span className="text-[12px] font-medium" style={{ color: MUTED }}>—</span>
                  )}
                  <span className="truncate text-[12px] font-semibold capitalize" style={{ color: TEXT }}>
                    {org.plan_tier ? `${org.plan_tier} plan` : "Trial"}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center">
                    <span className="flex -space-x-2">
                      {Array.from({ length: Math.min(org.user_count, AVATAR_STACK_MAX) }).map((_, avatarIdx) => (
                        <span
                          key={avatarIdx}
                          className="flex h-7 w-7 items-center justify-center rounded-full border-2"
                          style={{ background: AVATAR_TINTS[avatarIdx % AVATAR_TINTS.length], borderColor: SURFACE }}
                        >
                          <User size={11} style={{ color: MUTED }} />
                        </span>
                      ))}
                    </span>
                    <span
                      className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
                      style={{ background: SOFT, color: TEXT }}
                    >
                      {org.user_count}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </AdminShell>
  );
}
