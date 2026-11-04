const { syncLanIpEnv } = require("./scripts/sync-lan-ip.cjs");

// Runs on every `expo start`/`expo export`/etc invocation, however it's launched —
// keeps EXPO_PUBLIC_API_URL pointed at this machine's current LAN IP so a
// physical device can always reach the local backend, even after switching
// Wi-Fi networks or a hotspot. app.json stays the source of truth for
// everything else; this file only adds that one side effect.
// APP_VARIANT=demo (the "demo" EAS profile) builds "CareCliQ Demo": its own
// app ID, so it installs beside the real app, pointed at the demo server and
// its Harbourside data rather than at customers' production data.
const DEMO_ID = "care.cliq2026.demo";

module.exports = ({ config }) => {
  syncLanIpEnv();
  if (process.env.APP_VARIANT !== "demo") return config;
  return {
    ...config,
    name: "CareCliQ Demo",
    scheme: "carecliq-demo",
    ios: { ...config.ios, bundleIdentifier: DEMO_ID },
    android: { ...config.android, package: DEMO_ID },
  };
};
