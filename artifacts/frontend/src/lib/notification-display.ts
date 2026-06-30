import type { UserNotification } from "@/services/notificationService";

export const MOBILE_MAX_WIDTH = 767;

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= MOBILE_MAX_WIDTH;
}

/** Sticky banner stack is desktop-only; mobile uses toast alerts instead. */
export function shouldShowStickyBannerStack(): boolean {
  return !isMobileViewport();
}

/**
 * Worker notification display rules (CARECLIQV2-261 / 262 / 263).
 *
 * A — ticket strict
 *   | Event              | In-app UI                                      |
 *   |--------------------|------------------------------------------------|
 *   | Shift cancel       | Red sticky banner until dismissed              |
 *   | Shift change       | Orange sticky banner; must tap Acknowledged    |
 *   | Shift reminders    | Push only (T-60 / T-30) — no in-app banner     |
 *   | Overdue task (263) | Red sticky banner                              |
 *   | Message (262)      | Push + yellow in-thread banner when action req |
 *   | Other alerts       | Toast when tab is active (not banner events)   |
 *   | Any (background)   | Desktop OS notification when tab is hidden     |
 *
 * B — view = dismiss
 *   - Cancel and other non-ack banners (e.g. overdue): View details hides immediately in UI;
 *     backend dismiss runs in background for persistence
 *   - Change banners (requires_ack): View details navigates only; Acknowledged still required
 */

/** Ticket-spec sticky banners (261 cancel/change, 263 overdue). */
export function isBannerNotification(notification: UserNotification): boolean {
  return Boolean(notification.banner_style);
}

export function isActiveBanner(notification: UserNotification): boolean {
  if (notification.dismissed_at) return false;
  if (!notification.banner_style) return false;
  if (notification.requires_ack && notification.acknowledged_at) return false;
  return true;
}

/** B — view = dismiss: non-ack banners clear when worker taps View details. */
export function shouldDismissBannerOnView(notification: UserNotification): boolean {
  return isBannerNotification(notification) && !notification.requires_ack;
}

/** Toast only for reminders, messages, and general in-app alerts (not banner events). */
export function shouldShowToast(notification: UserNotification): boolean {
  return !isBannerNotification(notification);
}

export function shouldShowDesktopNotification(notification: UserNotification): boolean {
  if (notification.dismissed_at) return false;
  // Slack-style: OS notification when tab is in the background.
  return document.hidden;
}
