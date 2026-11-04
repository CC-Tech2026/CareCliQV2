const { syncLanIpEnv } = require("./scripts/sync-lan-ip.cjs");

// Runs on every `expo start`/`expo export`/etc invocation, however it's launched —
// keeps EXPO_PUBLIC_API_URL pointed at this machine's current LAN IP so a
// physical device can always reach the local backend, even after switching
// Wi-Fi networks or a hotspot. app.json stays the source of truth for
// everything else; this file only adds that one side effect.
// APP_VARIANT=demo (the "demo" EAS profile) builds "CareCliQ Demo": its own
// app ID, so it installs beside the real app, pointed at the demo server and
// its Harbourside data rather than at customers' production data.
// APP_VARIANT=development (the "development" EAS profile) builds "CareCliQ Dev",
// the dev client that loads JS live from `expo start --dev-client`, beside the
// real app. Firebase only knows care.cliq2026, so it builds without
// google-services and push notifications don't arrive in it.
const DEMO_ID = "care.cliq2026.demo";
const DEV_ID = "care.cliq2026.dev";

module.exports = ({ config }) => {
  syncLanIpEnv();
  if (process.env.APP_VARIANT === "development") {
    const { googleServicesFile: _android, ...android } = config.android;
    const { googleServicesFile: _ios, ...ios } = config.ios;
    return {
      ...config,
      name: "CareCliQ Dev",
      scheme: "carecliq-dev",
      ios: { ...ios, bundleIdentifier: DEV_ID },
      android: { ...android, package: DEV_ID },
    };
  }
  if (process.env.APP_VARIANT !== "demo") return config;
  return {
    ...config,
    name: "CareCliQ Demo",
    scheme: "carecliq-demo",
    ios: { ...config.ios, bundleIdentifier: DEMO_ID },
    android: { ...config.android, package: DEMO_ID },
  };
};
