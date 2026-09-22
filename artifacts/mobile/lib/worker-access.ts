export const WORKER_APP_ACCESS_MESSAGE = "This app is for support workers. Coordinators and managing directors should sign in through the CareCliQ web portal.";
export function isSupportWorker(user: { role?: string } | null | undefined): boolean {
  return user?.role === "support_worker";
}
export function requireSupportWorker(user: { role?: string } | null | undefined): void {
  if (!isSupportWorker(user)) throw new Error(WORKER_APP_ACCESS_MESSAGE);
}
