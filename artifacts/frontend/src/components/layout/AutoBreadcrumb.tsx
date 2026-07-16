/**
 * AutoBreadcrumb — auto-generated route breadcrumbs for level-2+ pages.
 *
 * Reads useLocation() and produces crumbs automatically from the URL, so no
 * individual page needs to configure anything. Only appears on pages that are
 * deeper than the top-level nav items (e.g. /sessions/abc, /incidents/new).
 *
 * Special case: if the URL contains ?from=participant the crumb uses
 * history.back() so the user is returned to the exact participant they were
 * viewing (with their selected tab and state intact), not the generic list.
 *
 * Coordinator-only paths are handled; worker-only detail paths are intentionally
 * excluded since that workspace is managed separately.
 */
import { Link, useLocation } from "wouter";
import { ChevronRight, Home, ArrowLeft } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { pageLabelForPath } from "@/lib/i18n/nav-labels";

// ── Parent-section map ────────────────────────────────────────────────────────
// Maps a path prefix → { href, labelKey } for the crumb that sits above it.
const PARENT_MAP: Array<{ prefix: string; parentHref: string; parentKey: string }> = [
  // Session detail/workflow pages — contextually live under Participants
  { prefix: "/session-new",            parentHref: "/patients",               parentKey: "nav.participants"      },
  { prefix: "/session-review",         parentHref: "/patients",               parentKey: "nav.participants"      },
  { prefix: "/sessions/",              parentHref: "/patients",               parentKey: "nav.participants"      },

  // Quality & Compliance children
  { prefix: "/incident-new",           parentHref: "/incidents",            parentKey: "nav.incidentManagement" },
  { prefix: "/incidents/",             parentHref: "/incidents",            parentKey: "nav.incidentManagement" },
  { prefix: "/audit-pack",             parentHref: "/compliance",             parentKey: "nav.qualityCompliance" },

  // Participants children
  { prefix: "/participant-new",        parentHref: "/patients",               parentKey: "nav.participants"      },
  { prefix: "/participant-edit",       parentHref: "/patients",               parentKey: "nav.participants"      },
  { prefix: "/patients/",              parentHref: "/patients",               parentKey: "nav.participants"      },
  { prefix: "/participants/",          parentHref: "/patients",               parentKey: "nav.participants"      },

  // Schedule children (coordinator)
  { prefix: "/coordinator/live",       parentHref: "/coordinator/rostering",  parentKey: "nav.schedule"          },
  { prefix: "/coordinator/monitor",    parentHref: "/coordinator/rostering",  parentKey: "nav.schedule"          },
  { prefix: "/coordinator/shift-verification", parentHref: "/coordinator/rostering", parentKey: "nav.schedule"  },
  { prefix: "/coordinator/travel",     parentHref: "/coordinator/rostering",  parentKey: "nav.schedule"          },
  { prefix: "/approvals",              parentHref: "/coordinator/rostering",  parentKey: "nav.schedule"          },

  // Team children
  { prefix: "/credentials",            parentHref: "/team",                   parentKey: "nav.team"              },

  // Reports children
  { prefix: "/reports/",               parentHref: "/reports",                parentKey: "nav.reports"           },

  // Settings children
  { prefix: "/settings/",              parentHref: "/settings",               parentKey: "nav.settings"          },

  // MD hub children
  { prefix: "/md/",                    parentHref: "/hub",                    parentKey: "nav.hub"               },
  { prefix: "/hub/",                   parentHref: "/hub",                    parentKey: "nav.hub"               },
];

// ── Worker-only paths — excluded from breadcrumbs ─────────────────────────────
const WORKER_PREFIXES = [
  "/my-shifts/",
  "/my-clients/",
  "/worker/",
  "/my-shift-",
  "/my-compliance",
];

// ── Level-1 paths — no breadcrumb needed ─────────────────────────────────────
const TOP_LEVEL_PATHS = [
  "/dashboard", "/team", "/patients", "/participants",
  "/sessions", "/compliance", "/incidents", "/billing",
  "/reports", "/settings", "/toolkit", "/credentials",
  "/coordinator/rostering", "/hub", "/accessibility",
  "/login", "/signup", "/forgot-password", "/reset-password",
  "/verify-email", "/accept-invite", "/account-secure", "/profile-completion",
  "/my-shifts", "/my-clients", "/my-compliance",
];

function isTopLevel(location: string): boolean {
  return TOP_LEVEL_PATHS.some(
    (p) => location === p || location === p + "/",
  );
}

function isWorkerPath(location: string): boolean {
  return WORKER_PREFIXES.some((p) => location.startsWith(p));
}

interface Crumb {
  label: string;
  href?: string;
}

export function AutoBreadcrumb() {
  const [fullLocation] = useLocation();
  const { translate } = useAccessibility();

  // Separate path from query string
  const [location, search] = fullLocation.split("?");
  const params = new URLSearchParams(search ?? "");
  const fromParticipant = params.get("from") === "participant";

  // Special case: came from a specific participant's shift history.
  // Use history.back() so the exact participant + tab state is restored.
  if (fromParticipant) {
    const participantName = params.get("name") ?? "";
    const currentLabel = pageLabelForPath(location, translate);
    return (
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-[12px] font-medium mb-4 flex-wrap"
        style={{ color: "var(--cc-muted)" }}
      >
        <Link href="/dashboard">
          <span className="flex items-center gap-1 hover:opacity-75 transition-opacity cursor-pointer" style={{ color: "var(--cc-muted)" }}>
            <Home size={12} strokeWidth={2} />
          </span>
        </Link>
        <ChevronRight size={12} strokeWidth={2} style={{ color: "var(--cc-border)" }} />
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex items-center gap-1 hover:opacity-75 transition-opacity"
          style={{ color: "var(--cc-muted)" }}
        >
          <ArrowLeft size={11} strokeWidth={2} />
          {participantName || translate("nav.participants")}
        </button>
        <ChevronRight size={12} strokeWidth={2} style={{ color: "var(--cc-border)" }} />
        <span className="font-semibold" style={{ color: "var(--cc-text)" }} aria-current="page">
          {currentLabel || "Session Detail"}
        </span>
      </nav>
    );
  }

  // Skip on top-level pages and worker-specific paths
  if (isTopLevel(location) || isWorkerPath(location)) return null;

  // Find parent section
  const parentEntry = PARENT_MAP.find((entry) =>
    location.startsWith(entry.prefix),
  );

  if (!parentEntry) return null;

  // Build crumb list
  const crumbs: Crumb[] = [];

  // Parent section crumb (always a link)
  crumbs.push({
    label: translate(parentEntry.parentKey),
    href: parentEntry.parentHref,
  });

  // Current page crumb (no link — you're already here)
  const currentLabel = pageLabelForPath(location, translate);
  crumbs.push({
    label: currentLabel || location.split("/").filter(Boolean).pop() || "Page",
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-[12px] font-medium mb-4 flex-wrap"
      style={{ color: "var(--cc-muted)" }}
    >
      <Link href="/dashboard">
        <span
          className="flex items-center gap-1 hover:opacity-75 transition-opacity cursor-pointer"
          style={{ color: "var(--cc-muted)" }}
        >
          <Home size={12} strokeWidth={2} />
        </span>
      </Link>

      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={12} strokeWidth={2} style={{ color: "var(--cc-border)" }} />
          {crumb.href ? (
            <Link href={crumb.href}>
              <span
                className="hover:opacity-75 transition-opacity cursor-pointer"
                style={{ color: "var(--cc-muted)" }}
              >
                {crumb.label}
              </span>
            </Link>
          ) : (
            <span
              className="font-semibold"
              style={{ color: "var(--cc-text)" }}
              aria-current="page"
            >
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
