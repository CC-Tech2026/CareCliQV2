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
      className="rounded-xl flex items-center justify-center shrink-0 shadow-sm"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #FA879F 0%, #D9F103 100%)",
      }}
    >
      <ShieldCheck size={size * 0.56} color="#0D0D55" strokeWidth={2.5} />
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
        <div className="flex items-center gap-3 px-5 py-5 border-b border-rose-100/60">
          <LogoMark size={36} />
          <div>
            <p className="font-bold text-[15px] tracking-tight text-[#0D0D55] leading-tight">
              Clinical Companion
            </p>
            <p className="text-[9px] uppercase tracking-widest text-[#FA879F]/70 font-bold">
              Healthcare
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#FA879F]/60 px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location === item.href || location.startsWith(item.href + "/") ||
                    (item.href === "/patients" && (location.startsWith("/patients") || location.startsWith("/participants")));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNav}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative",
                        isActive
                          ? "text-[#0D0D55]"
                          : "text-slate-500 hover:bg-rose-50/60 hover:text-[#0D0D55]",
                      )}
                      style={isActive ? {
                        background: "linear-gradient(90deg, rgba(250,135,159,0.13) 0%, rgba(217,241,3,0.07) 100%)",
                      } : undefined}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[#FA879F]" />
                      )}
                      <item.icon
                        size={17}
                        className={isActive ? "text-[#FA879F]" : "text-slate-400"}
                        strokeWidth={isActive ? 2.5 : 2}
                      />
                      <span>{item.label}</span>
                      {item.href === "/incidents" && (
                        <span className="ml-auto h-[18px] min-w-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                          style={{ background: "linear-gradient(90deg, #FA879F, #e0607a)" }}>
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

        {/* Lime accent promo strip */}
        <div className="mx-3 mb-3 rounded-2xl px-4 py-3.5 text-[#0D0D55]"
          style={{ background: "linear-gradient(135deg, #D9F103 0%, #b8d400 100%)" }}>
          <p className="text-[11px] font-bold leading-tight">NDIS Audit Ready</p>
          <p className="text-[10px] mt-0.5 opacity-60 leading-tight">All sessions are compliance-checked automatically.</p>
        </div>

        {/* Profile */}
        <div className="px-4 py-4 border-t border-rose-100/60 shrink-0">
          <div className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-rose-50/40 transition-colors cursor-default">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #FA879F, #D9F103)" }}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#0D0D55] truncate">{displayName}</p>
              <p className="text-[10px] text-slate-400 capitalize truncate">{displayRole}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-[#FA879F] hover:bg-rose-50 transition-colors"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-[#FFF9FB] text-[#0D0D55] overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-56 flex-col h-screen sticky top-0 bg-white border-r border-rose-100/70 shrink-0">
        <SidebarContent />
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="h-16 flex items-center gap-4 px-6 bg-white border-b border-rose-100/70 shrink-0">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2 rounded-xl text-slate-400 hover:bg-rose-50"
          >
            <Menu size={20} />
          </button>

          {/* Search */}
          <div className="flex flex-1 max-w-md items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50/40 px-3.5 py-2 focus-within:border-[#FA879F]/40 transition-colors">
            <Search size={15} className="text-[#FA879F]/50 shrink-0" />
            <input
              type="text"
              placeholder="Search participants, sessions, incidents..."
              className="w-full bg-transparent outline-none text-sm placeholder:text-slate-400 text-[#0D0D55]"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {/* Bell */}
            <button className="relative p-2.5 rounded-xl border border-rose-100 bg-white hover:bg-rose-50/40 transition-colors">
              <Bell size={17} className="text-slate-500" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#FA879F]" />
            </button>

            {/* New session CTA — lime */}
            <Link href="/sessions/new">
              <button className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-xl text-[#0D0D55] text-sm font-bold hover:opacity-90 transition-opacity shadow-sm"
                style={{ background: "linear-gradient(90deg, #D9F103 0%, #c8de00 100%)" }}>
                <Plus size={15} strokeWidth={2.5} />
                New Session
              </button>
            </Link>

            {/* User chip */}
            <div className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border border-rose-100 bg-white cursor-default">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[11px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #FA879F, #D9F103)" }}>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left">
                <p className="text-[12px] font-semibold text-[#0D0D55] leading-tight">{displayName.split(" ")[0]}</p>
                <p className="text-[10px] text-slate-400 capitalize leading-tight">{displayRole}</p>
              </div>
              <ChevronDown size={13} className="text-slate-400" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </main>
      </div>

      {/* ── Mobile overlay ── */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-56 bg-white flex flex-col shadow-2xl transition-transform duration-300",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="absolute top-4 right-4">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:bg-rose-50"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent onNav={() => setMobileMenuOpen(false)} />
      </aside>
    </div>
  );
}
