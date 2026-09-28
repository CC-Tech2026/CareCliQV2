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
  items: ReadonlyArray<{ href: string; label: string; icon: ElementType }>;
};
export function ManagementPageSearch({
  groups,
}: {
  groups: readonly NavigationGroup[];
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
  const matches = groups
    .flatMap((group) =>
      group.items.map((item) => ({ ...item, group: group.label })),
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
          className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-cc-border bg-cc-soft px-3 text-left text-sm text-cc-muted"
          aria-label="Find a page"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden md:inline">Find a page</span>
          <kbd className="ml-auto hidden text-xs lg:inline">Ctrl / Cmd K</kbd>
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
