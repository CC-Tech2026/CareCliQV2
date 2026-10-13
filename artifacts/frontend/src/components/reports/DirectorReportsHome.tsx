import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, FolderLock, Search, Siren } from "lucide-react";
import { ctaClass, outlineClass } from "@/components/layout/PageKit";

export const DIRECTOR_REPORTS = [
  {
    id: "sessions",
    title: "Shift documentation",
    category: "Service delivery",
    description: "Review participant shift records and documentation scores.",
  },
  {
    id: "incidents",
    title: "Incident register",
    category: "Quality & safety",
    description: "Review recorded incidents, severity and follow-up.",
  },
  {
    id: "compliance",
    title: "Documentation quality",
    category: "Quality & safety",
    description: "Review documentation checks across the organisation.",
  },
  {
    id: "audit",
    title: "Audit preparation",
    category: "Quality & safety",
    description: "Identify documentation gaps before a quality review.",
  },
  {
    id: "financial",
    title: "Revenue & invoices",
    category: "Finance",
    description: "Review billed, paid and outstanding invoice amounts.",
    href: "/md/financial",
  },
  {
    id: "delivery",
    title: "Service delivery overview",
    category: "Service delivery",
    description: "Review delivery trends and participant outcomes.",
    href: "/md/service-delivery",
  },
  {
    id: "ai",
    title: "Suggested insights",
    category: "Quality & safety",
    description: "Review automated suggestions alongside the source records.",
  },
  {
    id: "clinical",
    title: "Participant reports",
    category: "Service delivery",
    description:
      "Generate a participant report from their recorded care information.",
  },
] as const;

export function DirectorReportsHome({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All areas");
  const filtered = DIRECTOR_REPORTS.filter(
    (report) =>
      (category === "All areas" || report.category === category) &&
      `${report.title} ${report.category} ${report.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="space-y-8">
      <div className="overflow-hidden rounded-2xl bg-cc-surface">
        <ul className="divide-y divide-cc-border">
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cc-soft text-cc-muted" aria-hidden="true">
                <Siren className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-cc-text">Incident reporting</h2>
                <p className="mt-0.5 text-sm text-cc-muted">Record a new incident or follow up an existing report.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/incidents" className={outlineClass}>View incident register</Link>
              <Link href="/incidents/new" className={ctaClass}>Report an incident</Link>
            </div>
          </li>
          <li>
            <section className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" aria-label="Saved documents">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cc-soft text-cc-muted" aria-hidden="true">
                  <FolderLock className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-cc-text">Looking for a saved document?</h2>
                  <p className="mt-0.5 text-sm text-cc-muted">
                    Use the Vault to find stored files and organise evidence packs. Use Reports to review performance and generate reports.
                  </p>
                </div>
              </div>
              <Link href="/md/vault" className={outlineClass}>
                Open Vault
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          </li>
        </ul>
      </div>

      <section className="space-y-4" aria-label="Find a management report">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-cc-text">Reports</h2>
            <p className="mt-0.5 text-sm text-cc-muted" aria-live="polite">
              {filtered.length} reports and workspaces. Available record filters are shown inside each report.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">Find a report</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports, invoices or audit"
              className="h-11 w-full rounded-full border border-cc-border bg-cc-surface pl-11 pr-4 text-sm text-cc-text outline-none transition focus:ring-2 focus:ring-cc-plum"
            />
          </label>
          <label className="text-sm text-cc-text">
            <span className="sr-only">Reporting area</span>
            <select
              className="min-h-10 w-full rounded-full border border-cc-border bg-cc-surface px-4 text-sm sm:w-56"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "All areas",
                "Service delivery",
                "Quality & safety",
                "Finance",
              ].map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </label>
        </div>

        {!filtered.length ? (
          <div className="rounded-2xl bg-cc-surface px-6 py-12 text-center">
            <Search className="mx-auto mb-3 h-6 w-6 text-cc-muted" />
            <p className="text-base font-semibold text-cc-text">No reports match your search.</p>
            <button
              type="button"
              className={`${outlineClass} mt-4`}
              onClick={() => {
                setSearch("");
                setCategory("All areas");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((report) => (
              <article
                key={report.id}
                className="flex min-w-0 flex-col rounded-2xl bg-cc-surface p-5"
              >
                <p className="text-xs font-semibold text-cc-muted">{report.category}</p>
                <h2 className="mt-1 text-base font-semibold text-cc-text">{report.title}</h2>
                <p className="mb-4 mt-1 text-sm leading-6 text-cc-muted">{report.description}</p>
                <div className="mt-auto">
                  {"href" in report ? (
                    <Link href={report.href} className={outlineClass}>
                      Open workspace
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Open ${report.title}`}
                      onClick={() => onOpen(report.id)}
                      className={outlineClass}
                    >
                      Open report
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="text-sm text-cc-muted">
        For one participant's records, open their profile and choose Export
        records. Use these reports for organisation-wide review.
      </p>
    </div>
  );
}
