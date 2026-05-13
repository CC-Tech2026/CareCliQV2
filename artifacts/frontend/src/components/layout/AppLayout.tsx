import { Link, useLocation, useRoute } from "wouter";
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
  Sparkles,
  LogOut,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Participants", icon: Users },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
];

function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <div
      className="rounded-2xl flex items-center justify-center shrink-0 shadow-[0_12px_30px_rgba(13,13,85,0.18)] ring-1 ring-white/60"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #D9F103 0%, #FA879F 55%, #5271FF 100%)",
      }}
    >
      <ShieldCheck size={size * 0.6} color="#0D0D55" strokeWidth={2.5} />
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isSettings] = useRoute("/settings");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { settings } = useSettings();
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen w-full bg-[#FFF0F8] text-[#0D0D55] overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-72 flex-col h-screen sticky top-0">
        {/* Logo area — sits on pink background */}
        <div className="h-24 flex items-center px-8 gap-3 shrink-0 bg-sidebar">
          <LogoMark size={34} />
          <div className="leading-tight">
            <div className="font-bold text-[16px] tracking-tight text-sidebar-foreground">
              Clinical Companion
            </div>
            <div className="text-[9px] uppercase tracking-widest text-sidebar-foreground/50 font-bold">
              Healthcare
            </div>
          </div>
        </div>

        {/* Nav body — navy panel */}
        <div className="flex-1 bg-[#0D0D55] rounded-tr-[45px] flex flex-col overflow-hidden relative">
          {/* Scoop cutout */}
          <div className="absolute -top-[45px] left-0 w-[45px] h-[45px] bg-[#0D0D55] pointer-events-none">
            <div className="w-full h-full bg-sidebar rounded-bl-[45px]" />
          </div>

          <div className="flex flex-col h-full">
            {/* New Session CTA */}
            <div className="px-6 pt-10 shrink-0">
              <Link href="/sessions/new">
                <Button className="w-full bg-[#D9F103] text-[#0D0D55] hover:opacity-90 rounded-2xl py-6 shadow-lg font-bold gap-2 border-none">
                  <Plus size={18} strokeWidth={3} />
                  New Session
                </Button>
              </Link>
            </div>

            {/* Nav links */}
            <nav className="mt-8 px-4 flex-1 min-h-0 overflow-y-auto space-y-2">
              {navItems.map((item) => {
                const isActive = location.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-4 px-4 py-3 text-sm font-medium transition-all rounded-2xl",
                      isActive
                        ? "bg-[#FA879F] text-[#0D0D55] shadow-md"
                        : "text-[#D2C7FF]/70 hover:text-white hover:bg-white/5",
                    )}
                  >
                    <item.icon
                      size={18}
                      className={isActive ? "text-[#0D0D55]" : "text-[#D2C7FF]/50"}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Bottom — Settings + Profile */}
            <div className="shrink-0 px-6 pb-8 space-y-4 border-t border-white/10 pt-6">
              <Link href="/settings">
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-3 rounded-2xl h-12 text-sm font-medium transition-all",
                    isSettings
                      ? "bg-[#5271FF] text-white"
                      : "text-[#D2C7FF]/70 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Settings size={18} />
                  Settings
                </Button>
              </Link>

              <div className="flex items-center gap-2 rounded-2xl bg-white/5 p-3 border border-white/10">
                <Avatar className="h-9 w-9 border border-white/20 shrink-0">
                  <AvatarFallback className="bg-[#FA879F] text-[#0D0D55] text-xs font-bold">
                    {(user?.full_name || user?.email || settings?.name || "CS")
                      .slice(0, 2)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex flex-col flex-1">
                  <span className="truncate text-xs font-bold text-white">
                    {user?.full_name || settings?.name || user?.email || "Support Worker"}
                  </span>
                  <span className="truncate text-[10px] text-[#D2C7FF]/60 uppercase tracking-wider">
                    {user?.role?.replace("_", " ") ?? settings?.credentials ?? "Support Worker"}
                  </span>
                </div>
                <button
                  onClick={logout}
                  title="Sign out"
                  className="shrink-0 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <LogOut size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header bar */}
        <header className="h-24 flex items-center justify-between px-8 gap-6 shrink-0">
          <div className="flex flex-1 max-w-xl items-center gap-3 rounded-2xl border border-[#FFD6EC] bg-white/75 px-4 py-2.5 shadow-sm backdrop-blur-sm">
            <Search className="text-[#0D0D55]/30 shrink-0" size={18} />
            <input
              type="text"
              placeholder="Search participants, sessions..."
              className="w-full bg-transparent outline-none text-sm placeholder:text-[#0D0D55]/35"
            />
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-2xl border border-[#FFD6EC] bg-white/70 text-[#0D0D55] hover:bg-[#FA879F]/15 shadow-sm"
            >
              <Bell size={18} />
            </Button>
            <Button
              variant="ghost"
              className="hidden sm:inline-flex rounded-2xl border border-[#FFD6EC] bg-white/70 text-[#0D0D55] hover:bg-[#FA879F]/15 shadow-sm gap-2"
            >
              <Sparkles size={16} />
              Quick Actions
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-8 pb-8 min-h-0 overflow-hidden flex flex-col">
          <div className="flex-1 bg-white/80 backdrop-blur-sm rounded-[40px] border border-[#FFD6EC] shadow-[0_20px_50px_rgba(250,135,159,0.08)] p-8 overflow-y-auto">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile menu toggle ── */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden fixed bottom-6 right-6 z-50 bg-[#0D0D55] text-white p-4 rounded-full shadow-2xl"
      >
        {mobileMenuOpen ? <X /> : <Menu />}
      </button>

      {/* ── Mobile slide-out drawer ── */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <nav
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-[#0D0D55] flex flex-col transition-transform duration-300",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-6 py-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <LogoMark size={30} />
            <span className="font-bold text-white text-sm">Clinical Companion</span>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="text-white/60 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-4 px-4 py-3 text-sm font-medium rounded-2xl transition-all",
                  isActive
                    ? "bg-[#FA879F] text-[#0D0D55]"
                    : "text-[#D2C7FF]/70 hover:text-white hover:bg-white/5",
                )}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
