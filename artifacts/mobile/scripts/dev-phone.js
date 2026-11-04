#!/usr/bin/env node
/**
 * Starts Metro for the "CareCliQ Dev" app (the development EAS profile) on a
 * physical phone. APP_VARIANT has to match the installed build, otherwise the
 * QR code opens the carecliq:// scheme instead of carecliq-dev://.
 */
const { spawn } = require("child_process");
const path = require("path");

const child = spawn("npx", ["expo", "start", "--dev-client", ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, APP_VARIANT: "development" },
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
