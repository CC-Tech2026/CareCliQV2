import { Link, Redirect, useLocation } from "wouter";
import { ArrowLeftRight, CalendarDays, ChevronDown, FileText, FlaskConical, LayoutGrid, LogOut, Loader2, Receipt, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { usePortalDocumentTitle } from "@/components/participant-portal/PortalAuthLayout";
import { ProfileAvatar, displayName } from "@/components/participant-portal/ProfileAvatar";
import { ProfilePanel } from "@/components/participant-portal/ProfilePanel";
import { isPortalDemoOn, setPortalDemo, turnPortalDemoOff } from "@/lib/portal-demo-data";

const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

export const PORTAL_HOME = "/participant-portal";
export const PORTAL_SETTINGS = "/participant-portal/settings";

const TABS = [
  { href: PORTAL_HOME, label: "Overview", icon: LayoutGrid, match: (p: string) => p === PORTAL_HOME },
  { href: "/participant-portal/schedule", label: "Support Schedule", icon: CalendarDays, match: (p: string) => p.startsWith("/participant-portal/schedule") },
  { href: "/participant-portal/invoices", label: "Invoices", icon: Receipt, match: (p: string) => p.startsWith("/participant-portal/invoices") },
  {
    href: "/participant-portal/documents",
    label: "Documents",
    icon: FileText,
    match: (p: string) => p.startsWith("/participant-portal/documents") || p.startsWith("/participant-portal/plan"),
  },
] as const;

function PortalMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <h1 className="text-xl font-black" style={{ color: TEXT }}>{title}</h1>
      <p className="mt-2 text-[13px] font-medium" style={{ color: MUTED }}>{body}</p>
    </div>
  );
}

/**
 * The Participants Portal layout: a full-window page with a top bar (logo, section
 * tabs, account menu) and, below it, the participant's profile card on the
 * left beside the current tab's content — deliberately separate from the
 * staff AppLayout/HubLayout shells.
 */
export function ParticipantPortalShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, navigate] = useLocation();
  usePortalDocumentTitle();
  const { participants, loadError, participantId, current } = useViewingParticipant();
  const currentIndex = participants && current ? participants.indexOf(current) : 0;
  const canSwitch = (participants?.length ?? 0) > 1;
  const switchHref = `/participant-portal/choose?next=${encodeURIComponent(location)}`;
  const signOut = () => { logout(); navigate("/portal/login"); };

  let content: React.ReactNode;
  if (participants === null) {
    content = (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin" size={28} style={{ color: PLUM }} />
      </div>
    );
  } else if (loadError) {
    content = <PortalMessage title="Something went wrong" body={loadError} />;
  } else if (participants.length === 0) {
    content = (
      <PortalMessage
        title="No portal access"
        body="Your account doesn't currently have access to anyone's information. Please contact your care provider."
      />
    );
  } else if (!participantId) {
    // Several people and none chosen yet — the full-screen profile picker.
    return <Redirect to={switchHref} replace />;
  } else {
    content = children;
  }

  const isOverview = location === PORTAL_HOME;
  // Settings are about the signed-in account, not the participant — no profile card.
  const isSettings = location.startsWith(PORTAL_SETTINGS);

  return (
    <div className="min-h-screen" style={{ background: SURFACE }}>
      <div className="flex min-h-screen w-full flex-col">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-8 sm:py-5">
          <Link href={PORTAL_HOME} aria-label="Home" className="shrink-0">
            <CareCliQLogo size={48} />
          </Link>

          {participantId && (
            <nav
              aria-label="Portal sections"
              className="order-3 flex w-full gap-1 overflow-x-auto lg:order-2 lg:w-auto lg:flex-1 lg:justify-center"
            >
              {TABS.map((tab) => {
                const active = tab.match(location);
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className="flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-bold transition-colors"
                    style={{ background: active ? "var(--cc-plum-soft)" : "transparent", color: active ? PLUM : MUTED }}
                  >
                    <Icon size={16} /> {tab.label}
                  </Link>
                );
              })}
            </nav>
          )}

          <div className="order-2 ml-auto flex items-center gap-3 lg:order-3 lg:ml-0">
            {isPortalDemoOn() && (
              <button
                onClick={() => { turnPortalDemoOff(); window.location.replace(window.location.pathname); }}
                title="Made-up example data for design work (dev only). Click to turn off."
                className="rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide"
                style={{ background: "#FBF2E6", color: "#9A5B0A", border: "1px dashed #9A5B0A" }}
              >
                Demo data · turn off
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2"
                aria-label="Account menu"
              >
                {current ? (
                  <ProfileAvatar participant={current} index={currentIndex} size={36} className="!rounded-full" />
                ) : (
                  <span className="h-9 w-9 rounded-full" style={{ background: "var(--cc-soft)" }} />
                )}
                <span className="hidden text-left sm:block">
                  <span className="block text-[13px] font-bold leading-tight" style={{ color: TEXT }}>
                    {current ? displayName(current) : user?.full_name}
                  </span>
                  {/* No email here — it's on show in a shared room; the open menu has it. */}
                  {current && current.relationship !== "self" && (
                    <span className="block text-[11px] leading-tight" style={{ color: MUTED }}>
                      Viewing as {user?.full_name ?? "you"}
                    </span>
                  )}
                </span>
                <ChevronDown size={14} style={{ color: MUTED }} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <span className="block text-[13px] font-bold">{user?.full_name || "Participant"}</span>
                  <span className="block truncate text-[11px] opacity-70">{user?.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate(PORTAL_SETTINGS)} className="gap-2">
                  <Settings size={14} /> Settings
                </DropdownMenuItem>
                {canSwitch && (
                  <DropdownMenuItem onSelect={() => navigate(switchHref)} className="gap-2">
                    <ArrowLeftRight size={14} /> Switch profile
                  </DropdownMenuItem>
                )}
                {import.meta.env.DEV && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setPortalDemo(!isPortalDemoOn());
                      // Drop any ?demo= in the URL so it can't override the switch.
                      window.location.replace(window.location.pathname);
                    }}
                    className="gap-2"
                  >
                    <FlaskConical size={14} /> {isPortalDemoOn() ? "Hide demo data" : "Show demo data"}
                    <span className="ml-auto text-[10px] font-bold opacity-60">DEV</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={signOut} className="gap-2">
                  <LogOut size={14} /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* ── Body ────────────────────────────────────────────────── */}
        <main className="flex-1 px-3 pb-6 sm:px-8 sm:pb-8">
          {participantId && !isSettings ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(470px,530px)_1fr]">
              {/* Phones: the profile card only on Overview, so other tabs aren't pushed down. */}
              <aside className={isOverview ? "" : "hidden lg:block"} aria-label="Profile">
                <ProfilePanel />
              </aside>
              <div className="min-w-0">{content}</div>
            </div>
          ) : (
            content
          )}
        </main>
      </div>
    </div>
  );
}
