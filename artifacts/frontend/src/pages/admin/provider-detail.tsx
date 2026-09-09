import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { AlertTriangle, ArrowLeft, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  getAdminOrganization,
  suspendAdminOrganization,
  activateAdminOrganization,
  updateAdminOrganizationType,
  type AdminOrgDetail,
  type OrgStatus,
  type OrgType,
} from "@/services/adminService";

// Same labels as the Providers list filter (providers.tsx) — kept in sync
// by hand since there's no shared constants file for admin pages yet.
const ORG_TYPE_LABEL: Record<OrgType, string> = {
  aged_care: "Aged Care",
  disability: "Disability",
  aged_care_disability: "Aged Care & Disability",
};
const ORG_TYPE_OPTIONS: OrgType[] = ["aged_care", "disability", "aged_care_disability"];

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

export default function AdminProviderDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [org, setOrg] = useState<AdminOrgDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [savingOrgType, setSavingOrgType] = useState(false);

  // No dummy-data fallback — a real fetch failure (or a genuinely
  // not-found org) needs to read as that, not silently show a fabricated
  // provider that could be mistaken for a real customer.
  function load() {
    setLoadError(null);
    getAdminOrganization(organizationId)
      .then(setOrg)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load this provider."));
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

  async function handleOrgTypeChange(orgType: OrgType) {
    setSavingOrgType(true);
    // Optimistic — the picker feels instant; rolled back below on failure.
    setOrg((prev) => (prev ? { ...prev, org_type: orgType } : prev));
    try {
      await updateAdminOrganizationType(organizationId, orgType);
    } catch (err) {
      toast({ title: "Couldn't update org type", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
      load();
    } finally {
      setSavingOrgType(false);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-5">
        <button onClick={() => navigate("/admin/organizations")} className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: MUTED }}>
          <ArrowLeft size={14} /> All providers
        </button>

        {org === null && loadError && (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: AMBER_SOFT }}>
              <AlertTriangle size={20} style={{ color: AMBER }} />
            </span>
            <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Couldn't load this provider</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>{loadError}</p>
          </div>
        )}

        {org === null && !loadError && (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }} />)}
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
                  {org.provider_type || "Provider"} · {org.plan_tier ? `${org.plan_tier} plan` : "Trial"} · {org.team_size || "—"} team size · {org.participant_volume || "—"} participants
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Org Type</span>
                  <Select
                    value={org.org_type ?? undefined}
                    onValueChange={(v) => handleOrgTypeChange(v as OrgType)}
                    disabled={savingOrgType}
                  >
                    <SelectTrigger className="h-8 w-[190px] rounded-lg border text-[12px] shadow-none" style={{ borderColor: BORDER }}>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{ORG_TYPE_LABEL[opt]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
