/**
 * Labels: the office's own words for finding people ("Autism", "Female
 * worker only", "Lives in the hills"). One list for the organisation,
 * shared by participants and staff, kept on the server (tag_service
 * "Labels").
 *
 * - <PersonLabels>: a person's labels as chips, with "Add label". Typing
 *   shows the labels that already exist, so the same word is reused; a new
 *   one is made only when nothing matches (and the server matches by the
 *   words again, ignoring case, so "autism" never becomes a second label).
 * - <LabelFilter> and useLabels(): narrow a list of people to one label, and
 *   let search find people by their labels.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Tag, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { addLabel, getLabels, removeLabel, type LabelOverview, type LabelTarget, type OrgLabel } from "@/services/labelService";

export const LABELS_QUERY = ["labels"] as const;
const ALL = "__all__";

function key(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** The organisation's labels and who has which. */
export function useLabels(enabled = true) {
  const query = useOrgQuery(LABELS_QUERY, { queryFn: getLabels, enabled, staleTime: 60_000 });
  // Only the shape the server sends; anything else is treated as no labels.
  const data: LabelOverview | undefined = Array.isArray(query.data?.labels) ? query.data : undefined;
  const byId = useMemo(() => new Map((data?.labels ?? []).map((l) => [l.id, l])), [data]);
  const idsOf = (target: LabelTarget, personId?: string | null) => (personId ? data?.[target]?.[personId] ?? [] : []);
  const labelsOf = (target: LabelTarget, personId?: string | null): OrgLabel[] =>
    idsOf(target, personId).map((id) => byId.get(id)).filter((l): l is OrgLabel => !!l);
  return {
    labels: data?.labels ?? [],
    isLoading: query.isLoading,
    labelsOf,
    /** The person's label words, for search to match on. */
    wordsOf: (target: LabelTarget, personId?: string | null) => labelsOf(target, personId).map((l) => l.label),
    /** True when no label is chosen, or the person has it. */
    has: (target: LabelTarget, personId: string | null | undefined, labelId: string | null) =>
      !labelId || idsOf(target, personId).includes(labelId),
  };
}

/** Pick one label to narrow a list to. Hidden until the organisation has any. */
export function LabelFilter({ target, value, onChange, className }: {
  target: LabelTarget;
  value: string | null;
  onChange: (labelId: string | null) => void;
  className?: string;
}) {
  const { labels } = useLabels();
  const used = labels.filter((l) => l[target] > 0 || l.id === value);
  if (!used.length) return null;
  return (
    <div className={className}>
      <SearchableSelect
        ariaLabel="Filter by label"
        value={value ?? ALL}
        onValueChange={(v) => onChange(v === ALL ? null : v)}
        options={[
          { value: ALL, label: "All labels", keywords: "all" },
          ...used.map((l) => ({ value: l.id, label: l.label, detail: `${l[target]} ${target === "participants" ? "participant" : "staff member"}${l[target] === 1 ? "" : "s"}` })),
        ]}
        placeholder="All labels"
        searchPlaceholder="Find a label"
        emptyText="No label matches"
        triggerClassName="h-8 text-[12px]"
      />
    </div>
  );
}

/** A person's labels, and adding or removing one. */
export function PersonLabels({ target, personId, personName, compact = false }: {
  target: LabelTarget;
  personId: string;
  personName?: string;
  /** Smaller chips, for a panel header. */
  compact?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { labels, labelsOf } = useLabels();
  const mine = labelsOf(target, personId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const exact = labels.find((l) => key(l.label) === key(text));
  const mineIds = new Set(mine.map((l) => l.id));

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("labels") });

  async function add(choice: { tag_id: string } | { label: string }, shown: string) {
    setBusy("add");
    try {
      await addLabel(target, personId, choice);
      await refresh();
      setText("");
      setOpen(false);
    } catch (err) {
      toast({ title: `Couldn't add "${shown}"`, description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(label: OrgLabel) {
    setBusy(label.id);
    try {
      await removeLabel(target, personId, label.id);
      await refresh();
    } catch (err) {
      toast({ title: `Couldn't remove "${label.label}"`, description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const chip = compact ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs";
  const clean = text.trim().replace(/\s+/g, " ");

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={personName ? `Labels for ${personName}` : "Labels"}>
      {mine.map((l) => (
        <span key={l.id} className={`inline-flex items-center gap-1 rounded-full border border-cc-border bg-cc-soft font-medium text-cc-text ${chip}`}>
          <Tag size={compact ? 10 : 11} aria-hidden className="text-cc-muted" />
          {l.label}
          <button
            type="button"
            aria-label={`Remove label ${l.label}`}
            onClick={() => void remove(l)}
            disabled={busy === l.id}
            className="-mr-1 ml-0.5 rounded-full p-0.5 text-cc-muted hover:bg-cc-surface hover:text-cc-text"
          >
            {busy === l.id ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText(""); }} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-full border border-dashed border-cc-border font-medium text-cc-muted hover:bg-cc-soft hover:text-cc-text ${chip}`}
          >
            <Plus size={compact ? 11 : 12} aria-hidden /> {mine.length ? "Label" : "Add label"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="z-[100] w-72 border-cc-border p-0" align="start">
          <Command filter={(value, search) => (key(value).includes(key(search)) ? 1 : 0)}>
            <CommandInput placeholder="Find or make a label" value={text} onValueChange={setText} maxLength={60} />
            <CommandList>
              <CommandEmpty>{clean ? "No label like that yet." : "No labels yet. Type one to make it."}</CommandEmpty>
              {labels.length > 0 && (
                <CommandGroup heading="Labels in use">
                  {labels.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={l.label}
                      disabled={busy === "add"}
                      onSelect={() => (mineIds.has(l.id) ? setOpen(false) : void add({ tag_id: l.id }, l.label))}
                    >
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate">{l.label}</span>
                        <span className="shrink-0 text-[11px] text-cc-muted">{l.participants + l.workers}</span>
                      </span>
                      <Check className={`ml-2 h-4 w-4 shrink-0 ${mineIds.has(l.id) ? "opacity-100" : "opacity-0"}`} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {clean && !exact && (
                <CommandGroup heading="New label">
                  <CommandItem value={`__create__ ${clean}`} onSelect={() => void add({ label: clean }, clean)} disabled={busy === "add"}>
                    {busy === "add" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
                    Make "{clean}"
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          <p className="border-t border-cc-border px-3 py-2 text-[11px] text-cc-muted">
            Labels are shared, so pick one that's there before making a new one.
            {target === "workers" ? " Staff don't see their labels." : ""}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
