import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { activityLabel, formatDate } from "@/components/admin/adminFormat";
import { getPlatformActivity, type PlatformActivity } from "@/services/adminMessagesService";

function time(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/** Everything CareCliQ staff have done in the admin portal, newest first. */
export default function AdminActivityPage() {
  const [rows, setRows] = useState<PlatformActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getPlatformActivity().then((r) => setRows(r.activity)).catch((e) => { setError(e instanceof Error ? e.message : "Couldn't load activity."); setRows([]); });
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (!q) return true;
      return [activityLabel(r), r.actor_name, r.organization_name, r.details?.reason ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [rows, query]);

  // Group by day for scanning.
  const groups = useMemo(() => {
    const out: { day: string; items: PlatformActivity[] }[] = [];
    for (const r of shown) {
      const day = formatDate(r.created_at);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(r);
    }
    return out;
  }, [shown]);

  return (
    <AdminShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>Activity</h1>
          <p className="mt-1 text-sm text-cc-muted">Every change CareCliQ staff make to provider accounts, messages and banners.</p>
        </header>
        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cc-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by provider, person or reason" aria-label="Search activity"
            className="h-11 md:h-9 w-full rounded-full border border-cc-border bg-cc-surface pl-11 pr-4 text-sm text-cc-text outline-none focus:ring-2 focus:ring-cc-plum" />
        </div>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--cc-status-danger)" }}>{error}</p>}
        {rows === null ? (
          <div className="h-48 animate-pulse rounded-2xl bg-cc-surface" />
        ) : groups.length === 0 ? (
          <p className="rounded-2xl bg-cc-surface px-5 py-8 text-center text-sm text-cc-muted">{rows.length ? "Nothing matches." : "Nothing yet."}</p>
        ) : (
          groups.map((g) => (
            <section key={g.day} className="space-y-2" aria-label={g.day}>
              <h2 className="text-sm font-semibold text-cc-muted">{g.day}</h2>
              <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface shadow-[var(--cc-shadow-sm)]">
                {g.items.map((r, i) => (
                  <li key={`${r.created_at}-${i}`} className="flex gap-3 px-4 py-3 sm:px-5">
                    <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-cc-muted">{time(r.created_at)}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-cc-text">
                        {activityLabel(r)}
                        {r.organization_id && r.organization_name && (
                          <> · <Link href={`/admin/organizations/${r.organization_id}`} className="font-semibold text-cc-plum">{r.organization_name}</Link></>
                        )}
                      </p>
                      <p className="text-xs text-cc-muted">{r.actor_name}{r.details?.reason ? ` · "${r.details.reason}"` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </AdminShell>
  );
}
