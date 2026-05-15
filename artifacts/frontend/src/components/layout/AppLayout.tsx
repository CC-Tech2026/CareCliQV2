import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Menu, X, Plus, ChevronLeft, ChevronRight,
  LayoutDashboard, Users, CalendarDays, ShieldCheck,
  Settings, AlertTriangle, FileBarChart2, FolderOpen,
  LogOut, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadAlerts } from "@workspace/api-client-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "#542269";
const CORAL  = "#F1738A";
const MUTED  = "#7A6A8A";
const TEXT   = "#1C1626";
const BORDER = "rgba(232,213,232,0.5)";

// ── Navigation items ──────────────────────────────────────────────────────────
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

// ── Sidebar contents (extracted to avoid re-defining inside render) ───────────
function SidebarContents({
  location,
  collapsed,
  isDrawer,
  alertCount,
  displayName,
  displayRole,
  initials,
  onNav,
  onToggle,
  onLogout,
}: {
  location: string;
  collapsed: boolean;
  isDrawer: boolean;
  alertCount: number;
  displayName: string;
  displayRole: string;
  initials: string;
  onNav?: () => void;
  onToggle: () => void;
  onLogout: () => void;
}) {
  const compact = !isDrawer && collapsed;

  return (
    <div className="flex flex-col h-full">

      {/* ── Wordmark header ────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center h-16 shrink-0",
          compact ? "justify-center px-2" : "gap-3 px-4"
        )}
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        {/* Logo icon */}
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
        >
          <Sparkles size={16} color="white" strokeWidth={1.5} />
        </div>

        {/* Wordmark + subtitle (expanded only) */}
        {!compact && (
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-black tracking-tight leading-none select-none">
              <span style={{ color: TEXT }}>Care</span>
              <span style={{ color: CORAL }}>Scribe</span>
            </p>
            <p
              className="text-[8.5px] font-semibold uppercase tracking-[0.08em] mt-0.5 select-none"
              style={{ color: MUTED }}
            >
              NDIS Clinical Workspace
            </p>
          </div>
        )}

        {/* Collapse button (expanded desktop sidebar only) */}
        {!compact && !isDrawer && (
          <button
            onClick={onToggle}
            title="Collapse sidebar"
            className="p-1.5 rounded-lg transition-colors hover:bg-pink-50 shrink-0"
            style={{ color: MUTED }}
          >
            <ChevronLeft size={15} />
          </button>
        )}
      </div>

      {/* ── Expand row (collapsed desktop sidebar only) ────────────── */}
      {compact && (
        <div
          className="flex justify-center py-2 shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <button
            onClick={onToggle}
            title="Expand sidebar"
            className="p-1.5 rounded-lg transition-colors hover:bg-pink-50"
            style={{ color: MUTED }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* ── New Session button ─────────────────────────────────────── */}
      <div className={cn("pt-3 shrink-0", compact ? "px-2" : "px-3")}>
        <Link href="/sessions/new" onClick={onNav}>
          <div
            className={cn(
              "flex items-center justify-center rounded-xl text-white text-[13px] font-bold h-9 transition-opacity hover:opacity-90",
              compact ? "w-full" : "gap-2 px-3"
            )}
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            <Plus size={15} strokeWidth={2.5} />
            {!compact && "New Session"}
          </div>
        </Link>
      </div>

      {/* ── Navigation ────────────────────────────────────────────── */}
      <nav className={cn("flex-1 overflow-y-auto py-3 space-y-0.5", compact ? "px-2" : "px-3")}>
        {NAV_ITEMS.map((item) => {
          const active    = isActive(location, item.href);
          const Icon      = item.icon;
          const showBadge = item.href === "/compliance" && alertCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNav}
              title={compact ? item.label : undefined}
            >
              <div
                className={cn(
                  "flex items-center rounded-xl text-[13px] font-medium transition-colors w-full cursor-pointer",
                  compact ? "h-9 justify-center px-0" : "gap-3 px-3 py-2"
                )}
                style={{
                  background: active ? "rgba(84,34,105,0.07)" : "transparent",
                  color: active ? PLUM : MUTED,
                  fontWeight: active ? 600 : 500,
                }}
              >
                <div className="relative shrink-0">
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                  {showBadge && (
                    <span
                      className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 rounded-full text-[8px] font-bold text-white flex items-center justify-center px-0.5"
                      style={{ background: "#DC2626" }}
                    >
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </div>
                {!compact && item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* ── Alerts strip (expanded only) ─────────────────────────── */}
      {!compact && alertCount > 0 && (
        <Link href="/compliance" onClick={onNav}>
          <div
            className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium cursor-pointer hover:opacity-80 transition-opacity"
            style={{ background: "rgba(241,115,138,0.07)", color: CORAL }}
          >
            <AlertTriangle size={12} />
            {alertCount} unread alert{alertCount !== 1 ? "s" : ""}
          </div>
        </Link>
      )}

      {/* ── Profile ──────────────────────────────────────────────── */}
      <div
        className={cn("shrink-0 py-3", compact ? "px-2" : "px-3")}
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        {compact ? (
          <div
            className="w-8 h-8 rounded-xl mx-auto flex items-center justify-center text-[11px] font-bold text-white cursor-default"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            title={displayName}
          >
            {initials}
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold truncate" style={{ color: TEXT }}>
                {displayName}
              </p>
              <p className="text-[10.5px] capitalize truncate" style={{ color: MUTED }}>
                {displayRole}
              </p>
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="shrink-0 p-1.5 rounded-lg hover:bg-pink-50 transition-colors"
              style={{ color: MUTED }}
            >
              <LogOut size={13} />
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
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [collapsed, setCollapsed]     = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  const { settings } = useSettings();
  const { user, logout } = useAuth();
  const { data: alerts = [] } = useGetUnreadAlerts();

  const displayName = user?.full_name || settings?.name || user?.email || "Support Worker";
  const displayRole = (user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? "Support Worker");
  const initials    = getInitials(displayName);
  const alertCount  = Array.isArray(alerts) ? alerts.length : 0;

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* noop */ }
  };

  const sharedProps = {
    location,
    collapsed,
    alertCount,
    displayName,
    displayRole,
    initials,
    onToggle: toggleCollapse,
    onLogout: logout,
  };

  return (
    <div className="flex min-h-screen w-full" style={{ background: "#FAF5FF", color: TEXT }}>

      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex flex-col h-screen sticky top-0 bg-white shrink-0 overflow-hidden"
        style={{
          width: collapsed ? 64 : 224,
          transition: "width 220ms cubic-bezier(0.4, 0, 0.2, 1)",
          borderRight: `1px solid ${BORDER}`,
          boxShadow: "2px 0 12px rgba(84,34,105,0.04)",
        }}
      >
        <SidebarContents {...sharedProps} isDrawer={false} />
      </aside>

      {/* ── Main content column ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header
          className="md:hidden h-14 flex items-center justify-between px-4 bg-white shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              <Sparkles size={14} color="white" strokeWidth={1.5} />
            </div>
            <span className="text-[17px] font-black tracking-tight select-none">
              <span style={{ color: TEXT }}>Care</span>
              <span style={{ color: CORAL }}>Scribe</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/sessions/new">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-[12px] font-bold"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                <Plus size={12} strokeWidth={2.5} /> New
              </button>
            </Link>
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-xl transition-colors hover:bg-pink-50"
              style={{ color: MUTED }}
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        {/* Desktop top bar */}
        <header
          className="hidden md:flex h-11 items-center justify-end px-6 bg-white shrink-0 gap-3"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          {alertCount > 0 && (
            <Link href="/compliance">
              <button
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11.5px] font-semibold transition-colors hover:bg-pink-50"
                style={{ color: CORAL }}
              >
                <AlertTriangle size={12} />
                {alertCount} alert{alertCount !== 1 ? "s" : ""}
              </button>
            </Link>
          )}
          <div
            className="flex items-center gap-2 pl-3"
            style={{ borderLeft: `1px solid ${BORDER}` }}
          >
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white select-none"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {initials}
            </div>
            <span className="text-[12px] font-medium" style={{ color: TEXT }}>
              {displayName.split(" ")[0]}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 md:px-6 py-5 pb-20 md:pb-6">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center bg-white"
        style={{
          borderTop: `1px solid ${BORDER}`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
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

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(84,34,105,0.25)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white flex flex-col transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ boxShadow: "4px 0 24px rgba(84,34,105,0.15)" }}
      >
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-xl hover:bg-pink-50 transition-colors"
            style={{ color: MUTED }}
          >
            <X size={16} />
          </button>
        </div>
        <SidebarContents
          {...sharedProps}
          isDrawer
          collapsed={false}
          onNav={() => setDrawerOpen(false)}
        />
      </aside>
    </div>
  );
}
