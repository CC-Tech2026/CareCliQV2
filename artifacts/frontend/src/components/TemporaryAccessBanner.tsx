import type { AccessGrant } from "@/services/accessGrantService";
import { capabilityName, formatWhen, timeLeft } from "@/lib/access-capabilities";

/**
 * Shown wherever a coordinator is using a director-only feature through a
 * delegated-access grant rather than their own role, so it's never a silent
 * capability with no indication of why, or how long it lasts (spec item 3.5).
 */
export function TemporaryAccessBanner({ grant, label }: { grant: AccessGrant; label: string }) {
  return (
    <div
      role="status"
      className="mb-4 rounded-xl border-l-4 px-4 py-3 text-sm text-cc-text"
      style={{ borderLeftColor: "var(--cc-amber)", background: "var(--cc-status-warning-bg)" }}
    >
      <span className="font-semibold">Temporary access: {capabilityName(grant.capability, label)}.</span>{" "}
      <span className="text-cc-muted">
        Ends {formatWhen(grant.expires_at)} ({timeLeft(grant.expires_at)}).
      </span>
    </div>
  );
}
