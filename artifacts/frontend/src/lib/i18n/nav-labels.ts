import {
  WORKER_BOTTOM_NAV_KEYS,
  WORKER_GROUP_KEYS,
  WORKER_NAV_KEYS,
} from "@/lib/i18n/translations";

const SHARED_NAV_KEYS: Record<string, string> = {
  "/team": "nav.team",
  "/patients": "nav.participants",
  "/sessions": "nav.sessions",
  "/compliance": "nav.complianceCentre",
  "/audit-pack": "nav.auditPack",
  "/incidents": "nav.incidents",
  "/coordinator/rostering": "nav.rostering",
  "/coordinator/travel": "nav.travel",
  "/coordinator/live": "nav.liveMonitoring",
  "/billing": "nav.invoices",
  "/credentials": "nav.credentials",
  "/toolkit": "nav.toolkit",
  "/accessibility": "nav.accessibility",
  "/hub": "nav.hub",
  "/md/executive": "nav.executive",
  "/md/staff": "nav.staff",
  "/md/compliance": "nav.complianceCentre",
  "/md/financial": "nav.financial",
  "/md/onboarding": "nav.onboarding",
  "/reports": "nav.reports",
  "/settings": "nav.settings",
  "/worker/messages": "nav.messages",
  "/worker/notifications": "nav.notifications",
};

const ALL_NAV_KEYS: Record<string, string> = {
  ...WORKER_NAV_KEYS,
  ...SHARED_NAV_KEYS,
};

/** Worker nav href → i18n key (longest prefix match for nested routes). */
export function navLabelKeyForHref(href: string): string | undefined {
  if (ALL_NAV_KEYS[href]) return ALL_NAV_KEYS[href];
  const match = Object.keys(ALL_NAV_KEYS)
    .filter((path) => href.startsWith(path + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ALL_NAV_KEYS[match] : undefined;
}

export function navLabelForHref(
  href: string,
  fallback: string,
  translate: (key: string) => string,
): string {
  const key = navLabelKeyForHref(href);
  return key ? translate(key) : fallback;
}

export function bottomNavLabelForHref(
  href: string,
  fallback: string,
  translate: (key: string) => string,
): string {
  const key = WORKER_BOTTOM_NAV_KEYS[href];
  return key ? translate(key) : navLabelForHref(href, fallback, translate);
}

const ALL_GROUP_KEYS: Record<string, string> = {
  ...WORKER_GROUP_KEYS,
  "People & Care": "nav.group.peopleCare",
  "Quality & Safety": "nav.group.qualitySafety",
  Operations: "nav.group.operations",
  Clinical: "nav.group.clinical",
  Quality: "nav.group.quality",
  Admin: "nav.group.admin",
  "MD Workspaces": "nav.group.mdWorkspaces",
};

export function groupLabelForName(
  group: string | undefined,
  translate: (key: string) => string,
): string {
  if (!group) return "";
  const key = ALL_GROUP_KEYS[group];
  return key ? translate(key) : group;
}

/** Route prefix → i18n key for mobile/desktop page title. */
const ROUTE_LABEL_KEYS: [string, string][] = [
  ["/coordinator/rostering", "nav.rostering"],
  ["/coordinator/live", "nav.liveMonitoring"],
  ["/session-new", "nav.newShift"],
  ["/session/", "nav.shiftDetail"],
  ["/sessions", "nav.sessions"],
  ["/audit-pack", "nav.auditPack"],
  ["/incident-new", "nav.newIncident"],
  ["/incident/", "nav.incidentDetail"],
  ["/incidents", "nav.incidents"],
  ["/compliance", "nav.complianceCentre"],
  ["/my-compliance", "nav.compliance"],
  ["/my-shifts", "nav.shifts"],
  ["/calendar", "nav.schedule"],
  ["/my-clients", "nav.clients"],
  ["/participants", "nav.participants"],
  ["/patients", "nav.participants"],
  ["/participant-new", "nav.newParticipant"],
  ["/participant-edit", "nav.editParticipant"],
  ["/credentials", "nav.credentials"],
  ["/billing", "nav.invoices"],
  ["/toolkit", "nav.toolkit"],
  ["/team", "nav.team"],
  ["/tasks", "nav.tasks"],
  ["/reports", "nav.reports"],
  ["/settings", "nav.settings"],
  ["/worker/profile", "nav.profile"],
  ["/worker/security", "nav.security"],
  ["/worker/messages", "nav.messages"],
  ["/worker/notifications", "nav.notifications"],
  ["/hub", "nav.hub"],
  ["/md/executive", "nav.executive"],
  ["/md/staff", "nav.staff"],
  ["/md/compliance", "nav.complianceCentre"],
  ["/md/financial", "nav.financial"],
  ["/md/onboarding", "nav.onboarding"],
  ["/dashboard", "nav.dashboard"],
  ["/worker/shift-history", "nav.shiftHistory"],
  ["/worker/travel", "nav.travel"],
  ["/worker/performance", "nav.performance"],
  ["/worker/training", "nav.training"],
  ["/worker/help", "nav.help"],
  ["/accessibility", "nav.accessibility"],
  ["/worker/accessibility", "nav.accessibility"],
  ["/worker/availability", "nav.availability"],
  ["/worker/sync-status", "sync.page.eyebrow"],
];

export function pageLabelForPath(
  location: string,
  translate: (key: string) => string,
): string {
  if (location.includes("/message-office")) {
    return translate("shift.during.messageOffice");
  }
  for (const [prefix, key] of ROUTE_LABEL_KEYS) {
    if (location === prefix || location.startsWith(prefix + "/")) {
      return translate(key);
    }
  }
  return "";
}
