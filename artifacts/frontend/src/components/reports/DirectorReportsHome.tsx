import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cc-border bg-cc-surface p-4">
        <div>
          <h2 className="text-sm font-semibold">Incident reporting</h2>
          <p className="mt-1 text-sm text-cc-muted">
            Record a new incident or follow up an existing report.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/incidents"
            className="inline-flex min-h-11 items-center rounded-lg border border-cc-border px-4 text-sm font-medium text-cc-plum"
          >
            View incident register
          </Link>
          <Link
            href="/incidents/new"
            className="inline-flex min-h-11 items-center rounded-lg bg-cc-plum px-4 text-sm font-semibold text-white"
          >
            Report an incident
          </Link>
        </div>
      </div>
      <section
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cc-border bg-cc-surface p-4 sm:p-5"
        aria-label="Saved documents"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-cc-text">
            Looking for a saved document?
          </h2>
          <p className="mt-1 text-sm text-cc-muted">
            Use the Vault to find stored files and organise evidence packs. Use
            Reports to review performance and generate reports.
          </p>
        </div>
        <Link
          href="/md/vault"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cc-border px-4 text-sm font-semibold text-cc-plum"
        >
          Open Vault
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
      <section
        className="rounded-xl border border-cc-border bg-cc-surface p-4 sm:p-5"
        aria-label="Find a management report"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="min-w-0 flex-1 text-sm font-medium">
            Find a report
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports, invoices or audit"
              className="mt-1 min-h-11"
            />
          </label>
          <label className="text-sm font-medium">
            Reporting area
            <select
              className="mt-1 block min-h-11 w-full rounded-md border border-cc-border bg-cc-surface px-3 sm:w-56"
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
        <p className="mt-3 text-sm text-cc-muted" aria-live="polite">
          {filtered.length} reports and workspaces. Available record filters are
          shown inside each report.
        </p>
      </section>
      {!filtered.length ? (
        <div className="rounded-xl border border-cc-border p-6 text-center">
          <p>No reports match your search.</p>
          <Button
            variant="link"
            onClick={() => {
              setSearch("");
              setCategory("All areas");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((report) => (
            <article
              key={report.id}
              className="flex min-w-0 flex-col rounded-xl border border-cc-border bg-cc-surface p-5"
            >
              <p className="text-xs font-semibold text-cc-muted">
                {report.category}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-cc-text">
                {report.title}
              </h2>
              <p className="mb-4 mt-2 text-sm leading-relaxed text-cc-muted">
                {report.description}
              </p>
              <div className="mt-auto border-t border-cc-border pt-3">
                {"href" in report ? (
                  <Link
                    href={report.href}
                    className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold text-cc-plum"
                  >
                    Open workspace
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <button
                    aria-label={`Open ${report.title}`}
                    onClick={() => onOpen(report.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-cc-plum"
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
      <p className="rounded-xl bg-cc-soft p-4 text-sm text-cc-muted">
        For one participant's records, open their profile and choose Export
        records. Use these reports for organisation-wide review.
      </p>
    </div>
  );
}
