import { Check, Circle } from "lucide-react";

/** The password rules the server enforces (backend/app/services/password_policy.py).
 * Shown as the person types, so nobody finds out at the last step. */
export const PASSWORD_RULES: { label: string; test: (password: string) => boolean }[] = [
  { label: "At least 10 characters", test: (p) => p.length >= 10 },
  { label: "A capital letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
];

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}

/** Rules the password doesn't meet yet, in lower case for a sentence. */
export function missingPasswordRules(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label.toLowerCase());
}

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Password rules">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.label}
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: met ? "var(--cc-text)" : "var(--cc-muted)" }}
          >
            {met ? (
              <Check size={13} aria-hidden="true" style={{ color: "var(--cc-status-success)" }} />
            ) : (
              <Circle size={11} aria-hidden="true" />
            )}
            <span>
              {rule.label}
              <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
