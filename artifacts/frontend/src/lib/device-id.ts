const DEVICE_ID_KEY = "ccq_device_id";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = randomId();
    localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return randomId();
  }
}
