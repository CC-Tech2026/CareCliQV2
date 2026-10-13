import { Link, useLocation, useSearch } from "wouter";
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
import { EmptyState, LoadError, PageHeader, StatusText, SummaryStrip, ghostClass, outlineClass } from "@/components/layout/PageKit";
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
  if (alert.source === "participants" && alert.participant_id)
    return {
      href: `/patients?id=${encodeURIComponent(alert.participant_id)}&tab=overview`,
      label: "View participant",
    };
  if (alert.source === "shifts" && alert.shift_id)
    return {
      href: `/md/schedule?shiftId=${encodeURIComponent(alert.shift_id)}`,
      label: "View shift",
    };
  if (alert.source === "worker-notes" && alert.worker_id)
    return {
      href: `/md/staff?workerId=${encodeURIComponent(alert.worker_id)}`,
      label: "View staff profile",
    };
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
  const [location, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const requestedArea = params.get("area") ?? "all";
  const area = areas.some((item) => item.id === requestedArea)
    ? requestedArea
    : "all";
  const priority = params.get("priority") === "urgent" ? "urgent" : "all";
  const search = params.get("search") ?? "";
  const requestedPage = Number(params.get("page") ?? 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  function updateFilters(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (!value || value === "all" || (key === "page" && value === "1"))
        next.delete(key);
      else next.set(key, value);
    }
    navigate(location + (next.size ? "?" + next.toString() : ""), {
      replace: true,
    });
  }
  const setArea = (value: string) => updateFilters({ area: value, page: "1" });
  const setPriority = (value: string) =>
    updateFilters({ priority: value, page: "1" });
  const setSearch = (value: string) =>
    updateFilters({ search: value, page: "1" });
  const setPage = (value: number) => updateFilters({ page: String(value) });
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
        [
          alert.title,
          alert.detail,
          alert.participant_id,
          ...(alert.affected_staff ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.category === "urgent") - Number(a.category === "urgent") ||
        (priorities[a.severity] ?? 5) - (priorities[b.severity] ?? 5),
    );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  function clearFilters() {
    updateFilters({ area: "all", priority: "all", search: "", page: "1" });
  }
  return (
    <HubLayout>
      <div className="min-w-0 space-y-8 pb-12">
        <PageHeader
          eyebrow="Operations & Care"
          title="Delivery Quality"
          description="Follow up on shift coverage, participant contact and the quality of care records."
          actions={
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
              className={ghostClass}
            >
              <RefreshCw
                size={15}
                className={query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}
              />
              {query.isFetching ? "Refreshing" : "Refresh"}
            </button>
          }
        />
        <div aria-label="Care areas">
          <SummaryStrip
            loading={!known}
            items={areas.map(({ id, title, description }) => {
              const count = alerts.filter((alert) => alert.source === id).length;
              return {
                value: count,
                label: title,
                hint: description,
                tone: count ? "warning" : "good",
                active: area === id,
                onClick: () => setArea(area === id ? "all" : id),
              };
            })}
          />
        </div>
        <section
          aria-labelledby="care-follow-up"
          className="min-w-0 space-y-4"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2
                id="care-follow-up"
                className="text-lg font-semibold text-cc-text"
              >
                Care follow-up
              </h2>
              {known && (
                <p role="status" className="text-sm text-cc-muted">
                  {filtered.length} of {alerts.length} alerts
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative block w-full min-w-0 sm:max-w-sm">
                <span className="sr-only">Search care alerts</span>
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cc-muted"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, ID or concern"
                  className="h-11 w-full rounded-full border border-cc-border bg-cc-surface pl-11 pr-4 text-sm text-cc-text outline-none transition focus:ring-2 focus:ring-cc-plum"
                />
              </label>
              <label className="text-sm text-cc-text sm:ml-auto">
                <span className="sr-only">Priority</span>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  className="min-h-10 rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text"
                >
                  <option value="all">All priorities</option>
                  <option value="urgent">Urgent or high priority</option>
                </select>
              </label>
              {(area !== "all" || priority !== "all" || search) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className={ghostClass}
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
            <div role="status" aria-label="Loading care alerts" className="h-48 animate-pulse rounded-2xl bg-cc-surface" />
          ) : query.isError ? (
            <LoadError onRetry={query.isFetching ? undefined : () => void query.refetch()}>
              <AlertTriangle size={16} className="shrink-0 text-cc-muted" />
              <span>
                <span className="font-semibold">Care alerts could not be loaded.</span>{" "}
                <span className="text-cc-muted">Try again to check the current follow-up list.</span>
              </span>
            </LoadError>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title={alerts.length ? "No alerts match these filters" : "No care alerts returned"}
              body={
                alerts.length
                  ? "Try another care area, priority or search term."
                  : "Continue reviewing participant records and scheduled care as part of your regular follow-up."
              }
            />
          ) : (
            <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl bg-cc-surface">
              {visible.map((alert) => {
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
                      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StatusText tone={alert.severity === "critical" ? "danger" : urgent ? "warning" : "neutral"}>
                          {alert.severity === "critical"
                            ? "Critical"
                            : urgent
                              ? "Priority follow-up"
                              : "Follow-up"}
                        </StatusText>
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
                      className={`${outlineClass} shrink-0 self-start`}
                    >
                      {action.label}
                      <ArrowRight size={14} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {known && filtered.length > 10 && (
            <nav
              aria-label="Care alert pages"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <p role="status" className="text-sm text-cc-muted">
                Page {currentPage} of {pageCount}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  className={outlineClass}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage(currentPage + 1)}
                  className={outlineClass}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </section>
        <p className="text-xs leading-5 text-cc-muted">
          Contact and documentation alerts use up to 2,000 recent session
          records. A missing session does not confirm that no contact occurred.
          Check the participant record before following up.
        </p>
        <nav aria-label="Care management" className="flex flex-wrap gap-2">
          {[
            ["Participants", "/patients"],
            ["Master schedule", "/md/schedule"],
            ["Staff directory", "/md/staff"],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={ghostClass}
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
