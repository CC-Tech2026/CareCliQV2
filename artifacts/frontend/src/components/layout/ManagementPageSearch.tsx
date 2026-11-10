import { useEffect, useState, type ElementType } from "react";
import { useLocation } from "wouter";
import { Search, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type NavigationGroup = {
  label: string;
  items: ReadonlyArray<{
    href: string;
    label: string;
    icon: ElementType;
    tabs?: ReadonlyArray<{ href: string; label: string }>;
  }>;
};
export function ManagementPageSearch({
  groups,
  compactOnDesktop = false,
}: {
  groups: readonly NavigationGroup[];
  /** Shrink to an icon on standard desktop widths, where the main menu sits
   * in the same bar and needs the room; the full box returns on wide screens. */
  compactOnDesktop?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [location, navigate] = useLocation();
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
        if (!open) setSearch("");
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);
  // Pages folded into another entry as tabs stay findable by their own name.
  const matches = groups
    .flatMap((group) =>
      group.items.flatMap((item) => [
        { href: item.href, label: item.label, icon: item.icon, group: group.label },
        ...(item.tabs ?? [])
          .filter((tab) => tab.href !== item.href)
          .map((tab) => ({ href: tab.href, label: tab.label, icon: item.icon, group: `${group.label} · ${item.label}` })),
      ]),
    )
    .filter((item) =>
      `${item.label} ${item.group}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    );
  function choose(href: string) {
    setOpen(false);
    navigate(href);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setSearch("");
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          // Icon-only (phones, and desktop when compact) it is a plain round icon
          // button like the bell and calendar next to it; with its label it
          // reads as a search field.
          className={`flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full text-left text-sm text-cc-muted transition-colors hover:bg-cc-soft hover:text-cc-text md:w-full md:justify-start md:rounded-xl md:border md:border-cc-border md:bg-cc-soft md:px-3 md:hover:border-cc-muted/40 ${
            compactOnDesktop ? "xl:max-[1799px]:w-11 xl:max-[1799px]:justify-center xl:max-[1799px]:rounded-full xl:max-[1799px]:border-transparent xl:max-[1799px]:bg-transparent xl:max-[1799px]:px-0" : ""
          }`}
          aria-label="Find a page"
          title="Find a page (Ctrl / Cmd K)"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className={`hidden md:inline ${compactOnDesktop ? "xl:max-[1799px]:hidden" : ""}`}>Find a page</span>
          <kbd className={`ml-auto hidden text-xs lg:inline ${compactOnDesktop ? "xl:max-[1799px]:hidden" : ""}`}>Ctrl / Cmd K</kbd>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Find a page</DialogTitle>
          <DialogDescription>
            Search management pages. Use filters within each page to find
            records.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search management pages"
          placeholder="Try staff, invoices or reports"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.length === 1) {
              event.preventDefault();
              choose(matches[0].href);
            }
          }}
        />
        <p aria-live="polite" className="text-xs text-cc-muted">
          {matches.length} matching pages
        </p>
        <div className="max-h-[50dvh] overflow-y-auto">
          {!matches.length ? (
            <p className="p-4 text-sm text-cc-muted">
              No matching pages. Try a different name.
            </p>
          ) : (
            matches.map((item) => (
              <button
                key={item.href}
                onClick={() => choose(item.href)}
                aria-current={location === item.href ? "page" : undefined}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
              >
                <item.icon className="h-4 w-4 shrink-0 text-cc-plum" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  <span className="block text-xs text-cc-muted">
                    {item.group}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
