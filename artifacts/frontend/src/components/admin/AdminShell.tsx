import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Accessibility,
  ArrowLeft,
  Bug,
  Building2,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  LayoutPanelLeft,
  Lightbulb,
  LogOut,
  Mail,
  Menu,
  History,
  Server,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

// The nav rail is dark (--cc-sidebar-bg); the content card is CareCliQ's
// normal light surface. On phones and tablets the rail becomes a top bar
// and a slide-out drawer, so content gets the whole width.
const SIDEBAR_BG = "var(--cc-sidebar-bg)";
const SIDEBAR_TEXT = "#F5F5F7";
const SIDEBAR_MUTED = "rgba(245, 245, 247, 0.62)";
const SIDEBAR_BORDER = "rgba(245, 245, 247, 0.1)";
const SIDEBAR_AVATAR_BG = "rgba(245, 245, 247, 0.12)";
const ACTIVE_BG = "var(--cc-plum)";

type NavItem = { href: string; label: string; icon: LucideIcon };

// One entry per real page: add to this list (not ad hoc links) as the
// portal grows. `label: null` renders ungrouped at the top.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Customers",
    items: [
      { href: "/admin/organizations", label: "Providers", icon: Building2 },
      { href: "/admin/onboarding", label: "New provider", icon: UserPlus },
    ],
  },
  {
    label: "Communication",
    items: [{ href: "/admin/messages", label: "Messages", icon: Mail }],
  },
  {
    label: "Support",
    items: [
      { href: "/admin/feedback", label: "Feedback", icon: Lightbulb },
      { href: "/admin/bug-reports", label: "Bug reports", icon: Bug },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/activity", label: "Activity", icon: History },
      { href: "/admin/system", label: "System", icon: Server },
    ],
  },
];

const SETTINGS_ITEMS: NavItem[] = [
  { href: "/admin/settings/layout", label: "Layout", icon: LayoutPanelLeft },
  { href: "/admin/settings/accessibility", label: "Accessibility", icon: Accessibility },
];

const FLAT_NAV = NAV_GROUPS.flatMap((g) => g.items);

function getInitials(name: string) {
  return name.trim().split(/\s+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

const COLLAPSED_KEY = "cc-admin-sidebar-collapsed";

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function NavLink({ item, active, iconOnly, onNavigate }: { item: NavItem; active: boolean; iconOnly?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={iconOnly ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={
        iconOnly
          ? "flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
          : "flex min-h-10 md:min-h-8 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-white/10"
      }
      style={{ background: active ? ACTIVE_BG : undefined, color: active ? "#FFFFFF" : SIDEBAR_MUTED }}
    >
      <Icon size={iconOnly ? 18 : 17} aria-hidden="true" />
      {!iconOnly && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/** Page navigation, or the account panel in its place. Shared by the
 *  desktop rail and the phone/tablet drawer. */
function NavBody({
  iconOnly,
  accountPanel,
  onCloseAccount,
  onNavigate,
}: {
  iconOnly: boolean;
  accountPanel: boolean;
  onCloseAccount: () => void;
  onNavigate?: () => void;
}) {
  const { logout } = useAuth();
  const [location] = useLocation();
  const onSettingsRoute = location.startsWith("/admin/settings");
  const [settingsOpen, setSettingsOpen] = useState(onSettingsRoute);
  const isActive = (href: string) => location === href || location.startsWith(`${href}/`);

  if (accountPanel) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={onCloseAccount}
          className="mb-2 flex min-h-9 w-full items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors hover:bg-white/10"
          style={{ color: SIDEBAR_MUTED }}
        >
          <ArrowLeft size={14} /> Back to menu
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="flex min-h-10 md:min-h-8 w-full items-center justify-between gap-3 rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-white/10"
          style={{ color: SIDEBAR_MUTED }}
          aria-expanded={settingsOpen || onSettingsRoute}
        >
          <span className="flex items-center gap-3"><Settings size={17} /> Settings</span>
          {settingsOpen || onSettingsRoute ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {(settingsOpen || onSettingsRoute) && (
          <div className="ml-4 space-y-1 border-l pl-3" style={{ borderColor: SIDEBAR_BORDER }}>
            {SETTINGS_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={logout}
          className="flex min-h-10 md:min-h-8 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-white/10"
          style={{ color: SIDEBAR_MUTED }}
        >
          <LogOut size={17} /> Log out
        </button>
      </div>
    );
  }

  if (iconOnly) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        {FLAT_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} iconOnly />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "top"} className="space-y-1">
          {group.label && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: SIDEBAR_MUTED }}>
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </div>
  );
}

function AccountButton({ iconOnly, open, onClick }: { iconOnly: boolean; open: boolean; onClick: () => void }) {
  const { user } = useAuth();
  return (
    <button
      type="button"
      onClick={onClick}
      title={iconOnly ? (user?.full_name || "Account") : undefined}
      aria-expanded={open}
      className={`flex w-full items-center gap-3 rounded-xl py-2 text-left transition-colors hover:bg-white/10 ${iconOnly ? "justify-center px-0" : "px-2"}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: SIDEBAR_AVATAR_BG, color: SIDEBAR_TEXT }}>
        {getInitials(user?.full_name || user?.email || "A")}
      </span>
      {!iconOnly && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold" style={{ color: SIDEBAR_TEXT }}>{user?.full_name || "Admin"}</span>
            <span className="block truncate text-xs" style={{ color: SIDEBAR_MUTED }}>{user?.email}</span>
          </span>
          {open ? <ChevronUp size={14} style={{ color: SIDEBAR_MUTED }} /> : <ChevronDown size={14} style={{ color: SIDEBAR_MUTED }} />}
        </>
      )}
    </button>
  );
}

/**
 * The CareCliQ staff portal's frame. Separate from HubLayout on purpose:
 * HubLayout carries a provider's own branding, and a super admin isn't
 * scoped to any one provider.
 *
 *  - Desktop (1024px+): a dark rail on the left that stays put while the
 *    page scrolls (collapsible to icons), and a rounded content card.
 *  - Phones and tablets: a slim top bar with a menu button; the same
 *    navigation slides in from the left. Content uses the full width.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);

  const onSettingsRoute = location.startsWith("/admin/settings");
  const showAccountPanel = accountOpen || onSettingsRoute;
  const iconOnly = collapsed && !showAccountPanel;

  useEffect(() => setDrawerOpen(false), [location]);

  function closeAccountPanel() {
    if (onSettingsRoute) navigate("/admin/dashboard");
    else setAccountOpen(false);
  }

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // best-effort: the preference just won't survive a reload
      }
      return next;
    });
  }

  const current = FLAT_NAV.find((i) => location === i.href || location.startsWith(`${i.href}/`));

  return (
    <div className="min-h-[100dvh] lg:flex" style={{ background: SIDEBAR_BG }}>
      {/* Desktop rail */}
      <aside className={`sticky top-0 hidden h-[100dvh] shrink-0 flex-col lg:flex ${iconOnly ? "w-[72px]" : "w-64"} transition-[width]`}>
        <div className={`flex items-center border-b py-4 ${iconOnly ? "flex-col gap-2 px-2" : "gap-2 px-5"}`} style={{ borderColor: SIDEBAR_BORDER }}>
          <Link href="/admin/dashboard" className={`flex min-w-0 flex-1 items-center rounded-xl transition-colors hover:bg-white/10 ${iconOnly ? "flex-none justify-center p-1" : "py-1"}`}>
            <CareCliQLogo size={iconOnly ? 36 : 56} className="shrink-0" />
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="shrink-0 rounded-xl p-2 transition-colors hover:bg-white/10"
            aria-label={iconOnly ? "Expand menu" : "Collapse menu"}
            title={iconOnly ? "Expand menu" : "Collapse menu"}
          >
            {iconOnly ? <PanelLeftOpen size={17} style={{ color: SIDEBAR_MUTED }} /> : <PanelLeftClose size={17} style={{ color: SIDEBAR_MUTED }} />}
          </button>
        </div>
        <nav aria-label="Admin" className={`flex-1 overflow-y-auto py-4 ${iconOnly ? "px-2" : "px-3"}`}>
          <NavBody iconOnly={iconOnly} accountPanel={showAccountPanel} onCloseAccount={closeAccountPanel} />
        </nav>
        <div className="border-t p-3" style={{ borderColor: SIDEBAR_BORDER }}>
          <AccountButton iconOnly={iconOnly} open={showAccountPanel} onClick={() => (showAccountPanel ? closeAccountPanel() : setAccountOpen(true))} />
        </div>
      </aside>

      {/* Phone / tablet top bar */}
      <header
        className="sticky top-0 z-30 flex h-14 items-center gap-2 px-2 sm:px-4 lg:hidden"
        style={{ background: SIDEBAR_BG, paddingTop: "env(safe-area-inset-top)" }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
          aria-label="Open menu"
        >
          <Menu size={20} style={{ color: SIDEBAR_TEXT }} />
        </button>
        <Link href="/admin/dashboard" className="flex items-center" aria-label="Admin dashboard">
          <CareCliQLogo size={40} />
        </Link>
        <span className="ml-1 min-w-0 truncate text-sm font-semibold" style={{ color: SIDEBAR_TEXT }}>
          {current?.label ?? "Admin"}
        </span>
      </header>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="flex w-[min(20rem,86vw)] flex-col gap-0 border-0 p-0" style={{ background: SIDEBAR_BG }}>
          <SheetTitle className="sr-only">Admin menu</SheetTitle>
          <SheetDescription className="sr-only">Pages in the CareCliQ admin portal</SheetDescription>
          <div className="flex items-center border-b px-5 py-4" style={{ borderColor: SIDEBAR_BORDER }}>
            <CareCliQLogo size={52} />
          </div>
          <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4">
            <NavBody
              iconOnly={false}
              accountPanel={showAccountPanel}
              onCloseAccount={closeAccountPanel}
              onNavigate={() => setDrawerOpen(false)}
            />
          </nav>
          <div className="border-t p-3" style={{ borderColor: SIDEBAR_BORDER, paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <AccountButton iconOnly={false} open={showAccountPanel} onClick={() => (showAccountPanel ? closeAccountPanel() : setAccountOpen(true))} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Content card: edge to edge on phones, a floating card from tablet up */}
      <main
        className="min-h-[calc(100dvh-3.5rem)] min-w-0 flex-1 sm:m-3 sm:rounded-3xl sm:shadow-sm lg:m-4 lg:min-h-0"
        style={{ background: "var(--cc-bg)" }}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}
