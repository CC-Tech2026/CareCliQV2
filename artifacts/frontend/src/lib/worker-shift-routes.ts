/** Worker shift detail routes (not the list or requests inbox). */
export function isWorkerMobileShiftDetailPath(pathname: string): boolean {
  const match = pathname.match(/^\/my-shifts\/([^/]+)(?:\/(.*))?$/);
  if (!match) return false;
  const segment = match[1];
  if (segment === "requests") return false;
  return true;
}
