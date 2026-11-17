/**
 * The pieces every integration's own page shares (Xero, MYOB, API and
 * webhooks): its address inside Settings > Integrations
 * (?section=integrations&integration=<id>), the Back link, the header and the
 * status pill also used on the tiles and in the top bar's Integrations menu.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TileStatus } from "./integrationStatus";

export type { TileStatus };

export type IntegrationId = "xero" | "myob" | "employment-hero" | "api";

export const INTEGRATIONS_HREF = "/settings?section=integrations";
export function integrationHref(id: IntegrationId) {
  return `${INTEGRATIONS_HREF}&integration=${id}`;
}

/** Which integration's page is open, and how to open one or go back to the list. */
export function useIntegrationRoute() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const managing = new URLSearchParams(search).get("integration") as IntegrationId | null;
  return {
    managing,
    open: (id: IntegrationId) => navigate(integrationHref(id)),
    back: () => navigate(INTEGRATIONS_HREF),
  };
}

export const STATUS_LOOK: Record<TileStatus, { label: string; fg: string; bg: string; dot?: string }> = {
  connected: { label: "Connected", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)", dot: "var(--cc-status-success)" },
  attention: { label: "Needs attention", fg: "var(--cc-danger-text)", bg: "var(--cc-status-danger-bg)", dot: "var(--cc-danger-text)" },
  available: { label: "Not connected", fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
  soon: { label: "Coming soon", fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
  unavailable: { label: "Not switched on", fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
};

export function StatusPill({ status }: { status: TileStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: look.fg, background: look.bg }}>
      {look.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: look.dot }} />}
      {look.label}
    </span>
  );
}

export function PanelHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>{children}</h4>;
}

/** One integration's page: Back to Integrations, its name (or wordmark), status and a line about the connection. */
export function IntegrationPage({
  title, status, subtitle, onBack, children,
}: {
  /** The name, or the official wordmark as an <img alt="Name">. */
  title: ReactNode;
  status?: TileStatus;
  subtitle?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Start at the Back link, clear of the sticky top bar (scroll-mt), with focus on the name.
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section ref={sectionRef} className="min-w-0 scroll-mt-28 space-y-5" aria-labelledby="integration-page-title">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-10 items-center gap-1 rounded-full pr-3 text-sm font-medium text-cc-plum hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to Integrations
      </button>

      <header className="space-y-2 border-b border-cc-border pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="integration-page-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-[22px] font-semibold tracking-tight outline-none"
            style={{ color: "var(--cc-text)", fontFamily: "var(--app-font-display)" }}
          >
            {title}
          </h2>
          {status && <StatusPill status={status} />}
        </div>
        {subtitle && <p className="text-sm" style={{ color: "var(--cc-muted)" }}>{subtitle}</p>}
      </header>

      {children}
    </section>
  );
}

/** The bottom row of a connected accounting page: what disconnecting does, and the button. */
export function DisconnectRow({
  name, onDisconnect, detail,
}: {
  name: string;
  onDisconnect: () => void;
  /** What stops and what stays; defaults to the accounting wording (invoices). */
  detail?: string;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cc-border bg-cc-surface p-4">
      <div className="min-w-0">
        <PanelHeading>Disconnect {name}</PanelHeading>
        <p className="mt-0.5 text-xs" style={{ color: "var(--cc-muted)" }}>
          {detail ?? `New invoices stop going to ${name}. Invoices already in ${name} stay there.`}
        </p>
      </div>
      <Button variant="outline" size="sm" style={{ color: "var(--cc-danger-text)" }} onClick={onDisconnect}>
        Disconnect
      </Button>
    </section>
  );
}
