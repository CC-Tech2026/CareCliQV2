import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  ShieldCheck,
  Settings,
  Plus,
  Bell,
  Menu,
  X,
  Search,
  AlertTriangle,
  FileBarChart2,
  FolderOpen,
  LogOut,
  ChevronDown,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";

// ── Design tokens ──────────────────────────────────────────────────────────
const ROSE = "#E2457A";       // primary accent — warm rose
const ROSE_BG = "#FFF0F5";    // active nav fill
const BORDER = "#F3E8EE";     // sidebar / header border

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/patients", label: "Participants", icon: Users },
      { href: "/sessions", label: "Sessions", icon: CalendarDays },
    ],
  },
  {
    label: "Clinical",
    items: [
      { href: "/incidents", label: "Incidents", icon: AlertTriangle },
      { href: "/compliance", label: "Compliance", icon: ShieldCheck },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/reports", label: "Reports", icon: FileBarChart2 },
      { href: "/documents", label: "Documents", icon: FolderOpen },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="rounded-xl flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #E2457A 0%, #9B1D52 100%)",
      }}
    >
      <ShieldCheck size={size * 0.56} color="white" strokeWidth={2.2} />
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { settings } = useSettings();
  const { user, logout } = useAuth();

  const displayName = user?.full_name || settings?.name || user?.email || "Support Worker";
  const displayRole = user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? "Support Worker";
  const initials = displayName.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();

  function SidebarContent({ onNav }: { onNav?: () => void }) {
    return (
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <LogoMark size={36} />
          <div>
            <p className="font-bold text-[14.5px] tracking-tight text-[#0D0D55] leading-tight">
              Clinical Companion
            </p>
            <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mt-0.5">
              NDIS Healthcare
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 overflow-y-auto space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    location === item.href ||
                    location.startsWith(item.href + "/") ||
                    (item.href === "/patients" &&
                      (location.startsWith("/patients") || location.startsWith("/participants")));

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNav}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors",
                        isActive
                          ? "text-[#0D0D55]"
                          : "text-slate-500 hover:bg-slate-50 hover:text-[#0D0D55]",
                      )}
                      style={isActive ? { background: ROSE_BG } : undefined}
                    >
                      {/* Left accent pip */}
                      {isActive && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                          style={{ background: ROSE }}
                        />
                      )}
                      <item.icon
                        size={16}
                        style={{ color: isActive ? ROSE : undefined }}
                        className={isActive ? "" : "text-slate-400"}
                        strokeWidth={isActive ? 2.5 : 2}
                      />
                      <span>{item.label}</span>
                      {item.href === "/incidents" && (
                        <span
                          className="ml-auto h-[18px] min-w-[18px] px-1.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                          style={{ background: ROSE }}
                        >
                          2
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Profile */}
        <div className="px-4 py-4 shrink-0" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-default">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback
                className="text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg, #E2457A, #9B1D52)" }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-[#0D0D55] truncate">{displayName}</p>
              <p className="text-[10px] text-slate-400 capitalize truncate">{displayRole}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-[#FAFAFA] text-[#0D0D55] overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex w-56 flex-col h-screen sticky top-0 bg-white shrink-0"
        style={{ borderRight: `1px solid ${BORDER}` }}
      >
        <SidebarContent />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header
          className="h-14 flex items-center gap-4 px-6 bg-white shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2 rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <Menu size={20} />
          </button>

          {/* Search */}
          <div className="flex flex-1 max-w-sm items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Search..."
              className="w-full bg-transparent outline-none text-[13px] placeholder:text-slate-400 text-[#0D0D55]"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {/* Bell */}
            <button className="relative p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
              <Bell size={16} className="text-slate-500" />
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full" style={{ background: ROSE }} />
            </button>

            {/* New Session */}
            <Link href="/sessions/new">
              <button
                className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #E2457A 0%, #C03068 100%)" }}
              >
                <Plus size={14} strokeWidth={2.5} />
                New Session
              </button>
            </Link>

            {/* User chip */}
            <div className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg border border-slate-200 bg-white cursor-default">
              <Avatar className="h-6 w-6">
                <AvatarFallback
                  className="text-[10px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #E2457A, #9B1D52)" }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left">
                <p className="text-[12px] font-semibold text-[#0D0D55] leading-tight">{displayName.split(" ")[0]}</p>
              </div>
              <ChevronDown size={12} className="text-slate-400" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </main>
      </div>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-56 bg-white flex flex-col shadow-xl transition-transform duration-300",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="absolute top-4 right-4">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent onNav={() => setMobileMenuOpen(false)} />
      </aside>
    </div>
  );
}
