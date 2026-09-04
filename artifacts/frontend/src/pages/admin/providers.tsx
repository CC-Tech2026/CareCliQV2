import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Activity, Building2, CreditCard, HeartHandshake, Search, User, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAdminOrganizations, type AdminOrgSummary } from "@/services/adminService";

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

// UI-only placeholder — the real API needs migrations 151/152 run before it
// works. Lets the portal be iterated on without the backend. Swap back to
// relying purely on listAdminOrganizations() once that's wired up.
// Harbourview deliberately has no plan_tier — the one dummy row that
// exercises the "On Trial" status below.
const DUMMY_ORGS: AdminOrgSummary[] = [
  { organization_id: "dummy-1", display_name: "Sunshine Disability Services", provider_type: "Disability", status: "active", plan_tier: "growth", team_size: "11-25", participant_volume: "26-50", created_at: "2026-06-02T00:00:00Z", user_count: 13 },
  { organization_id: "dummy-2", display_name: "Harbourview Aged Care", provider_type: "Aged Care", status: "active", plan_tier: null, team_size: "1-10", participant_volume: "1-25", created_at: "2026-07-14T00:00:00Z", user_count: 6 },
  { organization_id: "dummy-3", display_name: "Northside Community Support", provider_type: "Disability", status: "suspended", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", created_at: "2026-05-20T00:00:00Z", user_count: 4 },
  { organization_id: "dummy-4", display_name: "Coastal Care Collective", provider_type: "Aged Care & Disability", status: "active", plan_tier: "enterprise", team_size: "50+", participant_volume: "100+", created_at: "2026-03-11T00:00:00Z", user_count: 42 },
];

// "Trial" isn't a real status field yet — derived from plan_tier being
// unset, per the product call (2026-09-02): a provider with no plan tier
// is still on trial; picking a tier (even "starter") makes them Active.
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

const PLAN_FILTER_OPTIONS = [
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "enterprise", label: "Enterprise" },
];

// Only the three statuses asked for are selectable filters — "offboarded"
// providers still show up under "All statuses", just without a dedicated
// filter option of their own.
const STATUS_FILTER_OPTIONS: { value: ProviderStatusKey; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "trial", label: "On Trial" },
  { value: "suspended", label: "Suspended" },
];

const SERVICE_FILTER_OPTIONS = ["Aged Care", "Disability", "Aged Care & Disability"];

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
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ProviderStatusKey>("all");
  const [serviceFilter, setServiceFilter] = useState<"all" | string>("all");

  useEffect(() => {
    let cancelled = false;
    listAdminOrganizations()
      .then((data) => { if (!cancelled) setOrgs(data.length > 0 ? data : DUMMY_ORGS); })
      .catch(() => { if (!cancelled) setOrgs(DUMMY_ORGS); });
    return () => { cancelled = true; };
  }, []);

  const trialCount = orgs?.filter((o) => !o.plan_tier).length ?? 0;
  const activeCount = orgs?.filter((o) => o.plan_tier && o.status === "active").length ?? 0;

  const q = search.trim().toLowerCase();
  const visibleOrgs = orgs?.filter((o) => {
    const matchesSearch = !q || o.display_name.toLowerCase().includes(q) || (o.provider_type || "").toLowerCase().includes(q);
    const matchesPlan = planFilter === "all" || o.plan_tier === planFilter;
    const matchesStatus = statusFilter === "all" || getProviderStatusKey(o) === statusFilter;
    const matchesService = serviceFilter === "all" || o.provider_type === serviceFilter;
    return matchesSearch && matchesPlan && matchesStatus && matchesService;
  }) ?? null;

  const hasActiveFilters = Boolean(search) || planFilter !== "all" || statusFilter !== "all" || serviceFilter !== "all";
  function clearFilters() {
    setSearch("");
    setPlanFilter("all");
    setStatusFilter("all");
    setServiceFilter("all");
  }

  const ROW_GRID = "grid-cols-[2fr_1fr_1fr_140px]";

  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Providers</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>Every organisation using CareCliQ, across all providers.</p>
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
              placeholder="Search for a provider"
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
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[190px]" style={{ background: SOFT }}>
              <HeartHandshake size={14} className="mr-1.5" style={{ color: MUTED }} />
              <SelectValue placeholder="All services" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {SERVICE_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
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

        {orgs === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }} />)}
          </div>
        ) : orgs.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[13px] font-black" style={{ color: TEXT }}>No providers yet.</p>
          </div>
        ) : visibleOrgs && visibleOrgs.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[13px] font-black" style={{ color: TEXT }}>No providers match these filters.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
            <div className={`grid ${ROW_GRID} gap-4 px-5 py-3 text-[10px] font-black uppercase tracking-wide`} style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
              <span>Company</span>
              <span>Status</span>
              <span>About</span>
              <span className="text-right">Users</span>
            </div>
            {(visibleOrgs ?? []).map((org, i) => {
              const st = PROVIDER_STATUS_STYLE[getProviderStatusKey(org)];
              return (
                <button
                  key={org.organization_id}
                  onClick={() => navigate(`/admin/organizations/${org.organization_id}`)}
                  className={`grid w-full ${ROW_GRID} items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-cc-soft`}
                  style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : undefined }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                      <Building2 size={15} style={{ color: PLUM }} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{org.display_name}</p>
                      {org.plan_tier && (
                        <p className="truncate text-[11px] font-medium capitalize" style={{ color: MUTED }}>{org.plan_tier} plan</p>
                      )}
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: st.color }}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.color }} />
                    {st.label}
                  </span>
                  <span className="truncate text-[12px] font-semibold" style={{ color: TEXT }}>{org.provider_type || "—"}</span>
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
                </button>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
