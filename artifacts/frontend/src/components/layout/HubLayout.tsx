import { ManagementNavigationDrawer } from "./ManagementNavigationDrawer";
import { PlatformBanner } from "@/components/PlatformBanner";
import { FloatingAiAssistant } from "./FloatingAiAssistant";
import { NotificationBell, NotificationInbox } from "@/components/notifications/NotificationInbox";
import { NotificationRealtimeBridge } from "@/components/worker/NotificationRealtimeBridge";
import { PageErrorBoundary } from "@/components/ErrorBoundary";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ManagementPageSearch, type QuickAction } from "./ManagementPageSearch";
import { IntegrationsMenu } from "./IntegrationsMenu";
﻿import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Moon,
  Sun,
  ChevronDown,
  TrendingUp,
  ChevronUp,
  ChevronRight,
  Settings,
  LogOut,
  LayoutDashboard,
  CalendarDays,
  Users,
  UserPlus,
  HeartHandshake,
  ShieldCheck,
  FolderLock,
  AlertTriangle,
  DollarSign,
  BarChart3,
  ClipboardCheck,
  GraduationCap,
  Tags,
  Menu,
  X,
  Bell,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  NotebookPen,
  BadgeCheck,
  Car,
  Wallet,
  Receipt,
  CalendarPlus,
  HeartPulse,
  MailPlus,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { NAV_INDIGO_NIGHT_HEX } from "@/lib/nav-colors";
import {
  getOrganizationBranding,
  type OrganizationBranding,
} from "@/services/organizationBrandingService";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { PARTICIPANT_COMPLAINTS_KEY } from "@/lib/query-keys";
import { listParticipantComplaints } from "@/services/participantComplaintsService";

// MD pages use the same CareCliQ tokens (--cc-plum pink / --cc-coral purple)
// as the rest of the app, defined once at :root and swapped automatically by
// the .dark class — no separate MD-only palette.


/** Small count pill shown after a nav item's label, when it has an open count. */
function NavCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
      style={{ background: "#DC2626" }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Collapsed-sidebar equivalent — no room for a number, just a dot. */
function NavCountDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute top-1 right-1 h-2 w-2 rounded-full"
      style={{ background: "#DC2626" }}
    />
  );
}

type NavTab = { href: string; label: string };
type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pages that are different views of the same job. They share one nav
   *  entry and show as tabs above the page instead of separate entries. */
  tabs?: readonly NavTab[];
  /** Other routes that belong to this entry (detail and edit pages). */
  match?: readonly string[];
  /** Same as match, but only the exact path, not anything under it. */
  exact?: readonly string[];
};

// One entry per job. Coordinator pages the MD also uses (Rostering, Team,
// Shift note review...) sit under the MD entry they belong to rather than
// beside it, which is where the duplicates came from.
const MD_NAV_GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Governance & Strategy",
    items: [
      { href: "/hub", label: "Executive Hub", icon: LayoutDashboard },
      { href: "/md/executive", label: "Performance review", icon: BarChart3 },
      { href: "/md/planning", label: "Workforce & growth", icon: TrendingUp },
    ],
  },
  {
    label: "Operations & Care",
    items: [
      // Shifts and meetings by day/week/month live in the Calendar (header
      // button); Rostering is where shifts get staffed.
      {
        href: "/coordinator/rostering",
        label: "Rostering",
        icon: CalendarDays,
        tabs: [
          { href: "/coordinator/rostering", label: "Roster" },
          { href: "/coordinator/live", label: "Live" },
        ],
        match: ["/coordinator/monitor"],
      },
      {
        href: "/onboard-participant/active",
        label: "Participants",
        icon: HeartHandshake,
        match: ["/patients", "/participants"],
      },
      {
        href: "/sessions",
        label: "Shift notes",
        icon: NotebookPen,
        tabs: [
          { href: "/sessions", label: "All shift notes" },
          { href: "/coordinator/verification", label: "Shift verification" },
        ],
      },
      { href: "/md/service-delivery", label: "Delivery Quality", icon: ClipboardCheck },
    ],
  },
  {
    label: "Workforce & People",
    items: [
      {
        href: "/md/staff",
        label: "Staff",
        icon: Users,
        tabs: [
          { href: "/md/staff", label: "Overview" },
          { href: "/team", label: "Team & invites" },
        ],
      },
      {
        href: "/md/staff-onboarding",
        label: "Onboarding",
        icon: UserPlus,
        exact: ["/onboard-participant"],
      },
      { href: "/md/onboarding/training", label: "Competency & Training", icon: GraduationCap },
      { href: "/md/tags", label: "Matching Tags", icon: Tags },
    ],
  },
  {
    label: "Oversight & Risk",
    items: [
      {
        href: "/md/compliance",
        label: "Audit & Compliance",
        icon: ShieldCheck,
        match: ["/audit-pack", "/md/audit-readiness"],
      },
      { href: "/md/vault", label: "Documents & Audit Vault", icon: FolderLock },
      {
        href: "/incidents",
        label: "Incidents & complaints",
        icon: AlertTriangle,
        tabs: [
          { href: "/incidents", label: "Incidents" },
          { href: "/onboard-participant/complaints", label: "Participant complaints" },
          { href: "/feedback-reports", label: "Staff feedback" },
        ],
      },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/md/financial", label: "Financial Governance", icon: DollarSign },
      { href: "/billing", label: "Billing & claims", icon: Receipt },
      { href: "/coordinator/travel", label: "Travel claims", icon: Car },
      { href: "/payroll", label: "Payroll", icon: Wallet },
    ],
  },
];

const NAV_ITEMS = MD_NAV_GROUPS.flatMap((group) => group.items);

// Things the director does often, offered first in the header search.
const MD_QUICK_ACTIONS: readonly QuickAction[] = [
  { href: "/md/calendar?book=1", label: "Book a meeting", detail: "With a participant, in person or online", icon: CalendarPlus },
  { href: "/participants/new", label: "Add a participant", detail: "Start a new participant record", icon: HeartPulse },
  { href: "/team", label: "Invite a staff member", detail: "Send a sign-up invite", icon: MailPlus },
  { href: "/md/calendar", label: "Calendar", detail: "Shifts and meetings by day, week or month", icon: CalendarDays },
  { href: "/settings", label: "Settings", detail: "Branding, menu layout and your account", icon: Settings },
];

function isNavItemActive(location: string, item: NavItem) {
  return (
    [item.href, ...(item.tabs ?? []).map((t) => t.href), ...(item.match ?? [])].some((href) =>
      isRouteActive(location, href),
    ) || (item.exact ?? []).includes(location)
  );
}

function isHrefActive(location: string, href: string) {
  const item = NAV_ITEMS.find((i) => i.href === href);
  return item ? isNavItemActive(location, item) : isRouteActive(location, href);
}

/** The entry whose tabs include this exact page, if it has tabs. Detail
 *  pages (/sessions/:id) don't get the tab bar; they have their own back links. */
function workspaceFor(location: string) {
  for (const group of MD_NAV_GROUPS) {
    for (const item of group.items) {
      if (item.tabs?.some((t) => t.href === location)) return item;
    }
  }
  return null;
}

function WorkspaceTabs({ item, location }: { item: NavItem; location: string }) {
  return (
    <nav
      aria-label={`${item.label} pages`}
      className="mb-3 flex gap-1 overflow-x-auto border-b border-[var(--cc-border)]"
    >
      {item.tabs!.map((tab) => {
        const active = tab.href === location;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 md:min-h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
              active
                ? "border-[var(--cc-brand-purple)] text-[var(--cc-brand-purple)]"
                : "border-transparent text-[var(--cc-muted)] hover:text-[var(--cc-text)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

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
  const calendarWorkspace = ["/md/schedule", "/coordinator/rostering", "/coordinator/live", "/coordinator/monitor"].includes(location);
  const workspace = isMD ? workspaceFor(location) : null;

  // Nav badge counts, keyed by href: open participant complaints, from the
  // same cached query as the complaints page, so addressing one updates it.
  const complaintsQuery = useOrgQuery(PARTICIPANT_COMPLAINTS_KEY, {
    queryFn: listParticipantComplaints,
    enabled: isMD || user?.role === "support_coordinator",
    retry: false,
    staleTime: 60_000,
  });
  const NAV_BADGE_COUNTS: Record<string, number> = {
    "/incidents": (complaintsQuery.data ?? []).filter((c) => c.status === "open").length,
  };
  // "sidebar" floats as a rounded card; "docked" is fixed to the left edge.
  const dockedSidebar = isMD && prefs?.nav_layout === "docked";
  const sidebarMode = isMD && (prefs?.nav_layout === "sidebar" || dockedSidebar);
  const bottombarMode = isMD && prefs?.nav_layout === "bottombar";
  const floatingMode = isMD && prefs?.nav_layout === "floating";
  // The default: the menu inside the header bar.
  const topbarMode = isMD && !sidebarMode && !bottombarMode && !floatingMode;
  // User-adjustable nav background (Settings > Layout) — an exact hex code,
  // stored solid (no opacity) per the Color Consistency Directive. Falls
  // back to the default --cc-surface token when unset.
  const navBackground = prefs?.nav_color || "var(--cc-surface)";
  // Every preset in Settings is a full design (background + guaranteed-
  // readable foreground), not just a raw color — this derives that
  // foreground from the chosen background so text/icons never go invisible.
  // "Indigo Night" (NAV_INDIGO_NIGHT_HEX in settings.tsx) reads exactly like
  // every other dark preset at rest - white text, no purple wash - and only
  // shows purple on the active pill itself. That's the whole point of the
  // reference screenshot: purple marks "this is where you are," not a
  // permanent tint (2026-08-20 correction - lavender-tinted resting text was
  // the wrong read of that reference).
  const navIsIndigoNight = prefs?.nav_color === NAV_INDIGO_NIGHT_HEX;
  const navIsDark = !!prefs?.nav_color && isDarkHex(prefs.nav_color);
  const navText = navIsDark ? "rgba(255,255,255,0.85)" : "var(--cc-muted)";
  const navTextHover = navIsDark ? "#FFFFFF" : "var(--cc-text)";
  const navHoverBg = navIsIndigoNight
    ? "rgba(108,99,255,0.14)"
    : navIsDark
      ? "rgba(255,255,255,0.10)"
      : "var(--cc-soft)";
  const navActiveBg = navIsIndigoNight
    ? "#6C63FF"
    : navIsDark
      ? "rgba(255,255,255,0.18)"
      // CareCliQ Purple marks where you are in every menu layout (pink is for
      // the page's own buttons). The fixed hex, not --cc-brand-purple, which
      // turns light lilac in dark mode and white text can't be read on it.
      : "#7C3AED";
  // The sidebar layouts sit on CareCliQ deep purple (the app sidebar's colour)
  // unless a menu colour is chosen in Settings > Branding; every preset is
  // dark, so the text and icons are light either way.
  const sideBg = prefs?.nav_color || "var(--cc-sidebar-bg)";

  const [orgName, setOrgName] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeGroupHover, setActiveGroupHover] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Remembers the last width the sidebar was dragged to, so collapsing (by
  // click or by dragging past the snap threshold) and re-expanding restores
  // it instead of always resetting to the default.
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartWidth = useRef(264);
  const SIDEBAR_MIN_WIDTH = 200;
  const SIDEBAR_MAX_WIDTH = 420;
  const SIDEBAR_COLLAPSE_THRESHOLD = 150;
  // Topbar/bottombar "Command Deck" dock auto-hides on scroll-down and
  // reappears on scroll-up, like a mobile browser's chrome — pointer events
  // (not raw mouse/touch listeners) so wheel, trackpad, and touch scrolling
  // all drive it the same way.
  const [navAutoHidden, setNavAutoHidden] = useState(false);
  const lastScrollY = useRef(0);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  // Tracks the specific URL that failed, not a plain boolean - so a fresh
  // logo_url (e.g. after the org uploads a new one) is never mistaken for
  // still being broken just because an earlier one failed to load.
  const [erroredLogoUrl, setErroredLogoUrl] = useState<string | null>(null);

  const profileRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Single-button day/dark toggle. The <html> "dark" class is what actually
  // paints the page, so it is the source of truth: read it on click and keep
  // the icon in sync by watching it (covers changes made from Settings too).
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [prefs?.theme_mode, resolvedTheme]);
  const setTheme = (mode: "light" | "dark") => {
    setThemeMode(mode);
    setIsDark(mode === "dark");
  };

  const displayName =
    user?.full_name || user?.email || translate("hub.role.staffFallback");
  const initials = getInitials(displayName);

  /** One link in the docked or floating sidebar. */
  const renderSideLink = ({
    href, label, icon: Icon, active, count,
  }: { href: string; label: string; icon: LucideIcon; active: boolean; count: number }) => {
    // Floating shows the current page as a solid purple pill; docked as a
    // soft wash with a lilac bar, as the app sidebar does.
    const pill = !dockedSidebar;
    const activeBg = pill ? (navIsIndigoNight ? "#6C63FF" : "#7C3AED") : "rgba(167,139,250,0.20)";
    return (
      <Link
        key={href}
        href={href}
        title={sidebarCollapsed ? label : undefined}
        aria-label={sidebarCollapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={`relative flex h-10 items-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A78BFA] ${
          sidebarCollapsed ? "mx-auto w-10 justify-center" : "gap-3 px-3 text-[13.5px]"
        } ${active ? "font-semibold" : "font-medium hover:bg-white/[0.06] hover:text-white"}`}
        style={{
          background: active ? activeBg : undefined,
          color: active ? "#FFFFFF" : "rgba(255,255,255,0.80)",
        }}
      >
        {active && !pill && !sidebarCollapsed && (
          <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full" style={{ background: "#A78BFA" }} />
        )}
        <Icon
          size={18}
          strokeWidth={active ? 2.1 : 1.8}
          style={{ color: active ? (pill ? "#FFFFFF" : "#D8CCFF") : "rgba(205,193,250,0.72)" }}
        />
        {sidebarCollapsed ? (
          <NavCountDot count={count} />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <NavCountBadge count={count} />
          </>
        )}
      </Link>
    );
  };

  const toggleGroup = (groupLabel: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupLabel]: !prev[groupLabel],
    }));
  };

  // Auto-hide the floating Command Deck dock (topbar or bottombar mode) as
  // the page scrolls down, bring it back the moment the user scrolls up —
  // only relevant for those two layouts, since the sidebar is always visible.
  useEffect(() => {
    if (!isMD || sidebarMode) return;
    lastScrollY.current = window.scrollY;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastScrollY.current;
        if (y < 80) setNavAutoHidden(false);
        else if (delta > 8) setNavAutoHidden(true);
        else if (delta < -8) setNavAutoHidden(false);
        lastScrollY.current = y;
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isMD, sidebarMode]);

  // Drag-to-resize the sidebar's right edge. Pointer events (rather than
  // separate mouse/touch handlers) cover mouse, trackpad, and touch alike.
  // Dragging past SIDEBAR_COLLAPSE_THRESHOLD snaps it fully closed; dragging
  // a collapsed sidebar back out past that point re-expands it.
  useEffect(() => {
    if (!sidebarDragging) return;
    function onMove(e: PointerEvent) {
      const delta = e.clientX - sidebarDragStartX.current;
      const next = sidebarDragStartWidth.current + delta;
      if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
      } else {
        setSidebarCollapsed(false);
        setSidebarWidth(
          Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next)),
        );
      }
    }
    function onUp() {
      setSidebarDragging(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarDragging]);

  function startSidebarDrag(e: React.PointerEvent) {
    e.preventDefault();
    setSidebarDragging(true);
    sidebarDragStartX.current = e.clientX;
    sidebarDragStartWidth.current = sidebarCollapsed ? 72 : sidebarWidth;
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setProfileOpen(false);
      }
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setActiveGroupHover(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        navRef.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
        setProfileOpen(false);
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
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBrandingLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const organisationDisplay =
    branding?.display_name || orgName || translate("hub.orgFallback");

  return (
    <div
      className="min-h-screen font-sans antialiased selection:bg-[var(--cc-plum-soft)] transition-colors duration-200"
      style={{
        background: "var(--cc-bg)",
        color: "var(--cc-text)",
      }}
    >
      <a href="#management-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-cc-surface focus:p-3">Skip to page content</a>
      {/* Header / Governance Bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--cc-border)] bg-[var(--cc-surface)]">
        {/* Purple accent line - carries the CareCliQ Purple identity from the
            login/signup pages (their background wash) into the MD portal, so
            arriving here after signing in doesn't feel like a different app. */}
        <div className="h-[3px] w-full" style={{ background: "#7C3AED" }} />
        <div className={`mx-auto flex h-16 items-center justify-between px-phi-4 sm:px-phi-5 ${isMD ? "w-full" : "max-w-[1600px]"}`}>
          {/* Brand & Organization Badge */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/hub"
              aria-label={`${organisationDisplay}: home`}
              title="Home"
              className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--cc-plum)]"
            >
              {!brandingLoaded ? (
                // Reserve the exact footprint so nothing shifts once the
                // branding fetch resolves - no flash of one logo swapping
                // for another a moment later.
                <div
                  className="h-9 w-9 shrink-0 rounded-lg"
                  style={{ background: "var(--cc-soft)" }}
                />
              ) : branding?.logo_url && branding.logo_url !== erroredLogoUrl ? (
                <img
                  src={branding.logo_url}
                  alt={organisationDisplay}
                  onError={() => setErroredLogoUrl(branding.logo_url ?? null)}
                  className="h-9 max-w-[80px] object-contain sm:max-w-[120px]"
                />
              ) : (
                // The full logo stacks the wordmark under the mark, which is
                // unreadable at header size: the mark on its own, with the
                // wordmark set beside it in the logo's pink and purple.
                <span className="flex items-center gap-2">
                  <img src="/carecliq-mark.png" alt="" className="h-9 w-9 shrink-0" draggable={false} />
                  <span
                    className="hidden text-[21px] font-bold leading-none tracking-tight sm:inline"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    <span style={{ color: "var(--cc-plum)" }}>Care</span>
                    <span style={{ color: "var(--cc-brand-purple)" }}>CliQ</span>
                  </span>
                </span>
              )}
              {/* With the wordmark beside the mark, the organisation name only fits next
                  to the menu from 1900px; below that it is in the account menu. */}
              <span className={`hidden h-6 w-px bg-[var(--cc-border)] lg:block ${topbarMode ? "xl:max-[1899px]:hidden" : ""}`} />
              <div className={`hidden min-w-0 lg:block ${topbarMode ? "xl:max-[1899px]:hidden" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <span className="max-w-[240px] truncate text-sm font-semibold tracking-tight" title={organisationDisplay}>
                    {organisationDisplay}
                  </span>
                  {isMD && (
                    <span
                      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--cc-brand-purple-soft)", color: "var(--cc-brand-purple)" }}
                    >
                      Governance
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </div>

          {/* Main menu in the header bar on desktop, so pages start straight
              under it instead of under a second floating row. */}
          {topbarMode && (
            <nav
              ref={navRef}
              aria-label="Managing Director workspaces"
              className="mx-5 hidden min-w-0 flex-1 items-center justify-center xl:flex"
            >
              <div
                className={`flex items-center gap-0.5 2xl:gap-1 ${prefs?.nav_color ? "rounded-full p-1" : ""}`}
                style={prefs?.nav_color ? { background: navBackground, boxShadow: "var(--cc-shadow-sm)" } : undefined}
              >
              {MD_NAV_GROUPS.map((group) => {
                const hasActiveRoute = group.items.some((item) => isNavItemActive(location, item));
                const open = activeGroupHover === group.label;
                // On the plain header the current group is a soft CareCliQ Purple
                // tint, the same as the active item in its menu: purple marks where
                // you are, pink is kept for the page's own buttons. A menu colour
                // from Settings keeps its solid active pill, which that colour
                // scheme is designed around.
                const quietActive = hasActiveRoute && !prefs?.nav_color;
                return (
                  <div key={group.label} className="relative">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={"management-group-" + group.label.replaceAll(" ", "-")}
                      onClick={() => setActiveGroupHover(open ? null : group.label)}
                      className={`flex min-h-10 md:min-h-8 items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors 2xl:gap-1.5 2xl:px-3.5 ${
                        hasActiveRoute ? "" : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"
                      }`}
                      style={{
                        // An open menu keeps its trigger lit, so it's clear which
                        // group the list below belongs to.
                        background: quietActive ? "var(--cc-brand-purple-soft)" : hasActiveRoute ? navActiveBg : open ? navHoverBg : undefined,
                        color: quietActive ? "var(--cc-brand-purple)" : hasActiveRoute ? "#FFFFFF" : open ? navTextHover : navText,
                        ["--nav-hover-bg" as string]: navHoverBg,
                        ["--nav-text-hover" as string]: navTextHover,
                      }}
                    >
                      {group.label}
                      <ChevronDown size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && (
                      <div
                        id={"management-group-" + group.label.replaceAll(" ", "-")}
                        className="absolute left-0 top-full z-50 mt-2 w-60 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150"
                      >
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const active = isNavItemActive(location, item);
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setActiveGroupHover(null)}
                                aria-current={active ? "page" : undefined}
                                className={`flex min-h-11 md:min-h-9 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                                  active
                                    ? "bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]"
                                    : "text-[var(--cc-text)] hover:bg-[var(--cc-soft)]"
                                }`}
                              >
                                <Icon size={16} className={active ? "" : "text-[var(--cc-muted)]"} />
                                <span>{item.label}</span>
                                <NavCountBadge count={NAV_BADGE_COUNTS[item.href] ?? 0} />
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </nav>
          )}

          {isMD && (
            <div className={`mx-2 min-w-0 max-w-md shrink-0 md:flex-1 md:px-2 ${topbarMode ? "xl:mx-0 xl:flex-none xl:px-0 min-[1800px]:w-56" : ""}`}>
              <ManagementPageSearch groups={MD_NAV_GROUPS} actions={MD_QUICK_ACTIONS} includePeople compactOnDesktop={topbarMode} />
            </div>
          )}

          {/* Executive Control Group. Every control here is the same 44px round
              button with an 18px icon, so they line up on one centre line. */}
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1" ref={profileRef}>
            <NotificationBell onClick={() => setNotificationsOpen(true)} />
            <NotificationRealtimeBridge />
              <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}><SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md [&>button]:hidden"><SheetHeader className="sr-only"><SheetTitle>Notifications</SheetTitle><SheetDescription>Your notifications and team alerts</SheetDescription></SheetHeader>{notificationsOpen && <NotificationInbox onClose={() => setNotificationsOpen(false)} />}</SheetContent></Sheet>

            {/* HubLayout is also shared with coordinators (e.g. /hub, /md/staff-onboarding)
                and the Calendar page itself is MD-only (App.tsx), so the button only
                shows for the role that can actually open it. */}
            {isMD && (
              <Link
                href="/md/calendar"
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                  location === "/md/calendar"
                    ? "bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]"
                    : "text-[var(--cc-muted)] hover:bg-[var(--cc-soft)] hover:text-[var(--cc-text)]"
                }`}
                aria-label="Calendar: shifts and meetings"
                aria-current={location === "/md/calendar" ? "page" : undefined}
                title="Calendar: shifts and meetings"
              >
                <CalendarDays size={18} />
              </Link>
            )}

            {/* Integrations are set up by the managing director only (Settings > Integrations).
                Hidden on phones, where the header is already full; Settings has them there. */}
            {isMD && (
              <div className="hidden sm:block">
                <IntegrationsMenu />
              </div>
            )}

            {/* Day / Night pill — both options always visible, active one highlighted. */}
            <div
              className="mx-1 hidden h-9 items-center gap-0.5 rounded-full p-0.5 xl:inline-flex"
              style={{ background: "var(--cc-soft)" }}
              role="group"
              aria-label="Theme"
            >
              {([
                { mode: "light", Icon: Sun, label: "Day theme" },
                { mode: "dark", Icon: Moon, label: "Night theme" },
              ] as const).map(({ mode, Icon, label }) => {
                const selected = (mode === "dark") === isDark;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTheme(mode)}
                    aria-pressed={selected}
                    aria-label={label}
                    title={label}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      selected
                        ? "bg-[var(--cc-surface)] text-[var(--cc-brand-purple)] shadow-sm"
                        : "text-[var(--cc-muted)] hover:text-[var(--cc-text)]"
                    }`}
                  >
                    <Icon size={16} aria-hidden />
                  </button>
                );
              })}
            </div>

            <div className="mx-1.5 hidden h-6 w-px bg-[var(--cc-border)] sm:block" />

            {/* MD User Menu */}
            <button
              type="button"
              onClick={() => setProfileOpen((prev) => !prev)}
              aria-label="Account menu"
              aria-expanded={profileOpen}
              className={`flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-[var(--cc-soft)] ${profileOpen ? "bg-[var(--cc-soft)]" : ""}`}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
                style={{ background: "#7C3AED" }}
              >
                {user?.profile_photo_url ? (
                  <img
                    src={user.profile_photo_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <span className={`hidden max-w-32 truncate text-sm font-semibold ${topbarMode ? "min-[1800px]:block" : "xl:block"}`}>
                {displayName}
              </span>
              <ChevronDown size={16} className={`text-[var(--cc-muted)] transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Profile Dropdown */}
            {profileOpen && (
              <div className="absolute right-4 top-14 w-64 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-1.5 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2 border-b border-[var(--cc-border)]">
                  <p className="text-sm font-semibold">{displayName}</p>
                  <p className="text-xs text-[var(--cc-muted)] truncate">
                    {user?.email}
                  </p>
                  {/* The header only has room for the organisation name on
                      very wide screens, so it is always here. */}
                  <p className="mt-1.5 truncate text-xs font-medium" title={organisationDisplay}>
                    {organisationDisplay}
                  </p>
                </div>
                <div className="py-1">
                  <Link
                    href="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex min-h-10 md:min-h-8 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:bg-[var(--cc-soft)] transition-colors"
                  >
                    <Settings size={15} />
                    <span>Settings</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                    className="flex min-h-10 md:min-h-8 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--cc-status-danger-bg)]"
                    style={{ color: "var(--cc-status-danger)" }}
                  >
                    <LogOut size={15} />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}

            {isMD && <ManagementNavigationDrawer groups={MD_NAV_GROUPS} location={location} isActive={href => isHrefActive(location, href)} />}

          </div>
        </div>
      </header>

      {/* Floating menu layout: the menu as its own rounded row under the header. */}
      {floatingMode && (
        <div
          className={calendarWorkspace ? "relative z-30 hidden xl:block px-3 py-2" : `sticky top-[calc(4rem+3px)] z-30 hidden xl:block py-2 px-3 pointer-events-none transition-transform duration-300 ease-out ${navAutoHidden ? "-translate-y-[calc(100%+2rem)]" : "translate-y-0"}`}
        >
          <div
            ref={navRef}
            className="pointer-events-auto mx-auto max-w-fit rounded-full border p-2"
            style={{
              borderColor: "rgba(124,58,237,0.15)",
              background: navBackground,
              boxShadow: "var(--cc-shadow-sm)",
            }}
          >
            <nav className="flex items-center gap-1.5 relative">
              {MD_NAV_GROUPS.map((group) => {
                const hasActiveRoute = group.items.some((item) =>
                  isNavItemActive(location, item),
                );

                return (
                  <div
                    key={group.label}
                    className="relative"
                  >
                    <button
                      type="button"
                      aria-expanded={activeGroupHover === group.label}
                      aria-controls={"management-group-" + group.label.replaceAll(" ", "-")}
                      onClick={() =>
                        setActiveGroupHover(
                          activeGroupHover === group.label ? null : group.label,
                        )
                      }
                      style={{
                        background: hasActiveRoute ? navActiveBg : undefined,
                        color: hasActiveRoute ? "#FFFFFF" : navText,
                        ["--nav-hover-bg" as string]: navHoverBg,
                        ["--nav-text-hover" as string]: navTextHover,
                      }}
                      className={`flex min-h-11 md:min-h-9 items-center gap-2 rounded-full px-5 py-2.5 md:py-1.5 text-sm font-semibold transition-all ${
                        hasActiveRoute
                          ? "shadow-md"
                          : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"
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
                        id={"management-group-" + group.label.replaceAll(" ", "-")}
                        className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">
                          {group.label}
                        </div>
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const active = isNavItemActive(location, item);
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setActiveGroupHover(null)}
                                aria-current={active ? "page" : undefined}
                                className={`flex min-h-11 md:min-h-9 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                                  active
                                    ? "bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]"
                                    : "text-[var(--cc-text)] hover:bg-[var(--cc-soft)]"
                                }`}
                              >
                                <Icon size={16} />
                                <span>{item.label}</span>
                                <NavCountBadge
                                  count={NAV_BADGE_COUNTS[item.href] ?? 0}
                                />
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

      {/* Bottom Bar Executive Navigation (Floating Dock — mirrors the top Command Deck) */}
      {isMD && bottombarMode && (
        <div
          className={`fixed inset-x-0 bottom-0 z-30 hidden xl:block py-4 px-6 pointer-events-none transition-transform duration-300 ease-out ${
            navAutoHidden ? "translate-y-[calc(100%+2rem)]" : "translate-y-0"
          }`}
        >
          <div
            ref={navRef}
            className="pointer-events-auto mx-auto max-w-fit rounded-full border p-2"
            style={{
              borderColor: "rgba(124,58,237,0.15)",
              background: navBackground,
              boxShadow: "var(--cc-shadow-sm)",
            }}
          >
            <nav className="flex items-center gap-1.5 relative">
              {MD_NAV_GROUPS.map((group) => {
                const hasActiveRoute = group.items.some((item) =>
                  isNavItemActive(location, item),
                );

                return (
                  <div
                    key={group.label}
                    className="relative"
                  >
                    <button
                      type="button"
                      aria-expanded={activeGroupHover === group.label}
                      aria-controls={"management-group-" + group.label.replaceAll(" ", "-")}
                      onClick={() =>
                        setActiveGroupHover(
                          activeGroupHover === group.label ? null : group.label,
                        )
                      }
                      style={{
                        background: hasActiveRoute ? navActiveBg : undefined,
                        color: hasActiveRoute ? "#FFFFFF" : navText,
                        ["--nav-hover-bg" as string]: navHoverBg,
                        ["--nav-text-hover" as string]: navTextHover,
                      }}
                      className={`flex min-h-11 md:min-h-9 items-center gap-2 rounded-full px-5 py-2.5 md:py-1.5 text-sm font-semibold transition-all ${
                        hasActiveRoute
                          ? "shadow-md"
                          : "hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-hover)]"
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
                        id={"management-group-" + group.label.replaceAll(" ", "-")}
                        className="absolute right-0 bottom-full mb-2 w-56 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">
                          {group.label}
                        </div>
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const active = isNavItemActive(location, item);
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setActiveGroupHover(null)}
                                aria-current={active ? "page" : undefined}
                                className={`flex min-h-11 md:min-h-9 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                                  active
                                    ? "bg-[var(--cc-brand-purple-soft)] text-[var(--cc-brand-purple)]"
                                    : "text-[var(--cc-text)] hover:bg-[var(--cc-soft)]"
                                }`}
                              >
                                <Icon size={16} />
                                <span>{item.label}</span>
                                <NavCountBadge
                                  count={NAV_BADGE_COUNTS[item.href] ?? 0}
                                />
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
        <div
          className={`mx-auto flex items-start ${dockedSidebar ? "gap-0" : "gap-4"} ${
            dockedSidebar ? "w-full" : `py-phi-3 ${isMD || location === "/billing" ? "w-full px-phi-4 sm:px-phi-5" : "max-w-[1600px] px-phi-4 sm:px-phi-5"}`
          }`}
        >
          {/* Docked: a deep purple rail on the left edge, like the app sidebar,
              the current page marked with a soft purple wash and a lilac bar.
              Floating: the same menu as a rounded panel on the page, the
              current page a solid purple pill. */}
          <aside
            className={`sticky hidden shrink-0 self-start xl:block ${
              dockedSidebar ? "top-[calc(4rem+3px)] h-[calc(100dvh-4rem-3px)]" : "top-[calc(4rem+15px)] rounded-2xl"
            } ${sidebarDragging ? "" : "transition-[width] duration-200"}`}
            style={{
              width: sidebarCollapsed ? 72 : sidebarWidth,
              background: sideBg,
              boxShadow: dockedSidebar ? undefined : "0 18px 40px -24px rgba(30,22,64,0.6)",
            }}
          >
            {/* Drag handle: pull to resize, or past the snap point to collapse. */}
            <div
              onPointerDown={startSidebarDrag}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="group absolute inset-y-0 -right-2 z-10 hidden w-4 cursor-col-resize items-center justify-center xl:flex"
              style={{ touchAction: "none" }}
            >
              <div
                className="h-10 w-1 rounded-full transition-opacity group-hover:opacity-100"
                style={{ background: "#A78BFA", opacity: sidebarDragging ? 1 : 0 }}
              />
            </div>

            <div className={`flex flex-col ${dockedSidebar ? "h-full" : "max-h-[calc(100dvh-6.5rem)]"}`}>
              <nav
                aria-label="Managing Director workspaces"
                className={`min-h-0 flex-1 overflow-y-auto scrollbar-none ${sidebarCollapsed ? "space-y-3 px-2 py-4" : "space-y-5 px-3 py-4"}`}
              >
                {MD_NAV_GROUPS.map((group) => {
                  const isGroupCollapsed = !!collapsedGroups[group.label];
                  return (
                    <div key={group.label}>
                      {sidebarCollapsed ? (
                        <div aria-hidden className="mx-auto mb-2 h-px w-6" style={{ background: "rgba(255,255,255,0.10)" }} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.label)}
                          aria-expanded={!isGroupCollapsed}
                          className="mb-1 flex h-7 w-full items-center justify-between gap-2 rounded-md px-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors hover:text-white"
                          style={{ color: "rgba(205,193,250,0.6)" }}
                        >
                          <span className="truncate">{group.label}</span>
                          <ChevronRight
                            size={13}
                            className={`shrink-0 transition-transform duration-200 ${isGroupCollapsed ? "" : "rotate-90"}`}
                          />
                        </button>
                      )}
                      {(sidebarCollapsed || !isGroupCollapsed) && (
                        <div className={sidebarCollapsed ? "space-y-1.5" : "space-y-0.5"}>
                          {group.items.map((item) => renderSideLink({
                            href: item.href,
                            label: item.label,
                            icon: item.icon,
                            active: isNavItemActive(location, item),
                            count: NAV_BADGE_COUNTS[item.href] ?? 0,
                          }))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>

              {/* Settings and the collapse control, at the foot of the menu. */}
              <div
                className={`shrink-0 space-y-0.5 ${sidebarCollapsed ? "px-2 py-3" : "px-3 py-3"}`}
                style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
              >
                {renderSideLink({
                  href: "/settings",
                  label: translate("common.settings"),
                  icon: Settings,
                  active: isHrefActive(location, "/settings"),
                  count: 0,
                })}
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                  title={sidebarCollapsed ? "Expand menu" : undefined}
                  className={`flex h-10 items-center rounded-lg text-[13px] font-medium transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A78BFA] ${
                    sidebarCollapsed ? "mx-auto w-10 justify-center" : "w-full gap-3 px-3"
                  }`}
                  style={{ color: "rgba(205,193,250,0.7)" }}
                >
                  {sidebarCollapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} /> : <PanelLeftClose size={18} strokeWidth={1.8} />}
                  {!sidebarCollapsed && <span>Collapse menu</span>}
                </button>
              </div>
            </div>
          </aside>

          <main id="management-main" tabIndex={-1}
            className={`min-w-0 flex-1 py-2 ${
              dockedSidebar ? "px-3 sm:px-4 xl:px-6" : "px-0"
            }`}
          >
            <PlatformBanner />
            {workspace && <WorkspaceTabs item={workspace} location={location} />}
            <PageErrorBoundary>{children}</PageErrorBoundary>
          </main>
        </div>
      ) : (
        <main id="management-main" tabIndex={-1}
          className={`mx-auto ${isMD ? "w-full px-phi-4 py-phi-4 sm:px-phi-5" : location === "/billing" ? "w-full px-phi-4 py-phi-4 sm:px-phi-5" : "max-w-[1600px] px-phi-4 py-phi-5 sm:px-phi-5 lg:px-phi-6"} ${bottombarMode ? "xl:pb-32" : ""}`}
        >
          <PlatformBanner />
            {workspace && <WorkspaceTabs item={workspace} location={location} />}
          <PageErrorBoundary>{children}</PageErrorBoundary>
        </main>
      )}

      {/* Quill, the assistant: the same one coordinators have in AppLayout. */}
      {(isMD || user?.role === "support_coordinator") && <FloatingAiAssistant />}
    </div>
  );
}
