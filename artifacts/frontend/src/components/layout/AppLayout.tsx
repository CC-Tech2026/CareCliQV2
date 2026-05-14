import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Menu, X, Plus,
  LayoutDashboard, Users, CalendarDays, ShieldCheck,
  Settings, AlertTriangle, FileBarChart2, FolderOpen, LogOut,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";

// ── CareScribe palette ────────────────────────────────────────────────────────
const PLUM   = "#542269";
const CORAL  = "#F1738A";
const LILAC  = "#F5EEF5";
const BORDER = "#E8D5E8";
const TEXT   = "#37352F";
const MUTED  = "#7A5E7A";

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

// 4 bottom-nav tabs for mobile
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
    (href === "/patients" && (location.startsWith("/patients") || location.startsWith("/participants")))
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { settings } = useSettings();
  const { user, logout } = useAuth();

  const displayName = user?.full_name || settings?.name || user?.email || "Support Worker";
  const displayRole = user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? "Support Worker";
  const initials = displayName.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();

  const SidebarInner = ({ onNav }: { onNav?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Wordmark */}
      <div className="px-5 py-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <span className="text-[20px] font-black tracking-tight" style={{ color: PLUM }}>
          Care<span style={{ color: CORAL }}>Scribe</span>
        </span>
        <p className="text-[9px] uppercase tracking-widest font-semibold mt-0.5" style={{ color: MUTED }}>
          NDIS Clinical
        </p>
      </div>

      {/* Nav — with icons */}
      <nav className="flex-1 px-3 py-5 overflow-y-auto space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNav}
              className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-all duration-150"
              style={{
                background: active ? `${PLUM}10` : "transparent",
                color: active ? PLUM : MUTED,
                fontWeight: active ? 700 : 500,
              }}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                  style={{ background: CORAL }}
                />
              )}
              <Icon
                size={15}
                strokeWidth={active ? 2.5 : 1.8}
                style={{ color: active ? PLUM : MUTED, flexShrink: 0 }}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* New Session shortcut */}
      <div className="px-3 pb-3">
        <Link href="/sessions/new" onClick={onNav}>
          <div
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-bold hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
          >
            <Plus size={14} strokeWidth={2.5} />
            New Session
          </div>
        </Link>
      </div>

      {/* Profile */}
      <div className="px-3 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl cursor-default">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback
              className="text-xs font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-semibold truncate" style={{ color: TEXT }}>{displayName}</p>
            <p className="text-[10px] capitalize truncate" style={{ color: MUTED }}>{displayRole}</p>
          </div>
          <button onClick={logout} title="Sign out" style={{ color: MUTED }} className="shrink-0 p-1.5 rounded-lg hover:bg-[#F5EEF5] transition-colors">
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full" style={{ background: LILAC, color: TEXT }}>
      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex w-52 flex-col h-screen sticky top-0 bg-white shrink-0"
        style={{ borderRight: `1px solid ${BORDER}` }}
      >
        <SidebarInner />
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header
          className="md:hidden h-14 flex items-center justify-between px-5 bg-white shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <span className="text-[18px] font-black tracking-tight" style={{ color: PLUM }}>
            Care<span style={{ color: CORAL }}>Scribe</span>
          </span>
          <div className="flex items-center gap-2">
            <Link href="/sessions/new">
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-white text-[12px] font-bold"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                <Plus size={12} strokeWidth={2.5} />
                New
              </button>
            </Link>
            <button onClick={() => setDrawerOpen(true)} className="p-2 rounded-xl" style={{ color: PLUM }}>
              <Menu size={20} />
            </button>
          </div>
        </header>

        {/* Desktop header — slim */}
        <header
          className="hidden md:flex h-11 items-center justify-between px-6 bg-white shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex-1" />
          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <p className="text-[11px] font-semibold" style={{ color: TEXT }}>{displayName.split(" ")[0]}</p>
              <p className="text-[9px] capitalize" style={{ color: MUTED }}>{displayRole}</p>
            </div>
            <Avatar className="h-7 w-7">
              <AvatarFallback
                className="text-[10px] font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
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
        style={{ borderTop: `1px solid ${BORDER}`, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {BOTTOM_NAV.map((item) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors"
              style={{ color: active ? CORAL : MUTED }}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile drawer overlay ── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(84,34,105,0.18)", backdropFilter: "blur(2px)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white flex flex-col shadow-2xl transition-transform duration-300",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="absolute top-4 right-4">
          <button onClick={() => setDrawerOpen(false)} className="p-2 rounded-xl" style={{ color: MUTED }}>
            <X size={18} />
          </button>
        </div>
        <SidebarInner onNav={() => setDrawerOpen(false)} />
      </aside>
    </div>
  );
}
