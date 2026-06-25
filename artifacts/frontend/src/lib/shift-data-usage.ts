const PREFIX = "ccq_shift_data_usage_";

function key(shiftId: string) {
  return `${PREFIX}${shiftId}`;
}

export function getShiftDataUsageBytes(shiftId: string | null | undefined): number {
  if (!shiftId) return 0;
  try {
    const raw = sessionStorage.getItem(key(shiftId));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export function addShiftDataUsage(shiftId: string | null | undefined, bytes: number) {
  if (!shiftId || !Number.isFinite(bytes) || bytes <= 0) return;
  const next = getShiftDataUsageBytes(shiftId) + bytes;
  try {
    sessionStorage.setItem(key(shiftId), String(next));
    window.dispatchEvent(new CustomEvent("shift-data-usage-updated", { detail: { shiftId, bytes: next } }));
  } catch {
    /* noop */
  }
}

export function resetShiftDataUsage(shiftId: string | null | undefined) {
  if (!shiftId) return;
  try {
    sessionStorage.removeItem(key(shiftId));
    window.dispatchEvent(new CustomEvent("shift-data-usage-updated", { detail: { shiftId, bytes: 0 } }));
  } catch {
    /* noop */
  }
}
