const fs = require("fs");
const os = require("os");
const path = require("path");

const ENV_PATH = path.resolve(__dirname, "..", ".env");
const ENV_VAR = "EXPO_PUBLIC_API_URL";

// Adapter names that are never the real network you're on — VMs, WSL,
// VPNs, container bridges. Windows sometimes still names a virtual
// adapter plainly ("Ethernet 2" for VirtualBox host-only, etc.), so this
// is combined with the known-virtual-subnet check below rather than relied on alone.
const VIRTUAL_NAME_RE =
  /vethernet|virtualbox|vmware|hyper-v|docker|wsl|tailscale|zerotier|\btap\b|npcap|loopback/i;

// Default subnets those virtual adapters commonly sit on, when the name alone doesn't give it away.
const VIRTUAL_SUBNET_RE = /^192\.168\.56\.|^192\.168\.99\.|^10\.0\.75\./;

const PRIVATE_IPV4_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

/** Best-guess LAN IPv4 for this machine — prefers a real Wi-Fi/Ethernet adapter over VM/WSL/VPN bridges. */
function detectLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      let score = 0;
      if (VIRTUAL_NAME_RE.test(name)) score -= 1000;
      if (VIRTUAL_SUBNET_RE.test(addr.address)) score -= 500;
      if (/wi-?fi|wlan/i.test(name)) score += 100;
      if (/^ethernet$/i.test(name.trim())) score += 50;
      candidates.push({ name, address: addr.address, score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
}

/**
 * Rewrites EXPO_PUBLIC_API_URL's host in .env to the machine's current LAN IP,
 * but only when it's already pointing at a private-LAN address — a deliberately
 * set live/production URL, or localhost/10.0.2.2 (Android emulator), is left alone.
 * Also updates process.env directly so the *current* process picks it up immediately,
 * not just the next run.
 */
function syncLanIpEnv({ log = console.log } = {}) {
  // Never touch env in a cloud build — no meaningful "device LAN" there, and a
  // wrong guess would get baked into the production bundle.
  if (process.env.EAS_BUILD || process.env.CI) return;

  let content;
  try {
    content = fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    return; // no .env — nothing to sync
  }

  const lineRe = new RegExp(`^${ENV_VAR}=(.*)$`, "m");
  const match = content.match(lineRe);
  if (!match) return;

  const currentUrl = match[1].trim();
  let parsed;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return;
  }

  if (!PRIVATE_IPV4_RE.test(parsed.hostname)) return; // live URL / not a LAN address — leave it
  if (parsed.hostname === "10.0.2.2") return; // Android emulator alias, not a real host IP

  const lanIp = detectLanIp();
  if (!lanIp || lanIp === parsed.hostname) return;

  const updatedUrl = currentUrl.replace(parsed.hostname, lanIp);
  const updatedContent = content.replace(lineRe, `${ENV_VAR}=${updatedUrl}`);

  try {
    fs.writeFileSync(ENV_PATH, updatedContent);
  } catch (err) {
    log(`[lan-ip-sync] could not write .env: ${err.message}`);
    return;
  }

  process.env[ENV_VAR] = updatedUrl;
  log(`[lan-ip-sync] ${ENV_VAR} host ${parsed.hostname} -> ${lanIp}`);
}

module.exports = { detectLanIp, syncLanIpEnv };
