#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  filterNdjsonByRole,
  computeStatsFromNdjson,
  evaluateThresholds,
  buildRoleAuthInfo,
} = require('./report-roles');

function parseArgs(argv) {
  const args = {
    summary: '',
    metrics: '',
    outputDir: '',
    testName: 'load',
    environment: 'Local',
    timestamped: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--summary') args.summary = argv[++i];
    else if (arg === '--metrics') args.metrics = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--test-name') args.testName = argv[++i];
    else if (arg === '--environment') args.environment = argv[++i];
    else if (arg === '--timestamped') args.timestamped = true;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseNdjson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function metricValue(metrics, name, key, fallback = 0) {
  const m = metrics[name];
  if (!m) return fallback;
  if (m.values && m.values[key] !== undefined) return m.values[key];
  if (m[key] !== undefined) return m[key];
  return fallback;
}

function asIterable(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection === 'object') return Object.values(collection);
  return [];
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return `${mins}m ${rem}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRate(rate) {
  return `${rate.toFixed(2)}/s`;
}

function formatPercent(rate) {
  return `${(rate * 100).toFixed(2)}%`;
}

function collectChecks(rootGroup, results = []) {
  if (!rootGroup) return results;
  for (const c of asIterable(rootGroup.checks)) {
    if (!c || typeof c !== 'object') continue;
    results.push({
      name: c.name || 'unknown',
      passes: c.passes || 0,
      fails: c.fails || 0,
      pass: (c.fails || 0) === 0,
    });
  }
  for (const g of asIterable(rootGroup.groups)) {
    collectChecks(g, results);
  }
  return results;
}

function collectThresholds(metrics) {
  const results = [];
  for (const [name, m] of Object.entries(metrics)) {
    if (!m.thresholds) continue;
    if (Array.isArray(m.thresholds)) {
      for (const t of m.thresholds) {
        results.push({
          metric: name,
          threshold: t.threshold || t,
          ok: t.ok !== undefined ? t.ok : true,
        });
      }
    } else {
      for (const [expr, result] of Object.entries(m.thresholds)) {
        const ok = typeof result === 'boolean' ? !result : (typeof result === 'object' ? result.ok !== false : !!result);
        results.push({ metric: name, threshold: expr, ok });
      }
    }
  }
  return results;
}

function bucketTimeSeries(points, bucketMs = 5000) {
  if (!points.length) return { labels: [], values: [] };
  const buckets = new Map();
  for (const p of points) {
    const ts = new Date(p.time).getTime();
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(p.value);
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  return {
    labels: sorted.map(([ts]) => new Date(ts).toLocaleTimeString()),
    values: sorted.map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length),
  };
}

function bucketCounterRate(points, bucketMs = 5000) {
  if (!points.length) return { labels: [], values: [] };
  const buckets = new Map();
  for (const p of points) {
    const ts = new Date(p.time).getTime();
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    buckets.set(bucket, (buckets.get(bucket) || 0) + p.value);
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const intervalSec = bucketMs / 1000;
  return {
    labels: sorted.map(([ts]) => new Date(ts).toLocaleTimeString()),
    values: sorted.map(([, count]) => count / intervalSec),
  };
}

function extractPoints(ndjson, metricName) {
  return ndjson
    .filter((e) => e.type === 'Point' && e.metric === metricName && e.data)
    .map((e) => ({ time: e.data.time, value: e.data.value }));
}

function normalizeGroup(group) {
  if (!group) return 'Default';
  return group.replace(/^::/, '').trim() || 'Default';
}

function parseEndpointFromTags(tags) {
  if (!tags) return null;
  const method = (tags.method || 'GET').toUpperCase();
  const name = tags.name || '';
  const url = tags.url || '';

  const formatted = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)$/.exec(name)
    || /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)$/.exec(url);
  if (formatted) {
    return { method: formatted[1], path: formatted[2], label: `${formatted[1]} ${formatted[2]}` };
  }

  const rawUrl = url.startsWith('http') ? url : (name.startsWith('http') ? name : null);
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return { method, path: parsed.pathname, label: `${method} ${parsed.pathname}` };
    } catch {
      return null;
    }
  }

  if (name.startsWith('/')) {
    return { method, path: name, label: `${method} ${name}` };
  }

  return null;
}

function loadEndpointManifest() {
  const manifestPath = path.join(__dirname, '..', 'endpoints.manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  return readJson(manifestPath);
}

function filterManifestByRole(manifest, role) {
  if (role === 'combined') return manifest;
  return manifest.filter((item) => {
    const roles = item.roles;
    if (!roles || roles.length === 0 || roles.includes('both')) return true;
    return roles.includes(role);
  });
}

function extractTestedEndpoints(ndjson) {
  const endpoints = new Map();

  for (const e of ndjson) {
    if (e.type !== 'Point' || e.metric !== 'http_req_duration' || !e.data?.tags) continue;
    const tags = e.data.tags;
    const ep = parseEndpointFromTags(tags);
    if (!ep) continue;

    const key = `${ep.method} ${ep.path}`;
    if (!endpoints.has(key)) {
      endpoints.set(key, {
        method: ep.method,
        path: ep.path,
        label: ep.label,
        groups: new Set(),
        durations: [],
        statuses: new Map(),
      });
    }
    const entry = endpoints.get(key);
    entry.groups.add(normalizeGroup(tags.group));
    entry.durations.push(e.data.value);
    if (tags.status) {
      entry.statuses.set(tags.status, (entry.statuses.get(tags.status) || 0) + 1);
    }
  }

  return [...endpoints.values()].map((e) => {
    e.durations.sort((a, b) => a - b);
    const count = e.durations.length;
    return {
      method: e.method,
      path: e.path,
      label: e.label,
      group: [...e.groups].sort().join(', '),
      tested: true,
      count,
      avg: e.durations.reduce((a, b) => a + b, 0) / count,
      min: e.durations[0],
      max: e.durations[count - 1],
      statuses: Object.fromEntries(e.statuses),
    };
  });
}

function buildEndpointCoverage(testedEndpoints, manifest, authInfo) {
  const testedByKey = new Map(testedEndpoints.map((e) => [`${e.method} ${e.path}`, e]));
  const covered = [];
  const seen = new Set();

  for (const item of manifest) {
    const key = `${item.method} ${item.path}`;
    seen.add(key);
    const hit = testedByKey.get(key);
    if (hit) {
      covered.push({
        ...item,
        label: hit.label,
        tested: true,
        group: hit.group || item.group,
        count: hit.count,
        avg: hit.avg,
        min: hit.min,
        max: hit.max,
        statuses: hit.statuses,
        skipReason: null,
      });
    } else {
      let skipReason = 'Not called during this test run';
      if (item.dynamicKey || (item.path && item.path.includes('{'))) {
        skipReason = 'Skipped — no participant/shift ID available for dynamic route';
      }
      if (item.requiresCredentials) {
        if (!authInfo) {
          skipReason = 'Skipped — no auth session for this role';
        } else if (!authInfo.loginOk) {
          skipReason = authInfo.skipReason || 'Login failed for this role';
        }
      }
      covered.push({
        ...item,
        label: `${item.method} ${item.path}`,
        tested: false,
        count: 0,
        avg: null,
        min: null,
        max: null,
        statuses: {},
        skipReason,
      });
    }
  }

  for (const hit of testedEndpoints) {
    const key = `${hit.method} ${hit.path}`;
    if (!seen.has(key)) {
      covered.push({
        method: hit.method,
        path: hit.path,
        label: hit.label,
        group: hit.group,
        description: 'Endpoint hit during test (not in manifest)',
        tested: true,
        count: hit.count,
        avg: hit.avg,
        min: hit.min,
        max: hit.max,
        statuses: hit.statuses,
        skipReason: null,
      });
    }
  }

  return covered.sort((a, b) => {
    if (a.tested !== b.tested) return a.tested ? -1 : 1;
    return a.group.localeCompare(b.group) || a.label.localeCompare(b.label);
  });
}

function extractEndpointStats(ndjson) {
  return extractTestedEndpoints(ndjson).map((e) => ({
    name: e.label,
    avg: e.avg,
    min: e.min,
    max: e.max,
    count: e.count,
  })).sort((a, b) => b.avg - a.avg);
}

function extractStatusCodes(ndjson) {
  const codes = new Map();
  for (const e of ndjson) {
    if (e.type !== 'Point' || e.metric !== 'http_reqs' || !e.data?.tags?.status) continue;
    const code = e.data.tags.status;
    codes.set(code, (codes.get(code) || 0) + 1);
  }
  if (codes.size === 0) {
    for (const e of ndjson) {
      if (e.type !== 'Point' || e.metric !== 'http_req_duration' || !e.data?.tags?.status) continue;
      const code = e.data.tags.status;
      codes.set(code, (codes.get(code) || 0) + 1);
    }
  }
  return [...codes.entries()].sort((a, b) => b[1] - a[1]);
}

function buildHistogram(avg, min, max, p90, p95, p99) {
  const bins = ['<100ms', '100-250ms', '250-500ms', '500ms-1s', '1-2s', '>2s'];
  const edges = [0, 100, 250, 500, 1000, 2000, Infinity];
  const weights = [0.15, 0.25, 0.25, 0.15, 0.12, 0.08];
  const markers = [min, avg, p90, p95, p99, max];
  const counts = new Array(bins.length).fill(0);
  for (const m of markers) {
    for (let i = 0; i < edges.length - 1; i++) {
      if (m >= edges[i] && m < edges[i + 1]) {
        counts[i] += 1;
        break;
      }
    }
  }
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return { labels: bins, values: counts.map((c) => Math.round((c / total) * 100)) };
}

function buildReport(summary, ndjson, meta, role = 'combined') {
  const filtered = filterNdjsonByRole(ndjson, role);
  const stats = computeStatsFromNdjson(filtered);
  const state = summary.state || {};
  const authInfo = role === 'coordinator' || role === 'worker' ? buildRoleAuthInfo(summary, role) : null;

  const iterRate = metricValue(summary.metrics || {}, 'iterations', 'rate');
  const iterCount = metricValue(summary.metrics || {}, 'iterations', 'count');
  const durationMs = stats.durationMs
    || state.testRunDurationMs
    || (iterRate > 0 ? Math.round((iterCount / iterRate) * 1000) : 0);

  const thresholds = evaluateThresholds(stats, meta.environment);
  const failedThresholds = thresholds.filter((t) => !t.ok);
  const allThresholdsPass = failedThresholds.length === 0;

  const endpointStats = extractEndpointStats(filtered);
  const testedEndpoints = extractTestedEndpoints(filtered);
  const endpointCoverage = buildEndpointCoverage(
    testedEndpoints,
    filterManifestByRole(loadEndpointManifest(), role),
    authInfo,
  );
  const statusCodes = extractStatusCodes(filtered);

  const responseTimeSeries = bucketTimeSeries(extractPoints(filtered, 'http_req_duration'));
  const rpsSeries = bucketCounterRate(extractPoints(filtered, 'http_reqs'));
  const vusSeries = bucketTimeSeries(extractPoints(filtered, 'vus'), 5000);
  const errorPoints = extractPoints(filtered, 'http_req_failed');
  const errorSeries = bucketTimeSeries(
    errorPoints.map((p) => ({ time: p.time, value: p.value * 100 })),
  );
  const histogram = buildHistogram(stats.avgDuration, stats.minDuration, stats.maxDuration, stats.p90, stats.p95, stats.p99);

  const roleLabel = role === 'coordinator' ? 'Coordinator' : role === 'worker' ? 'Worker' : 'Combined';
  const executiveSummary = allThresholdsPass
    ? `${roleLabel}: ${stats.totalRequests} requests at ${stats.rps.toFixed(1)} RPS, ${formatPercent(stats.errorRate)} error rate, P95 ${Math.round(stats.p95)}ms.`
    : `${roleLabel}: ${failedThresholds.length} threshold(s) failed. Error rate ${formatPercent(stats.errorRate)}, P95 ${Math.round(stats.p95)}ms.`;

  const report = {
    generatedAt: new Date().toISOString(),
    testName: meta.testName,
    environment: meta.environment,
    role,
    roleLabel,
    auth: authInfo,
    durationMs,
    durationFormatted: formatDuration(durationMs),
    virtualUsers: { max: stats.vusMax },
    requests: {
      total: stats.totalRequests,
      successful: stats.successfulRequests,
      failed: stats.failedRequests,
      errorRate: stats.errorRate,
      rps: stats.rps,
    },
    responseTime: {
      avg: stats.avgDuration,
      min: stats.minDuration,
      max: stats.maxDuration,
      p90: stats.p90,
      p95: stats.p95,
      p99: stats.p99,
    },
    dataTransfer: {
      sent: stats.dataSent,
      received: stats.dataReceived,
      sentFormatted: formatBytes(stats.dataSent),
      receivedFormatted: formatBytes(stats.dataReceived),
      throughputSent: stats.throughputSent,
      throughputReceived: stats.throughputReceived,
    },
    thresholds,
    checks: [],
    failedChecks: [],
    statusCodes: Object.fromEntries(statusCodes),
    testedEndpoints: endpointCoverage,
    endpoints: {
      slowest: endpointStats.slice(0, 5),
      fastest: [...endpointStats].sort((a, b) => a.avg - b.avg).slice(0, 5),
    },
    executiveSummary,
    allThresholdsPass,
  };

  return { report, charts: { responseTimeSeries, rpsSeries, vusSeries, errorSeries, histogram } };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadge(ok) {
  return ok
    ? '<span class="badge pass">PASS</span>'
    : '<span class="badge fail">FAIL</span>';
}

const METRIC_GUIDES = {
  http_req_duration: 'Total time for each HTTP request (send → response). Lower is better. This is the main speed metric.',
  http_req_failed: 'Percentage of requests that returned an error (network failure or non-2xx status). Should stay near 0%.',
  errors: 'Percentage of test assertions that failed (e.g. wrong status code or missing body text).',
  health_duration: 'Response time for GET /api/health only. A lightweight ping — should be the fastest endpoint.',
  api_duration: 'Response time for authenticated API calls (/api/auth/me, /api/participants).',
};

const THRESHOLD_GUIDES = {
  'p(95)<2000': '95% of all requests must finish within 2 seconds. Catches slow tail latency under load.',
  'p(95)<500': '95% of health-check requests must finish within 500ms. Ensures the API is responsive at a basic level.',
  'rate<0.05': 'Fewer than 5% of requests may fail. Allows minor transient errors but flags systemic problems.',
};

function thresholdGuide(metric, threshold) {
  if (THRESHOLD_GUIDES[threshold]) return THRESHOLD_GUIDES[threshold];
  if (metric.includes('duration') && threshold.includes('p(95)')) {
    return '95th percentile latency must stay below the limit. 5% of requests may be slower, but 95% must be within budget.';
  }
  if (threshold.includes('rate<')) {
    return 'Error rate must stay below this limit. High values mean many requests are failing.';
  }
  return 'Pass/fail rule defined in the load test script (performance/load-test.js).';
}

function thresholdFailureHint(metric, threshold, report) {
  if (metric === 'http_req_duration' || metric === 'health_duration') {
    return `P95 was ${Math.round(report.responseTime.p95)}ms. Check slow endpoints, database queries, or cold-start latency (common on Render free tier).`;
  }
  if (metric === 'http_req_failed' || metric === 'errors') {
    return `Error rate was ${formatPercent(report.requests.errorRate)}. Check server logs for 4xx/5xx responses, auth failures, or timeouts.`;
  }
  return 'Review server logs and the Failed Checks section below for details.';
}

function sectionGuide(text) {
  return `<p class="guide">${text}</p>`;
}

function methodBadge(method) {
  const colors = { GET: '#16a34a', POST: '#2563eb', PUT: '#d97706', PATCH: '#7c3aed', DELETE: '#dc2626' };
  const color = colors[method] || '#64748b';
  return `<span class="method-badge" style="background:${color}18;color:${color}">${escapeHtml(method)}</span>`;
}

function endpointStatusBadge(tested) {
  return tested
    ? '<span class="badge pass">TESTED</span>'
    : '<span class="badge skip">SKIPPED</span>';
}

function buildReportPanel(r, charts, idSuffix = '') {
  const sid = (id) => `${id}${idSuffix}`;
  const thresholdRows = r.thresholds.map((t) => {
    const meaning = METRIC_GUIDES[t.metric] || 'Custom metric tracked during the test.';
    const rule = thresholdGuide(t.metric, t.threshold);
    const hint = !t.ok ? `<br><span class="hint">Why it failed: ${escapeHtml(thresholdFailureHint(t.metric, t.threshold, r))}</span>` : '';
    return `<tr>
      <td><strong>${escapeHtml(t.metric)}</strong><br><span class="cell-sub">${escapeHtml(meaning)}</span></td>
      <td><code>${escapeHtml(t.threshold)}</code><br><span class="cell-sub">${escapeHtml(rule)}</span>${hint}</td>
      <td>${statusBadge(t.ok)}</td>
    </tr>`;
  }).join('');

  const failedCheckRows = r.failedChecks.length
    ? r.failedChecks.map((c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${c.passes}</td><td class="fail-text">${c.fails}</td></tr>`,
      ).join('')
    : '<tr><td colspan="3" class="muted">No failed checks</td></tr>';

  const statusRows = Object.entries(r.statusCodes).map(([code, count]) =>
    `<tr><td><span class="status-code s${String(code)[0]}xx">${escapeHtml(code)}</span></td><td>${count}</td></tr>`,
  ).join('') || '<tr><td colspan="2" class="muted">No status data</td></tr>';

  const slowestRows = r.endpoints.slowest.map((e) =>
    `<tr><td>${escapeHtml(e.name)}</td><td>${Math.round(e.avg)}ms</td><td>${Math.round(e.min)}ms</td><td>${Math.round(e.max)}ms</td><td>${e.count}</td></tr>`,
  ).join('') || '<tr><td colspan="5" class="muted">No endpoint data</td></tr>';

  const fastestRows = r.endpoints.fastest.map((e) =>
    `<tr><td>${escapeHtml(e.name)}</td><td>${Math.round(e.avg)}ms</td><td>${Math.round(e.min)}ms</td><td>${Math.round(e.max)}ms</td><td>${e.count}</td></tr>`,
  ).join('') || '<tr><td colspan="5" class="muted">No endpoint data</td></tr>';

  const endpointRows = (r.testedEndpoints || []).map((ep) => {
    const stats = ep.tested
      ? `${ep.count.toLocaleString()} calls &middot; avg ${Math.round(ep.avg)}ms &middot; ${Math.round(ep.min)}–${Math.round(ep.max)}ms`
      : `<span class="muted">${escapeHtml(ep.skipReason || 'Not tested')}</span>`;
    const statusSummary = ep.tested && Object.keys(ep.statuses).length
      ? Object.entries(ep.statuses).map(([code, n]) => `<span class="status-code s${String(code)[0]}xx">${code}</span> ${n}`).join(' ')
      : '—';
    return `<tr>
      <td>${methodBadge(ep.method)}</td>
      <td><code>${escapeHtml(ep.path)}</code><br><span class="cell-sub">${escapeHtml(ep.description || '')}</span></td>
      <td>${escapeHtml(ep.group)}</td>
      <td>${endpointStatusBadge(ep.tested)}</td>
      <td>${stats}</td>
      <td>${statusSummary}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No endpoint data</td></tr>';

  const testedCount = (r.testedEndpoints || []).filter((e) => e.tested).length;
  const totalCount = (r.testedEndpoints || []).length;

  const authBanner = r.auth
    ? `<div class="auth-banner ${r.auth.loginOk ? 'auth-ok' : 'auth-fail'}">
        <strong>${escapeHtml(r.roleLabel)} account:</strong> ${escapeHtml(r.auth.email || 'not configured')}
        &middot; Login: ${r.auth.loginOk ? '<span class="pass-text">OK</span>' : `<span class="fail-text">${escapeHtml(r.auth.skipReason || 'Failed')}</span>`}
      </div>`
    : '';

  return `
    ${authBanner}
    <div class="summary-card" style="border-left-color:${r.allThresholdsPass ? 'var(--pass)' : 'var(--fail)'}">
      <h2>Executive Summary — ${escapeHtml(r.roleLabel)}</h2>
      <p>${escapeHtml(r.executiveSummary)}</p>
    </div>

    <section>
      <h2>Tested API Endpoints</h2>
      ${sectionGuide(`API routes for <strong>${escapeHtml(r.roleLabel)}</strong>. <strong>${testedCount} of ${totalCount}</strong> endpoints were called.`)}
      <table>
        <thead><tr><th>Method</th><th>Endpoint</th><th>Group</th><th>Status</th><th>Results</th><th>HTTP Status</th></tr></thead>
        <tbody>${endpointRows}</tbody>
      </table>
    </section>

    <div class="grid">
      <div class="metric-card"><div class="label">Test Duration</div><div class="value">${escapeHtml(r.durationFormatted)}</div><div class="tip">How long the load test ran, including ramp-up and ramp-down.</div></div>
      <div class="metric-card"><div class="label">Virtual Users (max)</div><div class="value">${r.virtualUsers.max}</div><div class="tip">Peak simulated concurrent users during the test.</div></div>
      <div class="metric-card"><div class="label">Total Requests</div><div class="value">${r.requests.total.toLocaleString()}</div><div class="tip">All HTTP calls made. Higher VUs + longer test = more requests.</div></div>
      <div class="metric-card"><div class="label">Successful</div><div class="value" style="color:var(--pass)">${r.requests.successful.toLocaleString()}</div><div class="tip">Requests that returned 2xx without network errors.</div></div>
      <div class="metric-card"><div class="label">Failed</div><div class="value" style="color:var(--fail)">${r.requests.failed.toLocaleString()}</div><div class="tip">Requests that errored or returned non-2xx status.</div></div>
      <div class="metric-card"><div class="label">Error Rate</div><div class="value">${formatPercent(r.requests.errorRate)}</div><div class="tip">Failed ÷ total. Above 5% usually indicates a real problem.</div></div>
      <div class="metric-card"><div class="label">RPS</div><div class="value">${r.requests.rps.toFixed(1)}</div><div class="tip">Throughput — how many requests the server handled per second.</div></div>
      <div class="metric-card"><div class="label">Avg Response</div><div class="value">${Math.round(r.responseTime.avg)}ms</div><div class="tip">Mean latency. Can hide slow outliers — check P95 too.</div></div>
      <div class="metric-card"><div class="label">P95</div><div class="value">${Math.round(r.responseTime.p95)}ms</div><div class="tip">95% of requests were faster than this. Key SLO metric.</div></div>
      <div class="metric-card"><div class="label">Data Sent</div><div class="value">${escapeHtml(r.dataTransfer.sentFormatted)}</div><div class="sub">${formatRate(r.dataTransfer.throughputSent)}</div><div class="tip">Upload bandwidth used by the test.</div></div>
      <div class="metric-card"><div class="label">Data Received</div><div class="value">${escapeHtml(r.dataTransfer.receivedFormatted)}</div><div class="sub">${formatRate(r.dataTransfer.throughputReceived)}</div><div class="tip">Download bandwidth from API responses.</div></div>
    </div>

    <section>
      <h2>Response Time Percentiles</h2>
      ${sectionGuide('Percentiles show the distribution of response times. P50 (median) is typical speed; P95/P99 reveal slow requests that affect real users. A low average with a high P95 means most requests are fast but some are very slow.')}
      <div class="grid">
        <div class="metric-card"><div class="label">Minimum</div><div class="value">${Math.round(r.responseTime.min)}ms</div></div>
        <div class="metric-card"><div class="label">Average</div><div class="value">${Math.round(r.responseTime.avg)}ms</div></div>
        <div class="metric-card"><div class="label">Maximum</div><div class="value">${Math.round(r.responseTime.max)}ms</div></div>
        <div class="metric-card"><div class="label">P90</div><div class="value">${Math.round(r.responseTime.p90)}ms</div></div>
        <div class="metric-card"><div class="label">P95</div><div class="value">${Math.round(r.responseTime.p95)}ms</div></div>
        <div class="metric-card"><div class="label">P99</div><div class="value">${Math.round(r.responseTime.p99)}ms</div></div>
      </div>
    </section>

    <section>
      <h2>Charts</h2>
      ${sectionGuide('These graphs show how the system behaved over the course of the test — not just final numbers. Look for error rate spikes, response time climbing with VUs, and whether performance stabilised after ramp-up.')}
      <div class="charts-grid">
        <div><h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--muted)">Response Time Over Time</h3><p class="guide">Average latency per time bucket. Rising lines under steady VUs suggest the server is struggling.</p><div class="chart-wrap"><canvas id="${sid('chartResponseTime')}"></canvas></div></div>
        <div><h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--muted)">Requests Per Second</h3><p class="guide">Throughput over time. Should roughly track active VUs. Drops may indicate errors or timeouts.</p><div class="chart-wrap"><canvas id="${sid('chartRps')}"></canvas></div></div>
        <div><h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--muted)">Active Virtual Users</h3><p class="guide">How many simulated users were active. The ramp-up/ramp-down pattern is defined in the test script.</p><div class="chart-wrap"><canvas id="${sid('chartVus')}"></canvas></div></div>
        <div><h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--muted)">Error Rate</h3><p class="guide">Percentage of failed requests over time. Should stay near 0%. Spikes often correlate with ramp-up or server limits.</p><div class="chart-wrap"><canvas id="${sid('chartErrors')}"></canvas></div></div>
        <div><h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--muted)">Response Time Distribution</h3><p class="guide">How requests are spread across latency buckets. A bar shifted right means more slow requests.</p><div class="chart-wrap"><canvas id="${sid('chartHistogram')}"></canvas></div></div>
      </div>
    </section>

    <section>
      <h2>Threshold Results</h2>
      ${sectionGuide('Thresholds are pass/fail performance budgets (SLOs) set before the test runs. They are defined in <code>performance/load-test.js</code>. PASS means the server met the budget under load; FAIL means it did not and needs investigation.')}
      <table>
        <thead><tr><th>Metric &amp; Purpose</th><th>Rule &amp; Meaning</th><th>Result</th></tr></thead>
        <tbody>${thresholdRows || '<tr><td colspan="3" class="muted">No thresholds defined</td></tr>'}</tbody>
      </table>
    </section>

    <section>
      <h2>Failed Checks</h2>
      ${sectionGuide('Checks validate response content (e.g. "status is 200", "body contains healthy"). Unlike thresholds, these are per-assertion pass/fail counts. A failed check means the API returned something unexpected — even if it was fast.')}
      <table>
        <thead><tr><th>Check</th><th>Passes</th><th>Fails</th></tr></thead>
        <tbody>${failedCheckRows}</tbody>
      </table>
    </section>

    <section>
      <h2>HTTP Status Code Distribution</h2>
      ${sectionGuide('Breakdown of HTTP status codes returned. Healthy tests are mostly 2xx (green). 4xx = client/auth errors; 5xx = server errors.')}
      <table>
        <thead><tr><th>Status Code</th><th>Count</th></tr></thead>
        <tbody>${statusRows}</tbody>
      </table>
    </section>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
      <section>
        <h2>Slowest Endpoints</h2>
        ${sectionGuide('Routes with the highest average response time. Optimise these first — they are the biggest contributors to slow P95.')}
        <table>
          <thead><tr><th>Endpoint</th><th>Avg</th><th>Min</th><th>Max</th><th>Count</th></tr></thead>
          <tbody>${slowestRows}</tbody>
        </table>
      </section>
      <section>
        <h2>Fastest Endpoints</h2>
        ${sectionGuide('Routes with the lowest average response time. Use as a baseline — if even simple endpoints are slow, the issue is likely infrastructure (cold start, DB, network) not application logic.')}
        <table>
          <thead><tr><th>Endpoint</th><th>Avg</th><th>Min</th><th>Max</th><th>Count</th></tr></thead>
          <tbody>${fastestRows}</tbody>
        </table>
      </section>
    </div>
    <script data-panel="${idSuffix}">
    (function() {
      const chartDefaults = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
      const charts = ${JSON.stringify(charts)};
      const sid = (id) => id + ${JSON.stringify(idSuffix)};
      new Chart(document.getElementById(sid('chartResponseTime')), {
        type: 'line',
        data: { labels: charts.responseTimeSeries.labels, datasets: [{ data: charts.responseTimeSeries.values, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.1)', fill: true, tension: 0.3, pointRadius: 2 }] },
        options: { ...chartDefaults, scales: { y: { title: { display: true, text: 'ms' } } } }
      });
      new Chart(document.getElementById(sid('chartRps')), {
        type: 'line',
        data: { labels: charts.rpsSeries.labels, datasets: [{ data: charts.rpsSeries.values, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', fill: true, tension: 0.3, pointRadius: 2 }] },
        options: { ...chartDefaults, scales: { y: { title: { display: true, text: 'req/s' } } } }
      });
      new Chart(document.getElementById(sid('chartVus')), {
        type: 'line',
        data: { labels: charts.vusSeries.labels, datasets: [{ data: charts.vusSeries.values, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', fill: true, tension: 0.3, stepped: true, pointRadius: 2 }] },
        options: { ...chartDefaults, scales: { y: { title: { display: true, text: 'VUs' }, beginAtZero: true } } }
      });
      new Chart(document.getElementById(sid('chartErrors')), {
        type: 'line',
        data: { labels: charts.errorSeries.labels, datasets: [{ data: charts.errorSeries.values, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', fill: true, tension: 0.3, pointRadius: 2 }] },
        options: { ...chartDefaults, scales: { y: { title: { display: true, text: '%' }, beginAtZero: true } } }
      });
      new Chart(document.getElementById(sid('chartHistogram')), {
        type: 'bar',
        data: { labels: charts.histogram.labels, datasets: [{ data: charts.histogram.values, backgroundColor: ['#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e3a5f'] }] },
        options: { ...chartDefaults, scales: { y: { title: { display: true, text: '% of samples' }, beginAtZero: true } } }
      });
    })();
    </script>`;
}

function buildComparisonTable(reports) {
  const rows = ['coordinator', 'worker', 'combined'].map((key) => {
    const r = reports[key].report;
    return `<tr>
      <td><strong>${escapeHtml(r.roleLabel)}</strong></td>
      <td>${r.virtualUsers.max}</td>
      <td>${r.requests.total.toLocaleString()}</td>
      <td>${r.requests.rps.toFixed(1)}</td>
      <td>${formatPercent(r.requests.errorRate)}</td>
      <td>${Math.round(r.responseTime.avg)}ms</td>
      <td>${Math.round(r.responseTime.p95)}ms</td>
      <td>${statusBadge(r.allThresholdsPass)}</td>
    </tr>`;
  }).join('');
  return `<section>
    <h2>Role Comparison</h2>
    ${sectionGuide('Side-by-side summary for Coordinator vs Worker vs Combined. Each role runs 5 concurrent VUs independently.')}
    <table>
      <thead><tr><th>Role</th><th>Max VUs</th><th>Requests</th><th>RPS</th><th>Error Rate</th><th>Avg</th><th>P95</th><th>Thresholds</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function buildTabbedHtml(reports, meta) {
  const combined = reports.combined.report;
  const panels = [
    { id: 'overview', label: 'Overview', content: buildComparisonTable(reports) + buildReportPanel(reports.combined.report, reports.combined.charts, '-overview') },
    { id: 'coordinator', label: 'Coordinator', content: buildReportPanel(reports.coordinator.report, reports.coordinator.charts, '-coordinator') },
    { id: 'worker', label: 'Worker', content: buildReportPanel(reports.worker.report, reports.worker.charts, '-worker') },
  ];

  const tabButtons = panels.map((p, i) =>
    `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${p.id}">${escapeHtml(p.label)}</button>`,
  ).join('');

  const tabPanels = panels.map((p, i) =>
    `<div id="panel-${p.id}" class="tab-panel${i === 0 ? ' active' : ''}">${p.content}</div>`,
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Report — ${escapeHtml(combined.testName)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #f8fafc; --card: #ffffff; --border: #e2e8f0;
      --text: #0f172a; --muted: #64748b; --accent: #2563eb;
      --pass: #16a34a; --fail: #dc2626; --warn: #d97706;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
    header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: #fff; padding: 2.5rem 0; margin-bottom: 0; }
    header .container { padding-top: 0; padding-bottom: 0; }
    header h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem; }
    header .meta { opacity: 0.85; font-size: 0.9rem; }
    .tab-bar { display: flex; gap: 0.25rem; padding: 1rem 1.5rem 0; max-width: 1200px; margin: 0 auto; background: var(--bg); border-bottom: 2px solid var(--border); }
    .tab-btn { padding: 0.75rem 1.5rem; border: none; background: transparent; color: var(--muted); font-size: 0.95rem; font-weight: 600; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .summary-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; border-left: 4px solid var(--pass); }
    .summary-card h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .summary-card p { font-size: 1.05rem; }
    .auth-banner { padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .auth-banner.auth-ok { background: #dcfce7; border: 1px solid #86efac; }
    .auth-banner.auth-fail { background: #fee2e2; border: 1px solid #fca5a5; }
    .pass-text { color: var(--pass); font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .metric-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; text-align: center; }
    .metric-card .label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.25rem; }
    .metric-card .value { font-size: 1.5rem; font-weight: 700; color: var(--text); }
    .metric-card .sub { font-size: 0.75rem; color: var(--muted); margin-top: 0.15rem; }
    section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
    section h2 { font-size: 1.15rem; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { font-weight: 600; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 1.5rem; }
    .chart-wrap { position: relative; height: 280px; }
    .badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; }
    .badge.pass { background: #dcfce7; color: var(--pass); }
    .badge.fail { background: #fee2e2; color: var(--fail); }
    .badge.skip { background: #f1f5f9; color: var(--muted); }
    .method-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; font-family: monospace; }
    .fail-text { color: var(--fail); font-weight: 600; }
    .muted { color: var(--muted); font-style: italic; }
    .guide { color: var(--muted); font-size: 0.9rem; margin: -0.5rem 0 1rem; line-height: 1.55; }
    .cell-sub { display: block; font-size: 0.8rem; color: var(--muted); font-weight: 400; margin-top: 0.25rem; line-height: 1.45; }
    .hint { display: block; font-size: 0.8rem; color: var(--fail); margin-top: 0.35rem; }
    .metric-card .tip { font-size: 0.7rem; color: var(--muted); margin-top: 0.35rem; line-height: 1.3; }
    .status-code { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; }
    .s2xx { background: #dcfce7; color: #166534; }
    .s3xx { background: #dbeafe; color: #1e40af; }
    .s4xx { background: #fef3c7; color: #92400e; }
    .s5xx { background: #fee2e2; color: #991b1b; }
    footer { text-align: center; padding: 2rem; color: var(--muted); font-size: 0.85rem; }
    code { background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.85rem; }
    @media (max-width: 600px) { .charts-grid { grid-template-columns: 1fr; } .tab-bar { overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>Performance Test Report</h1>
      <div class="meta">${escapeHtml(combined.testName)} &middot; ${escapeHtml(combined.environment)} &middot; ${escapeHtml(combined.generatedAt)}</div>
    </div>
  </header>
  <div class="tab-bar">${tabButtons}</div>
  <div class="container">${tabPanels}</div>
  <footer>Generated by CareCliQ Performance Testing &middot; k6</footer>
  <script>
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      });
    });
  </script>
</body>
</html>`;
}

function buildHtml(report, charts) {
  return buildTabbedHtml({ combined: { report, charts }, coordinator: { report, charts }, worker: { report, charts } }, {});
}

function timestampSlug() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.summary || !args.outputDir) {
    console.error('Usage: generate-report.js --summary <file> --metrics <file> --output-dir <dir> [--test-name name] [--environment env] [--timestamped]');
    process.exit(1);
  }

  const summary = readJson(args.summary);
  const ndjson = parseNdjson(args.metrics);
  const meta = { testName: args.testName, environment: args.environment };

  const reports = {
    combined: buildReport(summary, ndjson, meta, 'combined'),
    coordinator: buildReport(summary, ndjson, meta, 'coordinator'),
    worker: buildReport(summary, ndjson, meta, 'worker'),
  };

  const reportJson = {
    generatedAt: new Date().toISOString(),
    testName: args.testName,
    environment: args.environment,
    roles: {
      combined: reports.combined.report,
      coordinator: reports.coordinator.report,
      worker: reports.worker.report,
    },
  };

  fs.mkdirSync(args.outputDir, { recursive: true });
  const historyDir = path.join(args.outputDir, 'history');
  fs.mkdirSync(historyDir, { recursive: true });

  const htmlPath = path.join(args.outputDir, 'report.html');
  const jsonPath = path.join(args.outputDir, 'report.json');
  const html = buildTabbedHtml(reports, meta);

  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2));

  if (args.timestamped) {
    const slug = `${timestampSlug()}_${args.testName}`;
    fs.writeFileSync(path.join(historyDir, `${slug}.html`), html);
    fs.writeFileSync(path.join(historyDir, `${slug}.json`), JSON.stringify(reportJson, null, 2));
  }

  return { htmlPath, jsonPath };
}

if (require.main === module) {
  main();
}

module.exports = { buildReport, buildHtml };
