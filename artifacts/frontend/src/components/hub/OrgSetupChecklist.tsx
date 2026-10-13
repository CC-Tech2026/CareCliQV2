import { useState } from "react";
import { ArrowRight, Building2, Check, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { apiFetch } from "@/lib/api-fetch";
import { ccqOrgSetupHiddenKey } from "@/lib/storage-keys";
import {
  ORGANISATION_DETAILS_KEY,
  type OrganisationDetails,
} from "@/components/settings/OrganisationDetailsCard";

type Step = {
  id: string;
  icon: typeof Building2;
  title: string;
  body: string;
  done: boolean;
  href: string;
  action: string;
  /** Bring an existing list across from another system instead. */
  importHref?: string;
};

/** First-run setup for a new organisation's managing director. Every tick
 * comes from real records (organisation details, accepted staff, active
 * participants), so it disappears on its own once the organisation is
 * actually ready, rather than when someone clicks through it. */
export function OrgSetupChecklist({
  staffCount,
  participantCount,
  onNavigate,
}: {
  /** Coordinators and support workers who have accepted an invite. */
  staffCount: number;
  participantCount: number;
  onNavigate: (href: string) => void;
}) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "";
  const [hidden, setHidden] = useState(() => {
    try {
      return Boolean(orgId) && localStorage.getItem(ccqOrgSetupHiddenKey(orgId)) === "1";
    } catch {
      return false;
    }
  });
  const details = useOrgQuery<OrganisationDetails>([...ORGANISATION_DETAILS_KEY], {
    queryFn: async () => {
      const res = await apiFetch("/api/settings/organisation");
      if (!res.ok) throw new Error("Couldn't load organisation details.");
      return res.json();
    },
  });

  if (hidden || details.isLoading) return null;

  const org = details.data;
  const steps: Step[] = [
    {
      id: "details",
      icon: Building2,
      title: "Add your business details",
      body: "Your ABN, address and NDIS registration number print on invoices and service agreements, and go out with NDIA claims.",
      done: Boolean(org?.abn && org?.address),
      href: "/settings?section=provider",
      action: "Add details",
    },
    {
      id: "team",
      icon: UserPlus,
      title: "Invite your team",
      body: "Send invitations to your coordinators and support workers. This is ticked once the first person accepts.",
      done: staffCount > 0,
      href: "/settings?section=team",
      action: "Invite staff",
      importHref: "/md/import?kind=staff",
    },
    {
      id: "participants",
      icon: Users,
      title: "Add your first participant",
      body: "Start their onboarding with their NDIS plan, goals and service agreement.",
      done: participantCount > 0,
      href: "/onboard-participant",
      action: "Add participant",
      importHref: "/md/import?kind=participants",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  function hide() {
    try {
      if (orgId) localStorage.setItem(ccqOrgSetupHiddenKey(orgId), "1");
    } catch {
      // Hiding is a convenience; it just shows again next visit.
    }
    setHidden(true);
  }

  return (
    <section aria-labelledby="org-setup-title" className="rounded-xl border border-cc-border bg-cc-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cc-muted">Getting started</p>
          <h2
            id="org-setup-title"
            className="mt-1 text-lg font-black tracking-tight text-cc-text"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Get your organisation ready
          </h2>
          <p className="mt-0.5 text-[13px] text-cc-muted">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          className="min-h-11 rounded-lg px-3 text-[13px] font-semibold text-cc-muted hover:bg-cc-soft"
        >
          Hide for now
        </button>
      </div>

      <ol className="divide-y divide-cc-border border-t border-cc-border">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.id} className="flex flex-wrap items-center gap-4 px-5 py-4 sm:flex-nowrap">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: step.done ? "var(--cc-status-success-bg)" : "var(--cc-soft)",
                  color: step.done ? "var(--cc-status-success)" : "var(--cc-muted)",
                }}
                aria-hidden="true"
              >
                {step.done ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-cc-text">
                  {step.title}
                  {step.done ? <span className="sr-only"> (done)</span> : null}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-cc-muted">{step.body}</p>
              </div>
              {step.done ? (
                <span className="text-[12px] font-semibold" style={{ color: "var(--cc-status-success)" }}>
                  Done
                </span>
              ) : (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {step.importHref ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(step.importHref!)}
                      className="min-h-11 rounded-lg px-3 text-[13px] font-bold text-cc-plum hover:bg-cc-soft"
                    >
                      Import a list
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onNavigate(step.href)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-cc-plum px-4 text-[13px] font-bold text-white hover:opacity-90"
                  >
                    {step.action}
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
