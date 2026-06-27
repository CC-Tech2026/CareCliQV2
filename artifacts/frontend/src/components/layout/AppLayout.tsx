import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  Menu, X, ChevronLeft, ChevronRight,
  LayoutDashboard, Users, UserRound, CalendarDays,
  ShieldCheck, Settings, AlertTriangle, FileBarChart2,
  CreditCard, LogOut, FileCheck2, BadgeCheck, Wrench, Target, ClipboardList,
  BarChart2, UserCheck, DollarSign, GraduationCap, LockKeyhole, Radio,
  Sun, Moon, Search,
} from "lucide-react";
import { getStoredTheme, applyTheme, type Theme } from "@/lib/theme";
import { NotificationBell, NotificationPanel } from "@/components/coordinator/NotificationPanel";
import { WorkerNotificationBell, WorkerNotificationPanel } from "@/components/worker/WorkerNotificationPanel";
import { NotificationBannerStack } from "@/components/worker/NotificationBannerStack";
import { NotificationRealtimeBridge } from "@/components/worker/NotificationRealtimeBridge";
import { ProfileDropdown } from "@/components/layout/ProfileDropdown";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { CareCliQLogo, CareCliQLogoSm } from "@/components/CareCliQLogo";

// ── Design tokens (CSS vars — dark mode ready) ────────────────────────────────
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const MUTED  = "var(--cc-muted)";
const TEXT   = "var(--cc-text)";
const BORDER = "var(--cc-border)";
const ACTIVE = "var(--cc-active-bg)";

type NavRole = "support_coordinator" | "support_worker" | "allied_health" | "managing_director";
type NavIconProps = { size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties };

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<NavIconProps>;
}
interface NavSection {
  group?: string;
  items: NavItem[];
}

// ── Full sectioned sidebar nav ────────────────────────────────────────────────
const SECTIONED_NAV: Record<NavRole, NavSection[]> = {
  support_coordinator: [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "People & Care",
      items: [
        { href: "/team",               label: "Team",            icon: Users          },
        { href: "/patients",           label: "Participants",    icon: UserRound      },
        { href: "/sessions",           label: "Shifts",          icon: CalendarDays   },
        { href: "/coordinator-goals",  label: "Goals & Planning",icon: Target         },
      ],
    },
    {
      group: "Quality & Safety",
      items: [
        { href: "/compliance", label: "Compliance", icon: ShieldCheck   },
        { href: "/audit-pack", label: "Audit Pack", icon: FileCheck2    },
        { href: "/incidents",  label: "Incidents",  icon: AlertTriangle },
      ],
    },
    {
      group: "Operations",
      items: [
        { href: "/coordinator/rostering", label: "Rostering",      icon: CalendarDays },
        { href: "/coordinator/live",      label: "Live Monitoring", icon: Radio        },
        { href: "/billing",               label: "Invoices",        icon: CreditCard   },
        { href: "/credentials",           label: "Credentials",     icon: BadgeCheck   },
        { href: "/toolkit",               label: "Toolkit",         icon: Wrench       },
      ],
    },
    {
      group: "Account",
      items: [
        { href: "/worker/profile",  label: "My Profile", icon: UserRound   },
        { href: "/worker/security", label: "Security",   icon: LockKeyhole },
      ],
    },
  ],
  support_worker: [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "My Work",
      items: [
        { href: "/my-shifts",  label: "My Shifts",  icon: CalendarDays  },
        { href: "/my-clients", label: "My Clients", icon: UserRound     },
        { href: "/tasks",      label: "Tasks",      icon: ClipboardList },
      ],
    },
    {
      group: "Safety",
      items: [
        { href: "/my-compliance", label: "My Compliance", icon: ShieldCheck   },
        { href: "/incidents",     label: "Incidents",     icon: AlertTriangle },
      ],
    },
    {
      group: "Resources",
      items: [
        { href: "/credentials", label: "Credentials", icon: BadgeCheck },
        { href: "/toolkit",     label: "Toolkit",     icon: Wrench     },
      ],
    },
    {
      group: "Account",
      items: [
        { href: "/worker/profile",  label: "My Profile", icon: UserRound   },
        { href: "/worker/security", label: "Security",   icon: LockKeyhole },
      ],
    },
  ],
  allied_health: [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "Clinical",
      items: [
        { href: "/patients", label: "Caseload",  icon: UserRound    },
        { href: "/sessions", label: "Sessions",  icon: CalendarDays },
      ],
    },
    {
      group: "Quality",
      items: [
        { href: "/incidents", label: "Incidents", icon: AlertTriangle },
        { href: "/reports",   label: "Reports",   icon: FileBarChart2 },
      ],
    },
    {
      group: "Admin",
      items: [
        { href: "/billing",     label: "Invoices",    icon: CreditCard },
        { href: "/credentials", label: "Credentials", icon: BadgeCheck },
        { href: "/toolkit",     label: "Toolkit",     icon: Wrench     },
      ],
    },
  ],
  managing_director: [
    { items: [{ href: "/hub", label: "Hub", icon: LayoutDashboard }] },
    {
      group: "MD Workspaces",
      items: [
        { href: "/md/executive",  label: "Executive",  icon: BarChart2    },
        { href: "/md/staff",      label: "Staff",      icon: UserCheck    },
        { href: "/md/compliance", label: "Compliance", icon: ShieldCheck  },
        { href: "/md/financial",  label: "Financial",  icon: DollarSign   },
        { href: "/md/onboarding", label: "Onboarding", icon: GraduationCap},
      ],
    },
  ],
};

// ── Topbar quick-nav tabs (shown when sidebar is collapsed) ───────────────────
const TOPBAR_QUICKNAV: Record<NavRole, NavItem[]> = {
  support_coordinator: [
    { href: "/dashboard",             label: "Dashboard",   icon: LayoutDashboard },
    { href: "/team",                  label: "Team",        icon: Users           },
    { href: "/patients",              label: "Participants", icon: UserRound      },
    { href: "/sessions",              label: "Shifts",      icon: CalendarDays    },
    { href: "/compliance",            label: "Compliance",  icon: ShieldCheck     },
    { href: "/coordinator/rostering", label: "Rostering",   icon: CalendarDays    },
    { href: "/coordinator/live",      label: "Live",        icon: Radio           },
    { href: "/incidents",             label: "Incidents",   icon: AlertTriangle   },
  ],
  support_worker: [
    { href: "/dashboard",    label: "Dashboard",  icon: LayoutDashboard },
    { href: "/my-shifts",    label: "My Shifts",  icon: CalendarDays    },
    { href: "/my-clients",   label: "My Clients", icon: UserRound       },
    { href: "/tasks",        label: "Tasks",      icon: ClipboardList   },
    { href: "/my-compliance",label: "Compliance", icon: ShieldCheck     },
  ],
  allied_health: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/patients",  label: "Caseload",  icon: UserRound       },
    { href: "/sessions",  label: "Sessions",  icon: CalendarDays    },
    { href: "/incidents", label: "Incidents", icon: AlertTriangle   },
  ],
  managing_director: [
    { href: "/hub",           label: "Hub",       icon: LayoutDashboard },
    { href: "/md/executive",  label: "Executive", icon: BarChart2       },
    { href: "/md/staff",      label: "Staff",     icon: UserCheck       },
    { href: "/md/compliance", label: "Compliance",icon: ShieldCheck     },
    { href: "/md/financial",  label: "Financial", icon: DollarSign      },
  ],
};

// ── Mobile bottom nav ─────────────────────────────────────────────────────────
const ROLE_BOTTOM_NAV: Record<NavRole, NavItem[]> = {
  support_coordinator: [
    { href: "/dashboard",  label: "Home",      icon: LayoutDashboard },
    { href: "/team",       label: "Team",      icon: Users           },
    { href: "/patients",   label: "People",    icon: UserRound       },
    { href: "/compliance", label: "Compliance",icon: ShieldCheck     },
    { href: "/billing",    label: "Invoices",  icon: CreditCard      },
  ],
  support_worker: [
    { href: "/dashboard",    label: "Home",      icon: LayoutDashboard },
    { href: "/my-shifts",    label: "Shifts",    icon: CalendarDays    },
    { href: "/my-clients",   label: "Clients",   icon: UserRound       },
    { href: "/tasks",        label: "Tasks",     icon: ClipboardList   },
    { href: "/my-compliance",label: "Compliance",icon: ShieldCheck     },
  ],
  allied_health: [
    { href: "/dashboard",   label: "Home",     icon: LayoutDashboard },
    { href: "/patients",    label: "Caseload", icon: UserRound       },
    { href: "/sessions",    label: "Sessions", icon: CalendarDays    },
    { href: "/reports",     label: "Reports",  icon: FileBarChart2   },
    { href: "/credentials", label: "Creds",    icon: BadgeCheck      },
  ],
  managing_director: [
    { href: "/hub",           label: "Hub",       icon: LayoutDashboard },
    { href: "/md/executive",  label: "Executive", icon: BarChart2       },
    { href: "/md/staff",      label: "Staff",     icon: UserCheck       },
    { href: "/md/compliance", label: "Compliance",icon: ShieldCheck     },
    { href: "/md/financial",  label: "Financial", icon: DollarSign      },
  ],
};

const ROUTE_LABELS: [string, string][] = [
  ["/coordinator/rostering", "Rostering"],
  ["/coordinator/live",      "Live Monitoring"],
  ["/coordinator-goals",     "Goals & Planning"],
  ["/session-new",           "New Shift"],
  ["/session/",              "Shift"],
  ["/sessions",              "Shifts"],
  ["/audit-pack",            "Audit Pack"],
  ["/incident-new",          "New Incident"],
  ["/incident/",             "Incident"],
  ["/incidents",             "Incidents"],
  ["/compliance",            "Compliance"],
  ["/my-compliance",         "My Compliance"],
  ["/my-shifts",             "My Shifts"],
  ["/my-clients",            "My Participants"],
  ["/participants",          "Participants"],
  ["/patients",              "Participants"],
  ["/participant-new",       "New Participant"],
  ["/participant-edit",      "Edit Participant"],
  ["/credentials",           "Credentials"],
  ["/billing",               "Invoices"],
  ["/toolkit",               "Toolkit"],
  ["/team",                  "Team"],
  ["/tasks",                 "Tasks"],
  ["/reports",               "Reports"],
  ["/settings",              "Settings"],
  ["/worker/profile",        "My Profile"],
  ["/worker/security",       "Security"],
  ["/worker/messages",       "Messages"],
  ["/worker/notifications",  "Notifications"],
  ["/hub",                   "Hub"],
  ["/md/executive",          "Executive"],
  ["/md/staff",              "Staff"],
  ["/md/compliance",         "Compliance"],
  ["/md/financial",          "Financial"],
  ["/md/onboarding",         "Onboarding"],
  ["/dashboard",             "Dashboard"],
];

function getPageLabel(location: string): string {
  for (const [prefix, label] of ROUTE_LABELS) {
    if (location === prefix || location.startsWith(prefix + "/") || (prefix.endsWith("/") && location.startsWith(prefix))) {
      return label;
    }
  }
  return "";
}

function isActive(location: string, href: string) {
  // /patients also matches the legacy /participants route — kept as an explicit
  // alias since it doesn't fit the plain prefix check below.
  if (href === "/patients" && location.startsWith("/participants")) return true;
  return location === href || location.startsWith(href + "/");
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ── Quick-jump search ─────────────────────────────────────────────────────────
function GlobalSearch({ sections }: { sections: NavSection[] }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [, navigate] = useLocation();
  const allItems = sections.flatMap((s) => s.items);

  const results = query.trim().length > 0
    ? allItems.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
    : [];

  function handleSelect(href: string) {
    navigate(href);
    setQuery("");
    setFocused(false);
  }

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 h-8 px-3 rounded-full transition-all duration-200"
        style={{
          border: `1px solid ${focused ? "var(--cc-plum)" : "var(--cc-border)"}`,
          background: focused ? "var(--cc-bg)" : "color-mix(in srgb, var(--cc-soft) 70%, transparent)",
          boxShadow: focused ? "0 0 0 3px rgba(55,48,163,0.08)" : "none",
          width: focused ? 200 : 160,
        }}
      >
        <Search size={12} strokeWidth={2.5} style={{ color: MUTED, flexShrink: 0 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); setQuery(""); }, 160)}
          placeholder="Quick jump…"
          className="flex-1 bg-transparent text-[12px] outline-none min-w-0"
          style={{ color: TEXT }}
        />
        {focused && (
          <kbd className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: "var(--cc-soft)", color: MUTED }}>
            ESC
          </kbd>
        )}
      </div>
      {results.length > 0 && focused && (
        <div
          className="absolute top-full mt-1.5 left-0 z-50 rounded-xl border shadow-xl py-1 overflow-hidden min-w-[200px]"
          style={{ background: "var(--cc-bg)", borderColor: "var(--cc-border)" }}
        >
          {results.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onMouseDown={() => handleSelect(item.href)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors hover:bg-[var(--cc-soft)]"
                style={{ color: TEXT }}
              >
                <Icon size={14} strokeWidth={2} style={{ color: MUTED }} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sidebar contents ──────────────────────────────────────────────────────────
function SidebarContents({
  location, collapsed, isDrawer,
  alertCount, displayName, displayRole, initials,
  onNav, onLogout,
}: {
  location: string; collapsed: boolean; isDrawer: boolean;
  alertCount: number; displayName: string; displayRole: string; initials: string;
  onNav?: () => void; onLogout: () => void;
}) {
  const compact = !isDrawer && collapsed;
  const { user } = useAuth();
  const role = (user?.role ?? "support_worker") as NavRole;
  const sections = SECTIONED_NAV[role] ?? SECTIONED_NAV.support_worker;

  return (
    <div className="flex flex-col h-full select-none overflow-hidden">

      {/* Logo row */}
      <div
        className={cn("flex items-center shrink-0 h-14", compact ? "justify-center px-2" : "px-3")}
        style={{ borderBottom: `1px solid ${BORDER}`, borderTop: "3px solid var(--cc-plum)" }}
      >
        <Link
          href="/dashboard"
          onClick={onNav}
          aria-label="CareCliQ — Go to Dashboard"
          title="Home"
          className={cn(
            "flex items-center rounded-xl transition-all hover:bg-[var(--cc-soft)] active:opacity-75",
            compact ? "h-10 w-10 justify-center" : "h-10 px-2 gap-2 w-full",
          )}
        >
          {compact ? <CareCliQLogoSm /> : <CareCliQLogo compact={false} />}
        </Link>
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 overflow-y-auto scrollbar-none py-4", compact ? "px-2" : "px-2")}>
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-5" : ""}>
            {section.group && !compact && (
              <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.14em] flex items-center gap-2" style={{ color: MUTED }}>
                <span className="w-px h-3 rounded-full shrink-0" style={{ background: BORDER }} />
                {section.group}
              </p>
            )}
            {section.group && compact && si > 0 && (
              <div className="h-px mx-2 mb-3" style={{ background: BORDER }} />
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(location, item.href);
                const Icon = item.icon;
                const isCompliance = item.href === "/compliance" || item.href === "/my-compliance" || item.href === "/md/compliance";
                const isIncident   = item.href === "/incidents";
                const hasAlert     = alertCount > 0 && isCompliance;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNav}
                    title={compact ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <div
                      className={cn(
                        "flex items-center rounded-xl text-[13px] transition-all cursor-pointer",
                        compact ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2.5",
                      )}
                      style={{
                        background: active
                          ? PLUM
                          : isIncident && !compact
                            ? "rgba(190,24,93,0.06)"
                            : "transparent",
                        color: active ? "#fff" : isIncident ? CORAL : MUTED,
                        fontWeight: active ? 700 : isIncident ? 600 : 500,
                      }}
                    >
                      <Icon
                        size={18}
                        strokeWidth={active ? 2.5 : isIncident ? 2.5 : 2}
                        style={{ color: active ? "#fff" : isIncident ? CORAL : MUTED }}
                      />
                      {!compact && <span className="flex-1 truncate">{item.label}</span>}
                      {!compact && hasAlert && (
                        <span
                          className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center"
                          style={{ background: active ? "rgba(255,255,255,0.25)" : CORAL, color: "#fff" }}
                        >
                          {alertCount}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* Settings */}
        <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          <Link href="/settings" onClick={onNav} title={compact ? "Settings" : undefined} aria-current={isActive(location, "/settings") ? "page" : undefined}>
            <div
              className={cn(
                "flex items-center rounded-xl text-[13px] transition-all cursor-pointer",
                compact ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2.5",
              )}
              style={{
                background: isActive(location, "/settings") ? PLUM : "transparent",
                color: isActive(location, "/settings") ? "#fff" : MUTED,
                fontWeight: isActive(location, "/settings") ? 700 : 500,
              }}
            >
              <Settings size={18} strokeWidth={isActive(location, "/settings") ? 2.5 : 2}
                style={{ color: isActive(location, "/settings") ? "#fff" : MUTED }} />
              {!compact && <span>Settings</span>}
            </div>
          </Link>
        </div>
      </nav>

      {/* ── Quick "Report Incident" shortcut (support workers + coordinators only) ── */}
      {!compact && (role === "support_worker" || role === "support_coordinator") && (
        <div className="px-3 pb-2 shrink-0">
          <Link href="/incident-new" onClick={onNav}>
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-black transition-all cursor-pointer hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "rgba(190,24,93,0.09)",
                color: CORAL,
                border: "1.5px solid rgba(190,24,93,0.18)",
              }}
            >
              <AlertTriangle size={14} strokeWidth={2.5} />
              <span>Report Incident</span>
            </div>
          </Link>
        </div>
      )}

      {/* User footer */}
      <div className={cn("shrink-0 py-3", compact ? "px-2" : "px-3")} style={{ borderTop: `1px solid ${BORDER}` }}>
        {compact ? (
          <div className="relative mx-auto w-fit">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-[12px] font-black"
              style={{ background: PLUM, color: "#fff" }}
              title={displayName}
            >
              {initials}
            </div>
            {/* Compact compliance dot */}
            <div
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
              style={{
                background: alertCount > 0 ? "#BE185D" : "#16A34A",
                borderColor: "var(--cc-bg)",
              }}
              title={alertCount > 0 ? `${alertCount} compliance action${alertCount !== 1 ? "s" : ""} pending` : "Compliance up to date"}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            {/* Avatar with compliance status ring */}
            <div className="relative shrink-0">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-[12px] font-black"
                style={{ background: PLUM, color: "#fff" }}
              >
                {initials}
              </div>
              <div
                className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                style={{
                  background: alertCount > 0 ? "#BE185D" : "#16A34A",
                  borderColor: "var(--cc-bg)",
                }}
                title={alertCount > 0 ? `${alertCount} compliance action${alertCount !== 1 ? "s" : ""} pending` : "Compliance up to date"}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate" style={{ color: TEXT }}>{displayName}</p>
              <p className="text-[11px] font-medium capitalize truncate" style={{ color: MUTED }}>
                {displayRole}
              </p>
            </div>
            <button type="button" onClick={onLogout} title="Sign out" className="p-1.5 rounded-md hover:bg-black/5 transition-colors" style={{ color: MUTED }}>
              <LogOut size={15} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── App layout ────────────────────────────────────────────────────────────────
export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [workerNotifOpen, setWorkerNotifOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; }
    catch { return false; }
  });

  const { settings } = useSettings();
  const { user, logout } = useAuth();
  const { data: alerts = [] } = useGetUnreadAlerts();

  const displayName = user?.full_name || settings?.name || user?.email || "Support Worker";
  const displayRole = user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? "Support Worker";
  const initials    = getInitials(displayName);
  const alertCount  = Array.isArray(alerts) ? alerts.length : 0;
  const userRole    = user?.role as NavRole | undefined;
  const isWorker    = userRole === "support_worker";
  const topbarAlertHref =
    userRole === "support_worker"    ? "/my-compliance" :
    userRole === "managing_director" ? "/md/compliance"  :
    "/compliance";

  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const navSections   = SECTIONED_NAV[userRole as NavRole]   ?? SECTIONED_NAV.support_worker;
  const topbarQuicknav = TOPBAR_QUICKNAV[userRole as NavRole] ?? TOPBAR_QUICKNAV.support_worker;
  const pageLabel     = getPageLabel(location);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* noop */ }
  };

  const sharedProps = {
    location, collapsed, alertCount, displayName, displayRole, initials,
    onLogout: logout,
  };

  // Short role label for pill
  const rolePill = displayRole.split(" ").slice(0, 2).join(" ");

  return (
    <div className="flex w-full overflow-hidden" style={{ height: "100dvh", color: TEXT, background: "var(--cc-bg)" }}>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out relative"
        style={{ width: collapsed ? 64 : 220, borderRight: `1px solid ${BORDER}`, background: "var(--cc-bg)" }}
      >
        <SidebarContents {...sharedProps} isDrawer={false} />

        {/* Collapse handle — sits on the right border, always visible */}
        <button
          type="button"
          onClick={toggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute z-10 flex items-center justify-center transition-all duration-150 hover:scale-105 group"
          style={{
            right: -7,
            top: "50%",
            transform: "translateY(-50%)",
            width: 14,
            height: 44,
            borderRadius: 7,
            background: "var(--cc-bg)",
            border: `1px solid ${BORDER}`,
            boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
            color: MUTED,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cc-plum)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--cc-plum)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER;
            (e.currentTarget as HTMLButtonElement).style.color = MUTED;
          }}
        >
          {collapsed
            ? <ChevronRight size={9} strokeWidth={3} />
            : <ChevronLeft  size={9} strokeWidth={3} />
          }
        </button>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* ── Mobile header ─────────────────────────────────────────────── */}
        <header
          className="md:hidden safe-header-mobile flex items-center justify-between px-4 shrink-0 z-10"
          style={{ borderBottom: `1px solid ${BORDER}`, background: "var(--cc-bg)" }}
        >
          <Link href="/dashboard" className="flex items-center py-1 active:opacity-75 transition-opacity">
            <CareCliQLogoSm />
          </Link>

          {/* Current page label */}
          {pageLabel && (
            <p className="text-[13px] font-black truncate max-w-[140px]" style={{ color: TEXT }}>
              {pageLabel}
            </p>
          )}

          <div className="flex items-center gap-1">
            {/* Alerts badge on mobile */}
            {alertCount > 0 && (
              <Link href={topbarAlertHref}>
                <button
                  type="button"
                  className="h-8 w-8 rounded-xl flex items-center justify-center relative"
                  style={{ background: "var(--cc-alert-bg)", color: CORAL }}
                  aria-label={`${alertCount} compliance actions`}
                >
                  <AlertTriangle size={15} strokeWidth={2.5} />
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-white text-[9px] font-black flex items-center justify-center"
                    style={{ background: CORAL }}
                  >
                    {alertCount}
                  </span>
                </button>
              </Link>
            )}
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors active:bg-black/5"
              style={{ color: TEXT }}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* ── Desktop topbar ─────────────────────────────────────────────── */}
        <header
          className="hidden md:flex h-14 items-center shrink-0 select-none"
          style={{
            borderBottom: `1px solid ${BORDER}`,
            borderTop: "3px solid var(--cc-plum)",
            background: "var(--cc-bg)",
          }}
        >
          {/* ── Left zone — role pill ── */}
          <div className="flex items-center px-4 shrink-0">
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-[0.14em] select-none"
              style={{ background: PLUM, color: "#fff" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white opacity-70 shrink-0" />
              {rolePill}
            </div>
          </div>

          {/* ── Center zone: pill tabs (collapsed) or page label (expanded) ── */}
          {collapsed ? (
            <div className="flex items-center flex-1 gap-0.5 overflow-x-auto scrollbar-none px-1">
              {topbarQuicknav.map((item) => {
                const active = isActive(location, item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] whitespace-nowrap transition-all cursor-pointer"
                      style={{
                        background: active ? PLUM : "transparent",
                        color: active ? "#fff" : MUTED,
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      <Icon size={13} strokeWidth={active ? 2.5 : 2} style={{ color: active ? "#fff" : MUTED }} />
                      <span>{item.label}</span>
                      {alertCount > 0 && (item.href === "/compliance" || item.href === "/my-compliance") && (
                        <span
                          className="min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black flex items-center justify-center text-white"
                          style={{ background: CORAL }}
                        >
                          {alertCount}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
              <div className="w-px h-4 mx-1 shrink-0" style={{ background: BORDER }} />
              <Link href="/settings">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] whitespace-nowrap transition-all cursor-pointer"
                  style={{
                    background: isActive(location, "/settings") ? PLUM : "transparent",
                    color: isActive(location, "/settings") ? "#fff" : MUTED,
                    fontWeight: isActive(location, "/settings") ? 700 : 500,
                  }}
                >
                  <Settings size={13} strokeWidth={isActive(location, "/settings") ? 2.5 : 2}
                    style={{ color: isActive(location, "/settings") ? "#fff" : MUTED }} />
                  <span>Settings</span>
                </div>
              </Link>
            </div>
          ) : (
            /* Expanded: page title */
            <div className="flex items-center flex-1 px-3">
              {pageLabel && (
                <p
                  className="text-[15px] font-black tracking-tight"
                  style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}
                >
                  {pageLabel}
                </p>
              )}
            </div>
          )}

          {/* ── Right zone: search + actions ── */}
          <div className="flex items-center gap-2 px-4 shrink-0">
            {/* Search */}
            <GlobalSearch sections={navSections} />

            {/* Compliance alert button — pulses when actions are pending */}
            {alertCount > 0 && (
              <Link href={topbarAlertHref}>
                <button
                  type="button"
                  aria-label={`${alertCount} compliance action${alertCount !== 1 ? "s" : ""} need attention`}
                  className="relative flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-bold transition-all hover:opacity-90 whitespace-nowrap"
                  style={{ background: "var(--cc-alert-bg)", color: CORAL, border: "1px solid rgba(190,24,93,0.18)" }}
                >
                  <AlertTriangle size={13} strokeWidth={2.5} />
                  <span className="font-black">{alertCount}</span>
                  <span className="hidden xl:inline">action{alertCount !== 1 ? "s" : ""}</span>
                </button>
              </Link>
            )}

            {/* Notification bell */}
            <button
              type="button"
              aria-label="Open notifications"
              className="relative h-8 w-8 rounded-xl border flex items-center justify-center hover:bg-[var(--cc-soft)] transition-colors"
              style={{ borderColor: BORDER }}
            >
              {!isWorker
                ? <NotificationBell onClick={() => setNotifOpen(true)} />
                : <WorkerNotificationBell onClick={() => setWorkerNotifOpen(true)} />
              }
            </button>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="h-8 w-8 rounded-xl border flex items-center justify-center transition-colors hover:bg-[var(--cc-soft)]"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              {theme === "dark" ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
            </button>

            {/* Profile */}
            <ProfileDropdown
              displayName={displayName}
              displayRole={displayRole}
              initials={initials}
              userRole={userRole}
              onLogout={logout}
            />
          </div>
        </header>

        {isWorker && <NotificationRealtimeBridge />}
        {isWorker && <NotificationBannerStack />}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-5 md:px-7 py-6 safe-scroll-bottom md:pb-8">
          {children}
        </main>

        {/* Notification panels */}
        {notifOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setNotifOpen(false)} />
            <NotificationPanel onClose={() => setNotifOpen(false)} />
          </>
        )}
        {workerNotifOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setWorkerNotifOpen(false)} />
            <WorkerNotificationPanel onClose={() => setWorkerNotifOpen(false)} />
          </>
        )}
      </div>

      {/* ── Mobile bottom nav ──────────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch safe-nav-bottom"
        style={{ borderTop: `1px solid ${BORDER}`, background: "var(--cc-bg)" }}
      >
        {(ROLE_BOTTOM_NAV[userRole as NavRole] ?? ROLE_BOTTOM_NAV.support_worker).map((item) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-2 relative transition-colors min-h-[60px]"
              style={{ color: active ? PLUM : MUTED }}
            >
              {/* Active indicator — top pill */}
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full transition-all duration-200"
                style={{
                  width: active ? 32 : 0,
                  height: 3,
                  background: PLUM,
                  opacity: active ? 1 : 0,
                }}
              />

              {/* Icon pill — wider active state for easier tap recognition */}
              <div
                className="flex items-center justify-center rounded-xl transition-all duration-200"
                style={{
                  width: active ? 52 : 36,
                  height: 32,
                  background: active ? ACTIVE : "transparent",
                }}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              </div>

              <span className={cn("text-[10.5px] leading-none", active ? "font-bold" : "font-medium")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile drawer backdrop ─────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(17,24,39,0.35)", backdropFilter: "blur(2px)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ borderRight: `1px solid ${BORDER}`, background: "var(--cc-bg)" }}
      >
        <div className="absolute top-3 right-3 z-10">
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            title="Close menu"
            className="p-1.5 rounded-xl hover:bg-black/5 transition-colors"
            style={{ color: MUTED }}
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContents {...sharedProps} isDrawer collapsed={false} onNav={() => setDrawerOpen(false)} />
      </aside>
    </div>
  );
}