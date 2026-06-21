import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Menu, X, ChevronLeft, ChevronRight,
  LayoutDashboard, Users, UserRound, CalendarDays,
  ShieldCheck, Settings, AlertTriangle, FileBarChart2,
  CreditCard, LogOut, Search, Bell, FileCheck2, BadgeCheck, Wrench, Target, ClipboardCheck, ClipboardList,
  BarChart2, UserCheck, DollarSign, GraduationCap, LockKeyhole, Radio,
} from "lucide-react";
import { NotificationBell, NotificationPanel } from "@/components/coordinator/NotificationPanel";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { CareCliQLogo, CareCliQLogoSm } from "@/components/CareCliQLogo";

// ── Design Tokens ─────────────────────────────────────────────────────────────
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const MUTED  = "#7A6A9E";
const TEXT   = "#1E1640";
const APP_BG = "#F5F3FC";
const ACTIVE = "#EDEAFF";

type NavRole = "support_coordinator" | "support_worker" | "allied_health" | "managing_director";
type NavIconProps = { size?: number; strokeWidth?: number; className?: string };

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<NavIconProps>;
}
interface NavSection {
  group?: string;
  items: NavItem[];
}

// ── Per-role sectioned nav ────────────────────────────────────────────────────
const SECTIONED_NAV: Record<NavRole, NavSection[]> = {
  support_coordinator: [
    {
      items: [
        { href: "/dashboard",  label: "Dashboard",    icon: LayoutDashboard },
      ],
    },
    {
      group: "People & Care",
      items: [
        { href: "/team",               label: "Team",             icon: Users },
        { href: "/patients",           label: "Participants",      icon: UserRound },
        { href: "/sessions",           label: "Sessions",          icon: CalendarDays },
        { href: "/coordinator-goals",  label: "Goals & Planning",  icon: Target },
      ],
    },
    {
      group: "Quality & Safety",
      items: [
        { href: "/compliance",      label: "Compliance",      icon: ShieldCheck },
        { href: "/session-review",  label: "Session Review",  icon: ClipboardCheck },
        { href: "/audit-pack",      label: "Audit Pack",      icon: FileCheck2 },
        { href: "/incidents",       label: "Incidents",       icon: AlertTriangle },
      ],
    },
    {
      group: "Operations",
      items: [
        { href: "/coordinator/rostering", label: "Rostering",       icon: CalendarDays },
        { href: "/coordinator/live",      label: "Live Monitoring", icon: Radio        },
        { href: "/billing",     label: "Invoices",     icon: CreditCard },
        { href: "/credentials", label: "Credentials",  icon: BadgeCheck },
        { href: "/toolkit",     label: "Toolkit",       icon: Wrench },
      ],
    },
  ],
  support_worker: [
    {
      items: [
        { href: "/dashboard",    label: "Dashboard",       icon: LayoutDashboard },
      ],
    },
    {
      group: "My Work",
      items: [
        { href: "/my-shifts",    label: "My Shifts",       icon: CalendarDays },
        { href: "/my-clients",   label: "My Clients",      icon: UserRound },
        { href: "/tasks",        label: "Tasks",           icon: ClipboardList },
      ],
    },
    {
      group: "Safety",
      items: [
        { href: "/my-compliance", label: "My Compliance",  icon: ShieldCheck },
        { href: "/incidents",     label: "Incidents",       icon: AlertTriangle },
      ],
    },
    {
      group: "Resources",
      items: [
        { href: "/credentials",  label: "Credentials",     icon: BadgeCheck },
        { href: "/toolkit",      label: "Toolkit",          icon: Wrench },
      ],
    },
    {
      group: "Account",
      items: [
        { href: "/worker/profile", label: "My Profile",      icon: UserRound },
        { href: "/worker/security", label: "Security",       icon: LockKeyhole },
      ],
    },
  ],
  allied_health: [
    {
      items: [
        { href: "/dashboard",  label: "Dashboard",         icon: LayoutDashboard },
      ],
    },
    {
      group: "Clinical",
      items: [
        { href: "/patients",   label: "Caseload",          icon: UserRound },
        { href: "/sessions",   label: "Sessions",          icon: CalendarDays },
      ],
    },
    {
      group: "Quality",
      items: [
        { href: "/incidents",  label: "Incidents",         icon: AlertTriangle },
        { href: "/reports",    label: "Reports",           icon: FileBarChart2 },
      ],
    },
    {
      group: "Admin",
      items: [
        { href: "/billing",     label: "Invoices",         icon: CreditCard },
        { href: "/credentials", label: "Credentials",      icon: BadgeCheck },
        { href: "/toolkit",     label: "Toolkit",           icon: Wrench },
      ],
    },
  ],
  managing_director: [
    {
      items: [
        { href: "/hub", label: "Hub", icon: LayoutDashboard },
      ],
    },
    {
      group: "MD Workspaces",
      items: [
        { href: "/md/executive",   label: "Executive",   icon: BarChart2 },
        { href: "/md/staff",       label: "Staff",        icon: UserCheck },
        { href: "/md/compliance",  label: "Compliance",   icon: ShieldCheck },
        { href: "/md/financial",   label: "Financial",    icon: DollarSign },
        { href: "/md/onboarding",  label: "Onboarding",   icon: GraduationCap },
      ],
    },
  ],
};

// ── Mobile bottom tabs ────────────────────────────────────────────────────────
const ROLE_BOTTOM_NAV: Record<NavRole, NavItem[]> = {
  support_coordinator: [
    { href: "/dashboard",  label: "Home",       icon: LayoutDashboard },
    { href: "/team",       label: "Team",        icon: Users },
    { href: "/patients",   label: "People",      icon: UserRound },
    { href: "/compliance", label: "Compliance",  icon: ShieldCheck },
    { href: "/billing",    label: "Invoices",    icon: CreditCard },
  ],
  support_worker: [
    { href: "/dashboard",     label: "Home",       icon: LayoutDashboard },
    { href: "/my-shifts",     label: "Shifts",     icon: CalendarDays },
    { href: "/my-clients",    label: "Clients",    icon: UserRound },
    { href: "/tasks",         label: "Tasks",      icon: ClipboardList },
    { href: "/my-compliance", label: "Compliance", icon: ShieldCheck },
  ],
  allied_health: [
    { href: "/dashboard",  label: "Home",         icon: LayoutDashboard },
    { href: "/patients",   label: "Caseload",     icon: UserRound },
    { href: "/sessions",   label: "Sessions",     icon: CalendarDays },
    { href: "/reports",    label: "Reports",      icon: FileBarChart2 },
    { href: "/credentials",label: "Creds",        icon: BadgeCheck },
  ],
  managing_director: [
    { href: "/hub",           label: "Hub",        icon: LayoutDashboard },
    { href: "/md/executive",  label: "Executive",  icon: BarChart2 },
    { href: "/md/staff",      label: "Staff",      icon: UserCheck },
    { href: "/md/compliance", label: "Compliance", icon: ShieldCheck },
    { href: "/md/financial",  label: "Financial",  icon: DollarSign },
  ],
};

function isActive(location: string, href: string) {
  return (
    location === href ||
    location.startsWith(href + "/") ||
    (href === "/patients" && (location.startsWith("/patients") || location.startsWith("/participants"))) ||
    (href === "/my-clients" && location.startsWith("/my-clients")) ||
    (href === "/my-shifts" && location.startsWith("/my-shifts")) ||
    (href === "/tasks" && location.startsWith("/tasks")) ||
    (href === "/worker/profile" && location.startsWith("/worker/profile")) ||
    (href === "/worker/security" && location.startsWith("/worker/security"))
  );
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ── Sidebar contents ──────────────────────────────────────────────────────────
function SidebarContents({
  location, collapsed, isDrawer,
  alertCount, displayName, displayRole, initials,
  onNav, onToggle, onLogout,
}: {
  location: string; collapsed: boolean; isDrawer: boolean;
  alertCount: number; displayName: string; displayRole: string; initials: string;
  onNav?: () => void; onToggle: () => void; onLogout: () => void;
}) {
  const compact = !isDrawer && collapsed;
  const { user } = useAuth();
  const role = (user?.role ?? "support_worker") as NavRole;
  const sections = SECTIONED_NAV[role] ?? SECTIONED_NAV.support_worker;

  return (
    <div className="flex flex-col h-full select-none">

      {/* Logo row */}
      <div className={cn(
        "flex items-center shrink-0 overflow-visible",
        compact ? "justify-center px-3 h-20" : "justify-between px-5 h-24",
      )}>
        <Link
          href="/dashboard"
          onClick={onNav}
          className={cn(
            "flex items-center transition-all duration-300 active:opacity-75",
            compact ? "justify-center w-full" : "flex-1 min-w-0",
          )}
        >
          <div className={cn("flex items-center overflow-visible", compact ? "justify-center" : "justify-start")}>
            <CareCliQLogo compact={compact} />
          </div>
        </Link>
        {!compact && !isDrawer && (
          <button
            onClick={onToggle}
            title="Collapse sidebar"
            className="ml-2 shrink-0 p-2 rounded-full transition-all hover:bg-black/5 hover:scale-105"
            style={{ color: MUTED }}
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      {compact && (
        <div className="flex justify-center pb-2 shrink-0">
          <button
            onClick={onToggle}
            title="Expand sidebar"
            className="p-2 rounded-full transition-colors hover:bg-black/5"
            style={{ color: MUTED }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Nav sections */}
      <nav className={cn("flex-1 overflow-y-auto scrollbar-none", compact ? "px-2 space-y-4" : "px-4 space-y-5")}>
        {sections.map((section, si) => (
          <div key={si}>
            {/* Group label — shown when expanded */}
            {section.group && !compact && (
              <p
                className="mb-1 px-1 text-[10px] font-black uppercase tracking-[0.2em]"
                style={{ color: MUTED }}
              >
                {section.group}
              </p>
            )}
            {/* Thin divider — shown when compact and not first section */}
            {section.group && compact && si > 0 && (
              <div className="h-px mx-1 mb-2" style={{ background: "#E2DEF2" }} />
            )}

            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(location, item.href);
                const Icon = item.icon;
                const hasAlert = alertCount > 0 && (item.href === "/compliance" || item.href === "/my-compliance");
                return (
                  <Link key={item.href} href={item.href} onClick={onNav} title={compact ? item.label : undefined}>
                    <div
                      className={cn(
                        "flex items-center rounded-2xl text-[14px] transition-all w-full cursor-pointer",
                        compact ? "h-11 justify-center px-0" : "gap-3.5 px-4 py-3",
                      )}
                      style={{
                        background: active ? ACTIVE : "transparent",
                        color: active ? PLUM : MUTED,
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                      {!compact && <span className="flex-1 truncate">{item.label}</span>}
                      {!compact && hasAlert && (
                        <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[#F03060] text-white text-[10px] font-black flex items-center justify-center">
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

        {/* Settings — always at the bottom of the nav list */}
        {!compact && (
          <div className="pt-1 border-t" style={{ borderColor: "#E2DEF2" }}>
            <Link href="/settings" onClick={onNav}>
              <div
                className="flex items-center gap-3.5 rounded-2xl text-[14px] transition-all w-full cursor-pointer px-4 py-3"
                style={{
                  background: isActive(location, "/settings") ? ACTIVE : "transparent",
                  color: isActive(location, "/settings") ? PLUM : MUTED,
                  fontWeight: isActive(location, "/settings") ? 700 : 500,
                }}
              >
                <Settings size={20} strokeWidth={isActive(location, "/settings") ? 2.5 : 2} />
                <span>Settings</span>
              </div>
            </Link>
          </div>
        )}
        {compact && (
          <div className="pt-1">
            <Link href="/settings" onClick={onNav} title="Settings">
              <div
                className="h-11 flex items-center justify-center rounded-2xl transition-all cursor-pointer"
                style={{
                  background: isActive(location, "/settings") ? ACTIVE : "transparent",
                  color: isActive(location, "/settings") ? PLUM : MUTED,
                }}
              >
                <Settings size={20} strokeWidth={isActive(location, "/settings") ? 2.5 : 2} />
              </div>
            </Link>
          </div>
        )}
      </nav>

      {/* User profile footer */}
      <div className={cn("shrink-0 py-4 mt-2", compact ? "px-2" : "px-5")}>
        {compact ? (
          <div
            className="w-10 h-10 rounded-full mx-auto flex items-center justify-center text-[12px] font-bold cursor-default"
            style={{ background: ACTIVE, color: PLUM }}
            title={displayName}
          >
            {initials}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0"
              style={{ background: ACTIVE, color: PLUM }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold truncate" style={{ color: TEXT }}>{displayName}</p>
              <p className="text-[11px] font-medium capitalize truncate" style={{ color: MUTED }}>{displayRole}</p>
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="shrink-0 p-2 rounded-full hover:bg-black/5 transition-colors"
              style={{ color: MUTED }}
            >
              <LogOut size={16} strokeWidth={2} />
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
  const [searchQuery, setSearchQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
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
  const topbarAlertHref = isWorker ? "/my-compliance" : "/compliance";

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* noop */ }
  };

  const sharedProps = {
    location, collapsed, alertCount, displayName, displayRole, initials,
    onToggle: toggleCollapse, onLogout: logout,
  };

  return (
    <div className="flex h-screen w-full selection:bg-pink-100" style={{ background: APP_BG, color: TEXT }}>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: collapsed ? 88 : 260 }}
      >
        <SidebarContents {...sharedProps} isDrawer={false} />
      </aside>

      {/* Main content canvas */}
      <div className="flex-1 flex flex-col min-w-0 md:py-3 md:pr-3 h-full relative">
        <div className="flex-1 flex flex-col bg-white md:rounded-[2.5rem] md:shadow-[0_8px_40px_rgba(106,64,125,0.06)] overflow-hidden relative">

          {/* Mobile header */}
          <header className="md:hidden h-16 flex items-center justify-between px-5 bg-white shrink-0 z-10 border-b border-black/5">
            <Link href="/dashboard" className="flex items-center focus:outline-none py-1 active:opacity-75 transition-opacity">
              <CareCliQLogoSm />
            </Link>
            <button onClick={() => setDrawerOpen(true)} className="p-2.5 rounded-full transition-colors active:bg-black/5" style={{ color: TEXT }}>
              <Menu size={22} />
            </button>
          </header>

          {/* Desktop topbar capsule */}
          <header className="hidden md:flex h-24 items-center px-8 shrink-0 z-10 w-full select-none">
            <div className="flex items-center gap-4 bg-white border border-[#EBE8F5] p-2 pl-4 pr-4 rounded-[2.5rem] shadow-[0_4px_20px_rgba(122,106,158,0.06)] w-full h-16">

              {/* Search */}
              <div className="relative flex-1">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7A6A9E]/60" />
                <input
                  type="text"
                  placeholder={isWorker ? "Search your clients, sessions, or notes..." : "Search records, team files, or logs..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 pl-11 pr-4 rounded-full bg-white text-[13px] font-medium placeholder:text-[#7A6A9E]/40 border border-[#E2DEF2] focus:outline-none focus:border-[#5533CC] transition-all"
                />
              </div>

              {/* Bell — coordinator gets NotificationBell, workers get the link */}
              {!isWorker ? (
                <div className="relative w-11 h-11 rounded-full bg-white border border-[#E2DEF2] flex items-center justify-center hover:bg-[#F5F3FC] transition-colors shrink-0">
                  <NotificationBell onClick={() => setNotifOpen(true)} />
                </div>
              ) : (
                <Link href={topbarAlertHref} className="relative w-11 h-11 rounded-full bg-white border border-[#E2DEF2] flex items-center justify-center hover:bg-[#F5F3FC] transition-colors shrink-0">
                  <Bell size={18} style={{ color: PLUM }} strokeWidth={2} />
                  {alertCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#F03060] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                      {alertCount}
                    </span>
                  )}
                </Link>
              )}

              {/* Quick link */}
              {isWorker ? (
                <Link href="/my-clients" className="shrink-0">
                  <button className="h-11 px-5 rounded-full text-[13px] font-bold bg-white border border-[#E2DEF2] text-[#1E1640] hover:bg-[#F5F3FC] transition-all whitespace-nowrap">
                    My Clients
                  </button>
                </Link>
              ) : (
                <Link href="/patients" className="shrink-0">
                  <button className="h-11 px-5 rounded-full text-[13px] font-bold bg-white border border-[#E2DEF2] text-[#1E1640] hover:bg-[#F5F3FC] transition-all whitespace-nowrap">
                    Manage Participants
                  </button>
                </Link>
              )}

              <div className="h-6 w-[1px] bg-[#E2DEF2] mx-1 shrink-0" />

              {/* Alert action badge */}
              {alertCount > 0 && (
                <Link href={topbarAlertHref} className="shrink-0">
                  <button className="flex items-center gap-1.5 px-4 h-11 rounded-full text-[13px] font-bold transition-all hover:opacity-90 whitespace-nowrap" style={{ background: "#FFE8EE", color: CORAL }}>
                    <AlertTriangle size={14} strokeWidth={2.5} />
                    <span>{alertCount} Action Item{alertCount !== 1 ? "s" : ""}</span>
                  </button>
                </Link>
              )}

              {/* User chip */}
              <div className="flex items-center gap-3 pl-1 shrink-0">
                <span className="text-[13px] font-bold text-[#1E1640] whitespace-nowrap">
                  {displayName.split(" ")[0]}
                </span>
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 border border-[#5533CC]/10 shadow-sm"
                  style={{ background: ACTIVE, color: PLUM }}
                >
                  {initials}
                </div>
              </div>

            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto px-5 md:px-8 py-4 pb-24 md:pb-8">
            {children}
          </main>

          {/* Notification slide-over */}
          {notifOpen && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/20"
                onClick={() => setNotifOpen(false)}
              />
              <NotificationPanel onClose={() => setNotifOpen(false)} />
            </>
          )}
        </div>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center bg-white/90 backdrop-blur-md"
        style={{ boxShadow: "0 -8px 30px rgba(0,0,0,0.04)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {(ROLE_BOTTOM_NAV[userRole as NavRole] ?? ROLE_BOTTOM_NAV.support_worker).map((item) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors relative"
              style={{ color: active ? PLUM : MUTED }}
            >
              {active && <div className="absolute top-0 w-10 h-[3px] rounded-b-full" style={{ background: PLUM }} />}
              <Icon size={22} strokeWidth={active ? 2.5 : 2} className={cn("mt-1", active && "animate-in zoom-in-90 duration-200")} />
              <span className={cn("text-[11px] leading-none", active ? "font-bold" : "font-medium")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 transition-opacity duration-300"
          style={{ background: "rgba(59,46,66,0.4)", backdropFilter: "blur(2px)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-white flex flex-col transition-transform duration-300 ease-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ boxShadow: "10px 0 40px rgba(0,0,0,0.08)" }}
      >
        <div className="absolute top-4 right-4 z-10">
          <button onClick={() => setDrawerOpen(false)} className="p-2 rounded-full hover:bg-black/5 transition-colors" style={{ color: MUTED }}>
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>
        <SidebarContents {...sharedProps} isDrawer collapsed={false} onNav={() => setDrawerOpen(false)} />
      </aside>
    </div>
  );
}
