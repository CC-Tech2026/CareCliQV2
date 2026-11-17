/**
 * The top bar's Integrations button (managing directors): a grid of dots that
 * opens a small menu of what CareCliQ is connected to, how each is doing, a
 * way straight into Xero, and each one's own page in Settings > Integrations.
 *
 * Setting up stays in Settings > Integrations; this is the everyday view. A
 * red dot on the button says something connected needs attention, such as an
 * invoice Xero wouldn't take or a webhook that keeps failing.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight, ChevronRight, Grip, Webhook } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getApiOverview, getXeroStatus } from "@/services/integrationsService";
import { getMyobStatus } from "@/services/myobService";
import { INTEGRATIONS_HREF, StatusPill, integrationHref, type IntegrationId } from "@/components/settings/IntegrationPage";
import { apiTileStatus, myobTileStatus, xeroTileStatus, XERO_WORDMARK, type TileStatus } from "@/components/settings/integrationStatus";

type Row = {
  id: IntegrationId;
  name: string;
  logo: ReactNode;
  detail: string;
  status: TileStatus;
  /** Opens the other system in a new tab. */
  external?: { href: string; label: string };
};

function NameLogo({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cc-border bg-cc-surface text-[10px] font-semibold text-cc-text">
      {children}
    </span>
  );
}

export function IntegrationsMenu() {
  const [open, setOpen] = useState(false);
  // The same queries (and cache) as Settings > Integrations.
  const xero = useOrgQuery(["integrations", "xero"], { queryFn: getXeroStatus, staleTime: 5 * 60_000, retry: false });
  const myob = useOrgQuery(["integrations", "myob"], { queryFn: getMyobStatus, staleTime: 5 * 60_000, retry: false });
  const api = useOrgQuery(["integrations", "api"], { queryFn: getApiOverview, staleTime: 5 * 60_000, retry: false });

  const rows: Row[] = [];
  if (xero.data?.connected) {
    rows.push({
      id: "xero",
      name: "Xero",
      logo: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cc-border bg-white">
          <img src={XERO_WORDMARK} alt="" width={28} height={8} className="block h-auto w-7" />
        </span>
      ),
      detail: xero.data.earlier?.count
        ? `${xero.data.earlier.count} older ${xero.data.earlier.count === 1 ? "invoice needs" : "invoices need"} your answer`
        : xero.data.tenant_name || "Accounting",
      status: xeroTileStatus(xero.data),
      external: { href: "https://go.xero.com/", label: "Open Xero" },
    });
  }
  if (myob.data?.connected) {
    rows.push({
      id: "myob",
      name: "MYOB",
      logo: <NameLogo>MYOB</NameLogo>,
      detail: myob.data.business_name || "Accounting",
      status: myobTileStatus(myob.data),
    });
  }
  if (api.data && apiTileStatus(api.data) !== "available") {
    const keys = api.data.keys.filter((k) => !k.revoked_at).length;
    const hooks = api.data.webhooks?.length ?? 0;
    rows.push({
      id: "api",
      name: "API and webhooks",
      logo: (
        <NameLogo>
          <Webhook className="h-4 w-4 text-[var(--cc-brand-purple)]" aria-hidden />
        </NameLogo>
      ),
      detail: `${keys} ${keys === 1 ? "key" : "keys"} · ${hooks} ${hooks === 1 ? "webhook" : "webhooks"}`,
      status: apiTileStatus(api.data),
    });
  }
  const attention = rows.some((r) => r.status === "attention");
  const label = attention ? "Integrations: something needs attention" : "Integrations";
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
            open ? "bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]" : "text-cc-muted hover:bg-cc-soft hover:text-cc-text"
          }`}
        >
          <Grip size={18} />
          {attention && (
            <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--cc-surface)]" style={{ background: "var(--cc-danger-text)" }} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-cc-border px-4 py-3">
          <h2 className="text-sm font-semibold text-cc-text">Integrations</h2>
          <Link href={INTEGRATIONS_HREF} onClick={close} className="text-[13px] font-semibold text-cc-plum hover:underline">
            See all
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <p className="text-sm font-medium text-cc-text">Nothing connected yet</p>
            <p className="mx-auto mt-1 max-w-[17rem] text-[13px] leading-relaxed text-cc-muted">
              Connect Xero so approved invoices go to your books and payments come back on their own.
            </p>
            <Link
              href={INTEGRATIONS_HREF}
              onClick={close}
              className="mt-3 inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              Connect an integration
            </Link>
          </div>
        ) : (
          <div className="py-1.5">
            <p className="px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-cc-muted">Connected</p>
            <ul>
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-1 px-2">
                  <Link
                    href={integrationHref(row.id)}
                    onClick={close}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 hover:bg-cc-soft"
                  >
                    {row.logo}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-cc-text">{row.name}</span>
                        {row.status === "attention" && <StatusPill status="attention" />}
                      </span>
                      <span className="block truncate text-xs text-cc-muted">{row.detail}</span>
                    </span>
                    {!row.external && <ChevronRight className="h-4 w-4 shrink-0 text-cc-muted" aria-hidden />}
                  </Link>
                  {row.external && (
                    <a
                      href={row.external.href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={close}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-cc-plum hover:bg-cc-soft"
                    >
                      {row.external.label}
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-cc-border px-4 py-3">
          <Link href="/settings?section=improvementFeedback" onClick={close} className="text-[13px] text-cc-muted hover:text-cc-text hover:underline">
            Need another system connected? Suggest one
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
