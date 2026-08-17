import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Moon,
  Sun,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Settings,
  LogOut,
  LayoutDashboard,
  CalendarDays,
  Users,
  UserPlus,
  ShieldCheck,
  AlertTriangle,
  DollarSign,
  BarChart3,
  ClipboardCheck,
  GraduationCap,
  Menu,
  X,
  Bell,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTheme } from "next-themes";

import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import {
  getOrganizationBranding,
  type OrganizationBranding,
} from "@/services/organizationBrandingService";

// MD pages use the same CareCliQ tokens (--cc-plum pink / --cc-coral purple)
// as the rest of the app, defined once at :root and swapped automatically by
// the .dark class — no separate MD-only palette.

const MD_NAV_GROUPS = [
  {
    label: "Governance & Strategy",
    items: [
      { href: "/hub", label: "Executive Hub", icon: LayoutDashboard },
      { href: "/md/executive", label: "Strategic Insights", icon: BarChart3 },
    ],
  },
  {
    label: "Operations & Care",
    items: [
      { href: "/md/schedule", label: "Master Schedule", icon: CalendarDays },
      { href: "/md/service-delivery", label: "Delivery Quality", icon: ClipboardCheck },
    ],
  },
  {
    label: "Workforce & People",
    items: [
      { href: "/md/staff", label: "Directory", icon: Users },
      { href: "/md/staff-onboarding", label: "Onboarding", icon: UserPlus },
      { href: "/md/onboarding/training", label: "Competency & Training", icon: GraduationCap },
    ],
  },
  {
    label: "Oversight & Risk",
    items: [
      { href: "/md/compliance", label: "Audit & Compliance", icon: ShieldCheck },
      { href: "/md/incidents", label: "Critical Incidents", icon: AlertTriangle },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/md/financial", label: "Financial Governance", icon: DollarSign }],
  },
] as const;

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function isRouteActive(location: string, href: string) {
  if (href === "/hub") return location === "/hub";
  return location === href || location.startsWith(`${href}/`);
}

// Perceived-brightness check so nav text/hover/active colors always stay
// readable against whatever background the user picked in Settings —
// picking a color never has to mean picking broken contrast too.
function isDarkHex(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

export function HubLayout({ children }: { children: React.ReactNode }) {
  const { translate, setThemeMode, prefs } = useAccessibility();
  const { resolvedTheme } = useTheme();
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const isMD = user?.role === "managing_director";
  const sidebarMode = isMD && prefs?.nav_layout === "sidebar";
  const bottombarMode = isMD && prefs?.nav_layout === "bottombar";
  // User-adjustable nav background (Settings > Layout) — an exact hex code,
  // stored solid (no opacity) per the Color Consistency Directive. Falls
  // back to the default --cc-surface token when unset.
  const navBackground = prefs?.nav_color || "var(--cc-surface)";
  // Every preset in Settings is a full design (background + guaranteed-
  // readable foreground), not just a raw color — this derives that
  // foreground from the chosen background so text/icons never go invisible.
  const navIsDark = !!prefs?.nav_color && isDarkHex(prefs.nav_color);
  const navText = navIsDark ? "rgba(255,255,255,0.85)" : "var(--cc-muted)";
  const navTextHover = navIsDark ? "#FFFFFF" : "var(--cc-text)";
  const navHoverBg = navIsDark ? "rgba(255,255,255,0.10)" : "var(--cc-soft)";
  const navActiveBg = navIsDark ? "rgba(255,255,255,0.18)" : "var(--cc-plum)";

  const [orgName, setOrgName] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeGroupHover, setActiveGroupHover] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [imgError, setImgError] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setThemeMode(isDark ? "light" : "dark");

  const displayName = user?.full_name || user?.email || translate("hub.role.staffFallback");
  const initials = getInitials(displayName);

  const toggleGroup = (groupLabel: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setActiveGroupHover(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setMobileNavOpen(false);
        setActiveGroupHover(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/hub/org")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setOrgName(data?.organization_name || null);
      })
      .catch(() => {
        if (!cancelled) setOrgName(null);
      });

    getOrganizationBranding()
      .then((data) => {
        if (!cancelled) setBranding(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const organisationDisplay = branding?.display_name || orgName || translate("hub.orgFallback");

  return (
    <div
      className="min-h-screen font-sans antialiased selection:bg-[var(--cc-plum-soft)] transition-colors duration-200"
      style={{
        background: "var(--cc-bg)",
        color: "var(--cc-text)",
      }}
    >
      {/* Dynamic Background Glows for MD Executive View */}
      {isMD && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-30">
          <div className="absolute -top-[20%] left-[10%] h-[500px] w-[500px] rounded-full bg-[var(--cc-plum)]/10 blur-[120px]" />
          <div className="absolute top-[30%] right-[5%] h-[600px] w-[600px] rounded-full bg-[var(--cc-coral)]/10 blur-[160px]" />
        </div>
      )}

      {/* Header / Governance Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-xl border-b border-[var(--cc-border)] bg-[var(--cc-surface)]/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          
          {/* Brand & Organization Badge */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              {branding?.logo_url && !imgError ? (
                <img
                  src={branding.logo_url}
                  alt={organisationDisplay}
                  onError={() => setImgError(true)}
                  className="h-8 max-w-[110px] object-contain"
                />
              ) : (
                <CareCliQLogo size={32} />
              )}
              <span className="hidden h-4 w-px bg-[var(--cc-border)] sm:block" />
              <div className="hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold tracking-tight">{organisationDisplay}</span>
                  {isMD && (
                    <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--cc-plum-soft)", color: "var(--cc-plum)", borderColor: "var(--cc-plum-soft)" }}>
                      Governance
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Search */}
          <div className="hidden max-w-sm flex-1 md:block px-6">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-[var(--cc-muted)]" />
              <input
                type="text"
                placeholder="Search metrics, reports, audit logs... (⌘K)"
                className="w-full rounded-full border border-[var(--cc-border)] bg-[var(--cc-soft)]/50 py-1.5 pl-9 pr-4 text-xs font-medium placeholder:text-[var(--cc-muted)] focus:border-[var(--cc-plum)] focus:outline-none focus:ring-2 focus:ring-[var(--cc-plum-soft)] transition-all"
              />
            </div>
          </div>

          {/* Executive Control Group */}
          <div className="flex items-center gap-2" ref={profileRef}>
            {/* Quick Status Pill (MD Only) */}
            {isMD && (
              <div className="hidden lg:flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 mr-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  System Compliant
                </span>
              </div>
            )}

            <button
              type="button"
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--cc-muted)] hover:bg-[var(--cc-soft)] hover:text-[var(--cc-text)] transition-colors"
              aria-label="Notifications"
            >
              <Bell size={17} />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full ring-2 ring-[var(--cc-surface)]" style={{ background: "var(--cc-status-danger)" }} />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="hidden sm:flex h-9 w-9 items-center justify-center rounded-full text-[var(--cc-muted)] hover:bg-[var(--cc-soft)] hover:text-[var(--cc-text)] transition-colors"
              aria-label="Toggle Mode"
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            <div className="mx-1 h-5 w-px bg-[var(--cc-border)] hidden sm:block" />

            {/* MD User Menu */}
            <button
              type="button"
              onClick={() => setProfileOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-full p-1 border border-transparent hover:border-[var(--cc-border)] hover:bg-[var(--cc-soft)]/60 transition-all"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: "linear-gradient(135deg, var(--cc-plum) 0%, var(--cc-coral) 100%)" }}>
                {initials}
              </div>
              <span className="hidden md:block text-xs font-semibold pr-1">
                {displayName}
              </span>
              <ChevronDown size={14} className="text-[var(--cc-muted)]" />
            </button>

            {/* Profile Dropdown */}
            {profileOpen && (
              <div className="absolute right-4 top-14 w-56 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-1.5 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2 border-b border-[var(--cc-border)]">
                  <p className="text-xs font-bold">{displayName}</p>
                  <p className="text-[11px] text-[var(--cc-muted)] truncate">{user?.email}</p>
                </div>
                <div className="py-1">
                  <Link
                    href="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium hover:bg-[var(--cc-soft)] transition-colors"
                  >
                    <Settings size={14} />
                    <span>Governance Settings</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--cc-status-danger-bg)]"
                    style={{ color: "var(--cc-status-danger)" }}
                  >
                    <LogOut size={14} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}

            {/* Mobile Nav Button */}
            {isMD && !bottombarMode && (
              <button
                type="button"
                onClick={() => setMobileNavOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-lg lg:hidden text-[var(--cc-muted)]"
              >
                {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Command Deck Executive Navigation (Floating Dock) */}
      {isMD && !sidebarMode && !bottombarMode && (
        <div className="sticky top-16 z-30 hidden lg:block py-4 px-6 pointer-events-none">
          <div
            ref={navRef}
            className="pointer-events-auto mx-auto max-w-fit rounded-full border backdrop-blur-md p-2"
            style={{ borderColor: "var(--cc-plum-border)", background: navBackground, boxShadow: "var(--cc-shadow-md)" }}
          >
            <nav className="flex items-center gap-1.5 relative">
              {MD_NAV_GROUPS.map((group) => {
                const hasActiveRoute = group.items.some((item) =>
                  isRouteActive(location, item.href)
                );

                return (
                  <div
                    key={group.label}
                    className="relative"
                    onMouseEnter={() => setActiveGroupHover(group.label)}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setActiveGroupHover(
                          activeGroupHover === group.label ? null : group.label
                        )
                      }
                      style={{
                        background: hasActiveRoute ? navActiveBg : undefined,
                        color: hasActiveRoute ? "#FFFFFF" : navText,
                        ["--nav-hover-bg" as string]: navHoverBg,
                        ["--nav-text-hover" as string]: navTextHover,
                      }}
                      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                        hasActiveRoute ? "shadow-md" : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"
                      }`}
                    >
                      <span>{group.label}</span>
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${
                          activeGroupHover === group.label ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* Dropdown Flyout Panel */}
                    {activeGroupHover === group.label && (
                      <div
                        className="absolute left-0 top-full mt-2 w-56 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)]/95 backdrop-blur-xl p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                        onMouseLeave={() => setActiveGroupHover(null)}
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">
                          {group.label}
                        </div>
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const active = isRouteActive(location, item.href);
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setActiveGroupHover(null)}
                                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                                  active
                                    ? "bg-[var(--cc-plum-soft)] text-[var(--cc-plum)]"
                                    : "text-[var(--cc-muted)] hover:bg-[var(--cc-soft)] hover:text-[var(--cc-text)]"
                                }`}
                              >
                                <Icon size={16} />
                                <span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Mobile Drawer (MD Navigation) */}
      {isMD && !bottombarMode && mobileNavOpen && (
        <div className="fixed inset-0 top-16 z-50 bg-[var(--cc-surface)] p-6 overflow-y-auto lg:hidden animate-in fade-in duration-200">
          <div className="space-y-6">
            {MD_NAV_GROUPS.map((group) => (
              <div key={group.label} className="space-y-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">
                  {group.label}
                </h3>
                <div className="grid grid-cols-1 gap-1">
                  {group.items.map((item) => {
                    const active = isRouteActive(location, item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold ${
                          active
                            ? "bg-[var(--cc-plum)] text-white"
                            : "bg-[var(--cc-soft)] text-[var(--cc-text)]"
                        }`}
                      >
                        <Icon size={18} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Bar Executive Navigation (Floating Dock — mirrors the top Command Deck) */}
      {isMD && bottombarMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 py-4 px-6 pointer-events-none">
          <div
            ref={navRef}
            className="pointer-events-auto mx-auto max-w-fit rounded-full border backdrop-blur-md p-2"
            style={{ borderColor: "var(--cc-plum-border)", background: navBackground, boxShadow: "var(--cc-shadow-md)" }}
          >
            <nav className="flex items-center gap-1.5 relative">
              {MD_NAV_GROUPS.map((group) => {
                const hasActiveRoute = group.items.some((item) => isRouteActive(location, item.href));

                return (
                  <div
                    key={group.label}
                    className="relative"
                    onMouseEnter={() => setActiveGroupHover(group.label)}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setActiveGroupHover(activeGroupHover === group.label ? null : group.label)
                      }
                      style={{
                        background: hasActiveRoute ? navActiveBg : undefined,
                        color: hasActiveRoute ? "#FFFFFF" : navText,
                        ["--nav-hover-bg" as string]: navHoverBg,
                        ["--nav-text-hover" as string]: navTextHover,
                      }}
                      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                        hasActiveRoute ? "shadow-md" : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"
                      }`}
                    >
                      <ChevronUp
                        size={14}
                        className={`transition-transform duration-200 ${
                          activeGroupHover === group.label ? "rotate-180" : ""
                        }`}
                      />
                      <span>{group.label}</span>
                    </button>

                    {/* Upward Dropdown Flyout Panel */}
                    {activeGroupHover === group.label && (
                      <div
                        className="absolute left-0 bottom-full mb-2 w-56 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)]/95 backdrop-blur-xl p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
                        onMouseLeave={() => setActiveGroupHover(null)}
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">
                          {group.label}
                        </div>
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const active = isRouteActive(location, item.href);
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setActiveGroupHover(null)}
                                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                                  active
                                    ? "bg-[var(--cc-plum-soft)] text-[var(--cc-plum)]"
                                    : "text-[var(--cc-muted)] hover:bg-[var(--cc-soft)] hover:text-[var(--cc-text)]"
                                }`}
                              >
                                <Icon size={16} />
                                <span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Canvas Area */}
      {isMD && sidebarMode ? (
        <div className="mx-auto flex max-w-[1600px] items-start gap-0 px-4 py-4 sm:px-6">
          <aside
            className={`sticky top-[76px] hidden shrink-0 self-start rounded-2xl border transition-all duration-200 lg:block ${
              sidebarCollapsed ? "w-[72px]" : "w-72"
            }`}
            style={{ background: navBackground, borderColor: "var(--cc-plum-border)", boxShadow: "var(--cc-shadow-md)" }}
          >
            <div className={sidebarCollapsed ? "flex flex-col items-center px-2 py-4" : "flex flex-col p-4"}>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                style={{ color: navText, ["--nav-hover-bg" as string]: navHoverBg, ["--nav-text-hover" as string]: navTextHover }}
                className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)] ${
                  sidebarCollapsed ? "" : "self-end"
                }`}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>

              <nav className={sidebarCollapsed ? "space-y-3" : "space-y-5"}>
                {MD_NAV_GROUPS.map((group) => {
                  const isGroupCollapsed = !!collapsedGroups[group.label];

                  return (
                    <div key={group.label} className="space-y-1.5">
                      {!sidebarCollapsed && (
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.label)}
                          className="flex w-full items-center justify-between px-2.5 text-[11px] font-black uppercase tracking-wider transition-colors hover:opacity-80"
                          style={{ color: navText }}
                        >
                          <span>{group.label}</span>
                          <ChevronRight
                            size={13}
                            className={`transition-transform duration-200 ${isGroupCollapsed ? "" : "rotate-90"}`}
                          />
                        </button>
                      )}

                      {!isGroupCollapsed && (
                        <div className={sidebarCollapsed ? "space-y-2" : "space-y-1"}>
                          {group.items.map((item) => {
                            const active = isRouteActive(location, item.href);
                            const Icon = item.icon;

                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                title={sidebarCollapsed ? item.label : undefined}
                                style={{
                                  background: active ? navActiveBg : undefined,
                                  color: active ? "#FFFFFF" : navText,
                                  ["--nav-hover-bg" as string]: navHoverBg,
                                  ["--nav-text-hover" as string]: navTextHover,
                                }}
                                className={
                                  sidebarCollapsed
                                    ? `mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${active ? "shadow-sm" : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"}`
                                    : `flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${active ? "shadow-sm" : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"}`
                                }
                              >
                                <Icon size={20} />
                                {!sidebarCollapsed && <span>{item.label}</span>}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-0 py-2 lg:px-6">{children}</main>
        </div>
      ) : (
        <main className={`mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 ${bottombarMode ? "pb-32" : ""}`}>
          {children}
        </main>
      )}
    </div>
  );
}