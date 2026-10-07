import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { VaultTreePerson } from "@/services/vaultService";
import { StatePill } from "./TreeSubfolderGrid";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";

type StatusFilter = "active" | "exited" | "prospective" | "all";

const STATUS_LABELS: Record<VaultTreePerson["status"], string> = {
  active: "Active",
  exited: "Exited",
  prospective: "Not yet active",
};

export function personHref(top: string, personId: string, sub?: string) {
  const base = `/md/vault/tree/${top}/person/${encodeURIComponent(personId)}`;
  return sub ? `${base}/${sub}` : base;
}

export function TreePeopleList({
  top,
  people,
  personNoun,
  initialGapsOnly = false,
}: {
  top: string;
  people: VaultTreePerson[];
  /** "participant" or "worker", for the copy. */
  personNoun: string;
  initialGapsOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [gapsOnly, setGapsOnly] = useState(initialGapsOnly);

  const gapTotal = people.reduce((n, p) => n + p.gap_count, 0);
  const gapPeople = people.filter((p) => p.gap_count > 0).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) =>
      (status === "all" || p.status === status) &&
      (!gapsOnly || p.gap_count > 0) &&
      (!q || p.name.toLowerCase().includes(q) || (p.ref ?? "").toLowerCase().includes(q))
    );
  }, [people, query, status, gapsOnly]);

  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold" style={{ color: gapTotal ? "var(--cc-status-danger)" : MUTED }}>
        {gapTotal
          ? `${gapTotal} ${gapTotal === 1 ? "gap" : "gaps"} across ${gapPeople} ${gapPeople === 1 ? personNoun : `${personNoun}s`}`
          : `No gaps across active ${personNoun}s`}
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3" style={{ borderColor: BORDER, background: SURFACE }}>
        <input
          aria-label={`Search ${personNoun}s`}
          type="search"
          placeholder={`Search by name or ${personNoun === "participant" ? "NDIS number" : "employee ID"}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 min-w-0 flex-1 basis-56 rounded-md border bg-transparent px-3 text-sm"
          style={{ borderColor: BORDER }}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-10 rounded-md border bg-transparent px-2 text-sm"
          style={{ borderColor: BORDER }}
        >
          <option value="active">Active</option>
          <option value="exited">Exited</option>
          <option value="prospective">Not yet active</option>
          <option value="all">All</option>
        </select>
        <label className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
          <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} />
          Only {personNoun}s with gaps
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border p-6 text-center text-[13px]" style={{ borderColor: BORDER, background: SURFACE, color: MUTED }}>
          No {personNoun}s match.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
          {visible.map((person) => {
            const gaps = person.subfolders.filter((s) => s.state === "missing" || s.state === "expired");
            return (
              <li key={person.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ borderColor: BORDER }}>
                <Link href={personHref(top, person.id)} className="flex min-w-0 flex-1 basis-56 items-center gap-2 hover:underline">
                  <span className="truncate text-[14px] font-bold" style={{ color: TEXT }}>{person.name}</span>
                  {person.ref && <span className="shrink-0 text-[12px]" style={{ color: MUTED }}>{person.ref}</span>}
                  {person.status !== "active" && (
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: BORDER, color: MUTED }}>
                      {STATUS_LABELS[person.status]}
                    </span>
                  )}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5">
                  {gaps.map((s) => (
                    <Link key={s.key} href={personHref(top, person.id, s.key)} title={s.missing.length ? `Not on file: ${s.missing.join(", ")}` : undefined}>
                      <StatePill state={s.state} label={s.label} />
                    </Link>
                  ))}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold" style={{ color: MUTED }}>
                  {person.document_count} {person.document_count === 1 ? "document" : "documents"}
                  <ChevronRight size={14} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
