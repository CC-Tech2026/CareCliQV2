export function safeMaterialUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// The API returns newest first. Keep the first record, not an older attempt.
export function latestTrainingHistory(history: Array<Record<string, unknown>>) {
  const records = new Map<string, Record<string, unknown>>();
  for (const record of history) {
    const key = String(record.module_id);
    if (!records.has(key)) records.set(key, record);
  }
  return records;
}
