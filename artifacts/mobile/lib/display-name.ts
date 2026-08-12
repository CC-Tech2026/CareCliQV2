/** Prefer real names; skip email-like placeholders used as full_name. */
export function isEmailLike(value: string): boolean {
  return value.includes("@");
}

export function resolveWorkerDisplayName(options: {
  landingFullName?: string | null;
  landingFirstName?: string | null;
  authFullName?: string | null;
  fallback?: string;
}): string {
  const candidates = [
    options.landingFullName,
    options.authFullName,
    options.landingFirstName,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && !isEmailLike(value)) return value;
  }
  return options.fallback ?? "Worker";
}
