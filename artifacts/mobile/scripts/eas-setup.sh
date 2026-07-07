#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20+ and retry."
  exit 1
fi

echo "==> CareCliQ mobile — EAS setup"
echo "    Working directory: $ROOT"
echo

if ! pnpm exec eas whoami >/dev/null 2>&1; then
  echo "Not logged in to Expo. Opening login (browser)..."
  pnpm exec eas login
fi

echo "Logged in as: $(pnpm exec eas whoami)"
echo

echo "==> Linking EAS project (carecliq)..."
pnpm exec eas init --non-interactive

echo
echo "==> Starting Android preview build (APK)..."
echo "    This runs on Expo cloud — may take 10–20 minutes."
pnpm exec eas build --platform android --profile preview --non-interactive

echo
echo "Done. Download the APK from the URL above, or run:"
echo "  pnpm exec eas build:list"
