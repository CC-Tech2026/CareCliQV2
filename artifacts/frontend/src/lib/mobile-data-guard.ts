const CONSENT_KEY = "ccq_mobile_upload_consent";
const WIFI_ONLY = "wifi_only";
const ALLOW = "allow";

export type MobileUploadConsent = typeof WIFI_ONLY | typeof ALLOW;

export function isLikelyMobileData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
  if (!conn) return false;
  if (conn.type === "cellular") return true;
  return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g" || conn.effectiveType === "3g";
}

export function getMobileUploadConsent(): MobileUploadConsent | null {
  try {
    const raw = sessionStorage.getItem(CONSENT_KEY);
    if (raw === WIFI_ONLY || raw === ALLOW) return raw;
    return null;
  } catch {
    return null;
  }
}

export function setMobileUploadConsent(consent: MobileUploadConsent) {
  try {
    sessionStorage.setItem(CONSENT_KEY, consent);
  } catch {
    /* noop */
  }
}

export function clearMobileUploadConsent() {
  try {
    sessionStorage.removeItem(CONSENT_KEY);
  } catch {
    /* noop */
  }
}

/** Returns true if upload may proceed; false if deferred for Wi-Fi. */
export async function checkMobileDataUpload(
  totalBytes: number,
  prompt: (sizeLabel: string) => Promise<"upload" | "wifi">,
): Promise<boolean> {
  if (totalBytes < 10 * 1024 * 1024) return true;
  if (!isLikelyMobileData()) return true;

  const existing = getMobileUploadConsent();
  if (existing === ALLOW) return true;
  if (existing === WIFI_ONLY) return false;

  const choice = await prompt(formatUploadSize(totalBytes));
  if (choice === "upload") {
    setMobileUploadConsent(ALLOW);
    return true;
  }
  setMobileUploadConsent(WIFI_ONLY);
  return false;
}

function formatUploadSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
