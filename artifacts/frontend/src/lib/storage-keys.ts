/** CareCliQ browser storage keys and app events (replaces legacy carescribe_*). */

export const CCQ_TOKEN_KEY = "ccq_token";
export const CCQ_USER_KEY = "ccq_user";
export const CCQ_SUPABASE_SESSION_KEY = "ccq_supabase_session";
export const CCQ_REAUTH_TOKEN_KEY = "ccq_reauth_token";
export const CCQ_REAUTH_UNTIL_KEY = "ccq_reauth_until";
export const CCQ_REMEMBER_DEVICE_KEY = "ccq_remember_device";
export const CCQ_DESKTOP_NOTIFICATIONS_KEY = "ccq_desktop_notifications";
export const CCQ_UNAUTHORIZED_EVENT = "carecliq:unauthorized";

export function ccqOnboardingKey(userId: string): string {
  return `ccq_onboarding_${userId}`;
}

const LEGACY_KEY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["carescribe_token", CCQ_TOKEN_KEY],
  ["carescribe_user", CCQ_USER_KEY],
  ["carescribe_supabase_session", CCQ_SUPABASE_SESSION_KEY],
  ["carescribe_reauth_token", CCQ_REAUTH_TOKEN_KEY],
  ["carescribe_reauth_until", CCQ_REAUTH_UNTIL_KEY],
  ["carescribe_remember_device", CCQ_REMEMBER_DEVICE_KEY],
  ["carescribe_desktop_notifications", CCQ_DESKTOP_NOTIFICATIONS_KEY],
];

/** One-time migration from carescribe_* keys so existing sessions keep working. */
export function migrateLegacyCareScribeStorageKeys(): void {
  if (typeof window === "undefined") return;
  for (const store of [localStorage, sessionStorage]) {
    for (const [legacy, next] of LEGACY_KEY_PAIRS) {
      try {
        const value = store.getItem(legacy);
        if (value !== null && store.getItem(next) === null) {
          store.setItem(next, value);
        }
        store.removeItem(legacy);
      } catch {
        /* noop */
      }
    }
    try {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (key?.startsWith("carescribe_onboarding_")) {
          const suffix = key.slice("carescribe_onboarding_".length);
          const next = ccqOnboardingKey(suffix);
          const value = store.getItem(key);
          if (value !== null && store.getItem(next) === null) {
            store.setItem(next, value);
          }
          store.removeItem(key);
        }
      }
    } catch {
      /* noop */
    }
  }
}
