'use strict';

function filterNdjsonByRole(ndjson, role) {
  if (!role || role === 'combined') {
    return ndjson.filter((e) => {
      const r = e.data?.tags?.role;
      return r === 'coordinator' || r === 'worker';
    });
  }
  return ndjson.filter((e) => e.data?.tags?.role === role);
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStatsFromNdjson(ndjson) {
  const durations = [];
  const healthDurations = [];
  let totalReqs = 0;
  let failCount = 0;
  let dataSent = 0;
  let dataReceived = 0;
  const timestamps = [];
  let maxVus = 0;

  for (const e of ndjson) {
    if (e.type !== 'Point' || !e.data) continue;
    const tags = e.data.tags || {};
    const t = new Date(e.data.time).getTime();

    if (e.metric === 'http_reqs') {
      totalReqs += e.data.value || 1;
      timestamps.push(t);
    }
    if (e.metric === 'http_req_failed' && e.data.value > 0) failCount += 1;
    if (e.metric === 'http_req_duration') {
      durations.push(e.data.value);
      const ep = tags.name || '';
      if (ep.includes('/api/health')) healthDurations.push(e.data.value);
    }
    if (e.metric === 'data_sent') dataSent += e.data.value;
    if (e.metric === 'data_received') dataReceived += e.data.value;
    if (e.metric === 'vus') maxVus = Math.max(maxVus, e.data.value);
  }

  durations.sort((a, b) => a - b);
  healthDurations.sort((a, b) => a - b);
  const durationMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const durationSec = durationMs / 1000 || 1;
  const errorRate = totalReqs > 0 ? failCount / totalReqs : 0;

  return {
    totalRequests: Math.round(totalReqs),
    failedRequests: Math.round(failCount),
    successfulRequests: Math.round(totalReqs - failCount),
    errorRate,
    rps: totalReqs / durationSec,
    avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    minDuration: durations[0] || 0,
    maxDuration: durations[durations.length - 1] || 0,
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    healthP95: percentile(healthDurations, 95),
    dataSent,
    dataReceived,
    durationMs,
    vusMax: maxVus || 5,
    throughputSent: dataSent / durationSec,
    throughputReceived: dataReceived / durationSec,
  };
}

function evaluateThresholds(stats, environment = 'Local') {
  const remote = environment === 'Development'
    || environment === 'Staging'
    || environment === 'Production';
  const httpP95Max = remote ? 20000 : 2000;
  const healthP95Max = remote ? 15000 : 500;
  return [
    { metric: 'http_req_duration', threshold: `p(95)<${httpP95Max}`, ok: stats.p95 < httpP95Max },
    { metric: 'http_req_failed', threshold: 'rate<0.05', ok: stats.errorRate < 0.05 },
    { metric: 'health_duration', threshold: `p(95)<${healthP95Max}`, ok: stats.healthP95 < healthP95Max || stats.healthP95 === 0 },
    { metric: 'errors', threshold: 'rate<0.05', ok: stats.errorRate < 0.05 },
  ];
}

function maskEmail(email) {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const masked = user.length <= 2 ? '**' : `${user.slice(0, 2)}***`;
  return `${masked}@${domain}`;
}

function buildRoleAuthInfo(summary, role) {
  const setup = summary.setup_data || {};
  const session = setup[role] || {};
  return {
    email: maskEmail(session.email),
    loginOk: !!session.loginOk,
    skipReason: session.skipReason || null,
  };
}

module.exports = {
  filterNdjsonByRole,
  computeStatsFromNdjson,
  evaluateThresholds,
  buildRoleAuthInfo,
  maskEmail,
};
