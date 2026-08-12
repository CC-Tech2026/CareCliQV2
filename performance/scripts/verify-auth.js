#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadK6Env() {
  const vars = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('K6_') && val) vars[key] = val;
  }
  if (Object.keys(vars).length) return vars;

  const candidates = [
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key.startsWith('K6_')) vars[key] = val;
    }
    if (Object.keys(vars).length) break;
  }
  return vars;
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

async function main() {
  const env = loadK6Env();
  const base = env.K6_BASE_URL || 'http://localhost:8000';
  const accounts = [
    { role: 'Coordinator', email: env.K6_COORDINATOR_EMAIL, password: env.K6_COORDINATOR_PASSWORD },
    { role: 'Worker', email: env.K6_WORKER_EMAIL, password: env.K6_WORKER_PASSWORD },
  ];

  console.log(`Target: ${base}`);
  console.log('');

  for (const acct of accounts) {
    if (!acct.email || !acct.password) {
      console.log(`${acct.role}: SKIP — credentials not set in .env`);
      continue;
    }
    console.log(`${acct.role}: ${acct.email}`);
    console.log(`  Password loaded: yes (${acct.password.length} chars)`);

    const res = await postJson(`${base}/api/auth/login`, {
      identifier: acct.email,
      password: acct.password,
      remember_device: false,
      device_id: 'k6-verify',
    });

    if (res.status === 200 && res.json?.access_token) {
      console.log(`  Result: OK — token received`);
      if (res.json.mfa_required) console.log('  Warning: MFA required');
    } else {
      const detail = res.json?.detail || res.raw?.slice(0, 200) || 'no body';
      console.log(`  Result: FAIL — HTTP ${res.status}`);
      console.log(`  Detail: ${detail}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
