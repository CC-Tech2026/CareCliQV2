import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ShieldCheck,
  LayoutDashboard,
  Building2,
  UserPlus,
  Lightbulb,
  Bug,
  LogOut,
  ChevronDown,
  ChevronUp,
  Settings,
  LayoutPanelLeft,
  Accessibility,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const BG = "var(--cc-bg)";
const PLUM = "var(--cc-plum)";

// One entry per real page — add to this list (not ad hoc links) as the
// portal grows. `label: null` renders ungrouped, flush with the top —
// everything else sits under its group's header + rail (see render below).
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/onboarding", label: "Onboarding", icon: UserPlus },
    ],
  },
  {
    label: "Workforce & People",
    items: [
      { href: "/admin/organizations", label: "Providers", icon: Building2 },
    ],
  },
  {
    label: "Oversight & Risk",
    items: [
      { href: "/admin/feedback", label: "Improvements & Feedback", icon: Lightbulb },
      { href: "/admin/bug-reports", label: "Bug Reports", icon: Bug },
    ],
  },
] as const;

const SETTINGS_ITEMS = [
  { href: "/admin/settings/layout", label: "Layout", icon: LayoutPanelLeft },
  { href: "/admin/settings/accessibility", label: "Accessibility", icon: Accessibility },
] as const;

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

/**
 * Deliberately separate from HubLayout — HubLayout is org-branded (a
 * provider's logo/nav/theming), and a super_admin isn't scoped to any one
 * org, so it gets its own minimal vendor-side shell instead. Sidebar, not a
 * top bar, so future sections (billing, system logs) have somewhere to go
 * without crowding a single row.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);

  // Every /admin/settings/* page (e.g. Layout) renders its own fresh
  // AdminShell instance, so local accountOpen/settingsOpen state can't
  // survive the navigation — derive the expanded state from the route
  // itself instead, same as how NAV_GROUPS below marks its own items
  // active.
  const onSettingsRoute = location.startsWith("/admin/settings");
  const showAccountPanel = accountOpen || onSettingsRoute;
  const showSettingsExpanded = settingsOpen || onSettingsRoute;
  // The narrow icon-only rail has nowhere to put the Account panel's text
  // rows, so showing that panel always wins over a collapsed preference —
  // collapsing is just a width preference for the ordinary page nav.
  const iconOnly = collapsed && !showAccountPanel;
  // NAV_GROUPS is `as const`, so each group's items tuple has its own
  // narrow literal type — flatMap needs an explicit common type or TS
  // can't unify them into one array.
  type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
  const flatNavItems = NAV_GROUPS.reduce<NavItem[]>((acc, group) => acc.concat(group.items as unknown as NavItem[]), []);

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
        // best-effort only — a private window or blocked storage just
        // means the preference won't survive a reload
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen" style={{ background: BG }}>
      <aside
        className={`flex ${iconOnly ? "w-16" : "w-60"} shrink-0 flex-col border-r transition-[width]`}
        style={{ borderColor: BORDER, background: SURFACE }}
      >
        <div className={`flex items-center border-b py-4 ${iconOnly ? "flex-col gap-2 px-2" : "gap-2 px-5"}`} style={{ borderColor: BORDER }}>
          <Link
            href="/admin/dashboard"
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg transition-colors hover:bg-cc-soft ${iconOnly ? "flex-none justify-center px-1 py-1" : ""}`}
          >
            <ShieldCheck size={20} style={{ color: PLUM }} className="shrink-0" />
            {!iconOnly && (
              <div className="min-w-0">
                <p className="truncate text-[13px] font-black leading-tight" style={{ color: TEXT }}>CareCliQ Admin</p>
                <p className="truncate text-[10px] font-semibold" style={{ color: MUTED }}>Master system</p>
              </div>
            )}
          </Link>
          <button
            onClick={toggleCollapsed}
            className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-cc-soft"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {iconOnly ? <PanelLeftOpen size={16} style={{ color: MUTED }} /> : <PanelLeftClose size={16} style={{ color: MUTED }} />}
          </button>
        </div>

        {/* The account trigger swaps this whole area between the page nav
            and the Account panel, rather than squeezing the panel into the
            leftover space below the trigger — full-height like the nav it
            replaces, not a cramped inline expansion. */}
        <nav className="flex-1 space-y-6 overflow-y-auto p-3">
          {showAccountPanel ? (
            <div className="space-y-0.5">
              <button
                onClick={closeAccountPanel}
                className="mb-2 flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase transition-colors hover:bg-cc-soft"
                style={{ color: MUTED, letterSpacing: "0.16em" }}
              >
                <ArrowLeft size={13} /> Account
              </button>

              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors hover:bg-cc-soft"
                style={{ color: MUTED }}
              >
                <span className="flex items-center gap-2.5">
                  <Settings size={16} /> Settings
                </span>
                {showSettingsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {showSettingsExpanded && (
                <div className="ml-3 space-y-0.5 border-l-2 pl-3" style={{ borderColor: BORDER }}>
                  {SETTINGS_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const active = location.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors"
                        style={{ background: active ? "var(--cc-plum-soft)" : "transparent", color: active ? PLUM : MUTED }}
                      >
                        <Icon size={16} /> {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}

              <button
                onClick={logout}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors hover:bg-cc-soft"
                style={{ color: MUTED }}
              >
                <LogOut size={16} /> Log out
              </button>
            </div>
          ) : iconOnly ? (
            <div className="flex flex-col items-center gap-1">
              {flatNavItems.map((item) => {
                const Icon = item.icon;
                const active = location.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
                    style={{ background: active ? "var(--cc-plum-soft)" : "transparent", color: active ? PLUM : MUTED }}
                  >
                    <Icon size={18} />
                  </Link>
                );
              })}
            </div>
          ) : (
            NAV_GROUPS.map((group) => (
              <div key={group.label ?? "top"}>
                {group.label && (
                  <p className="mb-2 px-3 text-[10px] font-black uppercase" style={{ color: MUTED, letterSpacing: "0.16em" }}>
                    {group.label}
                  </p>
                )}
                {/* Grouped sections get a left rail + indent so sub-options
                    read as "belonging to" their header, not as more top-level
                    items — the header alone (small caps, same-ish size as
                    before) wasn't enough of a visual break on its own. */}
                <div className={group.label ? "ml-3 space-y-0.5 border-l-2 pl-3" : "space-y-0.5"} style={group.label ? { borderColor: BORDER } : undefined}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = location.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors"
                        style={{ background: active ? "var(--cc-plum-soft)" : "transparent", color: active ? PLUM : MUTED }}
                      >
                        <Icon size={16} /> {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        <div className="border-t p-3" style={{ borderColor: BORDER }}>
          <button
            onClick={() => (showAccountPanel ? closeAccountPanel() : setAccountOpen(true))}
            title={iconOnly ? (user?.full_name || "Admin") : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-left transition-colors hover:bg-cc-soft ${iconOnly ? "justify-center px-0" : "px-2"}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black" style={{ background: SOFT, color: TEXT }}>
              {getInitials(user?.full_name || user?.email || "A")}
            </span>
            {!iconOnly && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>{user?.full_name || "Admin"}</p>
                  <p className="truncate text-[10px]" style={{ color: MUTED }}>{user?.email}</p>
                </div>
                {showAccountPanel ? <ChevronUp size={14} style={{ color: MUTED }} /> : <ChevronDown size={14} style={{ color: MUTED }} />}
              </>
            )}
          </button>
        </div>
      </aside>

      {/* No max-width cap — this was leaving most of the screen empty on
          anything wider than a laptop, centered inside a fixed max-w-5xl
          column. The sidebar already bounds one edge; let content use the
          rest. */}
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
