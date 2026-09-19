import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(root, 'public');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const prototypeDir = path.join(dataDir, 'prototypes');
const storePath = path.join(dataDir, 'store.json');
const port = Number(process.env.PORT || 4173);
const MAX_UPLOAD = 25 * 1024 * 1024;

await Promise.all([fs.mkdir(uploadDir, { recursive: true }), fs.mkdir(prototypeDir, { recursive: true })]);

async function loadStore() {
  try { return JSON.parse(await fs.readFile(storePath, 'utf8')); }
  catch { return { projects: [], prototypes: [], studies: [], sessions: [], events: [], responses: [] }; }
}

let writeQueue = Promise.resolve();
function mutate(mutator) {
  writeQueue = writeQueue.then(async () => {
    const store = await loadStore();
    const result = await mutator(store);
    await fs.writeFile(storePath, JSON.stringify(store, null, 2));
    return result;
  });
  return writeQueue;
}

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}

async function body(req, limit = 1024 * 1024) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function jsonBody(req) {
  const raw = await body(req);
  try { return JSON.parse(raw.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw Object.assign(new Error('Missing multipart boundary.'), { status: 400 });
  const boundary = `--${match[1] || match[2]}`;
  const raw = buffer.toString('binary');
  const chunks = raw.split(boundary).slice(1, -1);
  const fields = {};
  for (let chunk of chunks) {
    chunk = chunk.replace(/^\r\n|\r\n$/g, '');
    const split = chunk.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const headers = chunk.slice(0, split);
    let value = chunk.slice(split + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (!name) continue;
    fields[name] = filename ? { filename, buffer: Buffer.from(value, 'binary') } : value;
  }
  return fields;
}

function safeArchiveEntries(entries) {
  if (!entries.length || entries.length > 500) return false;
  return entries.every((entry) => {
    const normalized = entry.replaceAll('\\', '/');
    return normalized && !normalized.startsWith('/') && !normalized.includes('../') && !/^[A-Za-z]:/.test(normalized);
  });
}

async function extractZip(fileBuffer, prototypeId) {
  const zipPath = path.join(uploadDir, `${prototypeId}.zip`);
  const destination = path.join(prototypeDir, prototypeId);
  await fs.writeFile(zipPath, fileBuffer);
  const { stdout } = await exec('unzip', ['-Z1', zipPath], { maxBuffer: 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (!safeArchiveEntries(entries)) throw Object.assign(new Error('The ZIP contains unsafe paths or too many files.'), { status: 400 });
  const indexEntry = entries.find((e) => /(^|\/)index\.html$/i.test(e) && e.split('/').filter(Boolean).length <= 2);
  if (!indexEntry) throw Object.assign(new Error('The ZIP must include an index.html file at its root or inside one top-level folder.'), { status: 400 });
  await fs.mkdir(destination, { recursive: true });
  await exec('unzip', ['-q', zipPath, '-d', destination]);
  const base = path.dirname(indexEntry);
  return base === '.' ? destination : path.join(destination, base);
}

const tracker = `
<script>
(() => {
  const started = Date.now();
  const send = (type, detail = {}) => parent.postMessage({ source: 'eis-prototype', type, detail, at: Date.now(), elapsedMs: Date.now() - started }, '*');
  const describe = (el) => ({ tag: el.tagName?.toLowerCase(), id: el.id || null, role: el.getAttribute?.('role'), testId: el.getAttribute?.('data-testid'), text: (el.innerText || el.getAttribute?.('aria-label') || '').trim().slice(0, 100) });
  document.addEventListener('click', (event) => send('element_clicked', { ...describe(event.target), x: event.clientX, y: event.clientY }), true);
  document.addEventListener('submit', (event) => send('form_submitted', describe(event.target)), true);
  document.addEventListener('input', (event) => send('input_changed', { ...describe(event.target), inputType: event.target.type || null, valueLength: String(event.target.value || '').length }), true);
  addEventListener('hashchange', () => send('navigation', { url: location.pathname + location.hash }));
  addEventListener('error', (event) => send('error_triggered', { message: String(event.message || 'Runtime error').slice(0, 160) }));
  window.EIS = { complete: (name = 'task-completed', detail = {}) => send('custom_event', { name, ...detail }) };
  send('screen_viewed', { url: location.pathname + location.hash, title: document.title });
})();
</script>`;

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.woff':'font/woff', '.woff2':'font/woff2' })[ext] || 'application/octet-stream';
}

async function servePrototype(res, prototype, relativePath) {
  const clean = decodeURIComponent(relativePath || 'index.html').replace(/^\/+/, '');
  const file = path.resolve(prototype.basePath, clean || 'index.html');
  if (!file.startsWith(path.resolve(prototype.basePath) + path.sep) && file !== path.resolve(prototype.basePath, 'index.html')) return json(res, 403, { error: 'Forbidden path.' });
  let stat;
  try { stat = await fs.stat(file); } catch { return json(res, 404, { error: 'Prototype asset not found.' }); }
  const target = stat.isDirectory() ? path.join(file, 'index.html') : file;
  let content = await fs.readFile(target);
  if (path.extname(target).toLowerCase() === '.html') {
    let html = content.toString('utf8');
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tracker}</body>`) : `${html}${tracker}`;
    content = Buffer.from(html);
  }
  res.writeHead(200, { 'Content-Type': mime(target), 'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'", 'Cache-Control':'no-store' });
  res.end(content);
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const store = await loadStore();
    return json(res, 200, { projects: store.projects, prototypes: store.prototypes.map(({ basePath, ...p }) => p), studies: store.studies, sessions: store.sessions });
  }
  if (req.method === 'POST' && url.pathname === '/api/prototypes') {
    const fields = parseMultipart(await body(req, MAX_UPLOAD), req.headers['content-type']);
    const file = fields.file;
    if (!file?.filename?.toLowerCase().endsWith('.zip')) return json(res, 400, { error: 'Upload a .zip file.' });
    const prototypeId = id('proto');
    const basePath = await extractZip(file.buffer, prototypeId);
    const projectName = String(fields.projectName || 'Untitled project').trim().slice(0, 80);
    const result = await mutate((store) => {
      const project = { id: id('project'), name: projectName, createdAt: now() };
      const prototype = { id: prototypeId, projectId: project.id, name: file.filename.replace(/\.zip$/i,''), version: 1, status: 'ready', basePath, createdAt: now() };
      store.projects.push(project); store.prototypes.push(prototype);
      return { project, prototype: { ...prototype, basePath: undefined } };
    });
    return json(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/demo') {
    const sample = await fs.readFile(path.join(root, 'samples', 'support-dashboard.zip'));
    const prototypeId = id('proto'); const basePath = await extractZip(sample, prototypeId);
    const result = await mutate((store) => {
      const project = { id: id('project'), name: 'Support quality prototype', createdAt: now() };
      const prototype = { id: prototypeId, projectId: project.id, name: 'Support dashboard', version: 1, status: 'ready', basePath, createdAt: now() };
      store.projects.push(project); store.prototypes.push(prototype);
      return { project, prototype: { ...prototype, basePath: undefined } };
    });
    return json(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/studies') {
    const input = await jsonBody(req);
    if (!input.prototypeId || !input.title || !input.instruction || !input.successSelector) return json(res, 400, { error: 'Prototype, study title, instruction and success selector are required.' });
    const result = await mutate((store) => {
      const prototype = store.prototypes.find((p) => p.id === input.prototypeId);
      if (!prototype) throw Object.assign(new Error('Prototype not found.'), { status: 404 });
      const study = { id: id('study'), projectId: prototype.projectId, prototypeId: prototype.id, title: String(input.title).slice(0,100), status: 'published', createdAt: now(), task: { id: id('task'), scenario: String(input.scenario || '').slice(0,500), instruction: String(input.instruction).slice(0,500), successSelector: String(input.successSelector).slice(0,160) } };
      store.studies.push(study); return study;
    });
    return json(res, 201, result);
  }
  const studyMatch = /^\/api\/studies\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && studyMatch) {
    const store = await loadStore(); const study = store.studies.find((s) => s.id === studyMatch[1]);
    if (!study) return json(res, 404, { error: 'Study not found.' });
    const prototype = store.prototypes.find((p) => p.id === study.prototypeId);
    return json(res, 200, { study, prototype: { id: prototype.id, name: prototype.name } });
  }
  const resultMatch = /^\/api\/studies\/([^/]+)\/results$/.exec(url.pathname);
  if (req.method === 'GET' && resultMatch) {
    const store = await loadStore(); const study = store.studies.find((s) => s.id === resultMatch[1]);
    if (!study) return json(res, 404, { error: 'Study not found.' });
    const sessions = store.sessions.filter((s) => s.studyId === study.id);
    const events = store.events.filter((e) => sessions.some((s) => s.id === e.sessionId));
    const completed = sessions.filter((s) => s.outcome === 'success');
    const avg = completed.length ? Math.round(completed.reduce((sum,s) => sum + (s.durationMs || 0), 0) / completed.length / 1000) : 0;
    const bySession = sessions.map((s) => ({ ...s, events: events.filter((e) => e.sessionId === s.id).sort((a,b) => a.sequence - b.sequence), response: store.responses.find((r) => r.sessionId === s.id) || null }));
    return json(res, 200, { study, metrics: { participants: sessions.length, successRate: sessions.length ? Math.round(completed.length / sessions.length * 100) : 0, averageSuccessTimeSeconds: avg, totalEvents: events.length }, sessions: bySession });
  }
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const input = await jsonBody(req);
    const result = await mutate((store) => {
      if (!store.studies.some((s) => s.id === input.studyId)) throw Object.assign(new Error('Study not found.'), { status: 404 });
      const session = { id: id('session'), studyId: input.studyId, startedAt: now(), endedAt: null, outcome: 'in_progress', durationMs: null, eventCount: 0 };
      store.sessions.push(session); return session;
    });
    return json(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/events') {
    const input = await jsonBody(req);
    const result = await mutate((store) => {
      const session = store.sessions.find((s) => s.id === input.sessionId);
      if (!session) throw Object.assign(new Error('Session not found.'), { status: 404 });
      if (store.events.some((e) => e.idempotencyKey === input.idempotencyKey)) return { accepted: true, duplicate: true };
      const event = { id: id('event'), sessionId: session.id, type: input.type, detail: input.detail || {}, elapsedMs: Number(input.elapsedMs || 0), sequence: Number(input.sequence || session.eventCount + 1), idempotencyKey: input.idempotencyKey, createdAt: now() };
      store.events.push(event); session.eventCount += 1;
      return { accepted: true, eventId: event.id };
    });
    return json(res, 202, result);
  }
  const completeMatch = /^\/api\/sessions\/([^/]+)\/complete$/.exec(url.pathname);
  if (req.method === 'POST' && completeMatch) {
    const input = await jsonBody(req);
    const result = await mutate((store) => {
      const session = store.sessions.find((s) => s.id === completeMatch[1]);
      if (!session) throw Object.assign(new Error('Session not found.'), { status: 404 });
      session.endedAt = now(); session.outcome = input.outcome || 'success'; session.durationMs = Number(input.durationMs || 0);
      if (input.response) store.responses.push({ id:id('response'), sessionId:session.id, ease:Number(input.response.ease), confidence:Number(input.response.confidence), comment:String(input.response.comment || '').slice(0,1000), createdAt:now() });
      return session;
    });
    return json(res, 200, result);
  }
  return json(res, 404, { error: 'API route not found.' });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const protoMatch = /^\/prototype\/([^/]+)\/?(.*)$/.exec(url.pathname);
    if (protoMatch) {
      const store = await loadStore(); const prototype = store.prototypes.find((p) => p.id === protoMatch[1]);
      if (!prototype) return json(res, 404, { error: 'Prototype not found.' });
      return await servePrototype(res, prototype, protoMatch[2] || 'index.html');
    }
    const requested = url.pathname === '/' || url.pathname.startsWith('/test/') ? 'index.html' : url.pathname.slice(1);
    const target = path.resolve(publicDir, requested);
    if (!target.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden.' });
    try { const content = await fs.readFile(target); res.writeHead(200, { 'Content-Type': mime(target), 'Cache-Control': requested === 'index.html' ? 'no-store' : 'public, max-age=3600' }); return res.end(content); }
    catch { const content = await fs.readFile(path.join(publicDir,'index.html')); res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); return res.end(content); }
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error.' });
  }
}

http.createServer(handle).listen(port, () => console.log(`Experience Intelligence Studio running at http://localhost:${port}`));
