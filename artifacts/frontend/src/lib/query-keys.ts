/** Query keys shared by more than one screen. useOrgQuery prefixes these with
 * the orgId, so invalidate with `[orgId, ...KEY]`. Keeping them in one place
 * means a save on one screen refreshes every other screen showing the data. */

/** GET /api/dashboard/managing-director (MD hub, executive and staff pages).
 * Queries append a branch id or "all"; invalidating this prefix covers them all. */
export const MD_DASHBOARD_KEY = ["md", "dashboard"] as const;

/** getCoordinatorWorkerStats — team, rostering and MD staff pages. */
export const WORKER_STATS_KEY = ["coordinator", "worker-stats"] as const;

/** GET /api/dashboard/compliance-trend (MD hub and executive pages). */
export const COMPLIANCE_TREND_KEY = ["md", "compliance-trend"] as const;
