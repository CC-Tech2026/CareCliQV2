import { Platform } from "react-native";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Rewrite loopback hosts so each platform can reach the host machine. */
function adaptApiUrlForPlatform(url: string): string {
  // 10.0.2.2 is the Android emulator alias for the host — not usable elsewhere.
  if (Platform.OS !== "android" && /:\/\/10\.0\.2\.2(?::|\/|$)/.test(url)) {
    return url.replace("://10.0.2.2", "://localhost");
  }
  // Android emulator cannot reach the host via localhost/127.0.0.1.
  if (
    Platform.OS === "android" &&
    /:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/.test(url)
  ) {
    return url.replace(/:\/\/(localhost|127\.0\.0\.1)/, "://10.0.2.2");
  }
  return url;
}

/** API base URL for mobile → backend (Docker/local or production). */
export function getMobileApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) {
    return adaptApiUrlForPlatform(stripTrailingSlash(explicit));
  }
  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (domain) {
    const host = domain.replace(/^https?:\/\//, "");
    return `https://${host}`;
  }
  // Local fallback when .env was not loaded (Expo only reads artifacts/mobile/.env)
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    if (Platform.OS === "android") {
      return "http://10.0.2.2:8000";
    }
    return "http://localhost:8000";
  }
  return "";
}
