import { useEffect, useState, type ElementType } from "react";
import { Link } from "wouter";
import { Menu, Search } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
type Group = { label: string; items: readonly { href: string; label: string; icon: ElementType }[] };
export function ManagementNavigationDrawer({ groups, location, isActive }: { groups: readonly Group[]; location: string; isActive: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => { if (media.matches) setOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);
  const filtered = groups.map(group => ({ ...group, items: group.items.filter(item => (group.label + " " + item.label).toLowerCase().includes(search.trim().toLowerCase())) })).filter(group => group.items.length);
  return <Sheet open={open} onOpenChange={value => { setOpen(value); if (value) setSearch(""); }}>
    <SheetTrigger asChild><button type="button" aria-label="Open management navigation" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-cc-text hover:bg-cc-soft xl:hidden"><Menu size={22} /></button></SheetTrigger>
    <SheetContent className="flex h-[100dvh] w-full flex-col gap-3 bg-cc-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:max-w-md [&>button]:h-11 [&>button]:w-11 [&>button]:flex [&>button]:items-center [&>button]:justify-center">
      <SheetHeader className="pr-12 text-left"><SheetTitle>Management navigation</SheetTitle><SheetDescription>Choose a workspace or find a page.</SheetDescription></SheetHeader>
      <div className="relative"><Search size={16} className="absolute left-3 top-3.5 text-cc-muted" /><Input aria-label="Filter navigation" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find staff, invoices, reports..." className="min-h-11 pl-9" /></div>
      <nav aria-label="Management workspaces" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
        {filtered.map(group => <section key={group.label}><h2 className="mb-1 px-3 text-xs font-semibold text-cc-muted">{group.label}</h2>{group.items.map(item => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={isActive(item.href) ? "page" : undefined} className={"flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum " + (isActive(item.href) ? "bg-cc-soft text-cc-plum" : "text-cc-text hover:bg-cc-soft")}><item.icon size={18} className="shrink-0" /><span>{item.label}</span></Link>)}</section>)}
        {!filtered.length && <p role="status" className="p-3 text-sm text-cc-muted">No pages found. Try another search.</p>}
      </nav>
      <Link href="/settings" onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-lg border border-cc-border px-3 text-sm font-semibold text-cc-text">Settings</Link>
    </SheetContent>
  </Sheet>;
}
