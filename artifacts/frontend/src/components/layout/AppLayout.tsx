import { Link, useLocation, useRoute } from "wouter";
import {
  LayoutDashboard, Users, CalendarDays, ShieldCheck, Settings, Plus, Bell, Menu, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Participants", icon: Users },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isSettings] = useRoute("/settings");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">

      {/* ── Desktop sidebar ── */}
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col shrink-0 sticky top-0 h-screen hidden md:flex">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-8">
            <div className="bg-primary p-1.5 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Clinical Companion</span>
          </div>

          <div className="space-y-6">
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3">Menu</div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        <div className="mt-auto p-6 border-t border-slate-200 dark:border-slate-800">
          <Link href="/settings">
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start gap-2 border-slate-200 dark:border-slate-800 shadow-none",
                isSettings
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "text-slate-600 dark:text-slate-400"
              )}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </Link>
          <div className="flex items-center gap-3 mt-4 px-2">
            <Avatar className="h-9 w-9 border border-slate-200 dark:border-slate-800">
              <AvatarFallback className="bg-primary/5 text-primary">DR</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium leading-none">Dr. Provider</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Solo Practitioner</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile slide-out menu overlay ── */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-slate-900 shadow-xl flex flex-col transition-transform duration-200 ease-in-out md:hidden",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary p-1.5 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="font-semibold text-base tracking-tight">Clinical Companion</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-9 w-9 border border-slate-200 dark:border-slate-800">
              <AvatarFallback className="bg-primary/5 text-primary">DR</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">Dr. Provider</p>
              <p className="text-xs text-slate-500">Solo Practitioner</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content column ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top header */}
        <header className="h-14 md:h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between px-4 md:px-8">
          {/* Mobile: hamburger + logo */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="text-slate-500 hover:text-slate-700 p-1 rounded"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-1.5">
              <div className="bg-primary p-1 rounded-md">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold text-sm tracking-tight">Clinical Companion</span>
            </div>
          </div>

          {/* Desktop: spacer */}
          <div className="hidden md:block" />

          {/* Right actions */}
          <div className="flex items-center gap-2 md:gap-4">
            <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-700 relative h-9 w-9">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive border-2 border-white dark:border-slate-900" />
            </Button>
            <Link href="/sessions/new">
              <Button size="sm" className="gap-1.5 shadow-sm h-9 px-3">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Session</span>
              </Button>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full pb-20 md:pb-8">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom navigation bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 md:hidden safe-area-pb shadow-lg">
        <div className="flex items-stretch h-16">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-slate-400 hover:text-slate-700"
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <Link
            href="/settings"
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              isSettings
                ? "text-primary"
                : "text-slate-400 hover:text-slate-700"
            )}
          >
            <Settings className={cn("h-5 w-5", isSettings && "text-primary")} />
            <span>Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
