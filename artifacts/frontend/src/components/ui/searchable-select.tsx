import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchesPerson } from "@/lib/person-identity";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export type SearchableOption = {
  value: string;
  label: string;
  /** What the option is found by as well as its label: an NDIS number, a
   * staff ID, a phone number. Each entry is matched on its own. */
  keywords?: string | string[];
  /** A second, muted line under the label that tells look-alikes apart:
   * "NDIS 431990001 · Glenelg". */
  detail?: string | null;
  /** Optional group heading. Options sharing a group render together under
   * one heading, in order of the group's first appearance; options with no
   * group render in a single unheaded group, same as before grouping existed. */
  group?: string;
};

/** Single-select combobox: a Select-like trigger that opens a filterable
 * cmdk list. `keywords` (falling back to `label`) is what each option is
 * matched against as the user types: every word typed has to appear in it,
 * so "sam 1042" finds the Sam with staff ID 1042. */

// Each item is identified by its own value (two people can share a name, and
// cmdk treats items with the same value as one), and matched on its keywords
// only, word by word rather than fuzzily, so "1042" doesn't match any text
// that happens to contain a 1, 0, 4 and 2.
function matchOption(_value: string, search: string, keywords?: string[]) {
  return matchesPerson(search, keywords ?? []) ? 1 : 0;
}
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  renderTrigger,
  renderOption,
  id,
  triggerClassName,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  renderTrigger?: (selected: SearchableOption | undefined) => ReactNode;
  renderOption?: (option: SearchableOption, selected: boolean) => ReactNode;
  /** For a <label htmlFor>. */
  id?: string;
  /** Size the trigger to match the form around it, e.g. "h-11". */
  triggerClassName?: string;
  /** Names the picker when there's no visible label for it. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const groups = new Map<string | undefined, SearchableOption[]>();
  for (const option of options) {
    const bucket = groups.get(option.group);
    if (bucket) bucket.push(option);
    else groups.set(option.group, [option]);
  }

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => setOpen(disabled ? false : next)} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          id={id}
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-xl border border-cc-border bg-cc-surface px-3 py-2 text-sm text-cc-text shadow-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName,
          )}
        >
          <span className={cn("truncate", !selected && "text-cc-muted")}>
            {renderTrigger
              ? renderTrigger(selected)
              : selected?.label ?? placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-[var(--radix-popover-trigger-width)] p-0 border-cc-border"
        align="start"
      >
        <Command filter={matchOption}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {[...groups.entries()].map(([groupName, groupOptions]) => (
              <CommandGroup key={groupName ?? "__ungrouped__"} heading={groupName}>
                {groupOptions.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, ...(Array.isArray(option.keywords) ? option.keywords : option.keywords ? [option.keywords] : [])].filter(Boolean)}
                      onSelect={() => {
                        onValueChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                        {renderOption ? (
                          renderOption(option, isSelected)
                        ) : option.detail ? (
                          <span className="min-w-0">
                            <span className="block truncate">{option.label}</span>
                            <span className="block truncate text-xs text-cc-muted">{option.detail}</span>
                          </span>
                        ) : (
                          option.label
                        )}
                      </span>
                      <Check
                        className={cn(
                          "ml-2 h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
