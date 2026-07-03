import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

function metricVal(metrics, name, key, fallback) {
  fallback = fallback === undefined ? 0 : fallback;
  var m = metrics[name];
  if (!m || !m.values) return fallback;
  return m.values[key] !== undefined ? m.values[key] : fallback;
}

function fmtDuration(ms) {
  if (ms < 1000) return Math.round(ms) + 'ms';
  var secs = ms / 1000;
  if (secs < 60) return secs.toFixed(1) + 's';
  return Math.floor(secs / 60) + 'm ' + Math.round(secs % 60) + 's';
}

function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function fmtPct(rate) {
  return (rate * 100).toFixed(2) + '%';
}

function collectChecks(group, out) {
  out = out || [];
  if (!group) return out;
  if (group.checks) {
    for (var i = 0; i < group.checks.length; i++) {
      var c = group.checks[i];
      out.push({ name: c.name, passes: c.passes || 0, fails: c.fails || 0, pass: (c.fails || 0) === 0 });
    }
  }
  if (group.groups) {
    for (var j = 0; j < group.groups.length; j++) collectChecks(group.groups[j], out);
  }
  return out;
}

function buildHistogram(avg, min, max, p90, p95, p99) {
  var bins = ['<100ms', '100-250ms', '250-500ms', '500ms-1s', '1-2s', '>2s'];
  var edges = [0, 100, 250, 500, 1000, 2000, 999999];
  var markers = [min, avg, p90, p95, p99, max];
  var counts = [0, 0, 0, 0, 0, 0];
  for (var m = 0; m < markers.length; m++) {
    for (var i = 0; i < edges.length - 1; i++) {
      if (markers[m] >= edges[i] && markers[m] < edges[i + 1]) { counts[i]++; break; }
    }
  }
  var total = 0;
  for (var t = 0; t < counts.length; t++) total += counts[t];
  total = total || 1;
  var values = [];
  for (var v = 0; v < counts.length; v++) values.push(Math.round((counts[v] / total) * 100));
  return { labels: bins, values: values };
}

export function generateK6Report(data, meta) {
  meta = meta || {};
  var metrics = data.metrics || {};
  var state = data.state || {};
  var testName = meta.testName || 'load';
  var environment = meta.environment || 'Local';

  var total = Math.round(metricVal(metrics, 'http_reqs', 'count'));
  var failRate = metricVal(metrics, 'http_req_failed', 'rate');
  var failed = Math.round(total * failRate);
  var rps = metricVal(metrics, 'http_reqs', 'rate');
  var avg = metricVal(metrics, 'http_req_duration', 'avg');
  var min = metricVal(metrics, 'http_req_duration', 'min');
  var max = metricVal(metrics, 'http_req_duration', 'max');
  var p90 = metricVal(metrics, 'http_req_duration', 'p(90)');
  var p95 = metricVal(metrics, 'http_req_duration', 'p(95)');
  var p99 = metricVal(metrics, 'http_req_duration', 'p(99)');
  var sent = metricVal(metrics, 'data_sent', 'count');
  var received = metricVal(metrics, 'data_received', 'count');
  var vusMax = state.vusMax || metricVal(metrics, 'vus_max', 'max', metricVal(metrics, 'vus', 'max'));
  var durationMs = state.testRunDurationMs || 0;
  var checks = collectChecks(data.root_group);
  var failedChecks = checks.filter(function (c) { return !c.pass; });

  var thresholds = [];
  for (var key in metrics) {
    if (!metrics[key].thresholds) continue;
    var th = metrics[key].thresholds;
    if (Array.isArray(th)) {
      for (var ti = 0; ti < th.length; ti++) {
        thresholds.push({ metric: key, threshold: th[ti].threshold || th[ti], ok: th[ti].ok !== undefined ? th[ti].ok : true });
      }
    } else {
      for (var expr in th) {
        var val = th[expr];
        var ok = typeof val === 'boolean' ? !val : (typeof val === 'object' ? val.ok !== false : !!val);
        thresholds.push({ metric: key, threshold: expr, ok: ok });
      }
    }
  }
  var allPass = thresholds.every(function (t) { return t.ok; });
  var histogram = buildHistogram(avg, min, max, p90, p95, p99);

  var summary = allPass
    ? 'Test completed successfully. ' + total + ' requests at ' + rps.toFixed(1) + ' RPS, error rate ' + fmtPct(failRate) + ', P95 ' + Math.round(p95) + 'ms.'
    : 'Test completed with threshold failures. Error rate ' + fmtPct(failRate) + ', P95 ' + Math.round(p95) + 'ms.';

  var report = {
    generatedAt: new Date().toISOString(),
    testName: testName,
    environment: environment,
    durationMs: durationMs,
    durationFormatted: fmtDuration(durationMs),
    virtualUsers: { max: vusMax },
    requests: { total: total, successful: total - failed, failed: failed, errorRate: failRate, rps: rps },
    responseTime: { avg: avg, min: min, max: max, p90: p90, p95: p95, p99: p99 },
    dataTransfer: { sent: sent, received: received, sentFormatted: fmtBytes(sent), receivedFormatted: fmtBytes(received) },
    thresholds: thresholds,
    checks: checks,
    failedChecks: failedChecks,
    executiveSummary: summary,
    allThresholdsPass: allPass,
    raw: data,
  };

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Performance Report</title>'
    + '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>'
    + '<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#0f172a}'
    + '.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem;margin-bottom:1rem}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem}'
    + '.metric{text-align:center;padding:0.75rem;background:#f8fafc;border-radius:8px}'
    + '.metric .v{font-size:1.4rem;font-weight:700}.metric .l{font-size:0.75rem;color:#64748b;text-transform:uppercase}'
    + 'h1{color:#1e3a5f}h2{font-size:1rem;color:#64748b;margin:1.5rem 0 0.75rem}'
    + '.pass{color:#16a34a}.fail{color:#dc2626}</style></head><body>'
    + '<h1>Performance Report: ' + testName + '</h1>'
    + '<p>' + environment + ' &middot; ' + report.generatedAt + '</p>'
    + '<div class="card"><h2>Executive Summary</h2><p>' + summary + '</p></div>'
    + '<div class="grid">'
    + '<div class="metric"><div class="v">' + fmtDuration(durationMs) + '</div><div class="l">Duration</div></div>'
    + '<div class="metric"><div class="v">' + vusMax + '</div><div class="l">Max VUs</div></div>'
    + '<div class="metric"><div class="v">' + total + '</div><div class="l">Requests</div></div>'
    + '<div class="metric"><div class="v">' + rps.toFixed(1) + '</div><div class="l">RPS</div></div>'
    + '<div class="metric"><div class="v">' + fmtPct(failRate) + '</div><div class="l">Error Rate</div></div>'
    + '<div class="metric"><div class="v">' + Math.round(avg) + 'ms</div><div class="l">Avg Response</div></div>'
    + '<div class="metric"><div class="v">' + Math.round(p95) + 'ms</div><div class="l">P95</div></div>'
    + '<div class="metric"><div class="v">' + fmtBytes(sent) + '</div><div class="l">Data Sent</div></div>'
    + '</div>'
    + '<div class="card"><h2>Response Time Distribution</h2><canvas id="hist" height="200"></canvas></div>'
    + '<div class="card"><h2>Thresholds</h2><ul>'
    + thresholds.map(function (t) {
      return '<li class="' + (t.ok ? 'pass' : 'fail') + '">' + t.metric + ' ' + t.threshold + ' — ' + (t.ok ? 'PASS' : 'FAIL') + '</li>';
    }).join('')
    + '</ul></div>'
    + '<p style="color:#64748b;font-size:0.85rem">Run via <code>./performance/run-test.sh</code> for full time-series charts.</p>'
    + '<script>new Chart(document.getElementById("hist"),{type:"bar",data:{labels:'
    + JSON.stringify(histogram.labels) + ',datasets:[{data:' + JSON.stringify(histogram.values)
    + ',backgroundColor:["#93c5fd","#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e3a5f"]}]},options:{plugins:{legend:{display:false}}}});</script>'
    + '</body></html>';

  return { json: report, html: html };
}

export function buildHandleSummary(meta) {
  return function (data) {
    if (__ENV.K6_WRAPPED === 'true') return {};
    var reports = generateK6Report(data, meta);
    var stdout = textSummary(data, { indent: ' ', enableColors: true });
    stdout += '\n\nPerformance test completed successfully.\n\n';
    stdout += 'HTML Report:\nperformance/reports/report.html\n\n';
    stdout += 'JSON Report:\nperformance/reports/report.json\n';
    return {
      'performance/reports/report.json': JSON.stringify(reports.json, null, 2),
      'performance/reports/report.html': reports.html,
      stdout: stdout,
    };
  };
}
