const { syncLanIpEnv } = require("./scripts/sync-lan-ip.cjs");

// Runs on every `expo start`/`expo export`/etc invocation, however it's launched —
// keeps EXPO_PUBLIC_API_URL pointed at this machine's current LAN IP so a
// physical device can always reach the local backend, even after switching
// Wi-Fi networks or a hotspot. app.json stays the source of truth for
// everything else; this file only adds that one side effect.
module.exports = ({ config }) => {
  syncLanIpEnv();
  return config;
};
