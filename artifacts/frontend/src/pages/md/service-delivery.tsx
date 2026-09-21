import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  RefreshCw,
  CalendarDays,
  Users,
  FileText,
  AlertTriangle,
  Search,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getCareAlerts, type HubComplianceAlert } from "@/services/hubService";

const areas = [
  {
    id: "shifts",
    title: "Shift coverage",
    description: "Upcoming shifts needing cover",
    icon: CalendarDays,
  },
  {
    id: "participants",
    title: "Participant contact",
    description: "Gaps in recorded contact",
    icon: Users,
  },
  {
    id: "worker-notes",
    title: "Documentation quality",
    description: "Notes needing follow-up",
    icon: FileText,
  },
] as const;
const priorities: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
  positive: 4,
};
function destination(alert: HubComplianceAlert) {
  if (alert.source === "shifts")
    return { href: "/md/schedule", label: "Review schedule" };
  if (alert.source === "participants")
    return { href: "/patients", label: "Review participants" };
  if (alert.source === "worker-notes")
    return { href: "/md/staff", label: "Review staff" };
  return { href: "/md/compliance", label: "Review compliance" };
}
function dueDate(value: string) {
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

export default function MDServiceDeliveryPage() {
  const query = useOrgQuery(["care-alerts"], { queryFn: getCareAlerts });
  const [area, setArea] = useState("all");
  const [priority, setPriority] = useState("all");
  const [search, setSearch] = useState("");
  const alerts = query.data ?? [];
  const known = !query.isLoading && !query.isError && query.data !== undefined;
  const filtered = alerts
    .filter(
      (alert) =>
        (area === "all" || alert.source === area) &&
        (priority === "all" ||
          alert.category === "urgent" ||
          alert.severity === "critical" ||
          alert.severity === "high") &&
        [alert.title, alert.detail, ...(alert.affected_staff ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.category === "urgent") - Number(a.category === "urgent") ||
        (priorities[a.severity] ?? 5) - (priorities[b.severity] ?? 5),
    );
  function clearFilters() {
    setArea("all");
    setPriority("all");
    setSearch("");
  }
  return (
    <HubLayout>
      <div className="min-w-0 space-y-5 pb-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-cc-border pb-5">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-cc-text">
              Delivery Quality
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-cc-muted">
              Follow up on shift coverage, participant contact and the quality
              of care records.
            </p>
          </div>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cc-border bg-cc-surface px-3 text-sm font-medium text-cc-text disabled:opacity-50"
          >
            <RefreshCw
              size={15}
              className={
                query.isFetching
                  ? "animate-spin motion-reduce:animate-none"
                  : ""
              }
            />
            {query.isFetching ? "Refreshing" : "Refresh"}
          </button>
        </header>
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Care areas">
          {areas.map(({ id, title, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={area === id}
              onClick={() => setArea(area === id ? "all" : id)}
              className="flex min-w-0 items-start gap-3 rounded-xl border bg-cc-surface p-4 text-left transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
              style={{
                borderColor:
                  area === id ? "var(--cc-plum)" : "var(--cc-border)",
              }}
            >
              <Icon size={18} className="mt-0.5 shrink-0 text-cc-plum" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-cc-text">
                  {title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-cc-muted">
                  {description}
                </span>
              </span>
              <span className="text-xl font-semibold tabular-nums text-cc-text">
                {known
                  ? alerts.filter((alert) => alert.source === id).length
                  : "?"}
              </span>
            </button>
          ))}
        </div>
        <section
          aria-labelledby="care-follow-up"
          className="min-w-0 overflow-hidden rounded-xl border border-cc-border bg-cc-surface"
        >
          <div className="space-y-4 border-b border-cc-border p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="care-follow-up"
                className="text-base font-semibold text-cc-text"
              >
                Care follow-up
              </h2>
              {known && (
                <p role="status" className="text-sm text-cc-muted">
                  {filtered.length} of {alerts.length} alerts
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="grid min-w-0 flex-1 gap-1.5 text-xs font-medium text-cc-muted">
                Search care alerts
                <span className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-3.5"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search names or concerns"
                    className="min-h-11 w-full rounded-lg border border-cc-border bg-cc-surface py-2 pl-9 pr-3 text-sm text-cc-text"
                  />
                </span>
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-cc-muted">
                Priority
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  className="min-h-11 rounded-lg border border-cc-border bg-cc-surface px-3 text-sm text-cc-text"
                >
                  <option value="all">All priorities</option>
                  <option value="urgent">Urgent or high priority</option>
                </select>
              </label>
              {(area !== "all" || priority !== "all" || search) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="min-h-11 rounded-lg px-3 text-sm font-medium text-cc-plum"
                >
                  Clear filters
                </button>
              )}
            </div>
            {area !== "all" && (
              <p className="text-sm text-cc-muted">
                Showing{" "}
                {areas.find((item) => item.id === area)?.title.toLowerCase()}
              </p>
            )}
          </div>
          {query.isLoading ? (
            <div role="status" className="p-5 text-sm text-cc-muted">
              Loading care alerts...
            </div>
          ) : query.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 p-5">
              <AlertTriangle size={20} className="shrink-0 text-cc-muted" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-cc-text">
                  Care alerts could not be loaded
                </p>
                <p className="mt-1 text-sm text-cc-muted">
                  Try again to check the current follow-up list.
                </p>
              </div>
              <button
                type="button"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
                className="min-h-11 rounded-lg border border-cc-border px-4 text-sm font-medium text-cc-plum disabled:opacity-50"
              >
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm font-semibold text-cc-text">
                {alerts.length
                  ? "No alerts match these filters"
                  : "No care alerts returned"}
              </p>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-cc-muted">
                {alerts.length
                  ? "Try another care area, priority or search term."
                  : "Continue reviewing participant records and scheduled care as part of your regular follow-up."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-cc-border">
              {filtered.map((alert) => {
                const action = destination(alert);
                const urgent =
                  alert.category === "urgent" ||
                  alert.severity === "critical" ||
                  alert.severity === "high";
                const due = alert.due_date ? dueDate(alert.due_date) : null;
                return (
                  <li
                    key={alert.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-5 sm:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span
                          className={
                            "rounded-md px-2 py-1 text-xs font-medium " +
                            (urgent
                              ? "bg-amber-50 text-amber-900"
                              : "bg-cc-soft text-cc-muted")
                          }
                        >
                          {alert.severity === "critical"
                            ? "Critical"
                            : urgent
                              ? "Priority follow-up"
                              : "Follow-up"}
                        </span>
                        <span className="text-xs text-cc-muted">
                          {areas.find((item) => item.id === alert.source)
                            ?.title ?? "Care quality"}
                        </span>
                        {due && (
                          <span className="text-xs text-cc-muted">
                            Due {due}
                          </span>
                        )}
                      </div>
                      <h3 className="break-words text-sm font-semibold leading-6 text-cc-text">
                        {alert.title}
                      </h3>
                      <p className="mt-1 break-words text-sm leading-6 text-cc-muted">
                        {alert.detail}
                      </p>
                      {!!alert.affected_staff?.length && (
                        <p className="mt-2 break-words text-xs leading-5 text-cc-muted">
                          Staff: {alert.affected_staff.join(", ")}
                        </p>
                      )}
                    </div>
                    <Link
                      href={action.href}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-cc-border px-3 text-sm font-medium text-cc-plum hover:bg-cc-soft"
                    >
                      {action.label}
                      <ArrowRight size={14} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <nav aria-label="Care management" className="flex flex-wrap gap-2">
          {[
            ["Participants", "/patients"],
            ["Master schedule", "/md/schedule"],
            ["Staff directory", "/md/staff"],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-cc-muted hover:bg-cc-soft"
            >
              {label}
              <ArrowRight size={14} />
            </Link>
          ))}
        </nav>
      </div>
    </HubLayout>
  );
}
