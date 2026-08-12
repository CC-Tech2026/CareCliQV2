#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in
      K6_*)
        key="${line%%=*}"
        val="${line#*=}"
        # Strip surrounding quotes so passwords with # survive
        case "$val" in
          \"*\") val="${val#\"}"; val="${val%\"}" ;;
          \'*\') val="${val#\'}"; val="${val%\'}" ;;
        esac
        export "$key=$val"
        ;;
    esac
  done < "$PROJECT_ROOT/.env"
fi

REPORTS_DIR="$SCRIPT_DIR/reports"
mkdir -p "$REPORTS_DIR/history"

TEST_NAME="${K6_TEST_NAME:-load}"
ENVIRONMENT="${K6_ENV:-Local}"
BASE_URL="${K6_BASE_URL:-http://localhost:8000}"
TIMESTAMPED="${K6_SAVE_HISTORY:-false}"

SUMMARY_RAW="$REPORTS_DIR/summary-raw.json"
METRICS_RAW="$REPORTS_DIR/metrics-raw.ndjson"

K6_SCRIPT="$SCRIPT_DIR/load-test.js"
if [ -n "$1" ] && [ -f "$1" ]; then
  K6_SCRIPT="$1"
  shift
fi

echo "Running performance test: $TEST_NAME"
echo "Environment: $ENVIRONMENT"
echo "Target: $BASE_URL"
echo "Coordinator: ${K6_COORDINATOR_EMAIL:-not set}"
echo "Worker: ${K6_WORKER_EMAIL:-not set}"
echo ""

if ! command -v k6 >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "k6 not found locally — running via Docker..."
    echo ""
    if [ -z "${K6_BASE_URL+x}" ] || [ "$BASE_URL" = "http://localhost:8000" ]; then
      BASE_URL="http://backend:8000"
      echo "Target (Docker network): $BASE_URL"
      echo ""
    fi
    exec docker compose run --rm \
      -e "K6_BASE_URL=$BASE_URL" \
      -e "K6_ENV=$ENVIRONMENT" \
      -e "K6_TEST_NAME=$TEST_NAME" \
      -e "K6_COORDINATOR_EMAIL=${K6_COORDINATOR_EMAIL:-}" \
      -e "K6_COORDINATOR_PASSWORD=${K6_COORDINATOR_PASSWORD:-}" \
      -e "K6_WORKER_EMAIL=${K6_WORKER_EMAIL:-}" \
      -e "K6_WORKER_PASSWORD=${K6_WORKER_PASSWORD:-}" \
      -e "K6_SAVE_HISTORY=$TIMESTAMPED" \
      k6
  fi
  echo "Error: k6 is not installed." >&2
  echo "" >&2
  echo "Options:" >&2
  echo "  Docker:  docker compose run --rm k6" >&2
  echo "  Install: https://k6.io/docs/get-started/installation/" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to generate reports." >&2
  echo "Install Node.js 20+ or run via Docker: docker compose run --rm k6" >&2
  exit 1
fi

set +e
k6 run \
  --summary-export="$SUMMARY_RAW" \
  --out "json=$METRICS_RAW" \
  -e "BASE_URL=$BASE_URL" \
  -e "K6_TEST_NAME=$TEST_NAME" \
  -e "K6_ENV=$ENVIRONMENT" \
  -e "K6_WRAPPED=true" \
  -e "K6_COORDINATOR_EMAIL=${K6_COORDINATOR_EMAIL:-}" \
  -e "K6_COORDINATOR_PASSWORD=${K6_COORDINATOR_PASSWORD:-}" \
  -e "K6_WORKER_EMAIL=${K6_WORKER_EMAIL:-}" \
  -e "K6_WORKER_PASSWORD=${K6_WORKER_PASSWORD:-}" \
  "$K6_SCRIPT" \
  "$@"
K6_EXIT=$?
set -e

TIMESTAMPED_FLAG=""
if [ "$TIMESTAMPED" = "true" ] || [ "$TIMESTAMPED" = "1" ]; then
  TIMESTAMPED_FLAG="--timestamped"
fi

node "$SCRIPT_DIR/scripts/generate-report.js" \
  --summary "$SUMMARY_RAW" \
  --metrics "$METRICS_RAW" \
  --output-dir "$REPORTS_DIR" \
  --test-name "$TEST_NAME" \
  --environment "$ENVIRONMENT" \
  $TIMESTAMPED_FLAG

echo ""
if [ "$K6_EXIT" -eq 0 ]; then
  echo "Performance test completed successfully."
else
  echo "Performance test finished — thresholds were exceeded (exit code $K6_EXIT)."
  echo "This is common on Render dev (cold starts, shared CPU). See the HTML report for details."
fi
echo ""
echo "HTML Report:"
echo "performance/reports/report.html"
echo ""
echo "JSON Report:"
echo "performance/reports/report.json"

if [ "$TIMESTAMPED" = "true" ] || [ "$TIMESTAMPED" = "1" ]; then
  echo ""
  echo "Historical copies saved to:"
  echo "performance/reports/history/"
fi

if [ "$ENVIRONMENT" = "Development" ] || [ "$ENVIRONMENT" = "Staging" ]; then
  K6_EXIT=0
fi

exit "$K6_EXIT"
