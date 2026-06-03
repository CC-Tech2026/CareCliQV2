import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Menu, X, ChevronLeft, ChevronRight,
  LayoutDashboard, Users, UserRound, CalendarDays,
  ShieldCheck, Settings, AlertTriangle, FileBarChart2,
  CreditCard, LogOut, Bell, FileCheck2, BadgeCheck, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { CareScribeLogo, CareScribeLogoSm } from "@/components/CareScribeLogo";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const MUTED  = "#7A6A9E";
const TEXT   = "#1E1640";
const APP_BG = "#F5F3FC";
const ACTIVE = "#EDEAFF";

type NavRole = "support_coordinator" | "support_worker" | "allied_health";
type NavIconProps = { size?: number; strokeWidth?: number; className?: string };

// ── Typed nav item + section group ────────────────────────────────────────────
interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<NavIconProps>;
}
interface NavSection {
  group?: string; // undefined = no label (top-level)
  items: NavItem[];
}

// ── Per-role sectioned nav config ─────────────────────────────────────────────
const SECTIONED_NAV: Record<NavRole, NavSection[]> = {
  support_coordinator: [
    {
      items: [
        { href: "/dashboard",  label: "Dashboard",   icon: LayoutDashboard },
      ],
    },
    {
      group: "People & Care",
      items: [
        { href: "/team",       label: "Team",         icon: Users },
        { href: "/patients",   label: "Participants",  icon: UserRound },
        { href: "/sessions",   label: "Sessions",      icon: CalendarDays },
      ],
    },
    {
      group: "Quality & Safety",
      items: [
        { href: "/compliance", label: "Compliance",   icon: ShieldCheck },
        { href: "/audit-pack", label: "Audit Pack",   icon: FileCheck2 },
        { href: "/incidents",  label: "Incidents",    icon: AlertTriangle },
      ],
    },
    {
      group: "Operations",
      items: [
        { href: "/billing",      label: "Invoices",     icon: CreditCard },
        { href: "/credentials",  label: "Credentials",  icon: BadgeCheck },
        { href: "/toolkit",      label: "Toolkit",      icon: Wrench },
      ],
    },
  ],
  support_worker: [
    {
      items: [
        { href: "/dashboard",    label: "Dashboard",      icon: LayoutDashboard },
      ],
    },
    {
      group: "My Work",
      items: [
        { href: "/my-clients",   label: "My Clients",     icon: UserRound },
      ],
    },
    {
      group: "Safety",
      items: [
        { href: "/my-compliance", label: "My Compliance", icon: ShieldCheck },
        { href: "/incidents",     label: "Incidents",      icon: AlertTriangle },
      ],
    },
    {
      group: "Resources",
      items: [
        { href: "/credentials",  label: "Credentials",    icon: BadgeCheck },
        { href: "/toolkit",      label: "Toolkit",         icon: Wrench },
      ],
    },
  ],
  allied_health: [
    {
      items: [
        { href: "/dashboard",  label: "Dashboard",        icon: LayoutDashboard },
      ],
    },
    {
      group: "Clinical",
      items: [
        { href: "/patients",   label: "Caseload",         icon: UserRound },
        { href: "/sessions",   label: "Sessions",         icon: CalendarDays },
      ],
    },
    {
      group: "Quality",
      items: [
        { href: "/incidents",  label: "Incidents",        icon: AlertTriangle },
        { href: "/reports",    label: "Reports",          icon: FileBarChart2 },
      ],
    },
    {
      group: "Admin",
      items: [
        { href: "/billing",     label: "Invoices",        icon: CreditCard },
        { href: "/credentials", label: "Credentials",     icon: BadgeCheck },
        { href: "/toolkit",     label: "Toolkit",          icon: Wrench },
      ],
    },
  ],
};

// ── Mobile bottom tabs (max 5, most important per role) ───────────────────────
const BOTTOM_NAV: Record<NavRole, NavItem[]> = {
  support_coordinator: [
    { href: "/dashboard",  label: "Home",        icon: LayoutDashboard },
    { href: "/team",       label: "Team",         icon: Users },
    { href: "/patients",   label: "People",       icon: UserRound },
    { href: "/compliance", label: "Compliance",   icon: ShieldCheck },
    { href: "/billing",    label: "Invoices",     icon: CreditCard },
  ],
  support_worker: [
    { href: "/dashboard",     label: "Home",       icon: LayoutDashboard },
    { href: "/my-clients",    label: "Clients",    icon: UserRound },
    { href: "/my-compliance", label: "Compliance", icon: ShieldCheck },
    { href: "/toolkit",       label: "Toolkit",    icon: Wrench },
  ],
  allied_health: [
    { href: "/dashboard",  label: "Home",         icon: LayoutDashboard },
    { href: "/patients",   label: "Caseload",     icon: UserRound },
    { href: "/sessions",   label: "Sessions",     icon: CalendarDays },
    { href: "/reports",    label: "Reports",      icon: FileBarChart2 },
    { href: "/credentials",label: "Creds",        icon: BadgeCheck },
  ],
};

function isActive(location: string, href: string) {
  return (
    location === href ||
    location.startsWith(href + "/") ||
    (href === "/patients" && (location.startsWith("/patients") || location.startsWith("/participants"))) ||
    (href === "/my-clients" && location.startsWith("/my-clients"))
  );
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ── Sidebar contents (shared between desktop + mobile drawer) ─────────────────
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

      {/* ── Logo row ──────────────────────────────────────────────────────── */}
      <div className={cn(
        "flex items-center shrink-0",
        compact ? "justify-center h-16 px-3" : "justify-between h-16 px-4",
      )}>
        <Link
          href="/dashboard"
          onClick={onNav}
          className={cn("flex items-center transition-opacity active:opacity-70", compact && "justify-center w-full")}
        >
          <CareScribeLogo compact={compact} />
        </Link>

        {!compact && !isDrawer && (
          <button
            onClick={onToggle}
            title="Collapse"
            className="p-1.5 rounded-lg transition-colors hover:bg-black/5 shrink-0 ml-1"
            style={{ color: MUTED }}
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {compact && (
        <div className="flex justify-center pb-1 shrink-0">
          <button
            onClick={onToggle}
            title="Expand"
            className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
            style={{ color: MUTED }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* ── Nav sections ──────────────────────────────────────────────────── */}
      <nav className={cn("flex-1 overflow-y-auto scrollbar-none pb-2", compact ? "px-2 space-y-4" : "px-3 space-y-5")}>
        {sections.map((section, si) => (
          <div key={si}>
            {/* Group label — hidden when compact */}
            {section.group && !compact && (
              <p
                className="mb-1 px-2 text-[10px] font-black uppercase tracking-[0.18em]"
                style={{ color: MUTED }}
              >
                {section.group}
              </p>
            )}
            {/* Divider line — shown when compact */}
            {section.group && compact && si > 0 && (
              <div className="h-px mx-2 mb-2" style={{ background: "#E2DEF2" }} />
            )}

            <div className={compact ? "space-y-1" : "space-y-0.5"}>
              {section.items.map(item => {
                const active = isActive(location, item.href);
                const Icon = item.icon;
                const hasAlert = alertCount > 0 && (item.href === "/compliance" || item.href === "/my-compliance");
                return (
                  <Link key={item.href} href={item.href} onClick={onNav} title={compact ? item.label : undefined}>
                    <div
                      className={cn(
                        "flex items-center rounded-lg text-sm transition-all w-full cursor-pointer",
                        compact ? "h-10 w-10 justify-center mx-auto" : "gap-3 px-3 py-2.5",
                      )}
                      style={{
                        background: active ? ACTIVE : "transparent",
                        color: active ? PLUM : MUTED,
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      <Icon size={18} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                      {!compact && (
                        <span className="flex-1 truncate">{item.label}</span>
                      )}
                      {!compact && hasAlert && (
                        <span
                          className="ml-auto h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-black flex items-center justify-center text-white"
                          style={{ background: CORAL }}
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
      </nav>

      {/* ── Footer: Settings + user profile ──────────────────────────────── */}
      <div className={cn("shrink-0 border-t pt-3 pb-4", compact ? "px-2" : "px-3")} style={{ borderColor: "#E2DEF2" }}>
        {/* Settings link */}
        <Link href="/settings" onClick={onNav} title={compact ? "Settings" : undefined}>
          <div
            className={cn(
              "flex items-center rounded-lg text-sm transition-all cursor-pointer mb-3",
              compact ? "h-10 w-10 justify-center mx-auto" : "gap-3 px-3 py-2",
              isActive(location, "/settings") ? "" : "",
            )}
            style={{
              background: isActive(location, "/settings") ? ACTIVE : "transparent",
              color: isActive(location, "/settings") ? PLUM : MUTED,
              fontWeight: isActive(location, "/settings") ? 700 : 500,
            }}
          >
            <Settings size={18} strokeWidth={isActive(location, "/settings") ? 2.5 : 2} className="shrink-0" />
            {!compact && <span>Settings</span>}
          </div>
        </Link>

        {/* User row */}
        {compact ? (
          <button
            onClick={onLogout}
            title={`Sign out (${displayName})`}
            className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-black mx-auto transition-colors hover:bg-black/5"
            style={{ background: ACTIVE, color: PLUM }}
          >
            {initials}
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
              style={{ background: ACTIVE, color: PLUM }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate" style={{ color: TEXT }}>{displayName}</p>
              <p className="text-[10px] font-medium capitalize truncate" style={{ color: MUTED }}>{displayRole}</p>
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors shrink-0"
              style={{ color: MUTED }}
            >
              <LogOut size={15} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main layout ───────────────────────────────────────────────────────────────
export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  const { settings } = useSettings();
  const { user, logout } = useAuth();
  const { data: alerts = [] } = useGetUnreadAlerts();

  const displayName = user?.full_name || settings?.name || user?.email || "User";
  const displayRole = user?.role?.replace(/_/g, " ") ?? "Support Worker";
  const initials    = getInitials(displayName);
  const alertCount  = Array.isArray(alerts) ? alerts.length : 0;
  const userRole    = user?.role as NavRole | undefined;
  const isWorker    = userRole === "support_worker";
  const alertHref   = isWorker ? "/my-compliance" : "/compliance";

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* noop */ }
  };

  const sharedProps = { location, collapsed, alertCount, displayName, displayRole, initials, onToggle: toggleCollapse, onLogout: logout };

  return (
    <div className="flex h-screen w-full" style={{ background: APP_BG, color: TEXT }}>

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out bg-white border-r"
        style={{ width: collapsed ? 72 : 240, borderColor: "#E8E4F4" }}
      >
        <SidebarContents {...sharedProps} isDrawer={false} />
      </aside>

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* Mobile header */}
        <header className="md:hidden h-14 flex items-center justify-between px-4 bg-white shrink-0 border-b" style={{ borderColor: "#E8E4F4" }}>
          <Link href="/dashboard" className="flex items-center active:opacity-75 transition-opacity">
            <CareScribeLogoSm />
          </Link>
          <div className="flex items-center gap-2">
            {alertCount > 0 && (
              <Link href={alertHref}>
                <div className="relative w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#FFE8EE" }}>
                  <Bell size={17} style={{ color: CORAL }} />
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F03060] text-white text-[9px] font-black flex items-center justify-center border-2 border-white">
                    {alertCount}
                  </span>
                </div>
              </Link>
            )}
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[#F5F3FC]"
              style={{ color: TEXT }}
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        {/* Desktop topbar */}
        <header className="hidden md:flex h-14 items-center justify-between px-6 shrink-0 bg-white border-b" style={{ borderColor: "#E8E4F4" }}>
          <div />
          <div className="flex items-center gap-3">
            {/* Alert badge */}
            {alertCount > 0 && (
              <Link href={alertHref}>
                <button
                  className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-bold transition-colors hover:opacity-90"
                  style={{ background: "#FFE8EE", color: CORAL }}
                >
                  <AlertTriangle size={13} strokeWidth={2.5} />
                  {alertCount} action{alertCount !== 1 ? "s" : ""}
                </button>
              </Link>
            )}

            {/* Bell */}
            <Link href={alertHref}>
              <div className="relative w-9 h-9 rounded-lg flex items-center justify-center border transition-colors hover:bg-[#F5F3FC]" style={{ borderColor: "#E2DEF2" }}>
                <Bell size={16} style={{ color: PLUM }} strokeWidth={2} />
                {alertCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F03060] text-white text-[9px] font-black flex items-center justify-center border-2 border-white">
                    {alertCount}
                  </span>
                )}
              </div>
            </Link>

            {/* Divider */}
            <div className="h-5 w-px" style={{ background: "#E2DEF2" }} />

            {/* User chip */}
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-bold" style={{ color: TEXT }}>{displayName.split(" ")[0]}</p>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black border"
                style={{ background: ACTIVE, color: PLUM, borderColor: "#D5CEFF" }}
              >
                {initials}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-5 md:px-8 py-6 pb-24 md:pb-8">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom tabs ─────────────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center bg-white border-t"
        style={{ borderColor: "#E8E4F4", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {(userRole ? BOTTOM_NAV[userRole] : BOTTOM_NAV.support_worker).map(item => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors relative"
              style={{ color: active ? PLUM : MUTED }}
            >
              {active && <div className="absolute top-0 w-8 h-[2px] rounded-b-full" style={{ background: PLUM }} />}
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span className={cn("text-[10px] leading-none", active ? "font-bold" : "font-medium")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile drawer backdrop ─────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 transition-opacity"
          style={{ background: "rgba(30,22,64,0.35)", backdropFilter: "blur(2px)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white flex flex-col transition-transform duration-300 ease-out border-r",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ borderColor: "#E8E4F4" }}
      >
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
            style={{ color: MUTED }}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
        <SidebarContents {...sharedProps} isDrawer collapsed={false} onNav={() => setDrawerOpen(false)} />
      </aside>
    </div>
  );
}
