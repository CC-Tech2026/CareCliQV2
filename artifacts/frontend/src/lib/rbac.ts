export const ROLES = {
  admin: "admin",
  supportCoordinator: "support_coordinator",
  supportWorker: "support_worker",
  alliedHealth: "allied_health",
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES = [
  ROLES.admin,
  ROLES.supportCoordinator,
  ROLES.supportWorker,
  ROLES.alliedHealth,
] as const satisfies readonly UserRole[];

export const COORDINATOR_ROLES = [
  ROLES.admin,
  ROLES.supportCoordinator,
] as const satisfies readonly UserRole[];

export const COORDINATOR_AND_ALLIED = [
  ROLES.admin,
  ROLES.supportCoordinator,
  ROLES.alliedHealth,
] as const satisfies readonly UserRole[];

export function isKnownRole(role: unknown): role is UserRole {
  return typeof role === "string" && (ALL_ROLES as readonly string[]).includes(role);
}

export function normalizeRole(role: unknown): UserRole {
  return isKnownRole(role) ? role : ROLES.supportWorker;
}

export function canManageTeam(role: UserRole | undefined) {
  return !!role && (COORDINATOR_ROLES as readonly string[]).includes(role);
}
