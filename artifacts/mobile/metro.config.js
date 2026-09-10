const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");
const https = require("https");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

const PRIVATE_IPV4_HOST_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

/**
 * Dev-only: proxy browser `/api` → the backend (avoids CORS). Native apps do not use this.
 * This proxy always runs on the dev machine itself, so when EXPO_PUBLIC_API_URL is a LAN
 * address (set for a physical device to reach the same backend over the network), route
 * straight to localhost instead — same machine, no need to leave it, and it stays correct
 * across Wi-Fi/hotspot changes that would otherwise make the configured LAN IP stale.
 */
function getApiProxyTarget() {
  const raw = (
    process.env.EXPO_PUBLIC_API_URL || "https://dev-api-carescribe.onrender.com"
  ).trim();
  const target = raw.replace(/\/$/, "");
  try {
    const url = new URL(target);
    if (PRIVATE_IPV4_HOST_RE.test(url.hostname)) {
      url.hostname = "localhost";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // not a valid absolute URL — fall through and use it as-is
  }
  return target;
}

function proxyApiRequest(req, res, targetBase) {
  const target = new URL(req.url || "/", `${targetBase}/`);
  const isHttps = target.protocol === "https:";
  const lib = isHttps ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;

  const proxyReq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error("[metro-api-proxy]", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
    }
    res.end(`API proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
}

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      const url = req.url || "";
      if (
        url === "/api" ||
        url.startsWith("/api/") ||
        url.startsWith("/api?")
      ) {
        return proxyApiRequest(req, res, getApiProxyTarget());
      }
      return middleware(req, res, next);
    };
  },
};

config.watchFolders = [
  workspaceRoot,
  // OneDrive exposes this directory as a reparse point in directory listings.
  // An explicit crawl root lets Metro discover its files on Windows.
  path.resolve(projectRoot, "components/onboarding"),
];

// The workspace also contains Python environments and temporary build output.
// Metro must not crawl those trees (Windows can reject their native binaries).
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ignoredWorkspaceFolders = [".venv", "venv", "temp"].map(
  (folder) =>
    new RegExp(
      "^" + escapeRegExp(path.join(workspaceRoot, folder)) + "(?:[/\\\\]|$)",
    ),
);
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  ...ignoredWorkspaceFolders,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.unstable_enableSymlinks = true;

const scaledText = path.resolve(projectRoot, "lib/rn-scaled-text.tsx");
const scaledTextInput = path.resolve(
  projectRoot,
  "lib/rn-scaled-text-input.tsx",
);

function normalize(moduleName) {
  return String(moduleName).replace(/\\/g, "/");
}

function isFromScaledWrapper(originModulePath) {
  const origin = normalize(originModulePath || "");
  return (
    origin === normalize(scaledText) ||
    origin === normalize(scaledTextInput) ||
    origin.endsWith("/lib/rn-scaled-text.tsx") ||
    origin.endsWith("/lib/rn-scaled-text-input.tsx")
  );
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = normalize(moduleName);

  if (!isFromScaledWrapper(context.originModulePath)) {
    // RN 0.81 Text/TextInput are plain components — wrap via Metro so preferences apply.
    if (
      /\/Libraries\/Text\/Text$/.test(name) ||
      name === "./Libraries/Text/Text"
    ) {
      return { filePath: scaledText, type: "sourceFile" };
    }
    if (
      /\/Libraries\/Components\/TextInput\/TextInput$/.test(name) ||
      name === "./Libraries/Components/TextInput/TextInput"
    ) {
      return { filePath: scaledTextInput, type: "sourceFile" };
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
