#!/usr/bin/env node
/**
 * Docker-friendly Expo start:
 * - No TTY / no login prompt (compose logs are non-interactive)
 * - Auto "Proceed anonymously" via expo-docker-preload.cjs
 * - Prints Expo Go QR + exp:// URL once the tunnel is ready
 * - Keeps hot reload (does not set CI=1)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const port = String(process.env.PORT || "8081");
const preloadPath = path.join(__dirname, "expo-docker-preload.cjs");

function loadQrcode() {
  try {
    return require("qrcode-terminal");
  } catch {
    try {
      const expoCliPkg = require.resolve("@expo/cli/package.json");
      return require(
        require.resolve("qrcode-terminal", { paths: [path.dirname(expoCliPkg)] }),
      );
    } catch {
      return null;
    }
  }
}

const qrcode = loadQrcode();

function toExpUrl(tunnelUrl) {
  const u = new URL(tunnelUrl);
  const hostPort = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  return `exp://${hostPort}`;
}

function guessTunnelUrlFromSettings() {
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(projectRoot, ".expo", "settings.json"), "utf8"),
    );
    if (settings.urlRandomness) {
      return `https://${settings.urlRandomness}-anonymous-${port}.exp.direct`;
    }
  } catch {
    // ignore
  }
  return null;
}

function fetchNgrokTunnelUrl() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const tunnel =
            (data.tunnels || []).find((t) =>
              String(t.public_url || "").includes("exp.direct"),
            ) || (data.tunnels || [])[0];
          resolve(tunnel?.public_url || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

let printed = false;
let tunnelReady = false;
let lastExpUrl = null;

function printConnectionInfo(tunnelUrl) {
  if (!tunnelUrl) return;

  const expUrl = toExpUrl(tunnelUrl);
  if (printed && expUrl === lastExpUrl) return;

  printed = true;
  lastExpUrl = expUrl;

  console.log("");
  console.log("› Expo Go (scan QR or open URL on Android/iOS):");
  console.log(`› ${expUrl}`);
  console.log("");

  if (qrcode) {
    qrcode.generate(expUrl, { small: true }, (code) => {
      console.log(code);
    });
  } else {
    console.log("› (QR skipped — qrcode-terminal not found; use the URL above)");
  }

  console.log("");
  console.log("› Android: open Expo Go → Scan QR / Enter URL");
  console.log("› Web:     http://localhost:8081");
  console.log(
    "› Note: press-a (emulator) needs adb in the container; use Expo Go on a device.",
  );
  console.log("");
}

async function resolveAndPrintTunnel() {
  if (!tunnelReady) return;
  const fromNgrok = await fetchNgrokTunnelUrl();
  if (fromNgrok) {
    printConnectionInfo(fromNgrok);
    return;
  }
  const guessed = guessTunnelUrlFromSettings();
  if (guessed) {
    printConnectionInfo(guessed);
  }
}

function schedulePrintTunnel() {
  setTimeout(() => {
    resolveAndPrintTunnel().catch(() => {});
  }, 300);
  setTimeout(() => {
    resolveAndPrintTunnel().catch(() => {});
  }, 2000);
}

const existingNodeOptions = process.env.NODE_OPTIONS || "";
const requireFlag = `--require=${preloadPath}`;
const childEnv = {
  ...process.env,
  EXPO_NO_TELEMETRY: "1",
  NODE_OPTIONS: existingNodeOptions
    ? `${existingNodeOptions} ${requireFlag}`
    : requireFlag,
};
// Do not set CI=1 — that disables Metro watch / hot reload.
// Unset empty/invalid CI so getenv boolish does not throw.
delete childEnv.CI;
// Optional: set EXPO_TOKEN in .env for Expo account auth in Docker.
// Without it, expo-docker-preload.cjs auto-selects "Proceed anonymously".
if (!childEnv.EXPO_TOKEN) {
  delete childEnv.EXPO_TOKEN;
}

const child = spawn("expo", ["start", "--tunnel", "--port", port], {
  cwd: projectRoot,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

function onChunk(chunk) {
  process.stdout.write(chunk);
  const text = chunk.toString("utf8");

  if (text.includes("Tunnel connection has been closed")) {
    tunnelReady = false;
    printed = false;
    lastExpUrl = null;
    console.log("› Tunnel dropped — waiting to reconnect…");
  }

  if (text.includes("Tunnel ready.") || text.includes("Tunnel connected.")) {
    tunnelReady = true;
    schedulePrintTunnel();
  }
}

child.stdout.on("data", onChunk);
child.stderr.on("data", onChunk);

const poll = setInterval(() => {
  resolveAndPrintTunnel().catch(() => {});
}, 3000);

function shutdown(code) {
  clearInterval(poll);
  if (!child.killed) {
    child.kill("SIGTERM");
  }
  process.exit(code);
}

child.on("exit", (code, signal) => {
  clearInterval(poll);
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
