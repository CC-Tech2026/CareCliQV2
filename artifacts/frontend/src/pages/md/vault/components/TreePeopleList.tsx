import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, UserRound } from "lucide-react";
import type { VaultTreePerson } from "@/services/vaultService";
import { FolderCard, type FolderMenuItem } from "./FileManager";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

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
  sizeOf,
  menuFor,
}: {
  /** The ⋮ menu for a person's folder. */
  menuFor?: (person: VaultTreePerson) => FolderMenuItem[];
  /** Size of a person's folder, e.g. "1.2 MB". */
  sizeOf?: (personId: string) => string | undefined;
  top: string;
  people: VaultTreePerson[];
  /** "participant" or "worker", for the copy. */
  personNoun: string;
  initialGapsOnly?: boolean;
}) {
  const [, navigate] = useLocation();
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

  const counts: Record<StatusFilter, number> = {
    active: people.filter((p) => p.status === "active").length,
    exited: people.filter((p) => p.status === "exited").length,
    prospective: people.filter((p) => p.status === "prospective").length,
    all: people.length,
  };
  const pill = (selected: boolean) =>
    selected
      ? { background: TEXT, color: "var(--cc-bg)" }
      : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` };
  const pillClass =
    "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum";

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold" style={{ color: gapTotal ? "var(--cc-danger-text)" : MUTED }}>
        {gapTotal
          ? `${gapTotal} ${gapTotal === 1 ? "gap" : "gaps"} across ${gapPeople} ${gapPeople === 1 ? personNoun : `${personNoun}s`}`
          : `No gaps across active ${personNoun}s`}
      </p>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <input
            aria-label={`Search ${personNoun}s`}
            type="search"
            placeholder={`Search by name or ${personNoun === "participant" ? "NDIS number" : "employee ID"}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-full border bg-cc-surface pl-11 pr-4 text-sm outline-none transition focus:ring-2 focus:ring-cc-plum"
            style={{ borderColor: BORDER, color: TEXT }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter">
          {(["active", "prospective", "exited", "all"] as const)
            .filter((key) => key === "all" || key === "active" || counts[key] > 0)
            .map((key) => (
              <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)} className={pillClass} style={pill(status === key)}>
                {key === "all" ? "Everyone" : STATUS_LABELS[key]}
                <span className="tabular-nums" style={{ opacity: 0.7 }}>{counts[key]}</span>
              </button>
            ))}
          {gapPeople > 0 && (
            <button type="button" aria-pressed={gapsOnly} onClick={() => setGapsOnly((v) => !v)} className={pillClass} style={pill(gapsOnly)}>
              With gaps
              <span className="tabular-nums" style={{ opacity: 0.7 }}>{gapPeople}</span>
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl bg-cc-surface p-8 text-center text-sm" style={{ color: MUTED }}>
          No {personNoun}s match.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((person) => {
            const gaps = person.subfolders.filter((s) => s.state === "missing" || s.state === "expired");
            const required = person.subfolders.filter((s) => s.state !== "not_applicable");
            const listed = required.slice(0, 7);
            return (
              <FolderCard
                key={person.id}
                compact
                title={person.name}
                Icon={UserRound}
                muted={person.status !== "active"}
                meta={[
                  [`${person.document_count} ${person.document_count === 1 ? "file" : "files"}`, sizeOf?.(person.id)]
                    .filter(Boolean)
                    .join(" · "),
                  person.ref ?? (person.status !== "active" ? STATUS_LABELS[person.status] : undefined),
                ]}
                status={
                  gaps.length
                    ? { label: `Missing: ${gaps.map((g) => g.label).join(", ")}`, tone: "danger" }
                    : { label: "Nothing missing", tone: "good" }
                }
                onOpen={() => navigate(personHref(top, person.id))}
                menu={menuFor?.(person)}
                preview={{
                  nodes: listed.map((s) => {
                    const gap = s.state === "missing" || s.state === "expired";
                    return {
                      kind: "folder" as const,
                      label: s.label,
                      href: personHref(top, person.id, s.key),
                      meta: gap ? (s.state === "expired" ? "Expired" : "Missing") : String(s.count),
                      tone: gap ? (s.state === "expired" ? "warning" : "danger") : "neutral",
                    };
                  }),
                  more: required.length - listed.length,
                  moreNoun: "folders",
                  empty: "No folders are required yet.",
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
