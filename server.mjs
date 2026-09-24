import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closeStorage, initStorage, loadStore, mutate, readPrototypeArchive, savePrototypeArchive, storageHealth, storageKind } from './storage.mjs';

const exec = promisify(execFile);
const root = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(root, 'public');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const prototypeDir = path.join(dataDir, 'prototypes');
const port = Number(process.env.PORT || 4173);
const adminUser = process.env.ADMIN_USER || 'founder';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const ownerName = process.env.OWNER_NAME || 'Workspace owner';
const ownerEmail = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
const workspaceName = process.env.WORKSPACE_NAME || 'Experience Intelligence team';
const MAX_UPLOAD = 25 * 1024 * 1024;
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

if (process.env.NODE_ENV === 'production' && !adminPassword) {
  throw new Error('ADMIN_PASSWORD is required in production.');
}

await Promise.all([fs.mkdir(uploadDir, { recursive: true }), fs.mkdir(prototypeDir, { recursive: true })]);
await initStorage();

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();
const scrypt = promisify(crypto.scrypt);
const tokenHash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [scheme, saltHex, hashHex] = String(encoded || '').split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), 64));
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2));
}

function sessionCookie(token) {
  return `eis_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_AGE_MS / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function clearSessionCookie() {
  return `eis_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

async function ensureBootstrapAccount() {
  const current = await loadStore();
  if (current.users.some((user) => user.bootstrapOwner)) return;
  const passwordHash = await hashPassword(adminPassword || 'founder');
  await mutate((store) => {
    if (store.users.some((user) => user.bootstrapOwner)) return;
    const user = { id: id('user'), login: adminUser.toLowerCase(), email: ownerEmail || null, name: ownerName, passwordHash, bootstrapOwner: true, status: 'active', createdAt: now() };
    const workspace = { id: id('workspace'), name: workspaceName, createdAt: now(), createdBy: user.id };
    store.users.push(user);
    store.workspaces.push(workspace);
    store.memberships.push({ id: id('member'), workspaceId: workspace.id, userId: user.id, role: 'owner', createdAt: now() });
    for (const project of store.projects) {
      project.workspaceId ||= workspace.id;
      project.createdBy ||= user.id;
    }
  });
}

async function currentAuth(req) {
  const raw = cookies(req).eis_session;
  if (!raw) return null;
  const store = await loadStore();
  const session = store.authSessions.find((item) => item.tokenHash === tokenHash(raw) && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  const user = store.users.find((item) => item.id === session.userId && item.status === 'active');
  const membership = store.memberships.find((item) => item.userId === user?.id && item.workspaceId === session.workspaceId);
  const workspace = store.workspaces.find((item) => item.id === membership?.workspaceId);
  return user && membership && workspace ? { user, membership, workspace, session } : null;
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, login: user.login, status: user.status, createdAt: user.createdAt };
}

function canEdit(auth) { return auth && ['owner', 'researcher'].includes(auth.membership.role); }
function canManageTeam(auth) { return auth?.membership.role === 'owner'; }
function canAccessProject(auth, project) {
  return project?.workspaceId === auth?.workspace.id && (auth.membership.role !== 'researcher' || project.createdBy === auth.user.id);
}

function requirePermission(condition, message = 'You do not have permission to perform this action.') {
  if (!condition) throw Object.assign(new Error(message), { status: 403 });
}

function publicApiRequest(req, pathname) {
  return (req.method === 'GET' && (pathname === '/api/health' || /^\/api\/studies\/[^/]+$/.test(pathname) || /^\/api\/invites\/[^/]+$/.test(pathname)))
    || (req.method === 'POST' && (pathname === '/api/auth/login' || /^\/api\/invites\/[^/]+\/accept$/.test(pathname) || pathname === '/api/sessions' || pathname === '/api/events' || /^\/api\/sessions\/[^/]+\/complete$/.test(pathname)));
}

await ensureBootstrapAccount();

const loginAttempts = new Map();
function checkLoginRate(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const current = loginAttempts.get(key);
  const time = Date.now();
  if (!current || current.resetAt <= time) {
    loginAttempts.set(key, { count: 1, resetAt: time + 15 * 60 * 1000 });
    return key;
  }
  current.count += 1;
  if (current.count > 8) throw Object.assign(new Error('Too many sign-in attempts. Try again in 15 minutes.'), { status: 429 });
  return key;
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
  let stdout;
  try { ({ stdout } = await exec('unzip', ['-Z1', zipPath], { maxBuffer: 1024 * 1024 })); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw Object.assign(new Error('The ZIP could not be read. Create a new ZIP and try again.'), { status: 400 });
  }
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (!safeArchiveEntries(entries)) throw Object.assign(new Error('The ZIP contains unsafe paths or too many files.'), { status: 400 });
  const indexEntry = entries.find((e) => /(^|\/)index\.html$/i.test(e) && e.split('/').filter(Boolean).length <= 2);
  if (!indexEntry) throw Object.assign(new Error('The ZIP must include an index.html file at its root or inside one top-level folder.'), { status: 400 });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  try { await exec('unzip', ['-q', zipPath, '-d', destination]); }
  catch { throw Object.assign(new Error('The ZIP could not be extracted. Create a new ZIP and try again.'), { status: 400 }); }
  const indexRoot = path.dirname(indexEntry);
  return { basePath: indexRoot === '.' ? destination : path.join(destination, indexRoot), indexRoot };
}

async function extractHtml(fileBuffer, prototypeId) {
  if (!fileBuffer.length) throw Object.assign(new Error('The HTML file is empty.'), { status: 400 });
  let html;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer); }
  catch { throw Object.assign(new Error('The HTML file must use UTF-8 text encoding.'), { status: 400 }); }
  if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(html)) {
    throw Object.assign(new Error('This file does not appear to contain an HTML document.'), { status: 400 });
  }
  const destination = path.join(prototypeDir, prototypeId);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'index.html'), fileBuffer);
  return { basePath: destination, indexRoot: '.' };
}

async function materializePrototype(fileBuffer, prototypeId, format = 'zip') {
  return format === 'html' ? extractHtml(fileBuffer, prototypeId) : extractZip(fileBuffer, prototypeId);
}

async function ensurePrototypeMaterialized(prototype) {
  const destination = path.join(prototypeDir, prototype.id);
  const basePath = prototype.indexRoot && prototype.indexRoot !== '.' ? path.join(destination, prototype.indexRoot) : destination;
  try {
    await fs.access(path.join(basePath, 'index.html'));
    return basePath;
  } catch {
    const archive = await readPrototypeArchive(prototype.id);
    if (!archive) throw Object.assign(new Error('The prototype archive is unavailable.'), { status: 404 });
    return (await materializePrototype(archive, prototype.id, prototype.archiveFormat || 'zip')).basePath;
  }
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
  addEventListener('load', () => setTimeout(() => {
    const visible = Boolean((document.body?.innerText || '').trim() || document.querySelector('img,svg,canvas,video,button,input,select,textarea,[role]'));
    send('prototype_ready', { visible });
  }, 1500), { once: true });
  window.EIS = { complete: (name = 'task-completed', detail = {}) => send('custom_event', { name, ...detail }) };
  send('screen_viewed', { url: location.pathname + location.hash, title: document.title });
})();
</script>`;

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.woff':'font/woff', '.woff2':'font/woff2' })[ext] || 'application/octet-stream';
}

async function servePrototype(res, prototype, relativePath) {
  const basePath = await ensurePrototypeMaterialized(prototype);
  const clean = decodeURIComponent(relativePath || 'index.html').replace(/^\/+/, '');
  const file = path.resolve(basePath, clean || 'index.html');
  if (!file.startsWith(path.resolve(basePath) + path.sep) && file !== path.resolve(basePath, 'index.html')) return json(res, 403, { error: 'Forbidden path.' });
  let stat;
  try { stat = await fs.stat(file); } catch { return json(res, 404, { error: 'Prototype asset not found.' }); }
  const target = stat.isDirectory() ? path.join(file, 'index.html') : file;
  let content = await fs.readFile(target);
  if (path.extname(target).toLowerCase() === '.html') {
    let html = content.toString('utf8');
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tracker}</body>`) : `${html}${tracker}`;
    content = Buffer.from(html);
  }
  res.writeHead(200, { 'Content-Type': mime(target), 'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data: blob:; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'", 'Cache-Control':'no-store' });
  res.end(content);
}

async function api(req, res, url, auth = null) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    await storageHealth();
    return json(res, 200, { status: 'ok', storage: storageKind });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const rateKey = checkLoginRate(req);
    const input = await jsonBody(req);
    const identifier = String(input.identifier || '').trim().toLowerCase();
    const password = String(input.password || '');
    const store = await loadStore();
    const user = store.users.find((item) => item.status === 'active' && (item.login === identifier || item.email === identifier));
    if (!user || !(await verifyPassword(password, user.passwordHash))) return json(res, 401, { error: 'The sign-in details are incorrect.' });
    const membership = store.memberships.find((item) => item.userId === user.id);
    if (!membership) return json(res, 403, { error: 'Your account does not have access to a workspace.' });
    const token = crypto.randomBytes(32).toString('base64url');
    await mutate((draft) => {
      draft.authSessions = draft.authSessions.filter((item) => new Date(item.expiresAt) > new Date());
      draft.authSessions.push({ id: id('auth'), tokenHash: tokenHash(token), userId: user.id, workspaceId: membership.workspaceId, createdAt: now(), expiresAt: new Date(Date.now() + SESSION_AGE_MS).toISOString() });
    });
    loginAttempts.delete(rateKey);
    return json(res, 200, { signedIn: true }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (auth) await mutate((store) => { store.authSessions = store.authSessions.filter((item) => item.id !== auth.session.id); });
    return json(res, 200, { signedOut: true }, { 'Set-Cookie': clearSessionCookie() });
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    return json(res, 200, { user: safeUser(auth.user), role: auth.membership.role, workspace: auth.workspace });
  }
  const publicInviteMatch = /^\/api\/invites\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && publicInviteMatch) {
    const store = await loadStore();
    const invite = store.invites.find((item) => item.tokenHash === tokenHash(publicInviteMatch[1]));
    if (!invite || invite.status !== 'pending' || new Date(invite.expiresAt) <= new Date()) return json(res, 410, { error: 'This invitation is invalid or has expired.' });
    const workspace = store.workspaces.find((item) => item.id === invite.workspaceId);
    return json(res, 200, { email: invite.email, role: invite.role, workspaceName: workspace?.name || 'Workspace', expiresAt: invite.expiresAt });
  }
  const acceptInviteMatch = /^\/api\/invites\/([^/]+)\/accept$/.exec(url.pathname);
  if (req.method === 'POST' && acceptInviteMatch) {
    const input = await jsonBody(req);
    const name = String(input.name || '').trim().slice(0, 80);
    const password = String(input.password || '');
    if (name.length < 2) return json(res, 400, { error: 'Enter your full name.' });
    if (password.length < 10) return json(res, 400, { error: 'Use at least 10 characters for your password.' });
    const lookup = await loadStore();
    const invite = lookup.invites.find((item) => item.tokenHash === tokenHash(acceptInviteMatch[1]));
    if (!invite || invite.status !== 'pending' || new Date(invite.expiresAt) <= new Date()) return json(res, 410, { error: 'This invitation is invalid or has expired.' });
    if (lookup.users.some((item) => item.email === invite.email && item.status === 'active')) return json(res, 409, { error: 'An active account already exists for this email address.' });
    const passwordHash = await hashPassword(password);
    const rawSession = crypto.randomBytes(32).toString('base64url');
    const created = await mutate((store) => {
      const activeInvite = store.invites.find((item) => item.id === invite.id);
      if (!activeInvite || activeInvite.status !== 'pending' || new Date(activeInvite.expiresAt) <= new Date()) throw Object.assign(new Error('This invitation is invalid or has expired.'), { status: 410 });
      let user = store.users.find((item) => item.email === invite.email && item.status === 'removed');
      if (user) Object.assign(user, { name, passwordHash, status: 'active', reactivatedAt: now() });
      else { user = { id: id('user'), login: invite.email, email: invite.email, name, passwordHash, bootstrapOwner: false, status: 'active', createdAt: now() }; store.users.push(user); }
      store.memberships.push({ id: id('member'), workspaceId: invite.workspaceId, userId: user.id, role: invite.role, createdAt: now() });
      activeInvite.status = 'accepted'; activeInvite.acceptedAt = now(); activeInvite.acceptedBy = user.id;
      store.authSessions.push({ id: id('auth'), tokenHash: tokenHash(rawSession), userId: user.id, workspaceId: invite.workspaceId, createdAt: now(), expiresAt: new Date(Date.now() + SESSION_AGE_MS).toISOString() });
      return safeUser(user);
    });
    return json(res, 201, { user: created }, { 'Set-Cookie': sessionCookie(rawSession) });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const store = await loadStore();
    const workspaceProjects = store.projects.filter((project) => canAccessProject(auth, project));
    const projectIds = new Set(workspaceProjects.map((project) => project.id));
    const studies = store.studies.filter((study) => projectIds.has(study.projectId));
    const studyIds = new Set(studies.map((study) => study.id));
    return json(res, 200, {
      currentUser: safeUser(auth.user), role: auth.membership.role, workspace: auth.workspace,
      permissions: { canEdit: canEdit(auth), canManageTeam: canManageTeam(auth) },
      projects: workspaceProjects,
      prototypes: store.prototypes.filter((prototype) => projectIds.has(prototype.projectId)).map(({ basePath, ...prototype }) => prototype),
      studies,
      sessions: store.sessions.filter((session) => studyIds.has(session.studyId)),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/team') {
    const store = await loadStore();
    const memberships = store.memberships.filter((item) => item.workspaceId === auth.workspace.id);
    const members = memberships.map((membership) => ({ ...safeUser(store.users.find((user) => user.id === membership.userId)), membershipId: membership.id, role: membership.role }));
    const invites = store.invites.filter((item) => item.workspaceId === auth.workspace.id && item.status === 'pending').map(({ tokenHash: omitted, ...invite }) => invite);
    return json(res, 200, { members, invites, canManage: canManageTeam(auth) });
  }
  if (req.method === 'POST' && url.pathname === '/api/team/invites') {
    requirePermission(canManageTeam(auth));
    const input = await jsonBody(req);
    const email = String(input.email || '').trim().toLowerCase().slice(0, 160);
    const role = String(input.role || 'researcher');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    if (!['researcher', 'viewer'].includes(role)) return json(res, 400, { error: 'Select a valid role.' });
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const invite = await mutate((store) => {
      if (store.users.some((user) => user.email === email && user.status === 'active') || store.invites.some((item) => item.email === email && item.status === 'pending')) throw Object.assign(new Error('This person is already a member or has a pending invitation.'), { status: 409 });
      const created = { id: id('invite'), workspaceId: auth.workspace.id, email, role, tokenHash: tokenHash(rawToken), status: 'pending', createdBy: auth.user.id, createdAt: now(), expiresAt: new Date(Date.now() + INVITE_AGE_MS).toISOString() };
      store.invites.push(created); return created;
    });
    return json(res, 201, { invite: { id: invite.id, email, role, expiresAt: invite.expiresAt }, token: rawToken });
  }
  const memberMatch = /^\/api\/team\/members\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'PATCH' && memberMatch) {
    requirePermission(canManageTeam(auth));
    const input = await jsonBody(req); const role = String(input.role || '');
    if (!['researcher', 'viewer'].includes(role)) return json(res, 400, { error: 'Select Researcher or Viewer.' });
    const result = await mutate((store) => {
      const membership = store.memberships.find((item) => item.id === memberMatch[1] && item.workspaceId === auth.workspace.id);
      if (!membership) throw Object.assign(new Error('Team member not found.'), { status: 404 });
      if (membership.role === 'owner') throw Object.assign(new Error('The workspace owner role cannot be changed.'), { status: 400 });
      membership.role = role; return membership;
    });
    return json(res, 200, result);
  }
  if (req.method === 'DELETE' && memberMatch) {
    requirePermission(canManageTeam(auth));
    await mutate((store) => {
      const membership = store.memberships.find((item) => item.id === memberMatch[1] && item.workspaceId === auth.workspace.id);
      if (!membership) throw Object.assign(new Error('Team member not found.'), { status: 404 });
      if (membership.role === 'owner') throw Object.assign(new Error('The workspace owner cannot be removed.'), { status: 400 });
      store.memberships = store.memberships.filter((item) => item.id !== membership.id);
      store.authSessions = store.authSessions.filter((item) => item.userId !== membership.userId);
      const user = store.users.find((item) => item.id === membership.userId); if (user) user.status = 'removed';
    });
    return json(res, 200, { removed: true });
  }
  const inviteAdminMatch = /^\/api\/team\/invites\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && inviteAdminMatch) {
    requirePermission(canManageTeam(auth));
    await mutate((store) => { const invite = store.invites.find((item) => item.id === inviteAdminMatch[1] && item.workspaceId === auth.workspace.id); if (invite) invite.status = 'revoked'; });
    return json(res, 200, { revoked: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/prototypes') {
    requirePermission(canEdit(auth), 'Your Viewer role cannot create projects.');
    const fields = parseMultipart(await body(req, MAX_UPLOAD + 1024 * 1024), req.headers['content-type']);
    const file = fields.file;
    if (!file?.filename) return json(res, 400, { error: 'Choose an HTML or ZIP file to upload.' });
    if (file.buffer.length > MAX_UPLOAD) return json(res, 413, { error: 'The prototype is larger than the 25 MB upload limit.' });
    const originalName = path.basename(file.filename.replaceAll('\\', '/'));
    const extension = path.extname(originalName).toLowerCase();
    if (!['.html', '.htm', '.zip'].includes(extension)) return json(res, 400, { error: 'Upload an .html, .htm or .zip file.' });
    const archiveFormat = extension === '.zip' ? 'zip' : 'html';
    const prototypeId = id('proto');
    const { indexRoot } = await materializePrototype(file.buffer, prototypeId, archiveFormat);
    await savePrototypeArchive(prototypeId, file.buffer);
    const projectName = String(fields.projectName || 'Untitled project').trim().slice(0, 80);
    const result = await mutate((store) => {
      const project = { id: id('project'), workspaceId: auth.workspace.id, createdBy: auth.user.id, name: projectName, createdAt: now() };
      const prototype = { id: prototypeId, projectId: project.id, name: originalName.replace(/\.(?:html?|zip)$/i,''), version: 1, status: 'ready', indexRoot, archiveFormat, createdAt: now() };
      store.projects.push(project); store.prototypes.push(prototype);
      return { project, prototype };
    });
    return json(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/demo') {
    requirePermission(canEdit(auth), 'Your Viewer role cannot create projects.');
    const sample = await fs.readFile(path.join(root, 'samples', 'support-dashboard.zip'));
    const prototypeId = id('proto'); const { indexRoot } = await extractZip(sample, prototypeId);
    await savePrototypeArchive(prototypeId, sample);
    const result = await mutate((store) => {
      const project = { id: id('project'), workspaceId: auth.workspace.id, createdBy: auth.user.id, name: 'Support quality prototype', createdAt: now() };
      const prototype = { id: prototypeId, projectId: project.id, name: 'Support dashboard', version: 1, status: 'ready', indexRoot, createdAt: now() };
      store.projects.push(project); store.prototypes.push(prototype);
      return { project, prototype };
    });
    return json(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/studies') {
    requirePermission(canEdit(auth), 'Your Viewer role cannot create studies.');
    const input = await jsonBody(req);
    if (!input.prototypeId || !input.title || !input.instruction || !input.successSelector) return json(res, 400, { error: 'Prototype, study title, instruction and success selector are required.' });
    const result = await mutate((store) => {
      const prototype = store.prototypes.find((p) => p.id === input.prototypeId);
      if (!prototype) throw Object.assign(new Error('Prototype not found.'), { status: 404 });
      const project = store.projects.find((item) => item.id === prototype.projectId);
      requirePermission(canAccessProject(auth, project));
      const study = { id: id('study'), projectId: prototype.projectId, prototypeId: prototype.id, createdBy: auth.user.id, title: String(input.title).slice(0,100), status: 'published', createdAt: now(), task: { id: id('task'), scenario: String(input.scenario || '').slice(0,500), instruction: String(input.instruction).slice(0,500), successSelector: String(input.successSelector).slice(0,160) } };
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
    requirePermission(canAccessProject(auth, store.projects.find((project) => project.id === study.projectId)));
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
    if (url.pathname.startsWith('/api/')) {
      let auth = null;
      if (!publicApiRequest(req, url.pathname)) {
        auth = await currentAuth(req);
        if (!auth) return json(res, 401, { error: 'Sign in to continue.', code: 'AUTH_REQUIRED' }, { 'Set-Cookie': clearSessionCookie() });
      }
      return await api(req, res, url, auth);
    }
    const protoMatch = /^\/prototype\/([^/]+)\/?(.*)$/.exec(url.pathname);
    if (protoMatch) {
      const store = await loadStore(); const prototype = store.prototypes.find((p) => p.id === protoMatch[1]);
      if (!prototype) return json(res, 404, { error: 'Prototype not found.' });
      return await servePrototype(res, prototype, protoMatch[2] || 'index.html');
    }
    const requested = url.pathname === '/' || url.pathname.startsWith('/test/') || url.pathname.startsWith('/invite/') || url.pathname === '/login' ? 'index.html' : url.pathname.slice(1);
    const target = path.resolve(publicDir, requested);
    if (!target.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden.' });
    try { const content = await fs.readFile(target); res.writeHead(200, { 'Content-Type': mime(target), 'Cache-Control': requested === 'index.html' ? 'no-store' : 'public, max-age=3600' }); return res.end(content); }
    catch { const content = await fs.readFile(path.join(publicDir,'index.html')); res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); return res.end(content); }
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error.' });
  }
}

const server = http.createServer(handle).listen(port, () => console.log(`Experience Intelligence Studio running at http://localhost:${port} with ${storageKind} storage`));

async function shutdown() {
  server.close(async () => {
    await closeStorage();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
