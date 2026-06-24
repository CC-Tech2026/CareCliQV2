import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "18130";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const repoRoot = path.resolve(import.meta.dirname, "../..");

const REQUIRED_SUPABASE_REGION = "ap-southeast-2";

function isLocalSupabaseUrl(url: string): boolean {
  if (!url.trim()) return true;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "host.docker.internal" ||
      host === "kong" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function extractSupabaseProjectRef(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function validateSupabaseRegionAtBuild(url: string, declaredRegion: string): void {
  if (!url.trim() || isLocalSupabaseUrl(url)) return;

  const projectRef = extractSupabaseProjectRef(url);
  if (!projectRef) {
    throw new Error(
      "Supabase region validation failed: SUPABASE_URL must be a hosted *.supabase.co project URL.",
    );
  }

  if (declaredRegion.trim() !== REQUIRED_SUPABASE_REGION) {
    throw new Error(
      `Supabase region validation failed: SUPABASE_REGION must be "${REQUIRED_SUPABASE_REGION}" ` +
        `(Sydney) for Australian data residency before building for project "${projectRef}".`,
    );
  }
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const supabaseRegion = env.SUPABASE_REGION || process.env.SUPABASE_REGION || "";
  const regionCheck = (
    env.SUPABASE_REGION_CHECK ||
    process.env.SUPABASE_REGION_CHECK ||
    "enabled"
  ).toLowerCase();

  if (!["disabled", "skip", "off", "false", "0"].includes(regionCheck)) {
    validateSupabaseRegionAtBuild(supabaseUrl, supabaseRegion);
  }

  return {
    base: basePath,
    envDir: repoRoot,
    define: {
      "import.meta.env.SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
      headers:
        process.env.NODE_ENV !== "production"
          ? {
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            }
          : {},
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
    test: {
      environment: "jsdom",
      globals: false,
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  };
});
