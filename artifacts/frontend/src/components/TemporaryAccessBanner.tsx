import { Clock } from "lucide-react";
import type { AccessGrant } from "@/services/accessGrantService";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Shown wherever a coordinator is using an MD-exclusive feature via a
 * delegated-access grant rather than their own role — so it's never a
 * silent capability that just appears with no indication of why, or how
 * long it lasts (spec item 3.5).
 */
export function TemporaryAccessBanner({ grant, label }: { grant: AccessGrant; label: string }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm"
      style={{ borderColor: "var(--cc-status-warning)", background: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" }}
      role="status"
    >
      <Clock size={16} className="shrink-0" />
      <span className="font-semibold">Temporary access: {label}</span>
      <span>&mdash; ends {fmt(grant.expires_at)}</span>
    </div>
  );
}
