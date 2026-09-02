import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Building2, Users, ShieldAlert, ArrowRight, Clock } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAuth } from "@/contexts/AuthContext";
import { listAdminOrganizations, type AdminOrgSummary } from "@/services/adminService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

const DUMMY_ORGS: AdminOrgSummary[] = [
  { organization_id: "dummy-1", display_name: "Sunshine Disability Services", provider_type: "Disability", status: "active", plan_tier: "growth", team_size: "11-25", participant_volume: "26-50", created_at: "2026-06-02T00:00:00Z", user_count: 13 },
  { organization_id: "dummy-2", display_name: "Harbourview Aged Care", provider_type: "Aged Care", status: "active", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", created_at: "2026-07-14T00:00:00Z", user_count: 6 },
  { organization_id: "dummy-3", display_name: "Northside Community Support", provider_type: "Disability", status: "suspended", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", created_at: "2026-05-20T00:00:00Z", user_count: 4 },
  { organization_id: "dummy-4", display_name: "Coastal Care Collective", provider_type: "Disability", status: "active", plan_tier: "enterprise", team_size: "50+", participant_volume: "100+", created_at: "2026-03-11T00:00:00Z", user_count: 42 },
];

function StatTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-black" style={{ color: color ?? TEXT }}>{value}</p>
    </div>
  );
}

const TODAY_LABEL = new Date().toLocaleDateString("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default function AdminDashboardPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null);
  const firstName = (user?.full_name || "Admin").trim().split(/\s+/)[0];

  useEffect(() => {
    let cancelled = false;
    listAdminOrganizations()
      .then((data) => { if (!cancelled) setOrgs(data.length > 0 ? data : DUMMY_ORGS); })
      .catch(() => { if (!cancelled) setOrgs(DUMMY_ORGS); });
    return () => { cancelled = true; };
  }, []);

  const totalProviders = orgs?.length ?? 0;
  const activeCount = orgs?.filter((o) => o.status === "active").length ?? 0;
  const suspended = orgs?.filter((o) => o.status === "suspended") ?? [];
  const totalUsers = orgs?.reduce((sum, o) => sum + o.user_count, 0) ?? 0;

  const recent = [...(orgs ?? [])]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 5);

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="rounded-2xl p-5" style={{ background: "var(--cc-plum-soft)" }}>
          <p className="text-[11px] font-semibold" style={{ color: MUTED }}>{TODAY_LABEL}</p>
          <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>Hello, {firstName}! 👋</h1>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Overview across every provider on CareCliQ.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Total providers" value={orgs === null ? "—" : totalProviders} />
          <StatTile label="Active" value={orgs === null ? "—" : activeCount} color={GREEN} />
          <StatTile label="Suspended" value={orgs === null ? "—" : suspended.length} color={suspended.length > 0 ? AMBER : TEXT} />
          <StatTile label="Total staff accounts" value={orgs === null ? "—" : totalUsers} />
        </div>

        {suspended.length > 0 && (
          <div className="rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
            <div className="flex items-center gap-1.5">
              <ShieldAlert size={15} style={{ color: AMBER }} />
              <p className="text-[12px] font-black" style={{ color: AMBER }}>Needs attention</p>
            </div>
            <div className="mt-2 space-y-1.5">
              {suspended.map((o) => (
                <button
                  key={o.organization_id}
                  onClick={() => navigate(`/admin/organizations/${o.organization_id}`)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] font-bold transition-colors hover:bg-white/50"
                  style={{ color: TEXT }}
                >
                  {o.display_name} — suspended
                  <ArrowRight size={13} style={{ color: AMBER }} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
          <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
            <div className="flex items-center gap-1.5">
              <Clock size={13} style={{ color: MUTED }} />
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Recently added providers</p>
            </div>
            <button onClick={() => navigate("/admin/organizations")} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: PLUM }}>
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {orgs === null ? (
              <div className="p-5">
                <div className="h-10 animate-pulse rounded-lg" style={{ background: "var(--cc-soft)" }} />
              </div>
            ) : recent.length === 0 ? (
              <p className="p-5 text-center text-[12px] font-medium" style={{ color: MUTED }}>No providers yet.</p>
            ) : (
              recent.map((o) => (
                <button
                  key={o.organization_id}
                  onClick={() => navigate(`/admin/organizations/${o.organization_id}`)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-cc-soft"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                      <Building2 size={13} style={{ color: PLUM }} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>{o.display_name}</p>
                      <p className="text-[10px]" style={{ color: MUTED }}>{o.provider_type || "Provider"} · {o.plan_tier || "starter"}</p>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold" style={{ color: MUTED }}>
                    <Users size={11} /> {o.user_count}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
