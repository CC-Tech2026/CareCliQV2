import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Building2, Users, ArrowRight } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { listAdminOrganizations, type AdminOrgSummary, type OrgStatus } from "@/services/adminService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const GREEN = "#0F7B57";
const GREEN_SOFT = "#E9F5F0";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";
const SLATE = "#5B655F";
const SLATE_SOFT = "#F0F1EE";

const STATUS_STYLE: Record<OrgStatus, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: GREEN, bg: GREEN_SOFT },
  suspended: { label: "Suspended", color: AMBER, bg: AMBER_SOFT },
  offboarded: { label: "Offboarded", color: SLATE, bg: SLATE_SOFT },
};

// UI-only placeholder — the real API needs migrations 151/152 run before it
// works. Lets the portal be iterated on without the backend. Swap back to
// relying purely on listAdminOrganizations() once that's wired up.
const DUMMY_ORGS: AdminOrgSummary[] = [
  { organization_id: "dummy-1", display_name: "Sunshine Disability Services", provider_type: "Disability", status: "active", plan_tier: "growth", team_size: "11-25", participant_volume: "26-50", created_at: "2026-06-02T00:00:00Z", user_count: 13 },
  { organization_id: "dummy-2", display_name: "Harbourview Aged Care", provider_type: "Aged Care", status: "active", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", created_at: "2026-07-14T00:00:00Z", user_count: 6 },
  { organization_id: "dummy-3", display_name: "Northside Community Support", provider_type: "Disability", status: "suspended", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", created_at: "2026-05-20T00:00:00Z", user_count: 4 },
  { organization_id: "dummy-4", display_name: "Coastal Care Collective", provider_type: "Disability", status: "active", plan_tier: "enterprise", team_size: "50+", participant_volume: "100+", created_at: "2026-03-11T00:00:00Z", user_count: 42 },
];

export default function AdminProvidersPage() {
  const [, navigate] = useLocation();
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminOrganizations()
      .then((data) => { if (!cancelled) setOrgs(data.length > 0 ? data : DUMMY_ORGS); })
      .catch(() => { if (!cancelled) setOrgs(DUMMY_ORGS); });
    return () => { cancelled = true; };
  }, []);

  const activeCount = orgs?.filter((o) => o.status === "active").length ?? 0;
  const suspendedCount = orgs?.filter((o) => o.status === "suspended").length ?? 0;

  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Providers</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>Every organisation using CareCliQ, across all providers.</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Total providers</p>
            <p className="mt-1 text-xl font-black" style={{ color: TEXT }}>{orgs === null ? "—" : orgs.length}</p>
          </div>
          <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Active</p>
            <p className="mt-1 text-xl font-black" style={{ color: GREEN }}>{orgs === null ? "—" : activeCount}</p>
          </div>
          <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Suspended</p>
            <p className="mt-1 text-xl font-black" style={{ color: suspendedCount > 0 ? AMBER : TEXT }}>{orgs === null ? "—" : suspendedCount}</p>
          </div>
        </div>

        {orgs === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }} />)}
          </div>
        ) : orgs.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[13px] font-black" style={{ color: TEXT }}>No providers yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
            {orgs.map((org, i) => {
              const st = STATUS_STYLE[org.status];
              return (
                <button
                  key={org.organization_id}
                  onClick={() => navigate(`/admin/organizations/${org.organization_id}`)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-cc-soft"
                  style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : undefined }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                      <Building2 size={15} style={{ color: "var(--cc-plum)" }} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{org.display_name}</p>
                      <p className="text-[11px]" style={{ color: MUTED }}>{org.provider_type || "Provider"} · {org.plan_tier || "starter"}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: MUTED }}>
                      <Users size={12} /> {org.user_count}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                    <ArrowRight size={14} style={{ color: MUTED }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
