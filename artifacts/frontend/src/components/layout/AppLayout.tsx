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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { AvatarDisplay } from "@/components/AvatarPicker";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Participants", icon: Users },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
];

function SidebarUserBlock() {
  const { settings } = useSettings();
  const displayName = settings?.name || "Dr. Provider";
  const displayCreds = settings?.credentials || "Solo Practitioner";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 mt-4 px-2">
      <AvatarDisplay
        avatarId={settings?.avatarId}
        sizePx={36}
        fallback={
          <Avatar className="h-9 w-9 border border-sidebar-border">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-primary text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
        }
      />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium leading-none truncate text-sidebar-foreground">
          {displayName}
        </span>
        <span className="text-xs text-sidebar-foreground/50 truncate">
          {displayCreds}
        </span>
      </div>
    </div>
  );
}

/* ── Sidebar logo mark ── */
function LogoMark({ size = 7 }: { size?: number }) {
  return (
    <div
      className={cn(
        "rounded-lg flex items-center justify-center shrink-0",
        `h-${size} w-${size}`,
      )}
      style={{ background: "#0D0D55" }}
    >
      <ShieldCheck
        className={cn(`h-${size - 3} w-${size - 3}`)}
        style={{ color: "#D9F103" }}
        strokeWidth={2.5}
      />
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isSettings] = useRoute("/settings");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* ── Desktop sidebar ── */}
      <aside
        className="w-64 border-r border-sidebar-border flex-col shrink-0 sticky top-0 h-screen hidden md:flex"
        style={{ background: "linear-gradient(160deg, #D9F103 0%, #FA879F 100%)" }}
      >
        {/* Brand */}
        <div className="p-6 pb-4">
          <div className="flex items-center gap-2.5 mb-8">
            <LogoMark size={8} />
            <span className="font-bold text-sm tracking-tight text-sidebar-foreground leading-tight">
              CCTECH<br />
              <span className="font-normal text-sidebar-foreground/60 text-xs tracking-widest">AUSTRALIA</span>
            </span>
          </div>

          <div className="space-y-6">
            <div>
              <div className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest mb-3 px-3">
                Menu
              </div>
              <nav className="space-y-0.5">
                {navItems.map((item) => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        {/* Bottom section */}
        <div className="mt-auto p-5 border-t border-sidebar-border">
          <Link href="/settings">
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2 text-sm font-medium",
                isSettings
                  ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </Link>
          <SidebarUserBlock />
        </div>
      </aside>

      {/* ── Mobile slide-out overlay ── */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 shadow-2xl flex flex-col transition-transform duration-200 ease-in-out md:hidden",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ background: "linear-gradient(160deg, #D9F103 0%, #FA879F 100%)" }}
      >
        <div className="p-5 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={8} />
            <span className="font-bold text-sm text-sidebar-foreground">
              CCTECH AUSTRALIA
            </span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground p-1 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <SidebarUserBlock />
        </div>
      </div>

      {/* ── Main content column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="h-14 md:h-16 border-b border-border bg-card/90 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between px-4 md:px-8">
          {/* Mobile: hamburger + logo */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="text-muted-foreground hover:text-foreground p-1 rounded"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <LogoMark size={7} />
              <span className="font-semibold text-sm tracking-tight">
                Clinical Companion
              </span>
            </div>
          </div>

          {/* Desktop: spacer */}
          <div className="hidden md:block" />

          {/* Right actions */}
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground relative h-9 w-9"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive border-2 border-card" />
            </Button>
            <Link href="/sessions/new">
              <Button size="sm" className="gap-1.5 h-9 px-3 shadow-sm font-semibold">
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

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-sidebar border-t border-sidebar-border md:hidden safe-area-pb shadow-lg">
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
                    ? "text-sidebar-primary"
                    : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive && "text-sidebar-primary")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <Link
            href="/settings"
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              isSettings
                ? "text-sidebar-primary"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
            )}
          >
            <Settings className={cn("h-5 w-5", isSettings && "text-sidebar-primary")} />
            <span>Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
