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
  const progress = Math.round((doneCount / steps.length) * 100);
  const nextStepId = steps.find((step) => !step.done)?.id;

  function hide() {
    try {
      if (orgId) localStorage.setItem(ccqOrgSetupHiddenKey(orgId), "1");
    } catch {
      // Hiding is a convenience; it just shows again next visit.
    }
    setHidden(true);
  }

  return (
    <section
      aria-labelledby="org-setup-title"
      className="overflow-hidden rounded-2xl border bg-cc-surface shadow-sm"
      style={{ borderColor: "rgba(124,58,237,0.2)" }}
    >
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED] text-white shadow-sm" aria-hidden="true">
            <Building2 size={21} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6D28D9]">Your launch checklist</p>
            <h2
              id="org-setup-title"
              className="mt-1 text-xl font-bold leading-tight tracking-tight text-cc-text"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Get your organisation ready
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-cc-muted">
              Complete these essentials to start managing your team and participants in CareCliQ.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-cc-soft p-3 lg:block lg:bg-transparent lg:p-0">
          <div className="min-w-0 flex-1 lg:flex lg:items-center lg:justify-between">
            <p className="text-sm font-bold text-cc-text">{doneCount} of {steps.length} done</p>
            <p className="text-xs font-semibold text-cc-muted">{progress}% complete</p>
          </div>
          <div
            className="mt-2 h-2 flex-1 overflow-hidden rounded-full bg-[rgba(124,58,237,0.12)] lg:w-full"
            role="progressbar"
            aria-label="Organisation setup progress"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={doneCount}
          >
            <div className="h-full rounded-full bg-[#7C3AED] transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <ol className="grid gap-3 border-t border-cc-border bg-[color-mix(in_srgb,var(--cc-soft)_35%,transparent)] p-4 sm:p-5 lg:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isNext = !step.done && step.id === nextStepId;
          return (
            <li
              key={step.id}
              aria-current={isNext ? "step" : undefined}
              className="flex min-w-0 flex-col rounded-xl border bg-cc-surface p-4"
              style={{
                borderColor: isNext ? "rgba(124,58,237,0.42)" : "var(--cc-border)",
                boxShadow: isNext ? "0 2px 8px rgba(80,35,150,0.08)" : undefined,
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: step.done ? "var(--cc-status-success-bg)" : isNext ? "rgba(124,58,237,0.1)" : "var(--cc-soft)",
                    color: step.done ? "var(--cc-status-success)" : isNext ? "#6D28D9" : "var(--cc-muted)",
                  }}
                  aria-hidden="true"
                >
                  {step.done ? <Check size={17} strokeWidth={3} /> : <Icon size={17} />}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-cc-muted">Step {index + 1}</p>
                  {isNext && <p className="text-[11px] font-bold text-[#6D28D9]">Next up</p>}
                </div>
                {step.done && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--cc-status-success)" }}>
                    <Check size={13} aria-hidden="true" /> Done
                  </span>
                )}
              </div>

              <div className="mt-3 min-w-0 flex-1">
                <p className="text-[14px] font-bold leading-snug text-cc-text">
                  {step.title}
                  {step.done ? <span className="sr-only"> (done)</span> : null}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-cc-muted">{step.body}</p>
              </div>

              {!step.done && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-cc-border pt-3">
                  {step.importHref ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(step.importHref!)}
                      className="min-h-10 rounded-lg px-2.5 text-[12px] font-bold text-[#6D28D9] hover:bg-[rgba(124,58,237,0.08)]"
                    >
                      Import a list
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onNavigate(step.href)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--cc-cta)] px-3 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cc-cta)]"
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

      <div className="flex justify-end border-t border-cc-border px-4 py-2 sm:px-5">
        <button
          type="button"
          onClick={hide}
          className="min-h-10 rounded-lg px-3 text-[12px] font-semibold text-cc-muted hover:bg-cc-soft hover:text-cc-text"
        >
          Hide for now
        </button>
      </div>
    </section>
  );
}
