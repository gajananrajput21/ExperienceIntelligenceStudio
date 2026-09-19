import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'eis-smoke-'));
const port = 4189;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});

const base = `http://127.0.0.1:${port}`;
const request = async (url, options = {}) => {
  const response = await fetch(base + url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
  return result;
};

const textRequest = async (url) => {
  const response = await fetch(base + url);
  const result = await response.text();
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return result;
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await request('/api/state'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  if (!ready) throw new Error('Server did not become ready.');

  const home = await textRequest('/');
  if (!home.includes('Experience Intelligence Studio')) throw new Error('Creator application did not load.');

  const demo = await request('/api/demo', { method: 'POST' });
  const prototypeHtml = await textRequest(`/prototype/${demo.prototype.id}/index.html`);
  if (!prototypeHtml.includes("source: 'eis-prototype'")) throw new Error('Prototype tracker was not injected.');
  const study = await request('/api/studies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prototypeId: demo.prototype.id,
      title: 'Review low-quality interaction',
      scenario: 'You are reviewing support quality.',
      instruction: 'Open the evaluation for the interaction that needs review.',
      successSelector: '#open-evaluation'
    })
  });
  const session = await request('/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyId: study.id })
  });
  await request('/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, type: 'element_clicked', detail: { id: 'open-evaluation' }, elapsedMs: 4200, sequence: 1, idempotencyKey: `${session.id}:1` })
  });
  await request('/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, type: 'element_clicked', detail: { id: 'open-evaluation' }, elapsedMs: 4200, sequence: 1, idempotencyKey: `${session.id}:1` })
  });
  await request(`/api/sessions/${session.id}/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome: 'success', durationMs: 5200, response: { ease: 6, confidence: 5, comment: 'Clear task' } })
  });
  const results = await request(`/api/studies/${study.id}/results`);
  if (results.metrics.participants !== 1 || results.metrics.successRate !== 100 || results.metrics.totalEvents !== 1) throw new Error('Unexpected result metrics.');
  if (results.sessions[0].response.ease !== 6) throw new Error('Post-task response was not stored.');
  console.log('Smoke test passed: prototype → study → session → evidence → results');
} finally {
  server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}
