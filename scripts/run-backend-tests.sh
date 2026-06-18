#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXTRA_ARGS=("$@")
if [ "${#EXTRA_ARGS[@]}" -eq 0 ]; then
  EXTRA_ARGS=(-v)
fi

docker compose run --rm \
  -v "$ROOT/backend:/app/backend" \
  -v "$ROOT/pytest.ini:/app/pytest.ini" \
  backend sh -c "uv pip install pytest 'pytest-asyncio>=0.24' -q && PYTHONPATH=/app /app/.venv/bin/python -m pytest backend/tests ${EXTRA_ARGS[*]}"
