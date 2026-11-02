import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { ChevronRight, FileText } from "lucide-react";
import { useGetParticipants, useGetSessions } from "@workspace/api-client-react";
import {
  EmptyState,
  LoadError,
  RowList,
  SearchField,
  SkeletonBlocks,
  StatusText,
  SummaryStrip,
  Surface,
  ghostClass,
  outlineClass,
  rowClass,
  type Tone,
} from "@/components/layout/PageKit";

type Filter = "all" | "compliant" | "at_risk" | "non_compliant" | "draft";

const PAGE = 10;

interface SessionRow {
  id: string;
  patient_id?: string | null;
  participant_id?: string | null;
  participant_name?: string | null;
  session_date: string;
  session_type?: string | null;
  duration_minutes?: number | null;
  compliance_score?: number | null;
}

function bucket(score: number | null | undefined): Exclude<Filter, "all"> {
  if (score == null) return "draft";
  if (score >= 85) return "compliant";
  if (score >= 60) return "at_risk";
  return "non_compliant";
}

const BUCKET_META: Record<Exclude<Filter, "all">, { label: string; tone: Tone }> = {
  compliant: { label: "Compliant", tone: "good" },
  at_risk: { label: "At risk", tone: "warning" },
  non_compliant: { label: "Non-compliant", tone: "danger" },
  draft: { label: "Not scored yet", tone: "neutral" },
};

function day(value: string) {
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return value.slice(0, 10);
  }
}

/**
 * Shift notes and their documentation scores, the most recent 200 shifts.
 * Moved here from the old Report library: it's documentation quality, so it
 * sits with Audit & Compliance.
 */
export default function ShiftNotesReport() {
  const sessionsQuery = useGetSessions({ limit: 200 });
  const participantsQuery = useGetParticipants();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [search, filter, dateFrom, dateTo]);

  // The shift list carries the participant's id but not their name.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of (participantsQuery.data ?? []) as Array<{ id: string; full_name?: string }>) {
      if (p.id && p.full_name) map.set(String(p.id), p.full_name);
    }
    return map;
  }, [participantsQuery.data]);

  const rows = useMemo(
    () =>
      ((sessionsQuery.data ?? []) as SessionRow[])
        .map((s) => ({
          ...s,
          name: s.participant_name || names.get(String(s.patient_id ?? s.participant_id ?? "")) || "Participant not on file",
          bucket: bucket(s.compliance_score),
        }))
        .sort((a, b) => (b.session_date || "").localeCompare(a.session_date || "")),
    [sessionsQuery.data, names],
  );

  const inRange = rows.filter((s) => {
    const d = (s.session_date || "").slice(0, 10);
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  });
  const count = (b: Exclude<Filter, "all">) => inRange.filter((s) => s.bucket === b).length;
  const q = search.trim().toLowerCase();
  const filtered = inRange.filter(
    (s) =>
      (filter === "all" || s.bucket === filter) &&
      (!q || s.name.toLowerCase().includes(q) || (s.session_type ?? "").toLowerCase().includes(q)),
  );
  const badRange = dateFrom && dateTo && dateFrom > dateTo;
  const anyFilter = search || filter !== "all" || dateFrom || dateTo;
  const dateClass = "min-h-10 rounded-full border border-cc-border bg-cc-surface px-4 text-sm text-cc-text";

  return (
    <div className="space-y-6">
      <SummaryStrip
        loading={sessionsQuery.isLoading}
        items={[
          { value: inRange.length, label: "shifts", onClick: () => setFilter("all"), active: filter === "all" },
          { value: count("compliant"), label: "compliant", tone: "good", onClick: () => setFilter("compliant"), active: filter === "compliant" },
          { value: count("at_risk"), label: "at risk", tone: count("at_risk") ? "warning" : undefined, onClick: () => setFilter("at_risk"), active: filter === "at_risk" },
          { value: count("non_compliant"), label: "non-compliant", tone: count("non_compliant") ? "danger" : "good", onClick: () => setFilter("non_compliant"), active: filter === "non_compliant" },
          { value: count("draft"), label: "not scored yet", onClick: () => setFilter("draft"), active: filter === "draft" },
        ]}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchField label="Search shift notes" placeholder="Search participant or support type" value={search} onChange={setSearch} />
        <div className="flex flex-wrap items-center gap-2 text-sm text-cc-muted">
          <label className="flex items-center gap-2">
            From
            <input type="date" aria-label="Shift dates from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={dateClass} />
          </label>
          <label className="flex items-center gap-2">
            to
            <input type="date" aria-label="Shift dates to" min={dateFrom || undefined} value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={dateClass} />
          </label>
          {anyFilter && (
            <button type="button" className={ghostClass} onClick={() => { setSearch(""); setFilter("all"); setDateFrom(""); setDateTo(""); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>
      {badRange && <p role="alert" className="text-sm" style={{ color: "var(--cc-danger-text)" }}>The end date must be on or after the start date.</p>}
      <p className="text-sm text-cc-muted">
        The most recent 200 shifts. For one participant's full history, open their profile and choose Export records.
      </p>

      {sessionsQuery.isError ? (
        <LoadError onRetry={() => void sessionsQuery.refetch()}>Shift notes could not be loaded.</LoadError>
      ) : sessionsQuery.isLoading ? (
        <SkeletonBlocks count={4} height="h-14" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No shift notes match" body={anyFilter ? "Try another filter or date range." : "Shift notes appear here once workers record their shifts."} />
      ) : (
        <Surface>
          <RowList>
            {filtered.slice(0, shown).map((s) => {
              const meta = BUCKET_META[s.bucket];
              return (
                <li key={s.id}>
                  <Link href={`/sessions/${s.id}`} className={rowClass}>
                    <span className="hidden w-24 shrink-0 text-xs text-cc-muted sm:block">{day(s.session_date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-cc-text">{s.name}</span>
                      <span className="block truncate text-xs text-cc-muted">
                        <span className="sm:hidden">{day(s.session_date)} · </span>
                        {(s.session_type ?? "session").replace(/_/g, " ")}
                        {s.duration_minutes != null ? ` · ${s.duration_minutes} min` : ""}
                      </span>
                    </span>
                    <StatusText tone={meta.tone}>
                      {meta.label}
                      {s.compliance_score != null ? ` · ${Math.round(s.compliance_score)}%` : ""}
                    </StatusText>
                    <ChevronRight size={16} className="shrink-0 text-cc-muted" />
                  </Link>
                </li>
              );
            })}
          </RowList>
          {filtered.length > shown && (
            <div className="border-t border-cc-border px-4 py-3 text-center sm:px-5">
              <button type="button" className={outlineClass} onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length - shown}
              </button>
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}
