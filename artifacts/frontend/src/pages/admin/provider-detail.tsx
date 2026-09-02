import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getAdminOrganization,
  suspendAdminOrganization,
  activateAdminOrganization,
  type AdminOrgDetail,
  type OrgStatus,
} from "@/services/adminService";

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

// UI-only placeholder, keyed to match providers.tsx's DUMMY_ORGS ids — see
// the note there. Swap back to relying purely on the real API once the
// backend migrations (151/152) are run.
const DUMMY_DETAIL: Record<string, AdminOrgDetail> = {
  "dummy-1": {
    organization_id: "dummy-1", display_name: "Sunshine Disability Services", provider_type: "Disability",
    status: "active", plan_tier: "growth", team_size: "11-25", participant_volume: "26-50", user_count: 13,
    users: [
      { id: "u1", full_name: "Alex Director", email: "alex@sunshinedisability.com.au", role: "managing_director", is_active: true },
      { id: "u2", full_name: "Priya Coordinator", email: "priya@sunshinedisability.com.au", role: "support_coordinator", is_active: true },
      { id: "u3", full_name: "Jordan Worker", email: "jordan@sunshinedisability.com.au", role: "support_worker", is_active: true },
    ],
  },
  "dummy-2": {
    organization_id: "dummy-2", display_name: "Harbourview Aged Care", provider_type: "Aged Care",
    status: "active", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", user_count: 6,
    users: [
      { id: "u4", full_name: "Sam Director", email: "sam@harbourview.com.au", role: "managing_director", is_active: true },
    ],
  },
  "dummy-3": {
    organization_id: "dummy-3", display_name: "Northside Community Support", provider_type: "Disability",
    status: "suspended", plan_tier: "starter", team_size: "1-10", participant_volume: "1-25", user_count: 4,
    users: [
      { id: "u5", full_name: "Casey Director", email: "casey@northsidecs.com.au", role: "managing_director", is_active: true },
    ],
  },
  "dummy-4": {
    organization_id: "dummy-4", display_name: "Coastal Care Collective", provider_type: "Disability",
    status: "active", plan_tier: "enterprise", team_size: "50+", participant_volume: "100+", user_count: 42,
    users: [
      { id: "u6", full_name: "Morgan Director", email: "morgan@coastalcare.com.au", role: "managing_director", is_active: true },
      { id: "u7", full_name: "Riley Coordinator", email: "riley@coastalcare.com.au", role: "support_coordinator", is_active: true },
    ],
  },
};

export default function AdminProviderDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [org, setOrg] = useState<AdminOrgDetail | null>(null);
  const [working, setWorking] = useState(false);

  function load() {
    getAdminOrganization(organizationId)
      .then(setOrg)
      .catch(() => setOrg(DUMMY_DETAIL[organizationId] ?? null));
  }

  useEffect(() => { load(); }, [organizationId]);

  async function handleSuspend() {
    setWorking(true);
    try {
      const result = await suspendAdminOrganization(organizationId);
      toast({ title: "Provider suspended", description: `${result.sessions_revoked} active session(s) logged out.` });
      load();
    } catch (err) {
      toast({ title: "Couldn't suspend provider", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function handleActivate() {
    setWorking(true);
    try {
      await activateAdminOrganization(organizationId);
      toast({ title: "Provider activated" });
      load();
    } catch (err) {
      toast({ title: "Couldn't activate provider", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-5">
        <button onClick={() => navigate("/admin/organizations")} className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: MUTED }}>
          <ArrowLeft size={14} /> All providers
        </button>

        {org === null && (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <p className="text-[13px] font-black" style={{ color: TEXT }}>Unknown provider.</p>
          </div>
        )}

        {org && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-5" style={{ borderColor: BORDER, background: SURFACE }}>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black" style={{ color: TEXT }}>{org.display_name}</h1>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: STATUS_STYLE[org.status].bg, color: STATUS_STYLE[org.status].color }}>
                    {STATUS_STYLE[org.status].label}
                  </span>
                </div>
                <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
                  {org.provider_type || "Provider"} · {org.plan_tier || "starter"} plan · {org.team_size || "—"} team size · {org.participant_volume || "—"} participants
                </p>
              </div>
              <div className="flex items-center gap-2">
                {org.status === "active" ? (
                  <Button variant="outline" className="gap-1.5" disabled={working} onClick={handleSuspend} style={{ color: AMBER, borderColor: AMBER }}>
                    <ShieldAlert size={14} /> Suspend access
                  </Button>
                ) : (
                  <Button variant="navy" className="gap-1.5" disabled={working} onClick={handleActivate}>
                    <ShieldCheck size={14} /> Reactivate
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-2xl border p-5" style={{ borderColor: BORDER, background: SURFACE }}>
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Billing</p>
              <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-bold uppercase" style={{ color: MUTED }}>Stripe customer</p>
                  <p className="text-[12px] font-semibold" style={{ color: TEXT }}>{org.stripe_customer_id || "Not connected yet"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase" style={{ color: MUTED }}>Stripe subscription</p>
                  <p className="text-[12px] font-semibold" style={{ color: TEXT }}>{org.stripe_subscription_id || "Not connected yet"}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
              <div className="flex items-center gap-1.5 border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
                <Users size={13} style={{ color: MUTED }} />
                <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Users ({org.users.length})</p>
              </div>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {org.users.length === 0 && (
                  <p className="p-5 text-center text-[12px] font-medium" style={{ color: MUTED }}>No users yet.</p>
                )}
                {org.users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>{u.full_name || u.email}</p>
                      <p className="text-[11px]" style={{ color: MUTED }}>{u.email}</p>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase" style={{ background: "var(--cc-soft)", color: MUTED }}>
                      {u.role.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
