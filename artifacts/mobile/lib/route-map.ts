/**
 * Maps frontend web paths from API action_url fields to Expo Router paths.
 */
export function mapWebPathToMobile(path?: string | null): string | null {
  if (!path) return null;
  const url = path.replace(/^https?:\/\/[^/]+/, "");
  const shiftMatch = url.match(/\/my-shifts\/([^/?]+)/);
  if (shiftMatch?.[1]) return `/shift/${shiftMatch[1]}`;
  if (url.startsWith("/my-clients/")) {
    const id = url.split("/")[2];
    if (id) return `/client/${id}`;
  }
  if (url.includes("/my-clients")) return "/(tabs)/participants";
  if (url.includes("/my-shifts")) return "/(tabs)/shifts";
  if (url.includes("/my-compliance") || url.includes("/compliance")) return "/(tabs)/compliance";
  if (url.includes("/credentials")) return "/credentials";
  if (url.includes("/incidents")) return "/incidents";
  if (url.includes("/toolkit")) return "/toolkit";
  if (url.includes("/settings")) return "/(tabs)/settings";
  return null;
}
