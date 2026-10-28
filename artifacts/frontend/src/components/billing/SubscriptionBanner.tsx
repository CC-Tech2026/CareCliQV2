import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { apiFetch } from "@/lib/api-fetch";

type Access = {
  state: "full" | "grace" | "read_only";
  subscription_status: string | null;
  grace_ends_at: string | null;
  can_manage_billing: boolean;
};

const HIDDEN_ON = ["/login", "/signup", "/get-started", "/accept-invite", "/portal", "/participant-portal", "/admin", "/settings"];

function reason(status: string | null): string {
  if (status === "past_due" || status === "unpaid") return "the last CareCliQ payment didn't go through";
  if (status === "canceled") return "the CareCliQ subscription was cancelled";
  return "the free trial has ended";
}

function day(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** Shown when an organisation's subscription has lapsed (see
 * backend services/subscription_access.py). During the 7-day grace period
 * only people who can fix billing see it; once records are read-only,
 * everyone does, so nobody is left wondering why saving fails. */
export function SubscriptionBanner() {
  const { isAuthenticated, user } = useAuth();
  const [location, navigate] = useLocation();
  const eligible =
    isAuthenticated &&
    !!user?.organizationId &&
    user?.role !== "participant" &&
    user?.role !== "super_admin" &&
    !HIDDEN_ON.some((p) => location === p || location.startsWith(p + "/") || location.startsWith(p + "?"));

  const query = useOrgQuery<Access>(["platform-billing", "access"], {
    queryFn: async () => {
      const res = await apiFetch("/api/platform-billing/access");
      if (!res.ok) throw new Error("access check failed");
      return res.json();
    },
    enabled: eligible,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const access = query.data;
  if (!eligible || !access || access.state === "full") return null;
  if (access.state === "grace" && !access.can_manage_billing) return null;

  const readOnly = access.state === "read_only";
  const message = readOnly
    ? `Records are read-only because ${reason(access.subscription_status)}. You can still view and export everything, and report incidents.`
    : `${reason(access.subscription_status).replace(/^the /, "The ")}. Choose a plan by ${day(access.grace_ends_at)} to keep adding shifts, notes and invoices.`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role={readOnly ? "alert" : "status"}
        className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-[var(--cc-shadow-md)]"
        style={{
          background: "var(--cc-surface)",
          borderColor: readOnly ? "var(--cc-status-critical, #B3261E)" : "var(--cc-status-warning)",
        }}
      >
        <AlertTriangle
          size={18}
          className="shrink-0"
          aria-hidden="true"
          style={{ color: readOnly ? "#B3261E" : "var(--cc-status-warning)" }}
        />
        <p className="min-w-0 flex-1 basis-60 text-[13px] leading-snug text-cc-text">
          {message}
          {readOnly && !access.can_manage_billing ? " Your managing director can renew it." : ""}
        </p>
        {access.can_manage_billing ? (
          <button
            type="button"
            onClick={() => navigate("/settings?section=billing")}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-cc-plum px-4 text-[13px] font-bold text-white hover:opacity-90"
          >
            Choose a plan
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
