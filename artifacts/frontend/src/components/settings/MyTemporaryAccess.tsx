import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { useMyAccessGrants } from "@/hooks/useMyAccessGrants";
import { CAPABILITY_INFO, capabilityName, formatWhen, timeLeft } from "@/lib/access-capabilities";

/**
 * A coordinator's own view of the director-only things they can currently do
 * through delegated access: what each one is, where to find it and when it
 * ends. Several of these (deleting staff, reassigning a coordinator, locking a
 * training module) live inside other pages, so without this list they'd be
 * hard to discover.
 */
export function MyTemporaryAccess() {
  const { grants, isLoading } = useMyAccessGrants();

  return (
    <section className="min-w-0 space-y-5" aria-labelledby="my-temporary-access-heading">
      <header className="max-w-2xl">
        <h2 id="my-temporary-access-heading" className="text-2xl font-semibold tracking-tight text-cc-text">
          Your temporary access
        </h2>
        <p className="mt-1 text-sm leading-6 text-cc-muted">
          Your director has let you do these things for a set time. Each one switches off on its own when it ends.
        </p>
      </header>

      {isLoading ? (
        <div role="status" aria-label="Loading" className="h-24 animate-pulse rounded-2xl bg-cc-soft" />
      ) : grants.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-cc-border px-5 py-6 text-sm text-cc-muted">
          You don't have any temporary access right now.
        </p>
      ) : (
        <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
          {grants.map((g) => {
            const info = CAPABILITY_INFO[g.capability];
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-cc-text">{capabilityName(g.capability)}</p>
                  {info && <p className="mt-0.5 text-sm text-cc-muted">{info.does}</p>}
                  <p className="mt-0.5 text-xs text-cc-muted">
                    Ends {formatWhen(g.expires_at)} · {timeLeft(g.expires_at)}
                    {g.reason ? ` · ${g.reason}` : ""}
                  </p>
                </div>
                {info && (
                  <Link
                    href={info.where.href}
                    className="inline-flex min-h-10 md:min-h-8 items-center gap-1 rounded-full px-3 text-sm font-medium text-cc-plum transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
                  >
                    Go to {info.where.label}
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
