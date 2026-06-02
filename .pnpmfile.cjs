/**
 * pnpm hook: strip build scripts from @pnpm/exe so the Replit artifact
 * bootstrap `pnpm add pnpm@10.33.2 --allow-build=@pnpm/exe` succeeds on
 * NixOS where the pre-compiled @pnpm/exe binary SIGABRT's due to thread
 * contention during OpenSSL CA certificate loading at startup.
 * corepack already has pnpm@10.33.2 working system-wide.
 */
function readPackage(pkg) {
  if (pkg.name === '@pnpm/exe') {
    pkg.scripts = {};
    pkg.dependencies = {};
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
