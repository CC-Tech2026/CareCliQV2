import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Menu,
  X,
  Plus,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Users,
  CalendarDays,
  ShieldCheck,
  Settings,
  AlertTriangle,
  FileBarChart2,
  FolderOpen,
  LogOut,
  Search,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { CareScribeLogo, CareScribeLogoSm } from "@/components/CareScribeLogo";

// ── Design Tokens ────────────────────────────────────────────────────────────
const PLUM = "#5533CC"; 
const CORAL = "#F03060"; 
const MUTED = "#7A6A9E"; 
const TEXT = "#1E1640"; 
const APP_BG = "#F5F3FC"; 
const ACTIVE = "#EDEAFF"; 

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Participants", icon: Users },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/reports", label: "Reports", icon: FileBarChart2 },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

const BOTTOM_NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/patients", label: "People", icon: Users },
  { href: "/compliance", label: "Audit", icon: ShieldCheck },
];

function isActive(location: string, href: string) {
  return (
    location === href ||
    location.startsWith(href + "/") ||
    (href === "/patients" &&
      (location.startsWith("/patients") ||
        location.startsWith("/participants")))
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function SidebarContents({
  location,
  collapsed,
  isDrawer,
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
      <div
        className={cn(
          "flex items-center shrink-0 select-none overflow-visible",
          compact ? "justify-center px-3 h-20" : "justify-between px-5 h-24",
        )}
      >
        <Link
          href="/dashboard"
          onClick={onNav}
          className={cn(
            "flex items-center transition-all duration-300 active:opacity-75",
            compact ? "justify-center w-full" : "flex-1 min-w-0",
          )}
        >
          <div className={cn("flex items-center overflow-visible", compact ? "justify-center" : "justify-start")}>
            <CareScribeLogo compact={compact} />
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

      <div className={cn("pt-2 pb-4 shrink-0", compact ? "px-3" : "px-5")}>
        <Link href="/sessions/new" onClick={onNav}>
          <div
            className={cn(
              "flex items-center justify-center rounded-2xl text-white text-[14px] font-bold h-11 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]",
              compact ? "w-full" : "gap-2 px-4",
            )}
            style={{
              background: PLUM,
              boxShadow: "0 8px 16px -4px rgba(106, 64, 125, 0.2)",
            }}
          >
            <Plus size={18} strokeWidth={2.5} />
            {!compact && "New Session"}
          </div>
        </Link>
      </div>

      <nav className={cn("flex-1 overflow-y-auto space-y-1 scrollbar-none", compact ? "px-2" : "px-4")}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
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
                {!compact && item.label}
              </div>
            </Link>
          );
        })}
      </nav>

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
              <p className="text-[14px] font-bold truncate" style={{ color: TEXT }}>
                {displayName}
              </p>
              <p className="text-[11px] font-medium capitalize truncate" style={{ color: MUTED }}>
                {displayRole}
              </p>
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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const { settings } = useSettings();
  const { user, logout } = useAuth();
  const { data: alerts = [] } = useGetUnreadAlerts();

  const displayName = user?.full_name || settings?.name || user?.email || "Support Worker";
  const displayRole = user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? "Support Worker";
  const initials = getInitials(displayName);
  const alertCount = Array.isArray(alerts) ? alerts.length : 0;

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar-collapsed", String(next));
    } catch {
      /* noop */
    }
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
    <div className="flex h-screen w-full selection:bg-pink-100" style={{ background: APP_BG, color: TEXT }}>

      {/* Desktop Sidebar Column */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: collapsed ? 88 : 260 }}
      >
        <SidebarContents {...sharedProps} isDrawer={false} />
      </aside>

      {/* Content Canvas Layout Engine Container */}
      <div className="flex-1 flex flex-col min-w-0 md:py-3 md:pr-3 h-full relative">
        <div className="flex-1 flex flex-col bg-white md:rounded-[2.5rem] md:shadow-[0_8px_40px_rgba(106,64,125,0.06)] overflow-hidden relative">

          {/* Mobile Top Viewport Header */}
          <header className="md:hidden h-16 flex items-center justify-between px-5 bg-white shrink-0 z-10 border-b border-black/5">
            <Link href="/dashboard" className="flex items-center focus:outline-none py-1 active:opacity-75 transition-opacity">
              <CareScribeLogoSm />
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/sessions/new">
                <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-[13px] font-bold" style={{ background: PLUM }}>
                  <Plus size={14} strokeWidth={2.5} /> New
                </button>
              </Link>
              <button onClick={() => setDrawerOpen(true)} className="p-2.5 rounded-full transition-colors active:bg-black/5" style={{ color: TEXT }}>
                <Menu size={22} />
              </button>
            </div>
          </header>

          {/* ── UNIFIED CAPSULE DESKTOP HEADER BAR ───────────────────────────── */}
          <header className="hidden md:flex h-24 items-center px-8 shrink-0 z-10 w-full select-none">

            {/* Main Rounded Outer Pill Container */}
            <div className="flex items-center gap-4 bg-white border border-[#EBE8F5] p-2 pl-4 pr-4 rounded-[2.5rem] shadow-[0_4px_20px_rgba(122,106,158,0.06)] w-full h-16">

              {/* 1. Universal Smooth Search Input */}
              <div className="relative flex-1">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7A6A9E]/60" />
                <input 
                  type="text"
                  placeholder="Search records, global files, or logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 pl-11 pr-4 rounded-full bg-white text-[13px] font-medium placeholder:text-[#7A6A9E]/40 border border-[#E2DEF2] focus:outline-none focus:border-[#5533CC] transition-all"
                />
              </div>

              {/* 2. Notification Bell (With Floating Red Counter Circle) */}
              <Link href="/compliance" className="relative w-11 h-11 rounded-full bg-white border border-[#E2DEF2] flex items-center justify-center hover:bg-[#F5F3FC] transition-colors shrink-0">
                <Bell size={18} style={{ color: PLUM }} strokeWidth={2} />
                {alertCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#F03060] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                    {alertCount}
                  </span>
                )}
              </Link>

              {/* 3. Manage Participants Action Button */}
              <Link href="/patients" className="shrink-0">
                <button className="h-11 px-5 rounded-full text-[13px] font-bold bg-white border border-[#E2DEF2] text-[#1E1640] hover:bg-[#F5F3FC] transition-all whitespace-nowrap">
                  Manage Participants
                </button>
              </Link>

              {/* 4. New Session Action Button with Smooth Gradient */}
              <Link href="/sessions/new" className="shrink-0">
                <button 
                  className="flex items-center justify-center gap-2 h-11 px-6 rounded-full text-white text-[13px] font-bold shadow-sm hover:opacity-95 transition-all active:scale-[0.99] whitespace-nowrap"
                  style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
                >
                  <Plus size={14} strokeWidth={3} fill="white" className="shrink-0" />
                  <span>New Session</span>
                </button>
              </Link>

              {/* Thin Elegant Vertical Divider */}
              <div className="h-6 w-[1px] bg-[#E2DEF2] mx-1 shrink-0" />

              {/* 5. Action Items Crimson Tracker Capsule Badge */}
              {alertCount > 0 && (
                <Link href="/compliance" className="shrink-0">
                  <button className="flex items-center gap-1.5 px-4 h-11 rounded-full text-[13px] font-bold transition-all hover:opacity-90 whitespace-nowrap" style={{ background: "#FFE8EE", color: CORAL }}>
                    <AlertTriangle size={14} strokeWidth={2.5} />
                    <span>{alertCount} Action Item{alertCount !== 1 ? "s" : ""}</span>
                  </button>
                </Link>
              )}

              {/* 6. User Profile Node Identification Cluster */}
              <div className="flex items-center gap-3 pl-1 shrink-0 select-none">
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

          {/* Core Page Content Outlets */}
          <main className="flex-1 overflow-y-auto px-5 md:px-8 py-4 pb-24 md:pb-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile structural bottom tab configurations */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center bg-white/90 backdrop-blur-md"
        style={{
          boxShadow: "0 -8px 30px rgba(0,0,0,0.04)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {BOTTOM_NAV.map((item) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors relative"
              style={{ color: active ? PLUM : MUTED }}
            >
              {active && <div className="absolute top-0 w-8 h-1 rounded-b-full" style={{ background: PLUM }} />}
              <Icon size={22} strokeWidth={active ? 2.5 : 2} className={cn("mt-1", active && "animate-in zoom-in-90 duration-200")} />
              <span className={cn("text-[10px]", active ? "font-bold" : "font-medium")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Mobile Navigation Drawer Backdrop control */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 transition-opacity duration-300"
          style={{ background: "rgba(59, 46, 66, 0.4)", backdropFilter: "blur(2px)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

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