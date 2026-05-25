// src/lib/roles.ts

// -----------------------------
// 1. Canonical roles (SOURCE OF TRUTH)
// -----------------------------
export const USER_ROLES = {
  SUPPORT_WORKER: "support_worker",
  SUPPORT_COORDINATOR: "support_coordinator",
  ALLIED_HEALTH: "allied_health",
  ADMIN: "admin",
  AUDITOR: "auditor",
} as const;

export type UserRole =
  (typeof USER_ROLES)[keyof typeof USER_ROLES];

// -----------------------------
// 2. Role aliases (backend + legacy safe mapping)
// -----------------------------
const ROLE_ALIASES: Record<string, UserRole> = {
  // support worker
  worker: USER_ROLES.SUPPORT_WORKER,
  support_worker: USER_ROLES.SUPPORT_WORKER,

  // coordinator
  coordinator: USER_ROLES.SUPPORT_COORDINATOR,
  support_coordinator: USER_ROLES.SUPPORT_COORDINATOR,

  // allied health
  ot: USER_ROLES.ALLIED_HEALTH,
  allied_health: USER_ROLES.ALLIED_HEALTH,
  allied_health_pro: USER_ROLES.ALLIED_HEALTH,
  pro: USER_ROLES.ALLIED_HEALTH,

  // admin
  admin: USER_ROLES.ADMIN,

  // auditor
  auditor: USER_ROLES.AUDITOR,
};

// -----------------------------
// 3. SAFE NORMALIZER (NEVER CRASHES)
// -----------------------------
export function normalizeUserRole(
  role?: string | null
): UserRole {
  if (!role) return USER_ROLES.SUPPORT_WORKER;

  const cleaned = role.trim().toLowerCase();

  return (
    ROLE_ALIASES[cleaned] ?? USER_ROLES.SUPPORT_WORKER
  );
}

// -----------------------------
// 4. LABELS (STRICT + SAFE)
// -----------------------------
export const ROLE_LABELS: Record<UserRole, string> = {
  support_worker: "Support Worker",
  support_coordinator: "Support Coordinator",
  allied_health: "Allied Health Professional",
  admin: "Administrator",
  auditor: "Auditor",
};

// -----------------------------
// 5. TYPE GUARD (FIXED)
// -----------------------------
export function isValidRole(role: string): role is UserRole {
  const normalized = normalizeUserRole(role);
  return Object.values(USER_ROLES).includes(normalized);
}