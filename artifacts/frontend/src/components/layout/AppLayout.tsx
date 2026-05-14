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
  PenLine,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";

// ── CareScribe palette (from reference swatch) ───────────────────────────────
// #542269 deep plum · #DEB2E4 soft purple · #F6B8C0 blush · #F1738A coral
// #EFDCEF lilac bg  · #E8D5E8 plum border · #37352F warm text

const PLUM        = "#542269";
const PURPLE_MID  = "#DEB2E4";
const BLUSH       = "#F6B8C0";
const CORAL       = "#F1738A";
const BG_LILAC    = "#F5EEF5";   // slightly lighter than #EFDCEF for reading
const BORDER      = "#E8D5E8";   // plum-tinted border
const ACTIVE_FILL = "#F5EAF5";   // active nav background
const TEXT_DARK   = "#37352F";
const TEXT_MID    = "#7A5E7A";   // purple-tinted secondary

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard",  label: "Dashboard",    icon: LayoutDashboard },
      { href: "/patients",   label: "Participants", icon: Users            },
      { href: "/sessions",   label: "Sessions",     icon: CalendarDays     },
    ],
  },
  {
    label: "Clinical",
    items: [
      { href: "/incidents",  label: "Incidents",    icon: AlertTriangle    },
      { href: "/compliance", label: "Compliance",   icon: ShieldCheck      },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/reports",    label: "Reports",      icon: FileBarChart2    },
      { href: "/documents",  label: "Documents",    icon: FolderOpen       },
      { href: "/settings",   label: "Settings",     icon: Settings         },
    ],
  },
];

function LogoMark({ size = 32 }: { size?: number }) {
  const r = size * 0.35;
  return (
    <div
      className="rounded-xl flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)`,
      }}
    >
      <PenLine size={r} color="white" strokeWidth={2.3} />
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
            <p className="font-bold text-[15px] tracking-tight leading-tight" style={{ color: PLUM }}>
              CareScribe
            </p>
            <p className="text-[9px] uppercase tracking-widest font-semibold mt-0.5" style={{ color: PURPLE_MID }}>
              NDIS Clinical
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 overflow-y-auto space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest px-3 mb-1.5" style={{ color: TEXT_MID }}>
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
                      className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors"
                      style={{
                        background: isActive ? ACTIVE_FILL : undefined,
                        color: isActive ? PLUM : TEXT_MID,
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "#FAF0FA"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                          style={{ background: PLUM }}
                        />
                      )}
                      <item.icon
                        size={16}
                        style={{ color: isActive ? PLUM : PURPLE_MID }}
                        strokeWidth={isActive ? 2.5 : 2}
                      />
                      <span>{item.label}</span>
                      {item.href === "/incidents" && (
                        <span
                          className="ml-auto h-[18px] min-w-[18px] px-1.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                          style={{ background: CORAL }}
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
          <div className="flex items-center gap-2.5 p-2 rounded-xl transition-colors cursor-default"
            onMouseEnter={e => (e.currentTarget.style.background = "#FAF0FA")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
          >
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback
                className="text-xs font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold truncate" style={{ color: TEXT_DARK }}>{displayName}</p>
              <p className="text-[10px] capitalize truncate" style={{ color: TEXT_MID }}>{displayRole}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="shrink-0 p-1.5 rounded-lg transition-colors"
              style={{ color: PURPLE_MID }}
              onMouseEnter={e => (e.currentTarget.style.color = PLUM)}
              onMouseLeave={e => (e.currentTarget.style.color = PURPLE_MID)}
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full overflow-hidden" style={{ background: BG_LILAC, color: TEXT_DARK }}>
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
            className="md:hidden p-2 rounded-xl"
            style={{ color: TEXT_MID }}
          >
            <Menu size={20} />
          </button>

          {/* Search */}
          <div
            className="flex flex-1 max-w-sm items-center gap-2.5 rounded-xl px-3 py-1.5 transition-colors"
            style={{ background: "#FAF5FA", border: `1px solid ${BORDER}` }}
          >
            <Search size={14} style={{ color: PURPLE_MID }} className="shrink-0" />
            <input
              type="text"
              placeholder="Search participants, sessions…"
              className="w-full bg-transparent outline-none text-[13px]"
              style={{ color: TEXT_DARK }}
            />
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {/* Bell */}
            <button
              className="relative p-2 rounded-xl transition-colors"
              style={{ border: `1px solid ${BORDER}` }}
              onMouseEnter={e => (e.currentTarget.style.background = "#FAF5FA")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <Bell size={16} style={{ color: TEXT_MID }} />
              <span
                className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
                style={{ background: CORAL }}
              />
            </button>

            {/* New Session */}
            <Link href="/sessions/new">
              <button
                className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                <Plus size={14} strokeWidth={2.5} />
                New Session
              </button>
            </Link>

            {/* User chip */}
            <div
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-xl bg-white cursor-default"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback
                  className="text-[10px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left">
                <p className="text-[12px] font-semibold leading-tight" style={{ color: TEXT_DARK }}>
                  {displayName.split(" ")[0]}
                </p>
              </div>
              <ChevronDown size={12} style={{ color: PURPLE_MID }} />
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
          className="md:hidden fixed inset-0 z-40 backdrop-blur-sm"
          style={{ background: "rgba(84,34,105,0.15)" }}
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
            className="p-2 rounded-xl"
            style={{ color: TEXT_MID }}
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent onNav={() => setMobileMenuOpen(false)} />
      </aside>
    </div>
  );
}
