export function isEmailLike(value: string): boolean {
  return value.includes("@");
}

export function validateLoginIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter your email or mobile number";
  if (isEmailLike(trimmed)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return "Enter a valid email address";
    }
    return null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) {
    return "Enter a valid mobile number";
  }
  return null;
}
