# CareCliQ Performance Testing — Setup & User Guide

Load and smoke tests for the CareCliQ API using [k6](https://k6.io/). Tests simulate **Coordinator** and **Worker** users in parallel, hit real API routes, and produce an **HTML + JSON report** after every run.

---

## Table of Contents

1. [What This Tests](#what-this-tests)
2. [Prerequisites](#prerequisites)
3. [Without Docker (Local Machine)](#without-docker-local-machine)
4. [Setup](#setup)
5. [Configuration](#configuration)
6. [Verify Login Before Running](#verify-login-before-running)
7. [Running Tests](#running-tests)
8. [Reading the Report](#reading-the-report)
9. [Endpoint Coverage](#endpoint-coverage)
10. [Troubleshooting](#troubleshooting)
11. [Project Layout](#project-layout)
12. [Customizing Tests](#customizing-tests)

---

## What This Tests

| Scenario | VUs | Duration | What it does |
|---|---|---|---|
| `coordinator` | 0 → 5 → 0 | ~2 min | Ramps coordinator users; hits coordinator dashboards, participants, shifts, incidents, reports |
| `worker` | 0 → 5 → 0 | ~2 min | Ramps worker users; hits worker dashboards, my-clients, shifts, compliance, training |

Both scenarios run **at the same time** (10 max VUs total).

- Login happens **once** in `setup()` — tokens are reused per iteration.
- Dynamic routes (`{participant_id}`, `{shift_id}`) are resolved automatically from the first available record.
- **28 endpoints** are tracked in `endpoints.manifest.json` (see [Endpoint Coverage](#endpoint-coverage)).

---

## Prerequisites

Choose **one** of these run methods:

### Option A — Docker (recommended)

- Docker + Docker Compose
- Backend running (`docker compose up -d backend`) **or** a remote API URL in `.env`

No local k6 or Node install required — the `k6` service image includes both.

### Option B — Local

- [k6](https://k6.io/docs/get-started/installation/) v0.54+
- Node.js 20+
- API reachable at `K6_BASE_URL` (local backend or remote)

---

## Without Docker (Local Machine)

Kung **walang Docker**, kailangan mo lang i-install ang **k6** at **Node.js** sa machine mo. Hindi kailangan ng Docker para sa performance test mismo.

### Step 1 — Install k6

**Linux (Debian/Ubuntu/WSL):**

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17F747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**macOS (Homebrew):**

```bash
brew install k6
```

**Windows (Chocolatey):**

```powershell
choco install k6
```

Or download from: https://k6.io/docs/get-started/installation/

Verify:

```bash
k6 version
# → k6 v0.54.0 (or newer)
```

### Step 2 — Install Node.js

Node **20+** is required for HTML report generation.

- https://nodejs.org/ — LTS installer
- Or via `nvm`: `nvm install 20`

Verify:

```bash
node --version
# → v20.x.x
```

### Step 3 — Configure `.env`

From the project root, copy or edit `.env`:

```bash
K6_BASE_URL=http://localhost:8000
K6_ENV=Local
K6_COORDINATOR_EMAIL=coordinator@your-org.com
K6_COORDINATOR_PASSWORD="your-password"
K6_WORKER_EMAIL=worker@your-org.com
K6_WORKER_PASSWORD=your-password
```

| Target API | `K6_BASE_URL` |
|---|---|
| Backend running on same machine | `http://localhost:8000` |
| Remote dev (Render, etc.) | `https://dev-api-your-app.onrender.com` + `K6_ENV=Development` |

> Hindi mo kailangan ng `http://backend:8000` — yan lang para sa Docker internal network.

### Step 4 — Make sure the API is reachable

**Local backend** (Python, hindi Docker):

```bash
# Example: run FastAPI directly
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Remote API** — skip local backend; point `K6_BASE_URL` sa remote URL.

Check:

```bash
curl http://localhost:8000/api/health
```

### Step 5 — Verify login

```bash
node performance/scripts/verify-auth.js
```

Dapat `Result: OK — token received` para sa Coordinator at Worker.

### Step 6 — Run the test

```bash
chmod +x performance/run-test.sh   # once only
./performance/run-test.sh
```

Ang script ang mag:

1. Babasahin ang `K6_*` vars mula sa `.env`
2. Mag-run ng k6 (`load-test.js`, ~2 min)
3. Gagawa ng `performance/reports/report.html` at `report.json`

### Step 7 — Open report

```bash
xdg-open performance/reports/report.html      # Linux
open performance/reports/report.html          # macOS
explorer.exe performance/reports/report.html  # WSL → Windows browser
```

### Local-only quick reference

```bash
# Install: k6 + Node 20+
# Configure: .env (K6_* block)

node performance/scripts/verify-auth.js
./performance/run-test.sh
xdg-open performance/reports/report.html
```

### Optional: run k6 directly (without full report)

```bash
k6 run performance/load-test.js \
  -e BASE_URL=http://localhost:8000 \
  -e K6_ENV=Local \
  -e K6_COORDINATOR_EMAIL=... \
  -e K6_COORDINATOR_PASSWORD=... \
  -e K6_WORKER_EMAIL=... \
  -e K6_WORKER_PASSWORD=...
```

Mas basic ang report kung hindi via `run-test.sh`. Gamitin ang `run-test.sh` para sa buong HTML report na may charts at per-role tabs.

### Note: `run-test.sh` and Docker

Kung **wala** kang naka-install na k6 pero may Docker, auto-fallback ang script sa Docker. Kung may k6 **at** Node na locally, **hindi** na gagamit ng Docker — diretso local run.

---

## Setup

### 1. Copy environment variables

Add the k6 block to your project `.env` (see `.env.example`):

```bash
# ── k6 performance testing ────────────────────────────────────────────────────
K6_BASE_URL=http://localhost:8000
K6_ENV=Local

# Coordinator (support_coordinator / admin)
K6_COORDINATOR_EMAIL=coordinator@your-org.com
K6_COORDINATOR_PASSWORD="your-password-here"

# Worker (support_worker)
K6_WORKER_EMAIL=worker@your-org.com
K6_WORKER_PASSWORD=your-password-here
```

### 2. Choose your target API

| Environment | `K6_BASE_URL` | `K6_ENV` |
|---|---|---|
| Local backend (host) | `http://localhost:8000` | `Local` |
| Local backend (Docker k6) | `http://backend:8000` *(auto if unset)* | `Local` |
| Render / remote dev | `https://dev-api-your-app.onrender.com` | `Development` |
| Staging | `https://staging-api.example.com` | `Staging` |

> **Important:** Test accounts must exist on the **same API** you target. Credentials in `.env` for Render dev will not work against `localhost:8000` unless those users exist locally.

### 3. Password quoting

If a password contains `#`, `$`, or spaces, wrap it in **double quotes**:

```bash
K6_COORDINATOR_PASSWORD="Sarahsunshine#2026"
```

Unquoted `#` is treated as a comment by `.env` parsers and will truncate the password.

### 4. Account requirements

| Role | Required app role | Notes |
|---|---|---|
| Coordinator | `support_coordinator` (or admin) | Used for org-wide routes |
| Worker | `support_worker` | Must have assigned clients/shifts for dynamic routes |

- **No MFA** on test accounts — MFA blocks automated login.
- Accounts should belong to the **same organisation** for realistic data.

### 5. Start the backend (local testing)

**With Docker:**

```bash
docker compose up -d backend
```

**Without Docker** — run the API directly (example):

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or point `K6_BASE_URL` at a remote API — no local backend needed.

Wait until healthy:

```bash
curl http://localhost:8000/api/health
# → {"status":"healthy", ...}
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `K6_BASE_URL` | `http://localhost:8000` | API base URL (no trailing slash) |
| `K6_ENV` | `Local` | Label in reports: `Local`, `Development`, `Staging`, `Production` |
| `K6_TEST_NAME` | `load` | Test name shown in report title |
| `K6_COORDINATOR_EMAIL` | — | Coordinator login email |
| `K6_COORDINATOR_PASSWORD` | — | Coordinator login password |
| `K6_WORKER_EMAIL` | — | Worker login email |
| `K6_WORKER_PASSWORD` | — | Worker login password |
| `K6_SAVE_HISTORY` | `false` | Set `true` to keep timestamped report copies in `reports/history/` |

Legacy fallbacks (coordinator only): `K6_TEST_EMAIL`, `K6_TEST_PASSWORD`.

### Thresholds (built into `load-test.js`)

| Environment | HTTP p95 | Health p95 | Error rate |
|---|---|---|---|
| Local | &lt; 2s | &lt; 500ms | &lt; 5% |
| Development / Staging / Render | &lt; 20s | &lt; 15s | &lt; 5% |

`Development` and `Staging` runs exit with code **0** after the report is generated even if thresholds fail (common on cold-start hosts like Render).

---

## Verify Login Before Running

Run the auth checker to confirm credentials work **before** a 2-minute load test:

**Docker:**

```bash
docker compose run --rm --entrypoint node k6 /app/performance/scripts/verify-auth.js
```

**Local:**

```bash
node performance/scripts/verify-auth.js
```

Expected output:

```
Target: https://dev-api-carescribe.onrender.com

Coordinator: sarah@sunshine-demo.com
  Password loaded: yes (18 chars)
  Result: OK — token received

Worker: worker@yopmail.com
  Password loaded: yes (9 chars)
  Result: OK — token received
```

If you see `FAIL — HTTP 401` or `Password loaded: yes (N chars)` with wrong N, fix `.env` quoting or use an account on the correct API.

---

## Running Tests

### Docker (recommended)

```bash
docker compose run --rm k6
```

This:

1. Waits for backend health (when targeting `http://backend:8000`)
2. Runs `load-test.js` (~2 min)
3. Generates `reports/report.html` and `reports/report.json`

### Local script

```bash
./performance/run-test.sh
```

Falls back to Docker automatically if k6 is not installed locally.

### Against remote dev (Render)

Set in `.env`:

```bash
K6_BASE_URL=https://dev-api-carescribe.onrender.com
K6_ENV=Development
```

Then run:

```bash
./performance/run-test.sh
```

First request after idle may be slow (cold start) — run twice if you want warmer numbers.

### Save historical reports

```bash
K6_SAVE_HISTORY=true ./performance/run-test.sh
```

Copies are saved as `reports/history/YYYY-MM-DD_HH-MM_load.html` (and `.json`).

### Open the HTML report

```bash
# Linux
xdg-open performance/reports/report.html

# macOS
open performance/reports/report.html

# WSL → Windows browser
explorer.exe performance/reports/report.html
```

---

## Reading the Report

The HTML report has **three tabs**:

### Overview

Side-by-side comparison of Coordinator vs Worker: request counts, error rate, latency percentiles, and threshold pass/fail.

### Coordinator / Worker tabs

Each role tab shows:

| Section | What to look for |
|---|---|
| **Executive summary** | Total requests, RPS, error rate, avg/p95 latency |
| **Auth banner** | Green = login OK; red = login failed (endpoints skipped) |
| **Endpoint coverage** | Every route in the manifest — **TESTED** or **SKIPPED** with reason |
| **Metrics charts** | Response time, RPS, VUs, error rate over time |
| **Threshold results** | Pass/fail per SLO with explanation |
| **Slowest / fastest endpoints** | Per-route latency ranking |

### Status codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `401` | Bad credentials or expired token |
| `403` | Role cannot access route |
| `404` | Resource not found (e.g. no shifts for worker) |
| `500` | Server error — check backend logs |

### JSON report

`performance/reports/report.json` contains the same data for CI pipelines or custom dashboards.

---

## Endpoint Coverage

Endpoints are defined in `endpoints.manifest.json` and executed in `load-test.js`.

### Shared (both roles)

| Method | Path |
|---|---|
| GET | `/api/health` |
| POST | `/api/auth/login` |
| GET | `/api/auth/me` |
| GET | `/api/alerts` |
| GET | `/api/alerts/unread` |
| GET | `/api/sessions/recent` |
| GET | `/api/compliance/rules` |

### Coordinator only

| Group | Endpoints |
|---|---|
| Participants | list, dashboard-stats, `{participant_id}` |
| Dashboard | `/api/dashboard/coordinator` |
| Coordinator | team, shifts, compliance-overview, notifications, goals |
| Incidents | list |
| Reports | compliance-overview |

### Worker only

| Group | Endpoints |
|---|---|
| Worker | my-clients, my-compliance, `{participant_id}` |
| Dashboard | worker, worker-landing |
| Shifts | list, counts, `{shift_id}` |
| Performance | performance-dashboard, feedback/unread-count |
| Training | certifications |

Dynamic routes are **skipped** when no participant or shift exists for that account (shown as SKIPPED in the report).

---

## Troubleshooting

### All authenticated endpoints show SKIPPED

**Cause:** Login failed in setup.

**Fix:**
1. Run `verify-auth.js` (see above).
2. Check password quoting for `#` characters.
3. Confirm `K6_BASE_URL` matches where the accounts exist.
4. Ensure accounts do not require MFA.

### Coordinator SKIPPED, Worker OK (or vice versa)

**Cause:** Only one role's credentials are wrong, or coordinator login hit a transient 500.

**Fix:** Re-run the test. Check `verify-auth.js` output for the failing role.

### `GET /api/worker/shifts/{shift_id}` SKIPPED

**Cause:** Worker has no shifts in `today`, `week`, or `upcoming` filters.

**Fix:** Seed or assign shifts to the worker test account, or accept skip (other endpoints still tested).

### Threshold failures on Render dev

**Cause:** Cold starts, shared CPU, long DB round-trips.

**Expected:** `K6_ENV=Development` still generates the report and exits 0. Use the report to identify slow endpoints, not as a hard production gate.

### `k6 not found` locally

**Fix:** Use Docker:

```bash
docker compose run --rm k6
```

### Report not updating

**Cause:** Stale Docker mount or running k6 directly without `run-test.sh`.

**Fix:** Always use `./performance/run-test.sh` or `docker compose run --rm k6`. The compose file mounts `./performance` into the container.

### Password shows wrong character count in verify-auth

**Cause:** `.env` line has leading spaces or unquoted `#`.

**Fix:** No leading spaces before `K6_` keys. Quote passwords with special characters.

---

## Project Layout

```
performance/
├── README.md                 ← this guide
├── Dockerfile                ← k6 + Node image
├── load-test.js              ← k6 script (scenarios, thresholds, endpoints)
├── run-test.sh               ← entry point (env loading, k6, report gen)
├── endpoints.manifest.json   ← endpoint catalog for reports
├── reports/
│   ├── report.html           ← generated (gitignored)
│   ├── report.json           ← generated (gitignored)
│   └── history/              ← optional timestamped copies
└── scripts/
    ├── generate-report.js    ← HTML/JSON report builder
    ├── report-roles.js       ← per-role NDJSON filtering
    ├── k6-report.js          ← k6 handleSummary hook
    └── verify-auth.js        ← standalone login check
```

---

## Customizing Tests

### Add a new endpoint

1. Add an entry to `endpoints.manifest.json` with `method`, `path`, `group`, `roles`, and `description`.
2. Add the same route to `COORDINATOR_ENDPOINTS` or `WORKER_ENDPOINTS` (or `SHARED_AUTH_ENDPOINTS`) in `load-test.js`.
3. Use `{participant_id}` or `{shift_id}` in the path and set `dynamicKey: 'participantId'` or `'shiftId'`.
4. Re-run the test and confirm the route shows **TESTED** in the report.

### Change load profile

Edit `STAGES` in `load-test.js`:

```javascript
const STAGES = [
  { duration: '30s', target: 5 },  // ramp up
  { duration: '1m', target: 5 },   // hold
  { duration: '30s', target: 0 },  // ramp down
];
```

### Tighten thresholds for production

Edit `THRESHOLDS` in `load-test.js` and set `K6_ENV=Production` so exit code reflects failures.

---

## Quick Reference

```bash
# 1. Configure .env (K6_* variables)

# 2. Verify login
docker compose run --rm --entrypoint node k6 /app/performance/scripts/verify-auth.js

# 3. Run test
docker compose run --rm k6

# 4. Open report
xdg-open performance/reports/report.html
```
