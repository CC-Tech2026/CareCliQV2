/**
 * pnpm hook: strip build scripts from @pnpm/exe so the bootstrap
 * `pnpm add pnpm@10.33.2 --allow-build=@pnpm/exe` doesn't SIGABRT
 * when running on NixOS (pre-compiled binary incompatibility).
 * corepack already has pnpm@10.33.2 available system-wide.
 */
function readPackage(pkg) {
  if (pkg.name === '@pnpm/exe' || pkg.name === 'pnpm') {
    pkg.scripts = {};
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
