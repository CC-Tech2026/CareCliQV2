import { Link, useLocation } from "wouter";
import { useState, useEffect, useMemo } from "react";
import {
  Menu, X, ChevronLeft, ChevronRight, ArrowLeft,
  LayoutDashboard, Users, UserRound, CalendarDays, Clock,
  ShieldCheck, Settings, AlertTriangle, FileBarChart2,
  CreditCard, LogOut, BadgeCheck, Wrench, Target, ClipboardList,
  BarChart2, UserCheck, DollarSign, GraduationCap, LockKeyhole, Radio, Activity,
  Sun, Moon, Search, Car, HelpCircle, Plus,
} from "lucide-react";
import { useTheme } from "next-themes";
import { NotificationBell, NotificationPanel } from "@/components/coordinator/NotificationPanel";
import { WorkerNotificationBell, WorkerNotificationPanel } from "@/components/worker/WorkerNotificationPanel";
import { NotificationBannerStack } from "@/components/worker/NotificationBannerStack";
import { NotificationRealtimeBridge } from "@/components/worker/NotificationRealtimeBridge";
import { ProfileDropdown } from "@/components/layout/ProfileDropdown";
import { AutoBreadcrumb } from "@/components/layout/AutoBreadcrumb";
import { RightRail } from "@/components/layout/RightRail";
import { FloatingAiAssistant } from "@/components/layout/FloatingAiAssistant";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { isWorkerMobileShiftDetailPath, workerMobileShiftBackHref } from "@/lib/worker-shift-routes";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getIncidentStats } from "@/services/incidentService";
import { CareCliQLogo, CareCliQLogoSm } from "@/components/CareCliQLogo";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  bottomNavLabelForHref,
  groupLabelForName,
  navLabelForHref,
  pageLabelForPath,
} from "@/lib/i18n/nav-labels";

// ── Design tokens (CSS vars — dark mode ready) ────────────────────────────────
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const MUTED  = "var(--cc-muted)";
const TEXT   = "var(--cc-text)";
const BORDER = "var(--cc-border)";
const ACTIVE = "var(--cc-active-bg)";

type NavRole = "support_coordinator" | "support_worker" | "managing_director";
type NavIconProps = { size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties };

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<NavIconProps>;
}
interface NavSection {
  group?: string;
  items: NavItem[];
}

// ── Full sectioned sidebar nav ────────────────────────────────────────────────
const SECTIONED_NAV: Record<NavRole, NavSection[]> = {
  support_coordinator: [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "Daily Operations",
      items: [
        { href: "/patients",              label: "Participants",       icon: UserRound    },
        { href: "/team",                  label: "Workers",               icon: Users        },
        { href: "/coordinator/rostering", label: "Schedule",           icon: CalendarDays },
        { href: "/compliance",            label: "Quality & Compliance", icon: ShieldCheck  },
        { href: "/incidents",             label: "Incident Management",  icon: AlertTriangle },
        { href: "/billing",               label: "Invoices",           icon: CreditCard   },
        { href: "/reports",               label: "Reports",            icon: FileBarChart2 },
      ],
    },
    {
      group: "Settings",
      items: [
        { href: "/toolkit", label: "Toolkit", icon: Wrench },
      ],
    },
  ],
  support_worker: [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "My Work",
      items: [
        { href: "/my-shifts",           label: "My Shifts",   icon: Clock     },
        { href: "/worker/availability",  label: "Availability", icon: UserCheck },
        { href: "/my-clients",          label: "My Clients",  icon: UserRound },
      ],
    },
    {
      group: "Safety & Resources",
      items: [
        { href: "/my-compliance", label: "My Compliance", icon: ShieldCheck   },
        { href: "/incidents",     label: "Incidents",     icon: AlertTriangle },
        { href: "/credentials",   label: "Credentials",   icon: BadgeCheck    },
        { href: "/toolkit",       label: "Toolkit",       icon: Wrench        },
      ],
    },
  ],
  managing_director: [
    { items: [{ href: "/hub", label: "Hub", icon: LayoutDashboard }] },
    {
      group: "MD Workspaces",
      items: [
        { href: "/md/executive",  label: "Executive",  icon: BarChart2    },
        { href: "/md/staff",      label: "Staff",      icon: UserCheck    },
        { href: "/md/compliance", label: "Compliance", icon: ShieldCheck  },
        { href: "/md/financial",  label: "Financial",  icon: DollarSign   },
        { href: "/md/onboarding", label: "Onboarding", icon: GraduationCap},
      ],
    },
  ],
};

// ── Topbar quick-nav tabs (shown when sidebar is collapsed) ───────────────────
const TOPBAR_QUICKNAV: Record<NavRole, NavItem[]> = {
  support_coordinator: [
    { href: "/patients",              label: "Participants",       icon: UserRound    },
    { href: "/team",                  label: "Workers",               icon: Users        },
    { href: "/coordinator/rostering", label: "Schedule",           icon: CalendarDays },
    { href: "/compliance",            label: "Quality & Compliance", icon: ShieldCheck  },
  ],
  support_worker: [],
  managing_director: [
    { href: "/hub",           label: "Hub",       icon: LayoutDashboard },
    { href: "/md/executive",  label: "Executive", icon: BarChart2       },
    { href: "/md/compliance", label: "Compliance",icon: ShieldCheck     },
  ],
};

// ── Mobile bottom nav ─────────────────────────────────────────────────────────
const ROLE_BOTTOM_NAV: Record<NavRole, NavItem[]> = {
  support_coordinator: [
    { href: "/dashboard",             label: "Home",       icon: LayoutDashboard },
    { href: "/patients",              label: "Participants", icon: UserRound      },
    { href: "/coordinator/rostering", label: "Schedule",   icon: CalendarDays    },
    { href: "/compliance",            label: "Quality",    icon: ShieldCheck     },
    { href: "/billing",               label: "Invoices",   icon: CreditCard      },
  ],
  support_worker: [
    { href: "/dashboard",    label: "Home",      icon: LayoutDashboard },
    { href: "/my-shifts",    label: "Shifts",    icon: Clock           },
    { href: "/my-clients",   label: "Clients",   icon: UserRound       },
    { href: "/my-compliance",label: "Compliance",icon: ShieldCheck     },
  ],
  managing_director: [
    { href: "/hub",           label: "Hub",       icon: LayoutDashboard },
    { href: "/md/executive",  label: "Executive", icon: BarChart2       },
    { href: "/md/staff",      label: "Staff",     icon: UserCheck       },
    { href: "/md/compliance", label: "Compliance",icon: ShieldCheck     },
    { href: "/md/financial",  label: "Financial", icon: DollarSign      },
  ],
};

function isActive(location: string, href: string) {
  // Legacy route alias: /patients matches /participants
  if (href === "/patients" && location.startsWith("/participants")) return true;
  // Schedule: all coordinator scheduling sub-routes roll up to /coordinator/rostering
  if (href === "/coordinator/rostering" &&
    (location.startsWith("/coordinator/live") ||
     location.startsWith("/coordinator/monitor") ||
     location.startsWith("/coordinator/shift-verification") ||
     location.startsWith("/coordinator/travel") ||
     location.startsWith("/approvals"))) return true;
  // Quality & Compliance: audit-pack rolls up to /compliance
  if (href === "/compliance" && location.startsWith("/audit-pack")) return true;
  // Team: credentials roll up to /team
  if (href === "/team" && location.startsWith("/credentials")) return true;
  return location === href || location.startsWith(href + "/");
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ── Searchable platform catalogue (role-scoped) ─────────────────────────────
type SearchEntry = {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  group: "pages" | "features" | "settings";
  roles: NavRole[];
};

const ALL_ROLES: NavRole[] = ["support_coordinator", "support_worker", "managing_director"];

const SEARCH_CATALOGUE: SearchEntry[] = [
  // ── Pages ─────────────────────────────────────────────────────────────────
  { label: "Dashboard",           description: "Overview & key metrics",                   href: "/dashboard",                       icon: LayoutDashboard, group: "pages",    roles: ["support_coordinator", "support_worker"] },
  { label: "Hub",                 description: "Managing Director overview",               href: "/hub",                             icon: LayoutDashboard, group: "pages",    roles: ["managing_director"] },
  { label: "Participants",        description: "Profiles, plans & NDIS goals",            href: "/patients",                        icon: UserRound,       group: "pages",    roles: ["support_coordinator"] },
  { label: "Team",                description: "Support workers & staff management",       href: "/team",                            icon: Users,           group: "pages",    roles: ["support_coordinator"] },
  { label: "Schedule",            description: "Roster, availability & shift management",  href: "/coordinator/rostering",           icon: CalendarDays,    group: "pages",    roles: ["support_coordinator"] },
  { label: "Quality & Compliance",description: "Audit readiness & compliance tracking",    href: "/compliance",                      icon: ShieldCheck,     group: "pages",    roles: ["support_coordinator"] },
  { label: "Invoices & Billing",  description: "NDIS invoicing & revenue reports",         href: "/billing",                         icon: CreditCard,      group: "pages",    roles: ["support_coordinator"] },
  { label: "Reports",             description: "Session analytics & export",              href: "/reports",                         icon: FileBarChart2,   group: "pages",    roles: ["support_coordinator"] },
  { label: "My Shifts",           description: "Your scheduled & active shifts",          href: "/my-shifts",                       icon: Clock,           group: "pages",    roles: ["support_worker"] },
  { label: "My Clients",          description: "Your assigned participants",              href: "/my-clients",                      icon: UserRound,       group: "pages",    roles: ["support_worker"] },
  { label: "My Availability",     description: "Set working hours & blackout dates",      href: "/worker/availability",             icon: UserCheck,       group: "pages",    roles: ["support_worker"] },
  { label: "My Compliance",       description: "Your training & credential status",       href: "/my-compliance",                   icon: ShieldCheck,     group: "pages",    roles: ["support_worker"] },
  { label: "Credentials",         description: "Manage certifications & licences",        href: "/credentials",                     icon: BadgeCheck,      group: "pages",    roles: ["support_worker"] },
  { label: "Incidents",           description: "Incident reports & history",              href: "/incidents",                       icon: AlertTriangle,   group: "pages",    roles: ["support_coordinator", "support_worker"] },
  { label: "Toolkit",             description: "Resources & reference materials",         href: "/toolkit",                         icon: Wrench,          group: "pages",    roles: ["support_coordinator", "support_worker"] },
  { label: "Executive Dashboard", description: "Organisation-wide performance",           href: "/md/executive",                    icon: BarChart2,       group: "pages",    roles: ["managing_director"] },
  { label: "Staff Overview",      description: "All workers, compliance & credentials",   href: "/md/staff",                        icon: UserCheck,       group: "pages",    roles: ["managing_director"] },
  { label: "MD Compliance",       description: "Compliance metrics & risk reporting",     href: "/md/compliance",                   icon: ShieldCheck,     group: "pages",    roles: ["managing_director"] },
  { label: "Financial",           description: "Revenue, billing & budget overview",      href: "/md/financial",                    icon: DollarSign,      group: "pages",    roles: ["managing_director"] },
  { label: "Onboarding",          description: "Worker & participant onboarding flows",   href: "/md/onboarding",                   icon: GraduationCap,   group: "pages",    roles: ["managing_director"] },
  // ── Features & deep links ─────────────────────────────────────────────────
  { label: "Live Monitor",        description: "Real-time shift & clock-in monitoring",    href: "/coordinator/rostering",           icon: Radio,           group: "features", roles: ["support_coordinator"] },
  { label: "Shift Verification",  description: "Verify completed shifts before billing",   href: "/coordinator/shift-verification",  icon: ClipboardList,   group: "features", roles: ["support_coordinator"] },
  { label: "Audit Pack",          description: "NDIS audit documentation & export",        href: "/audit-pack",                      icon: ClipboardList,   group: "features", roles: ["support_coordinator"] },
  { label: "Worker Availability", description: "Team availability calendar & blackouts",  href: "/coordinator/rostering",           icon: UserCheck,       group: "features", roles: ["support_coordinator"] },
  { label: "Create Shift",        description: "Assign a new shift to a worker",          href: "/coordinator/rostering",           icon: Plus,            group: "features", roles: ["support_coordinator"] },
  { label: "Bulk Shifts",         description: "Create recurring shifts in bulk",          href: "/coordinator/rostering",           icon: CalendarDays,    group: "features", roles: ["support_coordinator"] },
  { label: "NDIS Goals",          description: "Participant goals & progress tracking",    href: "/patients",                        icon: Target,          group: "features", roles: ["support_coordinator"] },
  { label: "Credential Alerts",   description: "Expiring worker certifications",          href: "/compliance",                      icon: BadgeCheck,      group: "features", roles: ["support_coordinator"] },
  { label: "AI Pattern Detection",description: "AI-detected compliance & risk patterns",   href: "/compliance",                      icon: Activity,        group: "features", roles: ["support_coordinator"] },
  { label: "Report Incident",     description: "Log a new incident or near-miss",         href: "/incidents/new",                   icon: AlertTriangle,   group: "features", roles: ["support_coordinator", "support_worker"] },
  { label: "Help & Support",      description: "FAQs, guides & contact support",          href: "/worker/help",                     icon: HelpCircle,      group: "features", roles: ["support_worker"] },
  // ── Settings ──────────────────────────────────────────────────────────────
  { label: "Settings",            description: "Account, notifications & preferences",    href: "/settings",                        icon: Settings,        group: "settings", roles: ALL_ROLES },
  { label: "Profile Settings",    description: "Name, email & personal details",          href: "/settings",                        icon: UserRound,       group: "settings", roles: ALL_ROLES },
  { label: "Accessibility",       description: "Font size, contrast & display options",   href: "/settings",                        icon: Settings,        group: "settings", roles: ALL_ROLES },
  { label: "Notification Settings",description: "Alert preferences & reminder config",    href: "/settings",                        icon: Settings,        group: "settings", roles: ALL_ROLES },
];

const SEARCH_QUICK_ACCESS: Record<NavRole, string[]> = {
  support_coordinator: ["/dashboard", "/patients", "/coordinator/rostering", "/compliance", "/incidents/new"],
  support_worker:      ["/dashboard", "/my-shifts", "/my-clients", "/my-compliance", "/incidents/new"],
  managing_director:   ["/hub", "/md/executive", "/md/financial", "/md/compliance"],
};

const SEARCH_GROUP_LABELS: Record<string, string> = { pages: "Pages", features: "Features", settings: "Settings" };

// ── Global command-palette search ────────────────────────────────────────────
function GlobalSearch({ userRole }: { userRole: NavRole | undefined }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [, navigate] = useLocation();

  const role = (userRole ?? "support_worker") as NavRole;

  const allowed = useMemo(
    () => SEARCH_CATALOGUE.filter((e) => e.roles.includes(role)),
    [role],
  );

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allowed
      .filter((e) => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
      .slice(0, 9);
  }, [query, allowed]);

  const quickAccess = useMemo(() => {
    const hrefs = SEARCH_QUICK_ACCESS[role] ?? [];
    return allowed.filter((e) => hrefs.includes(e.href)).slice(0, 5);
  }, [role, allowed]);

  const showResults    = focused && query.trim().length > 0 && results.length > 0;
  const showQuickAccess = focused && query.trim() === "";

  const grouped = useMemo(() => {
    const map: Partial<Record<string, SearchEntry[]>> = {};
    for (const r of results) {
      (map[r.group] ??= []).push(r);
    }
    return map;
  }, [results]);

  function handleSelect(href: string) {
    navigate(href);
    setQuery("");
    setFocused(false);
  }

  return (
    <div className="relative flex-1 max-w-md">
      <div
        className="flex items-center gap-2 h-9 px-3.5 rounded-xl transition-all duration-200"
        style={{
          border: `1px solid ${focused ? "var(--cc-coral)" : "rgba(0,0,0,0.11)"}`,
          background: "#fff",
          boxShadow: focused ? "0 0 0 3px var(--cc-coral-soft)" : "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <Search size={13} strokeWidth={2.5} style={{ color: focused ? CORAL : MUTED, flexShrink: 0, transition: "color 150ms" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); setQuery(""); }, 180)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setFocused(false); setQuery(""); }
            if (e.key === "Enter" && results.length > 0) handleSelect(results[0].href);
          }}
          placeholder="Search pages, features, settings..."
          className="flex-1 bg-transparent text-[13px] outline-none min-w-0"
          style={{ color: TEXT }}
        />
        {focused && (
          <kbd className="text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0" style={{ background: "var(--cc-soft)", color: MUTED, borderColor: BORDER }}>
            ESC
          </kbd>
        )}
      </div>

      {(showResults || showQuickAccess) && (
        <div
          className="absolute top-full mt-2 left-0 z-50 rounded-xl border shadow-lg overflow-hidden"
          style={{ background: "var(--cc-bg)", borderColor: "var(--cc-border)", minWidth: 360, maxWidth: 480, width: "max-content" }}
        >
          {showQuickAccess && (
            <>
              <p className="px-3 pt-3 pb-1 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Quick access</p>
              {quickAccess.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button key={`qa-${entry.href}-${entry.label}`} type="button" onMouseDown={() => handleSelect(entry.href)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--cc-soft)]">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--cc-soft)" }}>
                      <Icon size={14} strokeWidth={1.8} style={{ color: CORAL }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: TEXT }}>{entry.label}</p>
                      <p className="text-[11px] truncate" style={{ color: MUTED }}>{entry.description}</p>
                    </div>
                  </button>
                );
              })}
              <div className="h-px mx-3 mt-1 mb-2" style={{ background: BORDER }} />
              <p className="px-3 pb-2.5 text-[11px]" style={{ color: MUTED }}>Type to search across {allowed.length} items\u2026</p>
            </>
          )}

          {showResults && Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <p className="px-3 pt-3 pb-1 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>
                {SEARCH_GROUP_LABELS[group] ?? group}
              </p>
              {items!.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button key={`${entry.href}-${entry.label}`} type="button" onMouseDown={() => handleSelect(entry.href)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--cc-soft)]">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--cc-soft)" }}>
                      <Icon size={14} strokeWidth={1.8} style={{ color: CORAL }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: TEXT }}>{entry.label}</p>
                      <p className="text-[11px] truncate" style={{ color: MUTED }}>{entry.description}</p>
                    </div>
                    <ChevronRight size={13} style={{ color: MUTED, flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sidebar contents ──────────────────────────────────────────────────────────
function SidebarContents({
  location, collapsed, isDrawer,
  alertCount, incidentOpenCount, displayName, displayRole, initials,
  onNav, onLogout, translate, translateParams,
  isDark, toggleTheme,
}: {
  location: string; collapsed: boolean; isDrawer: boolean;
  alertCount: number; incidentOpenCount: number;
  displayName: string; displayRole: string; initials: string;
  onNav?: () => void; onLogout: () => void;
  translate: (key: string) => string;
  translateParams: (key: string, params: Record<string, string>) => string;
  isDark: boolean; toggleTheme: () => void;
}) {
  const compact = !isDrawer && collapsed;
  const { user } = useAuth();
  const role = (user?.role ?? "support_worker") as NavRole;
  const sections = SECTIONED_NAV[role] ?? SECTIONED_NAV.support_worker;

  return (
    <div className="flex flex-col h-full select-none overflow-hidden">
      {/* Logo row — top of sidebar for both desktop and mobile drawer */}
      <div
        className={cn("flex items-center shrink-0 h-14", compact ? "justify-center px-2" : "px-5")}
        style={{ borderBottom: `1px solid rgba(255,255,255,0.08)` }}
      >
        <Link
          href="/dashboard"
          onClick={onNav}
          aria-label={translate("layout.aria.goToDashboard")}
          title={translate("nav.home")}
          className={cn(
            "flex items-center rounded-lg transition-all hover:bg-white/8 active:opacity-70",
            compact ? "h-10 w-10 justify-center" : "h-10 px-2 gap-2 w-full",
          )}
        >
          {compact ? (
            <span
              className="font-extrabold tracking-[-0.03em] leading-none select-none"
              style={{ fontFamily: "var(--app-font-display)", fontSize: 17 }}
            >
              <span style={{ color: "rgba(255,255,255,0.9)" }}>C</span><span style={{ color: PLUM }}>Q</span>
            </span>
          ) : (
            <span
              className="font-extrabold tracking-[-0.03em] leading-none select-none"
              style={{ fontFamily: "var(--app-font-display)", fontSize: 22 }}
            >
              <span style={{ color: "rgba(255,255,255,0.92)" }}>Care</span><span style={{ color: PLUM }}>CliQ</span>
            </span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 overflow-y-auto scrollbar-none py-2", compact ? "px-1.5" : "px-2")}>
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {section.group && !compact && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] opacity-50" style={{ color: TEXT }}>
                {groupLabelForName(section.group, translate)}
              </p>
            )}
            {section.group && compact && si > 0 && (
              <div className="h-px mx-2 mb-2 opacity-30" style={{ background: BORDER }} />
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(location, item.href);
                const Icon = item.icon;
                const label = navLabelForHref(item.href, item.label, translate);
                const isCompliance = item.href === "/compliance" || item.href === "/my-compliance" || item.href === "/md/compliance";
                const isIncidents = item.href === "/incidents";
                const hasAlert     = alertCount > 0 && isCompliance;
                const hasIncidentBadge = incidentOpenCount > 0 && isIncidents;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNav}
                    title={compact ? label : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <div
                      className={cn(
                        "flex items-center h-10 text-[13px] transition-all duration-150 cursor-pointer rounded-xl",
                        compact ? "w-10 justify-center mx-auto" : "gap-2.5 px-3",
                        !active && "hover:bg-white/8",
                      )}
                      style={{
                        background: active ? CORAL : undefined,
                        color: active ? "#fff" : TEXT,
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} style={{ color: active ? "#fff" : MUTED }} />
                      {!compact && <span className="flex-1 truncate">{label}</span>}
                      {!compact && hasIncidentBadge && (
                        <span
                          className="ml-auto min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-black flex items-center justify-center"
                          style={{ background: active ? "rgba(255,255,255,0.3)" : "#E24B4A", color: "#fff" }}
                        >
                          {incidentOpenCount}
                        </span>
                      )}
                      {!compact && hasAlert && (
                        <span
                          className="ml-auto min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-black flex items-center justify-center"
                          style={{ background: active ? "rgba(255,255,255,0.3)" : CORAL, color: "#fff" }}
                        >
                          {alertCount}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* Settings */}
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
          <Link href="/settings" onClick={onNav} title={compact ? translate("common.settings") : undefined} aria-current={isActive(location, "/settings") ? "page" : undefined}>
            <div
              className={cn(
                "flex items-center h-10 text-[13px] transition-all duration-150 cursor-pointer rounded-xl",
                compact ? "w-10 justify-center mx-auto" : "gap-2.5 px-3",
                !isActive(location, "/settings") && "hover:bg-white/8",
              )}
              style={{
                background: isActive(location, "/settings") ? CORAL : undefined,
                color: isActive(location, "/settings") ? "#fff" : TEXT,
                fontWeight: isActive(location, "/settings") ? 600 : 500,
              }}
            >
              <Settings size={17} strokeWidth={isActive(location, "/settings") ? 2.2 : 1.8} style={{ color: isActive(location, "/settings") ? "#fff" : MUTED }} />
              {!compact && <span>{translate("common.settings")}</span>}
            </div>
          </Link>
        </div>
      </nav>

      {/* ── Quick "Report Incident" shortcut (support workers + coordinators only) ── */}
      {!compact && (role === "support_worker" || role === "support_coordinator") && (
        <div className="px-3 pb-2 shrink-0">
          <Link href="/incidents/new" onClick={onNav}>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-semibold transition-all duration-150 cursor-pointer hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "var(--cc-coral-soft)",
                color: CORAL,
                border: "1px solid var(--cc-coral-ring)",
              }}
            >
              <AlertTriangle size={13} strokeWidth={2.2} />
              <span>{translate("nav.reportIncident")}</span>
            </div>
          </Link>
        </div>
      )}

      {/* User footer */}
      <div className={cn("shrink-0 py-3", compact ? "px-2" : "px-3")} style={{ borderTop: `1px solid ${BORDER}`, background: "color-mix(in srgb, var(--cc-soft) 80%, transparent)" }}>
        {compact ? (
          <div className="relative mx-auto w-fit">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-[12px] font-black"
              style={{ background: CORAL, color: "#fff" }}
              title={displayName}
            >
              {initials}
            </div>
            {/* Compact compliance dot */}
            <div
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
              style={{
                background: alertCount > 0 ? "var(--cc-status-warning)" : "var(--cc-status-success)",
                borderColor: "var(--cc-bg)",
              }}
              title={alertCount > 0
                ? translateParams("layout.compliance.actionsPending", { count: String(alertCount) })
                : translate("layout.compliance.upToDate")}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            {/* Avatar with compliance status ring */}
            <div className="relative shrink-0">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-[12px] font-black"
                style={{ background: CORAL, color: "#fff" }}
              >
                {initials}
              </div>
              <div
                className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                style={{
                  background: alertCount > 0 ? "var(--cc-status-warning)" : "var(--cc-status-success)",
                  borderColor: "var(--cc-bg)",
                }}
                title={alertCount > 0
                ? translateParams("layout.compliance.actionsPending", { count: String(alertCount) })
                : translate("layout.compliance.upToDate")}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate" style={{ color: TEXT }}>{displayName}</p>
              <p className="text-[11px] font-medium capitalize truncate" style={{ color: MUTED }}>
                {displayRole}
              </p>
            </div>
            <button type="button" onClick={onLogout} title={translate("common.signOut")} className="p-1.5 rounded-md hover:bg-black/5 transition-colors" style={{ color: MUTED }}>
              <LogOut size={15} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── App layout ────────────────────────────────────────────────────────────────
export function AppLayout({ children, rightRail }: { children: React.ReactNode; rightRail?: React.ReactNode }) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [workerNotifOpen, setWorkerNotifOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const isExpanded = !collapsed || sidebarHovered;

  const { settings } = useSettings();
  const { user, logout } = useAuth();
  const { translate, translateParams } = useAccessibility();
  const { data: alerts = [] } = useGetUnreadAlerts();

  const displayName = user?.full_name || settings?.name || user?.email || translate("common.supportWorker");
  const displayRole = user?.role?.replace(/_/g, " ") ?? settings?.credentials ?? translate("common.supportWorker");
  const initials    = getInitials(displayName);
  const alertCount  = Array.isArray(alerts) ? alerts.length : 0;
  const userRole    = user?.role as NavRole | undefined;
  const isCoordinator = userRole === "support_coordinator";
  const { data: incidentStats } = useOrgQuery<{ open: number }>(
    ["incident-stats", "nav-badge"],
    { queryFn: () => getIncidentStats<{ open: number }>(), enabled: isCoordinator },
  );
  const incidentOpenCount = incidentStats?.open ?? 0;
  const isWorker    = userRole === "support_worker";
  // Quill chatbox is scoped to coordinators and managing directors only.
  const showQuillAssistant = userRole === "support_coordinator" || userRole === "managing_director";
  const topbarAlertHref =
    userRole === "support_worker"    ? "/my-compliance" :
    userRole === "managing_director" ? "/md/compliance"  :
    "/compliance";

  const { setThemeMode } = useAccessibility();
  const { resolvedTheme } = useTheme();
  const isDark =
    resolvedTheme === "dark" ||
    (!resolvedTheme && typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const toggleTheme = () => setThemeMode(isDark ? "light" : "dark");

  const navSections   = SECTIONED_NAV[userRole as NavRole]   ?? SECTIONED_NAV.support_worker;
  const topbarQuicknav = TOPBAR_QUICKNAV[userRole as NavRole] ?? TOPBAR_QUICKNAV.support_worker;
  const pageLabel     = pageLabelForPath(location, translate);
  const isMobile      = useIsMobile();
  const hideWorkerMobileBottomNav =
    isWorker && isMobile && isWorkerMobileShiftDetailPath(location);
  const hideWorkerMobileTopNav =
    isWorker && isMobile && location.includes("/message-office");

  const toggleCollapse = () => {
    const next = isExpanded; // if currently expanded → pin collapsed; if collapsed → pin open
    setCollapsed(next);
    if (next) setSidebarHovered(false);
    try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* noop */ }
  };

  const sharedProps = {
    location, collapsed, alertCount, incidentOpenCount, displayName, displayRole, initials,
    onLogout: logout, translate, translateParams, isDark, toggleTheme,
  };

  // Short role label for pill
  const rolePill = displayRole.split(" ").slice(0, 2).join(" ");

  return (
    <div className="flex w-full overflow-hidden h-dvh" style={{ color: TEXT, background: "var(--cc-bg)" }}>
      {/* ── Desktop sidebar — full-height left rail ── */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out relative"
        style={{color: TEXT,                                                                                                                                                                                                  
                                                                                                                                                                                                          width: isExpanded ? 220 : 64,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          background: "var(--cc-sidebar-bg)",
          "--cc-text":       "rgba(255,255,255,0.88)",
          "--cc-muted":      "rgba(255,255,255,0.46)",
          "--cc-border":     "rgba(255,255,255,0.09)",
          "--cc-soft":       "rgba(255,255,255,0.06)",
          "--cc-coral-soft": "rgba(110,121,194,0.22)",
          "--cc-coral-ring": "rgba(110,121,194,0.42)",
        } as React.CSSProperties}
        onMouseEnter={() => collapsed && setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        <SidebarContents {...sharedProps} collapsed={!isExpanded} isDrawer={false} />

        {/* Collapse handle — coloured tab sticking out from the sidebar edge */}
        <button
          type="button"
          onClick={toggleCollapse}
          title={isExpanded ? translate("layout.sidebar.collapse") : translate("layout.sidebar.expand")}
          className="absolute z-10 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 hover:brightness-110 active:scale-95"
          style={{
            right: -18,
            top: "50%",
            transform: "translateY(-50%)",
            width: 18,
            height: 52,
            borderRadius: "0 8px 8px 0",
            background: CORAL,
            boxShadow: "3px 0 10px rgba(110,121,194,0.4)",
            color: "#fff",
          }}
        >
          {isExpanded
            ? <ChevronLeft  size={11} strokeWidth={2.5} />
            : <ChevronRight size={11} strokeWidth={2.5} />
          }
        </button>
      </aside>

      {/* ── Right column: desktop topbar + content ── */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
      {/* ── Desktop topbar — spans right column only ── */}
      <header
        className="hidden md:flex h-14 shrink-0 items-stretch select-none relative"
        style={{
          borderBottom: `1px solid ${BORDER}`,
          background: "var(--cc-bg)",
          boxShadow: "0 1px 0 var(--cc-border)",
          zIndex: 20,
        }}
      >
        {/* Brand accent gradient line at very top */}
        <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, ${CORAL} 0%, ${PLUM} 100%)`, opacity: 0.85 }} />

        {/* ── Role badge + breadcrumb ── */}
        <div className="flex items-center gap-3 px-5 shrink min-w-0 max-w-[480px]">
          <div
            className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[10px] font-semibold uppercase tracking-[0.08em] select-none shrink-0 border"
            style={{ background: "var(--cc-coral-soft)", color: CORAL, borderColor: "var(--cc-coral-ring)" }}
          >
            {rolePill}
          </div>
          <div className="min-w-0 overflow-hidden [&_nav]:mb-0 [&_nav]:flex-nowrap">
            <AutoBreadcrumb />
          </div>
        </div>

        {/* ── Center zone: search (always visible) + quick-nav pills when collapsed ── */}
        <div className="flex items-center flex-1 gap-3 px-4 min-w-0">
          <GlobalSearch userRole={userRole} />
          {collapsed && (
            <div className="hidden lg:flex items-center gap-0.5 overflow-x-hidden scrollbar-none shrink-0">
              {topbarQuicknav.map((item) => {
                const active = isActive(location, item.href);
                const Icon = item.icon;
                const label = navLabelForHref(item.href, item.label, translate);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] whitespace-nowrap transition-all duration-150 cursor-pointer"
                      style={{
                        background: active ? CORAL : "transparent",
                        color: active ? "#fff" : MUTED,
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <Icon size={13} strokeWidth={active ? 2.2 : 1.8} style={{ color: active ? "#fff" : MUTED }} />
                      <span>{label}</span>
                      {alertCount > 0 && (item.href === "/compliance" || item.href === "/my-compliance") && (
                        <span
                          className="min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black flex items-center justify-center"
                          style={{ background: active ? "rgba(255,255,255,0.3)" : CORAL, color: "#fff" }}
                        >
                          {alertCount}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Subtle inset divider — before right zone */}
        <div className="w-px self-stretch my-3 shrink-0 opacity-50" style={{ background: BORDER }} />

        {/* ── Right zone: notifications + profile ── */}
        <div className="flex items-center gap-1.5 px-4 shrink-0">
          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? translate("layout.theme.lightMode") : translate("layout.theme.darkMode")}
            aria-label={isDark ? translate("layout.theme.switchToLight") : translate("layout.theme.switchToDark")}
            className="h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:bg-black/8 hover:text-[var(--cc-coral)]"
            style={{ color: MUTED }}
          >
            {isDark ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
          </button>

          {!isWorker
            ? <NotificationBell onClick={() => setNotifOpen(true)} />
            : <WorkerNotificationBell onClick={() => setWorkerNotifOpen(true)} />
          }

          {/* Profile */}
          <ProfileDropdown
            displayName={displayName}
            displayRole={displayRole}
            initials={initials}
            userRole={userRole}
            onLogout={logout}
          />
        </div>
      </header>

      {/* Content row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main content canvas */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        <div className="flex-1 flex flex-col min-h-0 bg-cc-surface overflow-hidden relative">

          {/* ── Mobile header ─────────────────────────────────────────────── */}
          {!hideWorkerMobileTopNav && (
          <header
            className="md:hidden safe-header-mobile flex items-center justify-between px-4 shrink-0 z-10"
            style={{ borderBottom: `1px solid ${BORDER}`, background: "var(--cc-bg)" }}
          >
            {hideWorkerMobileBottomNav ? (
              <Link
                href={workerMobileShiftBackHref(location)}
                className="flex h-9 w-9 items-center justify-center rounded-full border active:opacity-75 transition-opacity"
                style={{ borderColor: BORDER }}
                aria-label={location.includes("/message-office") ? translate("shift.during.backToShift") : translate("shift.briefing.backToList")}
              >
                <ArrowLeft size={17} style={{ color: TEXT }} />
              </Link>
            ) : (
              <Link href="/dashboard" className="flex items-center py-1 active:opacity-75 transition-opacity">
                <CareCliQLogoSm />
              </Link>
            )}

            {/* Current page label */}
            {pageLabel && (
              <p className="text-[13px] font-black truncate max-w-[140px]" style={{ color: TEXT }}>
                {pageLabel}
              </p>
            )}

            <div className="flex items-center gap-1">
              {/* Alerts badge on mobile */}
              {alertCount > 0 && (
                <Link href={topbarAlertHref}>
                  <button
                    type="button"
                    className="h-8 w-8 rounded-xl flex items-center justify-center relative"
                    style={{ background: "var(--cc-alert-bg)", color: CORAL }}
                    aria-label={translateParams("layout.compliance.needAttention", { count: String(alertCount) })}
                  >
                    <AlertTriangle size={15} strokeWidth={2.5} />
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-white text-[9px] font-black flex items-center justify-center"
                      style={{ background: CORAL }}
                    >
                      {alertCount}
                    </span>
                  </button>
                </Link>
              )}
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label={translate("layout.aria.openNav")}
                className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors active:bg-black/5"
                style={{ color: TEXT }}
              >
                <Menu size={20} aria-hidden="true" />
              </button>
            </div>
          </header>
          )}

          {isWorker && <NotificationRealtimeBridge />}
          {isWorker && <NotificationBannerStack />}

        {/* Page content */}
          <main
            className={cn(
              "flex-1 overflow-y-auto md:py-5",
              hideWorkerMobileBottomNav
                ? "safe-scroll-no-bottom-nav px-0 py-0 md:px-4 md:py-4"
                : "px-4 py-4 safe-scroll-bottom",
            )}
          >
            <div className="md:hidden">
              <AutoBreadcrumb />
            </div>
            {children}
          </main>

          {/* Notification panels */}
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setNotifOpen(false)} />
              <NotificationPanel onClose={() => setNotifOpen(false)} />
            </>
          )}
          {workerNotifOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setWorkerNotifOpen(false)} />
              <WorkerNotificationPanel onClose={() => setWorkerNotifOpen(false)} />
            </>
          )}
        </div>
      </div>

      {rightRail && <RightRail>{rightRail}</RightRail>}
      </div>      </div>
      {/* ── Mobile bottom nav ──────────────────────────────────────────── */}
      {!hideWorkerMobileBottomNav && (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch safe-nav-bottom"
        style={{ borderTop: `1px solid ${BORDER}`, background: "var(--cc-bg)" }}
      >
        {(ROLE_BOTTOM_NAV[userRole as NavRole] ?? ROLE_BOTTOM_NAV.support_worker).map((item: NavItem) => {
          const active = isActive(location, item.href);
          const Icon = item.icon;
          const label = bottomNavLabelForHref(item.href, item.label, translate);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-2 relative transition-colors min-h-[60px]"
              style={{ color: active ? CORAL : MUTED }}
            >
              {/* Active indicator — top pill */}
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full transition-all duration-200"
                style={{
                  width: active ? 32 : 0,
                  height: 3,
                  background: CORAL,
                  opacity: active ? 1 : 0,
                }}
              />

              {/* Icon pill — wider active state for easier tap recognition */}
              <div
                className="flex items-center justify-center rounded-xl transition-all duration-200"
                style={{
                  width: active ? 52 : 36,
                  height: 32,
                  background: active ? ACTIVE : "transparent",
                }}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              </div>

              <span className={cn("text-[10.5px] leading-none", active ? "font-bold" : "font-medium")}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
      )}

      {/* ── Mobile drawer backdrop ─────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(17,24,39,0.35)", backdropFilter: "blur(2px)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ borderRight: `1px solid rgba(255,255,255,0.06)`, background: "var(--cc-sidebar-bg)" }}
      >
        <div className="absolute top-3 right-3 z-10">
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label={translate("layout.aria.closeMenu")}
            title={translate("layout.aria.closeMenu")}
            className="p-1.5 rounded-xl hover:bg-black/5 transition-colors"
            style={{ color: MUTED }}
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContents {...sharedProps} isDrawer collapsed={false} onNav={() => setDrawerOpen(false)} />
      </aside>

      {showQuillAssistant && <FloatingAiAssistant />}
    </div>
  );
}
