import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Menu, X, Plus, ChevronLeft, ChevronRight,
  LayoutDashboard, Users, CalendarDays, ShieldCheck,
  Settings, AlertTriangle, FileBarChart2, FolderOpen,
  LogOut, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadAlerts } from "@workspace/api-client-react";

// ── Design tokens (enterprise neutral) ───────────────────────────────────────
const PLUM    = "#542269";
const TEXT    = "#111827";
const MUTED   = "#6B7280";
const BORDER  = "#E5E7EB";
const BGHOVER = "#F3F4F6";

const NAV_ITEMS = [
  { href: "/dashboard",  label: "Dashboard",    icon: LayoutDashboard },
  { href: "/patients",   label: "Participants", icon: Users           },
  { href: "/sessions",   label: "Sessions",     icon: CalendarDays    },
  { href: "/incidents",  label: "Incidents",    icon: AlertTriangle   },
  { href: "/compliance", label: "Compliance",   icon: ShieldCheck     },
  { href: "/reports",    label: "Reports",      icon: FileBarChart2   },
  { href: "/documents",  label: "Documents",    icon: FolderOpen      },
  { href: "/settings",   label: "Settings",     icon: Settings        },
];

const BOTTOM_NAV = [
  { href: "/dashboard",  label: "Home",     icon: LayoutDashboard },
  { href: "/sessions",   label: "Sessions", icon: CalendarDays    },
  { href: "/patients",   label: "People",   icon: Users           },
  { href: "/compliance", label: "Audit",    icon: ShieldCheck     },
];

function isActive(location: string, href: string) {
  return (
    location === href ||
    location.startsWith(href + "/") ||
    (href === "/patients" && (
      location.startsWith("/patients") || location.startsWith("/participants")
    ))
  );
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const { settings } = useSettings();
  const { user, logout } = useAuth();
  const { data: alerts = [] } = useGetUnreadAlerts();

  const displayName   = user?.full_name || settings?.name || user?.email || "Support Worker";
  const displayRole   = user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? "Support Worker";
  const initials      = getInitials(displayName);
  const alertCount    = Array.isArray(alerts) ? alerts.length : 0;

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* ignore */ }
  };

  // ── Sidebar inner content ──────────────────────────────────────────────────
  const SidebarInner = ({
    onNav,
    isDrawer = false,
  }: {
    onNav?: () => void;
    isDrawer?: boolean;
  }) => {
    const compact = !isDrawer && collapsed;

    return (
      <div className="flex flex-col h-full">
        {/* Wordmark + collapse toggle */}
        <div
          className="flex items-center h-14 shrink-0 px-3"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          {!compact && (
            <span className="flex-1 text-[17px] font-bold tracking-tight select-none" style={{ color: PLUM }}>
              Care<span style={{ color: TEXT }}>Scribe</span>
            </span>
          )}
          {!isDrawer && (
            <button
              onClick={toggleCollapse}
              title={compact ? "Expand sidebar" : "Collapse sidebar"}
              className="p-1.5 rounded-lg transition-colors hover:bg-gray-100 ml-auto shrink-0"
              style={{ color: MUTED }}
            >
              {compact ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          )}
        </div>

        {/* New Session — always visible */}
        <div className={cn("pt-3 shrink-0", compact ? "px-2" : "px-3")}>
          <Link href="/sessions/new" onClick={onNav}>
            <div
              className={cn(
                "flex items-center justify-center rounded-lg text-white text-[13px] font-semibold transition-opacity hover:opacity-90",
                compact ? "h-9 w-full" : "h-9 gap-2 px-3"
              )}
              style={{ background: PLUM }}
            >
              <Plus size={15} strokeWidth={2.5} />
              {!compact && "New Session"}
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-3 space-y-0.5", compact ? "px-2" : "px-3")}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(location, item.href);
            const Icon   = item.icon;
            const showBadge = item.href === "/compliance" && alertCount > 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNav}
                title={compact ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-[13px] font-medium transition-colors w-full",
                  compact ? "h-9 justify-center px-0" : "px-2.5 py-2"
                )}
                style={{
                  background: active ? `${PLUM}0F` : "transparent",
                  color: active ? PLUM : MUTED,
                  fontWeight: active ? 600 : 500,
                }}
              >
                <div className="relative shrink-0">
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                  {showBadge && (
                    <span
                      className="absolute -top-1 -right-1 min-w-[14px] h-3.5 rounded-full text-[8px] font-bold text-white flex items-center justify-center px-0.5"
                      style={{ background: "#DC2626" }}
                    >
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </div>
                {!compact && item.label}
              </Link>
            );
          })}
        </nav>

        {/* Alerts status strip (expanded only) */}
        {!compact && alertCount > 0 && (
          <div
            className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium"
            style={{ background: "rgba(220,38,38,0.06)", color: "#DC2626" }}
          >
            <Bell size={12} />
            {alertCount} unread alert{alertCount !== 1 ? "s" : ""}
          </div>
        )}

        {/* Profile */}
        <div
          className={cn("shrink-0 py-3", compact ? "px-2" : "px-3")}
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          {compact ? (
            <div
              className="w-8 h-8 rounded-lg mx-auto flex items-center justify-center text-[11px] font-bold text-white cursor-default"
              style={{ background: PLUM }}
              title={displayName}
            >
              {initials}
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                style={{ background: PLUM }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold truncate" style={{ color: TEXT }}>{displayName}</p>
                <p className="text-[10.5px] capitalize truncate" style={{ color: MUTED }}>{displayRole}</p>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: MUTED }}
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen w-full" style={{ background: "#F9FAFB", color: TEXT }}>

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col h-screen sticky top-0 bg-white shrink-0 overflow-hidden"
        style={{
          width: collapsed ? 60 : 220,
          transition: "width 200ms ease",
          borderRight: `1px solid ${BORDER}`,
        }}
      >
        <SidebarInner />
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header
          className="md:hidden h-14 flex items-center justify-between px-4 bg-white shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <span className="text-[17px] font-bold tracking-tight" style={{ color: PLUM }}>
            Care<span style={{ color: TEXT }}>Scribe</span>
          </span>
          <div className="flex items-center gap-2">
            <Link href="/sessions/new">
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold"
                style={{ background: PLUM }}
              >
                <Plus size={12} strokeWidth={2.5} /> New
              </button>
            </Link>
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-lg transition-colors hover:bg-gray-100"
              style={{ color: MUTED }}
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        {/* Desktop top bar — slim context bar */}
        <header
          className="hidden md:flex h-11 items-center justify-end px-6 bg-white shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center gap-3">
            {alertCount > 0 && (
              <Link href="/compliance">
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition-colors hover:bg-red-50"
                  style={{ color: "#DC2626" }}
                >
                  <Bell size={13} />
                  {alertCount} alert{alertCount !== 1 ? "s" : ""}
                </button>
              </Link>
            )}
            <div className="flex items-center gap-2 pl-2" style={{ borderLeft: `1px solid ${BORDER}` }}>
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: PLUM }}
              >
                {initials}
              </div>
              <span className="text-[12px] font-medium" style={{ color: TEXT }}>
                {displayName.split(" ")[0]}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 md:px-6 py-5 pb-20 md:pb-6">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ──────────────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center bg-white"
        style={{ borderTop: `1px solid ${BORDER}`, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {BOTTOM_NAV.map((item) => {
          const active = isActive(location, item.href);
          const Icon   = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors"
              style={{ color: active ? PLUM : MUTED }}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile drawer overlay ───────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile drawer ───────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white flex flex-col shadow-xl transition-transform duration-250",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="absolute top-3 right-3">
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            style={{ color: MUTED }}
          >
            <X size={16} />
          </button>
        </div>
        <SidebarInner onNav={() => setDrawerOpen(false)} isDrawer />
      </aside>
    </div>
  );
}
