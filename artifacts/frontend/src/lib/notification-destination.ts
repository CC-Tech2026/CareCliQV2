import type { UserNotification } from "@/services/notificationService";

/** Who's looking: pages differ by role (directors can't open the coordinator
 *  roster, coordinators can't open /md pages, workers have their own). */
export type NotificationAudience = "worker" | "office" | "director";

export type NotificationDestination = { path: string; labelKey: string };

export function audienceForRole(role: string | null | undefined): NotificationAudience {
  if (role === "support_worker") return "worker";
  if (role === "managing_director") return "director";
  return "office";
}

export function pathFromActionUrl(actionUrl: string | null | undefined): string | null {
  if (!actionUrl) return null;
  try {
    const url = new URL(actionUrl, window.location.origin);
    const path = url.pathname + url.search;
    if (path.startsWith("/")) return path;
  } catch {
    /* fall through */
  }
  return null;
}

// Links the backend has used as "nowhere in particular". /worker/profile was
// the default for everyone until it 403'd office staff.
const GENERIC_PATHS = new Set(["/", "/notifications", "/dashboard"]);

const WORKER_ONLY = /^\/(my-shifts|my-compliance|worker|worker-onboarding|tasks|my-clients)(\/|\?|$)/;
const OFFICE_ONLY = /^\/(coordinator|team|patients|compliance|documents)(\/|\?|$)/;
const DIRECTOR_ONLY = /^\/(md|hub)(\/|\?|$)/;

const HIRING_EVENTS = new Set([
  "applicant_stage_stuck", "offer_letter_expired", "hire_invite_expired",
  "hire_invite_pending", "onboarding_stage_auto_inactive",
]);

function labelFor(path: string): string {
  if (/^\/(my-shifts|coordinator\/rostering|md\/schedule)/.test(path)) return "inbox.go.shift";
  if (path.startsWith("/incidents")) return "inbox.go.incident";
  if (path.startsWith("/worker/messages")) return "inbox.go.messages";
  if (path.startsWith("/my-compliance")) return "inbox.go.compliance";
  if (path.startsWith("/worker-onboarding")) return "inbox.go.credentials";
  if (/^\/(worker\/training|md\/onboarding\/training)/.test(path)) return "inbox.go.training";
  if (path.startsWith("/worker/availability")) return "inbox.go.availability";
  if (path.startsWith("/md/staff-onboarding")) return "inbox.go.hiring";
  if (/^\/(team|md\/staff)/.test(path)) return "inbox.go.staff";
  if (path.startsWith("/patients")) return "inbox.go.participants";
  if (/^\/(worker\/performance|worker\/feedback|sessions)/.test(path)) return "inbox.go.feedback";
  if (path.startsWith("/worker/profile")) return "inbox.go.profile";
  return "inbox.go.open";
}

function shiftPath(shiftId: string, audience: NotificationAudience, event: string): string {
  if (audience === "worker") {
    return event === "compliance_checkin" ? `/my-shifts/${shiftId}?checkin=pending` : `/my-shifts/${shiftId}`;
  }
  return audience === "director" ? `/md/schedule?shiftId=${shiftId}` : `/coordinator/rostering?openShift=${shiftId}`;
}

/** Point a stored link at the page this audience can actually open. */
function fitToAudience(path: string, audience: NotificationAudience): string | null {
  if (audience === "director") {
    const roster = path.match(/^\/coordinator\/rostering\?openShift=([\w-]+)/);
    if (roster) return `/md/schedule?shiftId=${roster[1]}`;
    if (/^\/team(\?|$)/.test(path)) return path.replace(/^\/team/, "/md/staff");
    if (OFFICE_ONLY.test(path) && !path.startsWith("/patients") && !path.startsWith("/compliance") && !path.startsWith("/documents")) return null;
  }
  if (audience === "office" && DIRECTOR_ONLY.test(path) && !path.startsWith("/md/staff-onboarding")) return null;
  if (audience !== "worker" && WORKER_ONLY.test(path)) return null;
  if (audience === "worker" && (OFFICE_ONLY.test(path) || DIRECTOR_ONLY.test(path))) return null;
  return path;
}

function byEvent(event: string, audience: NotificationAudience): string | null {
  if (audience === "worker") {
    if (event === "certification_expiry") return "/my-compliance";
    if (event.startsWith("training")) return "/worker/training";
    if (event === "availability_update_requested") return "/worker/availability";
    if (event === "feedback_received" || event === "shift_feedback_received") return "/worker/performance";
    if (event === "buddy_assigned" || event === "onboarding_stage_reminder") return "/worker-onboarding";
    if (event.startsWith("account")) return "/worker/profile";
    return null;
  }
  const director = audience === "director";
  if (event === "safety_alert" || event.startsWith("incident")) return "/incidents";
  if (HIRING_EVENTS.has(event)) return "/md/staff-onboarding";
  if (event === "invite_request" || event === "ndis_screening_recheck_due") return director ? "/md/staff" : "/team";
  if (event === "training_request" || event === "training_completion_review") return director ? "/md/onboarding/training" : "/team";
  if (event === "medication_alert") return "/patients";
  return null;
}

/**
 * Where tapping a notification should take this person, and what to call the
 * button. Works from the notification's shift or conversation first, then the
 * stored link (adjusted for role), then its type. null: nothing to open.
 */
export function notificationDestination(
  notification: Pick<UserNotification, "event_type" | "action_url" | "shift_id" | "conversation_id">,
  audience: NotificationAudience,
): NotificationDestination | null {
  const event = notification.event_type ?? "";
  const stored = pathFromActionUrl(notification.action_url);
  let path: string | null = null;

  // An incident link beats the shift: the report is what needs reading.
  if (stored?.startsWith("/incidents/")) path = stored;
  else if (notification.shift_id) path = shiftPath(notification.shift_id, audience, event);
  else if (notification.conversation_id && audience === "worker") path = `/worker/messages?conversation=${notification.conversation_id}`;
  else if (stored && !GENERIC_PATHS.has(stored.split("?")[0])) path = fitToAudience(stored, audience);

  path = path ?? byEvent(event, audience);
  return path ? { path, labelKey: labelFor(path) } : null;
}
