const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");
const https = require("https");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

/** Dev-only: proxy browser `/api` → EXPO_PUBLIC_API_URL (avoids CORS). Native apps do not use this. */
function getApiProxyTarget() {
  const raw = (
    process.env.EXPO_PUBLIC_API_URL ||
    "https://dev-api-carescribe.onrender.com"
  ).trim();
  return raw.replace(/\/$/, "");
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
      if (url === "/api" || url.startsWith("/api/") || url.startsWith("/api?")) {
        return proxyApiRequest(req, res, getApiProxyTarget());
      }
      return middleware(req, res, next);
    };
  },
};

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.unstable_enableSymlinks = true;

const scaledText = path.resolve(projectRoot, "lib/rn-scaled-text.tsx");
const scaledTextInput = path.resolve(projectRoot, "lib/rn-scaled-text-input.tsx");

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
    if (/\/Libraries\/Text\/Text$/.test(name) || name === "./Libraries/Text/Text") {
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
