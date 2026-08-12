import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration', true);
const apiDuration = new Trend('api_duration', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const TEST_NAME = __ENV.K6_TEST_NAME || 'load';
const ENVIRONMENT = __ENV.K6_ENV || 'Local';

const ROLES = {
  coordinator: {
    email: __ENV.K6_COORDINATOR_EMAIL || __ENV.K6_TEST_EMAIL || '',
    password: __ENV.K6_COORDINATOR_PASSWORD || __ENV.K6_TEST_PASSWORD || '',
  },
  worker: {
    email: __ENV.K6_WORKER_EMAIL || '',
    password: __ENV.K6_WORKER_PASSWORD || '',
  },
};

const SHARED_AUTH_ENDPOINTS = [
  { method: 'GET', path: '/api/auth/me', group: 'Auth' },
  { method: 'GET', path: '/api/alerts', group: 'Alerts' },
  { method: 'GET', path: '/api/alerts/unread', group: 'Alerts' },
  { method: 'GET', path: '/api/sessions/recent', group: 'Sessions' },
  { method: 'GET', path: '/api/compliance/rules', group: 'Compliance' },
];

const COORDINATOR_ENDPOINTS = [
  { method: 'GET', path: '/api/participants', group: 'Participants' },
  { method: 'GET', path: '/api/participants/dashboard-stats', group: 'Participants' },
  { method: 'GET', path: '/api/dashboard/coordinator', group: 'Dashboard' },
  { method: 'GET', path: '/api/coordinator/team', group: 'Coordinator' },
  { method: 'GET', path: '/api/coordinator/shifts', group: 'Coordinator' },
  { method: 'GET', path: '/api/coordinator/compliance-overview', group: 'Coordinator' },
  { method: 'GET', path: '/api/coordinator/notifications', group: 'Coordinator' },
  { method: 'GET', path: '/api/coordinator/goals', group: 'Coordinator' },
  { method: 'GET', path: '/api/incidents', group: 'Incidents' },
  { method: 'GET', path: '/api/reports/compliance-overview', group: 'Reports' },
  {
    method: 'GET',
    path: '/api/participants/{participant_id}',
    group: 'Participants',
    dynamicKey: 'participantId',
  },
];

const WORKER_ENDPOINTS = [
  { method: 'GET', path: '/api/worker/my-clients', group: 'Worker' },
  { method: 'GET', path: '/api/dashboard/worker', group: 'Dashboard' },
  { method: 'GET', path: '/api/dashboard/worker-landing', group: 'Dashboard' },
  { method: 'GET', path: '/api/worker/shifts', group: 'Worker Shifts', query: 'filter=today' },
  { method: 'GET', path: '/api/worker/shifts/counts', group: 'Worker Shifts' },
  { method: 'GET', path: '/api/worker/my-compliance', group: 'Worker' },
  { method: 'GET', path: '/api/worker/performance-dashboard', group: 'Worker Performance' },
  { method: 'GET', path: '/api/worker/feedback/unread-count', group: 'Worker Performance' },
  { method: 'GET', path: '/api/worker/training/certifications', group: 'Worker Training' },
  {
    method: 'GET',
    path: '/api/worker/my-clients/{participant_id}',
    group: 'Worker',
    dynamicKey: 'participantId',
  },
  {
    method: 'GET',
    path: '/api/worker/shifts/{shift_id}',
    group: 'Worker Shifts',
    dynamicKey: 'shiftId',
  },
];

const STAGES = [
  { duration: '30s', target: 5 },
  { duration: '1m', target: 5 },
  { duration: '30s', target: 0 },
];

const IS_REMOTE = BASE_URL.includes('onrender.com')
  || BASE_URL.includes('render.com')
  || ENVIRONMENT === 'Development'
  || ENVIRONMENT === 'Staging';

const THRESHOLDS = IS_REMOTE
  ? {
      'http_req_duration{role:coordinator}': ['p(95)<20000'],
      'http_req_duration{role:worker}': ['p(95)<20000'],
      'http_req_failed{role:coordinator}': ['rate<0.05'],
      'http_req_failed{role:worker}': ['rate<0.05'],
      'errors{role:coordinator}': ['rate<0.05'],
      'errors{role:worker}': ['rate<0.05'],
      'health_duration{role:coordinator}': ['p(95)<15000'],
      'health_duration{role:worker}': ['p(95)<15000'],
    }
  : {
      'http_req_duration{role:coordinator}': ['p(95)<2000'],
      'http_req_duration{role:worker}': ['p(95)<2000'],
      'http_req_failed{role:coordinator}': ['rate<0.05'],
      'http_req_failed{role:worker}': ['rate<0.05'],
      'errors{role:coordinator}': ['rate<0.05'],
      'errors{role:worker}': ['rate<0.05'],
      'health_duration{role:coordinator}': ['p(95)<500'],
      'health_duration{role:worker}': ['p(95)<500'],
    };

export const options = {
  setupTimeout: '180s',
  scenarios: {
    coordinator: {
      executor: 'ramping-vus',
      exec: 'coordinatorFlow',
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: '10s',
      tags: { role: 'coordinator' },
    },
    worker: {
      executor: 'ramping-vus',
      exec: 'workerFlow',
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: '10s',
      tags: { role: 'worker' },
    },
  },
  thresholds: THRESHOLDS,
  tags: {
    test_name: TEST_NAME,
    environment: ENVIRONMENT,
  },
};

const HTTP_PARAMS = { timeout: '60s' };

function login(email, password, role) {
  if (!email || !password) {
    return {
      token: null,
      loginOk: false,
      email: email || '',
      passwordConfigured: false,
      skipReason: password ? 'No email configured' : 'Password not loaded — check .env quoting for special characters (#)',
    };
  }
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      identifier: email,
      password,
      remember_device: false,
      device_id: `k6-${role}`,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /api/auth/login', role },
      timeout: '60s',
    },
  );
  if (res.status === 200) {
    const body = res.json();
    if (body.mfa_required) {
      return { token: null, loginOk: false, email, passwordConfigured: true, skipReason: 'MFA required — use a test account without MFA' };
    }
    const token = body.access_token || body.token || null;
    return {
      token,
      loginOk: !!token,
      email,
      passwordConfigured: true,
      skipReason: token ? null : 'Login succeeded but no access token returned',
    };
  }
  let detail = '';
  try {
    const body = res.json();
    if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
  } catch (_) {
    detail = (res.body || '').slice(0, 120);
  }
  const skipReason = detail
    ? `Login failed (HTTP ${res.status}): ${detail}`
    : `Login failed (HTTP ${res.status})`;
  return { token: null, loginOk: false, email, passwordConfigured: true, skipReason };
}

function extractFirstId(body) {
  if (!body) return null;
  if (Array.isArray(body)) {
    for (const item of body) {
      if (!item || typeof item !== 'object') continue;
      if (item.id) return String(item.id);
      if (item.participant_id) return String(item.participant_id);
      if (item.participant && item.participant.id) return String(item.participant.id);
    }
    return null;
  }
  if (Array.isArray(body.participants) && body.participants.length) {
    return extractFirstId(body.participants);
  }
  if (body.id) return String(body.id);
  if (body.participant_id) return String(body.participant_id);
  return null;
}

function extractShiftId(body) {
  if (!body) return null;
  const shifts = body.shifts || (Array.isArray(body) ? body : null);
  if (!Array.isArray(shifts) || !shifts.length) return null;
  const shift = shifts[0];
  if (!shift || typeof shift !== 'object') return null;
  return shift.id || shift.shift_id ? String(shift.id || shift.shift_id) : null;
}

function prefetchRoleContext(token, role) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const ctx = { participantId: null, shiftId: null };

  if (role === 'coordinator') {
    const res = http.get(`${BASE_URL}/api/participants`, {
      headers,
      tags: { name: 'GET /api/participants', role: 'setup' },
      ...HTTP_PARAMS,
    });
    if (res.status === 200) {
      try {
        ctx.participantId = extractFirstId(res.json());
      } catch (_) {
        /* ignore */
      }
    }
  } else if (role === 'worker') {
    const clientsRes = http.get(`${BASE_URL}/api/worker/my-clients`, {
      headers,
      tags: { name: 'GET /api/worker/my-clients', role: 'setup' },
      ...HTTP_PARAMS,
    });
    if (clientsRes.status === 200) {
      try {
        ctx.participantId = extractFirstId(clientsRes.json());
      } catch (_) {
        /* ignore */
      }
    }

    for (const filter of ['today', 'week', 'upcoming']) {
      if (ctx.shiftId) break;
      const shiftsRes = http.get(`${BASE_URL}/api/worker/shifts?filter=${filter}`, {
        headers,
        tags: { name: 'GET /api/worker/shifts', role: 'setup' },
        ...HTTP_PARAMS,
      });
      if (shiftsRes.status === 200) {
        try {
          ctx.shiftId = extractShiftId(shiftsRes.json());
        } catch (_) {
          /* ignore */
        }
      }
    }
  }

  return ctx;
}

export function setup() {
  const health = http.get(`${BASE_URL}/api/health`, {
    tags: { name: 'GET /api/health', role: 'setup' },
    ...HTTP_PARAMS,
  });
  if (health.status !== 200) {
    throw new Error(`Backend not reachable at ${BASE_URL} (status ${health.status})`);
  }

  const coordinator = login(ROLES.coordinator.email, ROLES.coordinator.password, 'coordinator');
  const worker = login(ROLES.worker.email, ROLES.worker.password, 'worker');

  if (coordinator.loginOk) {
    coordinator.context = prefetchRoleContext(coordinator.token, 'coordinator');
  } else {
    coordinator.context = { participantId: null, shiftId: null };
  }

  if (worker.loginOk) {
    worker.context = prefetchRoleContext(worker.token, 'worker');
  } else {
    worker.context = { participantId: null, shiftId: null };
  }

  return { coordinator, worker };
}

function resolvePath(template, ctx, dynamicKey) {
  if (!dynamicKey) return template;
  const id = ctx[dynamicKey];
  if (!id) return null;
  if (dynamicKey === 'participantId') {
    return template.replace('{participant_id}', id);
  }
  if (dynamicKey === 'shiftId') {
    return template.replace('{shift_id}', id);
  }
  return null;
}

function callEndpoint(spec, headers, ctx, role) {
  const resolvedPath = resolvePath(spec.path, ctx, spec.dynamicKey);
  if (spec.dynamicKey && !resolvedPath) return;

  const urlPath = resolvedPath || spec.path;
  const url = spec.query ? `${BASE_URL}${urlPath}?${spec.query}` : `${BASE_URL}${urlPath}`;
  const tagName = `${spec.method} ${spec.path}`;

  const res = http.request(spec.method, url, null, {
    headers,
    tags: { name: tagName, group: spec.group, role },
    ...HTTP_PARAMS,
  });

  apiDuration.add(res.timings.duration, { role });
  const ok = check(res, {
    [`${tagName} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
  errorRate.add(!ok, { role });
}

function runAuthenticatedEndpoints(endpoints, headers, ctx, role) {
  for (const spec of endpoints) {
    callEndpoint(spec, headers, ctx, role);
  }
}

function runRoleFlow(session, role, roleEndpoints) {
  const tags = { role };

  group(`${role} — Health Check`, () => {
    const res = http.get(`${BASE_URL}/api/health`, {
      tags: { name: 'GET /api/health', ...tags },
    });
    healthDuration.add(res.timings.duration, tags);
    const ok = check(res, {
      'health status is 200': (r) => r.status === 200,
      'health body contains status': (r) => r.body && r.body.includes('healthy'),
    });
    errorRate.add(!ok, tags);
  });

  if (session.token) {
    const headers = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };
    const ctx = session.context || { participantId: null, shiftId: null };

    group(`${role} — Shared API`, () => {
      runAuthenticatedEndpoints(SHARED_AUTH_ENDPOINTS, headers, ctx, role);
    });

    group(`${role} — Role API`, () => {
      runAuthenticatedEndpoints(roleEndpoints, headers, ctx, role);
    });
  }

  sleep(1);
}

export function coordinatorFlow(data) {
  runRoleFlow(data.coordinator, 'coordinator', COORDINATOR_ENDPOINTS);
}

export function workerFlow(data) {
  runRoleFlow(data.worker, 'worker', WORKER_ENDPOINTS);
}

import { buildHandleSummary } from './scripts/k6-report.js';

export const handleSummary = buildHandleSummary({
  testName: TEST_NAME,
  environment: ENVIRONMENT,
});
