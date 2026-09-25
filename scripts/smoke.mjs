import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'eis-smoke-'));
const port = 4189;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DATABASE_URL: '', ADMIN_PASSWORD: 'smoke-password', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const base = `http://127.0.0.1:${port}`;
const rawRequest = (url, options = {}, cookie = '') => {
  const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) };
  return fetch(base + url, { ...options, headers });
};
const request = async (url, options = {}, cookie = '') => {
  const response = await rawRequest(url, options, cookie);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `Request failed: ${response.status}`), { status: response.status });
  return result;
};
const textRequest = async (url) => {
  const response = await fetch(base + url);
  const result = await response.text();
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return result;
};
const cookieFrom = (response) => response.headers.get('set-cookie')?.split(';')[0] || '';

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await request('/api/health'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  if (!ready) throw new Error('Server did not become ready.');

  const health = await request('/api/health');
  if (health.status !== 'ok' || health.storage !== 'json') throw new Error('Health check did not report local storage.');
  if ((await rawRequest('/api/state')).status !== 401) throw new Error('Private workspace API was not protected.');

  const loginResponse = await rawRequest('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'founder', password: 'smoke-password' }),
  });
  if (!loginResponse.ok) throw new Error('Founder could not sign in.');
  const ownerCookie = cookieFrom(loginResponse);
  const owner = await request('/api/auth/me', {}, ownerCookie);
  if (owner.role !== 'owner') throw new Error('Founder was not assigned the Owner role.');

  const home = await textRequest('/');
  if (!home.includes('Experience Intelligence Studio')) throw new Error('Creator application did not load.');
  const clientScript = await textRequest('/app.js');
  if (!clientScript.includes('I completed this task') || !clientScript.includes('participant_marked_complete') || !clientScript.includes('participantTarget')) throw new Error('Participant completion and target controls were not available.');
  const styles = await textRequest('/styles.css');
  if (!styles.includes('Liquid glass blue visual system')) throw new Error('Liquid-glass theme was not served.');

  const demo = await request('/api/demo', { method: 'POST' }, ownerCookie);
  const prototypeResponse = await rawRequest(`/prototype/${demo.prototype.id}/index.html`);
  const prototypeHtml = await prototypeResponse.text();
  if (!prototypeResponse.headers.get('content-security-policy')?.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:")) throw new Error('Prototype CSP did not allow embedded module scripts.');
  if (!prototypeHtml.includes("source: 'eis-prototype'")) throw new Error('Prototype tracker was not injected.');
  if (!prototypeHtml.includes("send('prototype_ready', { visible })")) throw new Error('Prototype readiness reporting was not injected.');
  await rm(path.join(dataDir, 'prototypes', demo.prototype.id), { recursive: true, force: true });
  const restoredPrototypeHtml = await textRequest(`/prototype/${demo.prototype.id}/index.html`);
  if (!restoredPrototypeHtml.includes("source: 'eis-prototype'")) throw new Error('Prototype was not restored from its persistent archive.');

  const htmlForm = new FormData();
  htmlForm.set('projectName', 'Standalone ideation output');
  htmlForm.set('file', new Blob(['<!doctype html><html><body><button id="finish">Finish</button></body></html>'], { type: 'text/html' }), 'idea-output.html');
  const htmlUpload = await request('/api/prototypes', { method: 'POST', body: htmlForm }, ownerCookie);
  if (htmlUpload.prototype.archiveFormat !== 'html' || htmlUpload.prototype.name !== 'idea-output') throw new Error('Standalone HTML upload metadata was incorrect.');
  const uploadedHtml = await textRequest(`/prototype/${htmlUpload.prototype.id}/index.html`);
  if (!uploadedHtml.includes('id="finish"') || !uploadedHtml.includes("source: 'eis-prototype'")) throw new Error('Standalone HTML prototype did not run.');
  await rm(path.join(dataDir, 'prototypes', htmlUpload.prototype.id), { recursive: true, force: true });
  const restoredHtml = await textRequest(`/prototype/${htmlUpload.prototype.id}/index.html`);
  if (!restoredHtml.includes('id="finish"')) throw new Error('Standalone HTML prototype was not restored from persistent storage.');

  const unsupportedForm = new FormData();
  unsupportedForm.set('projectName', 'Unsupported upload');
  unsupportedForm.set('file', new Blob(['not a prototype'], { type: 'text/plain' }), 'notes.txt');
  if ((await rawRequest('/api/prototypes', { method: 'POST', body: unsupportedForm }, ownerCookie)).status !== 400) throw new Error('Unsupported prototype file type was accepted.');
  const corruptZipForm = new FormData();
  corruptZipForm.set('projectName', 'Corrupt archive');
  corruptZipForm.set('file', new Blob(['not really a zip'], { type: 'application/zip' }), 'broken.zip');
  const corruptZipResponse = await rawRequest('/api/prototypes', { method: 'POST', body: corruptZipForm }, ownerCookie);
  if (corruptZipResponse.status !== 400 || !(await corruptZipResponse.json()).error.includes('could not be read')) throw new Error('Corrupt ZIP did not return a recoverable validation error.');

  const researcherInvite = await request('/api/team/invites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'researcher@example.com', role: 'researcher' }),
  }, ownerCookie);
  const inviteDetails = await request(`/api/invites/${researcherInvite.token}`);
  if (inviteDetails.role !== 'researcher') throw new Error('Researcher invitation was not readable.');
  const researcherResponse = await rawRequest(`/api/invites/${researcherInvite.token}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Researcher One', password: 'researcher-password' }),
  });
  if (!researcherResponse.ok) throw new Error('Researcher invitation could not be accepted.');
  const researcherCookie = cookieFrom(researcherResponse);
  const researcherStateBefore = await request('/api/state', {}, researcherCookie);
  if (researcherStateBefore.projects.length !== 0) throw new Error('Researcher could see another member’s private work.');
  await request('/api/demo', { method: 'POST' }, researcherCookie);
  const researcherStateAfter = await request('/api/state', {}, researcherCookie);
  if (researcherStateAfter.projects.length !== 1) throw new Error('Researcher could not see their own work.');
  const ownerState = await request('/api/state', {}, ownerCookie);
  if (ownerState.projects.length !== 3) throw new Error('Owner could not see workspace-wide work.');

  const viewerInvite = await request('/api/team/invites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager@example.com', role: 'viewer' }),
  }, ownerCookie);
  const viewerResponse = await rawRequest(`/api/invites/${viewerInvite.token}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Product Manager', password: 'manager-password' }),
  });
  const viewerCookie = cookieFrom(viewerResponse);
  const viewerState = await request('/api/state', {}, viewerCookie);
  if (viewerState.projects.length !== 3 || viewerState.permissions.canEdit) throw new Error('Viewer permissions were incorrect.');
  if ((await rawRequest('/api/demo', { method: 'POST' }, viewerCookie)).status !== 403) throw new Error('Viewer was able to create work.');

  const study = await request('/api/studies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prototypeId: demo.prototype.id,
      title: 'Review low-quality interaction',
      scenario: 'You are reviewing support quality.',
      instruction: 'Open the evaluation for the interaction that needs review.',
      successSelector: '#open-evaluation',
      participantTarget: 50,
      metrics: ['task_success_rate', 'time_on_task', 'click_count', 'ease', 'confidence', 'session_replay'],
      customQuestion: 'What attracted your attention first?',
    }),
  }, ownerCookie);
  await request(`/api/studies/${study.id}`);
  const session = await request('/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studyId: study.id }),
  });
  const event = { sessionId: session.id, type: 'element_clicked', detail: { id: 'open-evaluation' }, elapsedMs: 4200, sequence: 1, idempotencyKey: `${session.id}:1` };
  await request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  await request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  await request(`/api/sessions/${session.id}/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome: 'success', durationMs: 5200, response: { ease: 6, confidence: 5, comment: 'Clear task', customAnswer: 'The highlighted evaluation' } }),
  });
  const results = await request(`/api/studies/${study.id}/results`, {}, viewerCookie);
  if (results.metrics.participants !== 1 || results.metrics.participantTarget !== 50 || results.metrics.participantProgress !== 2 || results.metrics.taskSuccessRate !== 100 || results.metrics.successRate !== 100 || results.metrics.totalEvents !== 1 || results.metrics.averageClicks !== 1) throw new Error('Unexpected result metrics.');
  if (!results.study.measurementPlan.metrics.includes('session_replay')) throw new Error('Study measurement plan was not stored.');
  if (results.sessions[0].response.ease !== 6 || results.sessions[0].response.customAnswer !== 'The highlighted evaluation') throw new Error('Post-task response was not stored.');
  if ((await rawRequest(`/api/studies/${study.id}/results`, {}, researcherCookie)).status !== 403) throw new Error('Researcher could access another member’s private results.');

  const limitedStudy = await request('/api/studies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prototypeId: demo.prototype.id, title: 'Limited pilot', instruction: 'Complete the task.', successSelector: '#open-evaluation', participantTarget: 1, metrics: ['task_success_rate'] }),
  }, ownerCookie);
  await request('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studyId: limitedStudy.id }) });
  if ((await rawRequest('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studyId: limitedStudy.id }) })).status !== 409) throw new Error('Participant target did not close the study link.');

  const team = await request('/api/team', {}, ownerCookie);
  const manager = team.members.find((member) => member.email === 'manager@example.com');
  await request(`/api/team/members/${manager.membershipId}`, { method: 'DELETE' }, ownerCookie);
  if ((await rawRequest('/api/auth/me', {}, viewerCookie)).status !== 401) throw new Error('Removed member session remained active.');
  const reinvite = await request('/api/team/invites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'manager@example.com', role: 'viewer' }),
  }, ownerCookie);
  const reactivated = await rawRequest(`/api/invites/${reinvite.token}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Product Manager', password: 'new-manager-password' }),
  });
  if (!reactivated.ok) throw new Error('Removed member could not be safely reinvited.');

  console.log('Smoke test passed: team accounts → isolated work → public participant → manager results');
} finally {
  server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}
