import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Search } from "lucide-react";
import { getGetParticipantsQueryKey, useGetParticipants } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { matchesPerson, suburbFromAddress } from "@/lib/person-identity";
import { getCoordinatorWorkerStats } from "@/services/coordinatorService";

type NavigationGroup = {
  label: string;
  items: ReadonlyArray<{
    href: string;
    label: string;
    icon: ElementType;
    tabs?: ReadonlyArray<{ href: string; label: string }>;
  }>;
};

export type QuickAction = { href: string; label: string; detail: string; icon: ElementType };

type Result = {
  key: string;
  href: string;
  label: string;
  detail?: string;
  icon?: ElementType;
  /** People show their initials instead of an icon. */
  person?: boolean;
};

type Section = { title: string; results: Result[]; more: number };

type ParticipantRow = {
  id: string;
  full_name: string;
  preferred_name?: string | null;
  ndis_number?: string | null;
  address?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  status?: string | null;
};

const PEOPLE_SHOWN = 6;

function initials(name: string) {
  return name.trim().split(/\s+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function roleLabel(role?: string | null) {
  if (!role) return "Staff";
  const text = role.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The label with the typed text picked out, so it's clear why a row matched. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-[var(--cc-brand-purple)]">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </>
  );
}

/** Participants and staff, loaded only while the search is open. */
function usePeopleSections(query: string, enabled: boolean): { sections: Section[]; loading: boolean } {
  const participantsQuery = useGetParticipants({ query: { queryKey: getGetParticipantsQueryKey(), enabled } });
  const staffQuery = useOrgQuery(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
    enabled,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) return { sections: [], loading: false };

    const participants = ((participantsQuery.data as ParticipantRow[] | undefined) ?? [])
      .filter((p) => matchesPerson(q, [p.full_name, p.preferred_name, p.ndis_number, p.address, p.phone], p.date_of_birth))
      .map<Result>((p) => ({
        key: `participant:${p.id}`,
        href: `/patients?id=${encodeURIComponent(p.id)}`,
        label: p.full_name,
        detail: [p.ndis_number ? `NDIS ${p.ndis_number}` : null, suburbFromAddress(p.address)].filter(Boolean).join(" · ") || "Participant",
        person: true,
      }));

    const staff = (staffQuery.data ?? [])
      .filter((w) => matchesPerson(q, [w.full_name, w.email, w.phone, w.employee_id, w.suburb, w.address, roleLabel(w.role)], w.date_of_birth))
      .map<Result>((w) => ({
        key: `staff:${w.id}`,
        href: `/md/staff?workerId=${encodeURIComponent(w.id)}`,
        label: w.full_name,
        detail: [roleLabel(w.role), w.suburb || suburbFromAddress(w.address)].filter(Boolean).join(" · "),
        person: true,
      }));

    return {
      sections: [
        { title: "Participants", results: participants.slice(0, PEOPLE_SHOWN), more: Math.max(0, participants.length - PEOPLE_SHOWN) },
        { title: "Staff", results: staff.slice(0, PEOPLE_SHOWN), more: Math.max(0, staff.length - PEOPLE_SHOWN) },
      ],
      loading: participantsQuery.isLoading || staffQuery.isLoading,
    };
  }, [query, enabled, participantsQuery.data, participantsQuery.isLoading, staffQuery.data, staffQuery.isLoading]);
}

function ResultIcon({ result }: { result: Result }) {
  if (result.person) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--cc-soft)] text-[11px] font-semibold text-[var(--cc-text)]">
        {initials(result.label)}
      </span>
    );
  }
  const Icon = result.icon ?? ArrowRight;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--cc-soft)] text-[var(--cc-muted)]">
      <Icon size={16} />
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--cc-border)] bg-[var(--cc-surface)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--cc-muted)]">
      {children}
    </kbd>
  );
}

type SearchProps = {
  groups: readonly NavigationGroup[];
  actions: readonly QuickAction[];
  includePeople: boolean;
};

/** The search box and its results. Only mounted while the search is open, so
 *  participants and staff are loaded when someone actually searches. */
function SearchPanel({
  groups,
  actions,
  includePeople,
  onChoose,
  onClose,
}: SearchProps & { onChoose: (href: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [location] = useLocation();
  const listRef = useRef<HTMLDivElement>(null);

  const q = search.trim().toLowerCase();

  // Pages folded into another entry as tabs stay findable by their own name.
  const pages = groups
    .flatMap((group) =>
      group.items.flatMap((item) => [
        { key: `page:${item.href}`, href: item.href, label: item.label, icon: item.icon, detail: group.label },
        ...(item.tabs ?? [])
          .filter((tab) => tab.href !== item.href)
          .map((tab) => ({ key: `page:${tab.href}`, href: tab.href, label: tab.label, icon: item.icon, detail: `${group.label} · ${item.label}` })),
      ]),
    )
    .filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(q));

  const matchingActions = actions
    .filter((a) => `${a.label} ${a.detail}`.toLowerCase().includes(q))
    .map<Result>((a) => ({ key: `action:${a.href}`, ...a }));

  const people = usePeopleSections(search, includePeople);

  // Empty search: what you can do, then where you can go. Typing: people
  // first, since that's usually what's being looked for.
  const sections: Section[] = (
    q
      ? [...people.sections, { title: "Pages", results: pages, more: 0 }, { title: "Quick actions", results: matchingActions, more: 0 }]
      : [{ title: "Quick actions", results: matchingActions, more: 0 }, { title: "Pages", results: pages, more: 0 }]
  ).filter((s) => s.results.length > 0);
  const flat = sections.flatMap((s) => s.results);

  useEffect(() => setActiveIndex(0), [search]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);


  const placeholder = includePeople ? "Search participants, staff, suburbs or pages" : "Search pages";
  let index = -1;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-[var(--cc-border)] px-4">
        <Search size={18} className="shrink-0 text-[var(--cc-muted)]" />
        <input
          autoFocus
          role="textbox"
          aria-label="Search"
          aria-controls="management-search-results"
          aria-activedescendant={flat[activeIndex] ? `management-search-${activeIndex}` : undefined}
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter" && flat[activeIndex]) {
              event.preventDefault();
              onChoose(flat[activeIndex].href);
            }
          }}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-[var(--cc-text)] outline-none placeholder:text-[var(--cc-muted)]"
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-[var(--cc-muted)] hover:bg-[var(--cc-soft)] hover:text-[var(--cc-text)]"
        >
          <span className="sm:hidden">Cancel</span>
          <span className="hidden sm:inline"><Kbd>Esc</Kbd></span>
        </button>
      </div>

      <div ref={listRef} id="management-search-results" role="listbox" aria-label="Results" className="min-h-0 overflow-y-auto p-2">
        <p aria-live="polite" className="sr-only">
          {flat.length} {flat.length === 1 ? "result" : "results"}
        </p>
        {flat.length === 0 ? (
          <div className="px-3 py-10 text-center">
            {people.loading ? (
              <p className="text-sm text-[var(--cc-muted)]">Searching...</p>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--cc-text)]">Nothing matches "{search.trim()}"</p>
                <p className="mt-1 text-sm text-[var(--cc-muted)]">
                  {includePeople ? "Try a first name, an NDIS number, a suburb or a page name." : "Try a different name."}
                </p>
              </>
            )}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.title} role="group" aria-label={section.title} className="mb-1 last:mb-0">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold text-[var(--cc-muted)]">{section.title}</p>
              {section.results.map((result) => {
                index += 1;
                const i = index;
                const active = i === activeIndex;
                return (
                  <button
                    key={result.key}
                    id={`management-search-${i}`}
                    data-index={i}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-current={location === result.href ? "page" : undefined}
                    onMouseMove={() => setActiveIndex(i)}
                    onClick={() => onChoose(result.href)}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                      active ? "bg-[var(--cc-brand-purple-soft)]" : ""
                    }`}
                  >
                    <ResultIcon result={result} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--cc-text)]">
                        <Highlighted text={result.label} query={search} />
                      </span>
                      {result.detail && (
                        <span className="block truncate text-xs text-[var(--cc-muted)]">{result.detail}</span>
                      )}
                    </span>
                    <ArrowRight
                      size={16}
                      className={`shrink-0 text-[var(--cc-brand-purple)] transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
                    />
                  </button>
                );
              })}
              {section.more > 0 && (
                <p className="px-3 pb-1 pt-1 text-xs text-[var(--cc-muted)]">
                  {section.more} more. Keep typing to narrow it down.
                </p>
              )}
            </div>
          ))
        )}
      </div>

      <div className="hidden items-center gap-4 border-t border-[var(--cc-border)] px-4 py-2.5 text-xs text-[var(--cc-muted)] sm:flex">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span>
        <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> to open</span>
        <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> to close</span>
      </div>
    </>
  );
}

/** The header search: pages, quick actions and, with `includePeople`, the
 *  organisation's participants and staff by name, NDIS number, suburb, phone
 *  or email. Ctrl / Cmd K opens it from anywhere. */
export function ManagementPageSearch({
  groups,
  actions = [],
  includePeople = false,
  compactOnDesktop = false,
}: {
  groups: readonly NavigationGroup[];
  actions?: readonly QuickAction[];
  includePeople?: boolean;
  /** Shrink to an icon on standard desktop widths, where the main menu sits
   * in the same bar and needs the room; the full box returns on wide screens. */
  compactOnDesktop?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        // Keep shortcuts local when another modal is already open.
        if (!open && document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          // Icon-only (phones, and desktop when compact) it is a plain round icon
          // button like the bell and calendar next to it; with its label it
          // reads as a search field.
          className={`flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full text-left text-sm text-cc-muted transition-colors hover:bg-cc-soft hover:text-cc-text md:w-full md:justify-start md:rounded-xl md:border md:border-cc-border md:bg-cc-soft md:px-3 md:hover:border-cc-muted/40 ${
            compactOnDesktop ? "xl:max-[1799px]:w-11 xl:max-[1799px]:justify-center xl:max-[1799px]:rounded-full xl:max-[1799px]:border-transparent xl:max-[1799px]:bg-transparent xl:max-[1799px]:px-0" : ""
          }`}
          aria-label="Search"
          title="Search (Ctrl / Cmd K)"
        >
          <Search className="h-[18px] w-[18px] shrink-0" />
          <span className={`hidden md:inline ${compactOnDesktop ? "xl:max-[1799px]:hidden" : ""}`}>Search</span>
          <kbd className={`ml-auto hidden text-xs lg:inline ${compactOnDesktop ? "xl:max-[1799px]:hidden" : ""}`}>Ctrl / Cmd K</kbd>
        </button>
      </DialogTrigger>
      {/* Sits near the top rather than centred, so the box doesn't jump as
          results come and go. */}
      <DialogContent
        hideCloseButton
        className="top-[10dvh] max-h-[80dvh] translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-2xl border-[var(--cc-border)] bg-[var(--cc-surface)] p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          {includePeople ? "Find participants, staff, pages and quick actions." : "Find a page."}
        </DialogDescription>
        <SearchPanel
          groups={groups}
          actions={actions}
          includePeople={includePeople}
          onChoose={(href) => {
            setOpen(false);
            navigate(href);
          }}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
