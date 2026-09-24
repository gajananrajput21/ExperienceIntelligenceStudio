const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const state = { data: null, auth: null, team: null, lastInviteUrl: '', view: 'projects', selectedPrototype: null, selectedStudy: null, setupStep: 1 };

const escapeHtml = (value='') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const api = async (url, options={}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.'); error.status=response.status; error.code=data.code;
    if(response.status===401 && !url.includes('/api/auth/login') && !location.pathname.startsWith('/test/') && !location.pathname.startsWith('/invite/')) setTimeout(()=>renderLogin('Your session ended. Sign in again to continue.'),0);
    throw error;
  }
  return data;
};
function toast(message){ toastEl.textContent=message; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),2600); }
function formatDate(value){ return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value)); }
function shell(content, active='projects'){
  const user=state.data?.currentUser||state.auth?.user||{}; const role=state.data?.role||state.auth?.role||''; const workspace=state.data?.workspace||state.auth?.workspace;
  return `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">EI</div><div><strong>Experience Intelligence</strong><span>${escapeHtml(workspace?.name||'Validation Studio')}</span></div></div><nav class="nav"><button data-nav="projects" class="${active==='projects'?'active':''}">My work</button><button data-nav="studies" class="${active==='studies'?'active':''}">Studies</button><button data-nav="results" class="${active==='results'?'active':''}">Results</button><button data-nav="team" class="${active==='team'?'active':''}">Team</button></nav><div class="sidebar-profile"><strong>${escapeHtml(user.name||user.login||'Member')}</strong><span>${escapeHtml(roleLabel(role))}</span><button data-action="logout">Sign out</button></div></aside><main class="main">${content}</main></div>`;
}
function top(title, lead, actions=''){ return `<header class="topline"><div><div class="eyebrow">Prototype validation</div><h1>${title}</h1><p class="lead">${lead}</p></div><div class="actions">${actions}</div></header>`; }

function roleLabel(role){ return ({owner:'Owner',researcher:'Researcher',viewer:'Viewer / manager'})[role]||role; }

async function refresh(){ state.data = await api('/api/state'); }
async function renderProjects(){
  await refresh();
  const projects = state.data.projects; const editable=state.data.permissions.canEdit;
  const actions=editable?`<button class="btn" data-action="demo">Load demo</button><button class="btn primary" data-action="new">New project</button>`:'';
  const lead=state.data.role==='researcher'?'Projects you created in your team workspace.':'Workspace projects, published studies and participant evidence.';
  const content = top('My work',lead,actions)+
    (projects.length ? `<div class="grid three">${projects.map(p=>{const proto=state.data.prototypes.find(x=>x.projectId===p.id);const studies=state.data.studies.filter(x=>x.projectId===p.id);return `<article class="card project-card"><span class="pill green">Ready to test</span><h2>${escapeHtml(p.name)}</h2><p>${proto?escapeHtml(proto.name):'No prototype'} · ${studies.length} ${studies.length===1?'study':'studies'}</p><div class="meta"><button class="btn small" data-project="${p.id}">Open</button>${proto&&editable?`<button class="btn small primary" data-create-study="${proto.id}">Create study</button>`:''}</div></article>`}).join('')}</div>`:
    `<section class="empty"><div class="empty-icon">⌁</div><h2>${editable?'No prototype tests yet':'No work to review yet'}</h2><p>${editable?'Upload a runnable HTML prototype or load the demo to explore the complete product loop.':'Projects will appear here when a researcher creates them.'}</p>${editable?`<div class="actions" style="justify-content:center"><button class="btn" data-action="demo">Load demo</button><button class="btn primary" data-action="new">Upload prototype</button></div>`:''}</section>`);
  app.innerHTML=shell(content,'projects'); bind();
}
function renderUpload(){
  const content=top('Add a prototype','Upload a standalone HTML ideation output, or a ZIP when your prototype includes separate CSS, JavaScript or image files.',`<button class="btn" data-nav="projects">Cancel</button>`)+`<div class="card" style="max-width:760px"><form id="upload-form" class="form"><div class="field"><label for="projectName">Project name</label><input id="projectName" name="projectName" required placeholder="Example: Customer support workflow"></div><div class="upload"><div class="empty-icon">↑</div><h3>Upload runnable prototype</h3><p>HTML or ZIP · maximum 25 MB</p><input type="file" name="file" accept=".html,.htm,.zip,text/html,application/zip" aria-describedby="prototype-file-help" required><small id="prototype-file-help">A standalone HTML file is used as index.html automatically. ZIP files must contain index.html at the root or inside one top-level folder.</small></div><div id="form-error" role="alert" aria-live="assertive"></div><button class="btn primary" type="submit">Validate and upload</button></form></div>`;
  app.innerHTML=shell(content,'projects'); bind();
}
function renderProject(projectId){
  const p=state.data.projects.find(x=>x.id===projectId); const proto=state.data.prototypes.find(x=>x.projectId===projectId); const studies=state.data.studies.filter(x=>x.projectId===projectId);
  const create=state.data.permissions.canEdit?`<button class="btn primary" data-create-study="${proto.id}">Create study</button>`:'';
  const content=top(escapeHtml(p.name),'Review the prototype, create a task and publish a participant test.',`<button class="btn" data-nav="projects">All projects</button>${create}`)+`<div class="grid two"><section class="card"><span class="pill green">Prototype ready</span><h2>${escapeHtml(proto.name)}</h2><p>Version ${proto.version} · uploaded ${formatDate(proto.createdAt)}</p><button class="btn" data-preview="${proto.id}">Preview prototype</button></section><section class="card"><h2>Studies</h2>${studies.length?studies.map(s=>`<div class="study-row"><div><strong>${escapeHtml(s.title)}</strong><span class="sub">${escapeHtml(s.task.instruction)}</span></div><span class="pill green">Published</span><span class="sub">${formatDate(s.createdAt)}</span><button class="btn small" data-result="${s.id}">Results</button></div>`).join(''):`<p>${state.data.permissions.canEdit?'No studies yet. Create the first task-based test.':'No studies have been published yet.'}</p>`}</section></div>`;
  app.innerHTML=shell(content,'projects'); bind();
}
function renderPreview(protoId){
  const proto=state.data.prototypes.find(x=>x.id===protoId);
  const create=state.data.permissions.canEdit?`<button class="btn primary" data-create-study="${proto.id}">Create study</button>`:'';
  const content=top('Prototype preview',`Confirm that ${escapeHtml(proto.name)} loads correctly before defining a task.`,`<button class="btn" data-project="${proto.projectId}">Back</button>${create}`)+`<div class="card"><iframe class="preview-frame" sandbox="allow-scripts allow-forms allow-modals" src="/prototype/${proto.id}/index.html"></iframe></div>`;
  app.innerHTML=shell(content,'projects'); bind();
}
function renderStudyBuilder(protoId){
  const proto=state.data.prototypes.find(x=>x.id===protoId); state.selectedPrototype=protoId;
  const content=top('Create a usability study',`Define one realistic task for ${escapeHtml(proto.name)}. The participant should know the goal, not the interface action.`,`<button class="btn" data-project="${proto.projectId}">Cancel</button>`)+`<div class="steps"><div class="step on"></div><div class="step on"></div><div class="step"></div></div><div class="grid two"><form id="study-form" class="card form"><div class="field"><label>Study title</label><input name="title" required placeholder="Review a low-quality interaction"></div><div class="field"><label>Scenario</label><textarea name="scenario" placeholder="You are a support manager reviewing yesterday's interactions."></textarea><small>Give context without naming the control to click.</small></div><div class="field"><label>Task instruction</label><textarea name="instruction" required placeholder="Find an interaction with a low quality score and open its evaluation."></textarea></div><div class="field"><label>Success rule</label><input name="successSelector" required value="#open-evaluation" placeholder="text:Automatic"><small>Use an element ID, a data-testid selector, or visible text such as text:Automatic.</small></div><input type="hidden" name="prototypeId" value="${proto.id}"><div id="form-error"></div><button class="btn primary" type="submit">Publish participant test</button></form><section class="card"><h2>Live task preview</h2><p>Use the preview to confirm the success element exists and the journey is achievable.</p><iframe class="preview-frame" style="height:460px" sandbox="allow-scripts allow-forms allow-modals" src="/prototype/${proto.id}/index.html"></iframe></section></div>`;
  app.innerHTML=shell(content,'studies'); bind();
}
async function renderStudies(){
  await refresh();
  const rows=state.data.studies.map(s=>{const sessions=state.data.sessions.filter(x=>x.studyId===s.id);return `<div class="study-row"><div><strong>${escapeHtml(s.title)}</strong><span class="sub">${escapeHtml(s.task.instruction)}</span></div><span class="pill green">Published</span><span>${sessions.length} participants</span><div class="actions"><button class="btn small" data-copy="${s.id}">Copy link</button><button class="btn small primary" data-result="${s.id}">Results</button></div></div>`}).join('');
  app.innerHTML=shell(top('Studies','Published prototype tests and participant activity.')+`<section class="card">${rows||'<p>No studies published yet.</p>'}</section>`,'studies'); bind();
}
async function renderResults(studyId){
  if(!studyId){ await refresh(); studyId=state.data.studies.at(-1)?.id; }
  if(!studyId){ app.innerHTML=shell(top('Results','Evidence appears after you publish a study and collect participant sessions.')+`<section class="empty"><h2>No results yet</h2><p>Create a study to begin collecting evidence.</p></section>`,'results');bind();return; }
  const data=await api(`/api/studies/${studyId}/results`); state.selectedStudy=studyId;
  const m=data.metrics;
  const sessionRows=data.sessions.map((s,i)=>`<div class="session-row"><div><strong>Participant ${String(i+1).padStart(2,'0')}</strong><span class="sub">${formatDate(s.startedAt)} · ${s.eventCount} events</span></div><span class="${s.outcome==='success'?'status-success':'status-progress'}">${escapeHtml(s.outcome.replace('_',' '))}</span><span>${s.durationMs?Math.round(s.durationMs/1000)+' sec':'—'}</span><button class="btn small" data-session="${s.id}">Evidence</button></div>`).join('');
  const content=top(escapeHtml(data.study.title),'Observed behavior and participant feedback are kept separate so every interpretation remains traceable.',`<button class="btn" data-copy="${studyId}">Copy participant link</button><button class="btn primary" data-refresh-result="${studyId}">Refresh results</button>`)+`<div class="grid three"><div class="card metric"><div class="label">Task success</div><div class="value">${m.successRate}%</div><span class="sub">${data.sessions.filter(x=>x.outcome==='success').length} of ${m.participants} participants</span></div><div class="card metric"><div class="label">Average successful time</div><div class="value">${m.averageSuccessTimeSeconds||'—'}${m.averageSuccessTimeSeconds?'s':''}</div><span class="sub">Successful sessions only</span></div><div class="card metric"><div class="label">Behavioral evidence</div><div class="value">${m.totalEvents}</div><span class="sub">Captured interaction events</span></div></div><section class="card" style="margin-top:18px"><h2>Participant sessions</h2>${sessionRows||'<p>No one has taken this study yet. Copy the participant link to run the first session.</p>'}</section>`;
  app.innerHTML=shell(content,'results'); bind();
}
async function renderSession(studyId,sessionId){
  const data=await api(`/api/studies/${studyId}/results`); const s=data.sessions.find(x=>x.id===sessionId); if(!s)return;
  const events=s.events.map(e=>`<div class="event"><span>${(e.elapsedMs/1000).toFixed(1)}s</span><strong>${escapeHtml(e.type)}</strong><span>${escapeHtml(JSON.stringify(e.detail))}</span></div>`).join('');
  const content=top('Participant evidence',`A chronological record for ${escapeHtml(data.study.title)}. Input values are never captured.`,`<button class="btn" data-result="${studyId}">Back to results</button>`)+`<div class="grid two"><section class="card"><h2>Session summary</h2><p><strong>Outcome:</strong> ${escapeHtml(s.outcome)}<br><strong>Duration:</strong> ${s.durationMs?Math.round(s.durationMs/1000)+' seconds':'In progress'}<br><strong>Events:</strong> ${s.eventCount}</p>${s.response?`<div class="divider"></div><h3>Post-task feedback</h3><p>Ease: <strong>${s.response.ease}/7</strong><br>Confidence: <strong>${s.response.confidence}/5</strong></p><p>${escapeHtml(s.response.comment||'No comment')}</p>`:''}</section><section><h2>Evidence timeline</h2><div class="evidence">${events||'<div class="event"><span>—</span><strong>No events</strong><span>The session has not produced evidence yet.</span></div>'}</div></section></div>`;
  app.innerHTML=shell(content,'results'); bind();
}

async function renderParticipant(studyId){
  let payload;
  try{ payload=await api(`/api/studies/${studyId}`); }catch(e){app.innerHTML=`<div class="consent"><h1>Study unavailable</h1><p>${escapeHtml(e.message)}</p></div>`;return;}
  const {study,prototype}=payload;
  app.innerHTML=`<main class="test-shell"><div class="test-top"><div class="brand" style="color:var(--ink);margin:0"><div class="brand-mark">EI</div><div><strong>Experience Intelligence</strong><span style="color:var(--muted)">Participant study</span></div></div><span class="pill">About 3 minutes</span></div><section class="consent"><div class="eyebrow">Usability study</div><h1>${escapeHtml(study.title)}</h1><p>You will complete one task using an interactive prototype. We collect clicks, navigation, timing and task feedback. Text values are masked.</p><ul><li>No account is required.</li><li>You can leave at any time.</li><li>This is a prototype, not a production system.</li></ul><button class="btn primary" id="consent">I agree — start study</button></section></main>`;
  document.querySelector('#consent').onclick=()=>startParticipant(study,prototype);
}
async function startParticipant(study,prototype){
  const session=await api('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studyId:study.id})});
  let sequence=0; const started=Date.now(); let complete=false;
  app.innerHTML=`<main class="test-shell"><div class="test-top"><strong>${escapeHtml(study.title)}</strong><span class="pill green">Task in progress</span></div><section class="test-card"><div class="task-strip"><div><div class="eyebrow">Your task</div><strong>${escapeHtml(study.task.instruction)}</strong>${study.task.scenario?`<p>${escapeHtml(study.task.scenario)}</p>`:''}</div><button class="btn" id="give-up">I cannot complete this</button></div><div class="test-frame-wrap"><div id="prototype-status" class="prototype-status" role="status" aria-live="polite"><strong>Loading prototype…</strong><span>Large HTML prototypes can take a few seconds.</span></div><iframe id="runner" class="test-frame" sandbox="allow-scripts allow-forms allow-modals" src="/prototype/${prototype.id}/index.html"></iframe></div></section></main>`;
  const runner=document.querySelector('#runner'); const prototypeStatus=document.querySelector('#prototype-status'); let loadTimer;
  const showLoadFailure=()=>{prototypeStatus.innerHTML='<strong>The prototype did not load</strong><span>Reload it to try again, or end the task if the problem continues.</span><button class="btn small" id="retry-prototype">Reload prototype</button>';prototypeStatus.classList.add('failed');document.querySelector('#retry-prototype').onclick=()=>{prototypeStatus.classList.remove('failed');prototypeStatus.innerHTML='<strong>Loading prototype…</strong><span>Large HTML prototypes can take a few seconds.</span>';runner.src=runner.src;armLoadTimer();};};
  const armLoadTimer=()=>{clearTimeout(loadTimer);loadTimer=setTimeout(showLoadFailure,30000);}; armLoadTimer();
  async function record(type,detail,elapsedMs){ sequence++; await api('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.id,type,detail,elapsedMs,sequence,idempotencyKey:`${session.id}:${sequence}`})}); }
  const listener=async(event)=>{
    if(event.data?.source!=='eis-prototype'||complete)return;
    const {type,detail,elapsedMs}=event.data; await record(type,detail,elapsedMs);
    if(type==='prototype_ready'){clearTimeout(loadTimer);if(detail.visible)prototypeStatus.remove();else showLoadFailure();return;}
    if(type==='element_clicked'){
      const selector=study.task.successSelector;
      const expectedText=selector.startsWith('text:')?selector.slice(5).trim().toLowerCase():'';
      const match=(selector.startsWith('#')&&detail.id===selector.slice(1))||(selector.startsWith('[data-testid="')&&detail.testId===selector.match(/"([^"]+)/)?.[1])||(expectedText&&String(detail.text||'').toLowerCase().includes(expectedText));
      if(match){ complete=true; await record('success_rule_met',{selector},Date.now()-started); window.removeEventListener('message',listener); renderSurvey(study,session,started,'success'); }
    }
    if(type==='custom_event'&&study.task.successSelector===`event:${detail.name}`){ complete=true; await record('success_rule_met',{event:detail.name},Date.now()-started);window.removeEventListener('message',listener);renderSurvey(study,session,started,'success'); }
  };
  window.addEventListener('message',listener);
  document.querySelector('#give-up').onclick=()=>{complete=true;clearTimeout(loadTimer);window.removeEventListener('message',listener);renderSurvey(study,session,started,'failed');};
}
function renderSurvey(study,session,started,outcome){
  let ease=0,confidence=0;
  app.innerHTML=`<main class="test-shell"><section class="survey card"><div class="eyebrow">Task ${outcome==='success'?'completed':'ended'}</div><h1>One last step</h1><form id="survey" class="form"><div class="field"><label>How easy or difficult was this task?</label><div class="scale" data-scale="ease">${[1,2,3,4,5,6,7].map(n=>`<button type="button" data-value="${n}">${n}</button>`).join('')}</div><small>1 = very difficult · 7 = very easy</small></div><div class="field"><label>How confident are you that you completed it correctly?</label><div class="scale" data-scale="confidence" style="grid-template-columns:repeat(5,1fr)">${[1,2,3,4,5].map(n=>`<button type="button" data-value="${n}">${n}</button>`).join('')}</div><small>1 = not confident · 5 = very confident</small></div><div class="field"><label>What, if anything, was confusing?</label><textarea name="comment" placeholder="Optional"></textarea></div><div id="form-error"></div><button class="btn primary" type="submit">Submit feedback</button></form></section></main>`;
  document.querySelectorAll('.scale').forEach(group=>group.onclick=e=>{const b=e.target.closest('button');if(!b)return;group.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');if(group.dataset.scale==='ease')ease=Number(b.dataset.value);else confidence=Number(b.dataset.value);});
  document.querySelector('#survey').onsubmit=async e=>{e.preventDefault();if(!ease||!confidence){document.querySelector('#form-error').innerHTML='<div class="error">Please select both ratings.</div>';return;}await api(`/api/sessions/${session.id}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome,durationMs:Date.now()-started,response:{ease,confidence,comment:new FormData(e.target).get('comment')}})});app.innerHTML=`<main class="test-shell"><section class="consent" style="text-align:center"><div class="empty-icon">✓</div><h1>Thank you</h1><p>Your responses were recorded. You can now close this window.</p></section></main>`;};
}

function renderLogin(message=''){
  state.data=null; state.auth=null;
  app.innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="brand auth-brand"><div class="brand-mark">EI</div><div><strong>Experience Intelligence</strong><span>Team workspace</span></div></div><div class="eyebrow">Private workspace</div><h1>Sign in to your work</h1><p class="muted">UX researchers and managers use team accounts. Participants never need to sign in.</p>${message?`<div class="notice">${escapeHtml(message)}</div>`:''}<form id="login-form" class="form"><div class="field"><label for="identifier">Username or email</label><input id="identifier" name="identifier" autocomplete="username" required placeholder="founder or name@company.com"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div id="form-error"></div><button class="btn primary" type="submit">Sign in</button></form></section></main>`;
  const form=document.querySelector('#login-form');
  form.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Signing in…';document.querySelector('#form-error').innerHTML='';try{await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});history.replaceState({},'', '/');state.auth=await api('/api/auth/me');renderProjects();}catch(error){document.querySelector('#form-error').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;button.disabled=false;button.textContent='Sign in';}};
}

async function renderInvite(token){
  let invite;
  try{invite=await api(`/api/invites/${token}`);}catch(error){app.innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="empty-icon">!</div><h1>Invitation unavailable</h1><p class="muted">${escapeHtml(error.message)}</p><a class="btn" href="/login">Go to sign in</a></section></main>`;return;}
  app.innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="brand auth-brand"><div class="brand-mark">EI</div><div><strong>${escapeHtml(invite.workspaceName)}</strong><span>Team invitation</span></div></div><div class="eyebrow">${escapeHtml(roleLabel(invite.role))} invitation</div><h1>Create your account</h1><p class="muted">You were invited as <strong>${escapeHtml(invite.email)}</strong>. This invitation expires ${formatDate(invite.expiresAt)}.</p><form id="invite-form" class="form"><div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" minlength="2" required></div><div class="field"><label for="new-password">Create password</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="10" required><small>At least 10 characters.</small></div><div id="form-error"></div><button class="btn primary" type="submit">Join workspace</button></form></section></main>`;
  const form=document.querySelector('#invite-form');form.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Creating account…';try{await api(`/api/invites/${token}/accept`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});history.replaceState({},'', '/');state.auth=await api('/api/auth/me');renderProjects();}catch(error){document.querySelector('#form-error').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;button.disabled=false;button.textContent='Join workspace';}};
}

async function renderTeam(){
  if(!state.data)await refresh(); state.team=await api('/api/team');
  const canManage=state.team.canManage;
  const members=state.team.members.map(member=>`<div class="member-row"><div class="avatar">${escapeHtml((member.name||member.email||'?').slice(0,1).toUpperCase())}</div><div><strong>${escapeHtml(member.name||member.email)}</strong><span class="sub">${escapeHtml(member.email||member.login||'Workspace owner')}</span></div>${canManage&&member.role!=='owner'?`<select data-member-role="${member.membershipId}" data-previous="${member.role}" aria-label="Role for ${escapeHtml(member.name)}"><option value="researcher" ${member.role==='researcher'?'selected':''}>Researcher</option><option value="viewer" ${member.role==='viewer'?'selected':''}>Viewer / manager</option></select><button class="btn small danger" data-remove-member="${member.membershipId}">Remove</button>`:`<span class="pill">${escapeHtml(roleLabel(member.role))}</span><span></span>`}</div>`).join('');
  const invites=state.team.invites.map(invite=>`<div class="invite-row"><div><strong>${escapeHtml(invite.email)}</strong><span class="sub">${escapeHtml(roleLabel(invite.role))} · expires ${formatDate(invite.expiresAt)}</span></div>${canManage?`<button class="btn small" data-revoke-invite="${invite.id}">Revoke</button>`:''}</div>`).join('');
  const invitePanel=canManage?`<section class="card"><h2>Invite a teammate</h2><p>Create a secure link for a UX researcher or a read-only manager.</p><form id="invite-member-form" class="form inline-form"><div class="field"><label>Email address</label><input name="email" type="email" required placeholder="teammate@company.com"></div><div class="field"><label>Workspace role</label><select name="role"><option value="researcher">Researcher — create and test</option><option value="viewer">Viewer / manager — results only</option></select></div><button class="btn primary" type="submit">Create invitation</button><div id="form-error"></div></form>${state.lastInviteUrl?`<div class="invite-success"><strong>Invitation link ready</strong><div class="copy-field"><input readonly value="${escapeHtml(state.lastInviteUrl)}"><button class="btn" data-copy-invite>Copy link</button></div><small>Share this link privately. It expires after seven days.</small></div>`:''}</section>`:'';
  const content=top('Team','Manage who can create research and who can review results.')+`<div class="grid two team-grid"><section class="card"><h2>Workspace members</h2><p>${state.team.members.length} active ${state.team.members.length===1?'member':'members'}</p><div class="member-list">${members}</div></section>${invitePanel}</div>${invites?`<section class="card pending-card"><h2>Pending invitations</h2>${invites}</section>`:''}`;
  app.innerHTML=shell(content,'team');bind();
}

function bind(){
  document.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>{const v=el.dataset.nav;if(v==='projects')renderProjects();if(v==='studies')renderStudies();if(v==='results')renderResults();if(v==='team')renderTeam();});
  document.querySelectorAll('[data-action="logout"]').forEach(el=>el.onclick=async()=>{el.disabled=true;await api('/api/auth/logout',{method:'POST'}).catch(()=>{});history.replaceState({},'', '/login');renderLogin('You signed out successfully.');});
  document.querySelectorAll('[data-action="new"]').forEach(el=>el.onclick=renderUpload);
  document.querySelectorAll('[data-action="demo"]').forEach(el=>el.onclick=async()=>{el.disabled=true;await api('/api/demo',{method:'POST'});toast('Demo prototype added');renderProjects();});
  document.querySelectorAll('[data-project]').forEach(el=>el.onclick=()=>renderProject(el.dataset.project));
  document.querySelectorAll('[data-preview]').forEach(el=>el.onclick=()=>renderPreview(el.dataset.preview));
  document.querySelectorAll('[data-create-study]').forEach(el=>el.onclick=()=>renderStudyBuilder(el.dataset.createStudy));
  document.querySelectorAll('[data-result]').forEach(el=>el.onclick=()=>renderResults(el.dataset.result));
  document.querySelectorAll('[data-refresh-result]').forEach(el=>el.onclick=()=>renderResults(el.dataset.refreshResult));
  document.querySelectorAll('[data-session]').forEach(el=>el.onclick=()=>renderSession(state.selectedStudy,el.dataset.session));
  document.querySelectorAll('[data-copy]').forEach(el=>el.onclick=async()=>{await navigator.clipboard.writeText(`${location.origin}/test/${el.dataset.copy}`);toast('Participant link copied');});
  const upload=document.querySelector('#upload-form'); if(upload)upload.onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;btn.textContent='Validating prototype…';try{const result=await api('/api/prototypes',{method:'POST',body:new FormData(upload)});await refresh();toast('Prototype is ready');renderProject(result.project.id);}catch(error){document.querySelector('#form-error').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;btn.disabled=false;btn.textContent='Validate and upload';}};
  const study=document.querySelector('#study-form');if(study)study.onsubmit=async e=>{e.preventDefault();const input=Object.fromEntries(new FormData(study));try{const result=await api('/api/studies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});await refresh();await navigator.clipboard.writeText(`${location.origin}/test/${result.id}`).catch(()=>{});toast('Study published and link copied');renderResults(result.id);}catch(error){document.querySelector('#form-error').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;}};
  const inviteForm=document.querySelector('#invite-member-form');if(inviteForm)inviteForm.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Creating…';try{const result=await api('/api/team/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(inviteForm)))});state.lastInviteUrl=`${location.origin}/invite/${result.token}`;toast('Invitation created');renderTeam();}catch(error){document.querySelector('#form-error').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;button.disabled=false;button.textContent='Create invitation';}};
  document.querySelectorAll('[data-copy-invite]').forEach(el=>el.onclick=async()=>{await navigator.clipboard.writeText(state.lastInviteUrl);toast('Invitation link copied');});
  document.querySelectorAll('[data-member-role]').forEach(el=>el.onchange=async()=>{const previous=el.dataset.previous||'';el.disabled=true;try{await api(`/api/team/members/${el.dataset.memberRole}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:el.value})});toast('Member role updated');renderTeam();}catch(error){toast(error.message);if(previous)el.value=previous;el.disabled=false;}});
  document.querySelectorAll('[data-remove-member]').forEach(el=>el.onclick=async()=>{if(!confirm('Remove this member from the workspace? They will be signed out immediately, but their projects will remain available to the owner.'))return;el.disabled=true;try{await api(`/api/team/members/${el.dataset.removeMember}`,{method:'DELETE'});toast('Member removed');renderTeam();}catch(error){toast(error.message);el.disabled=false;}});
  document.querySelectorAll('[data-revoke-invite]').forEach(el=>el.onclick=async()=>{el.disabled=true;try{await api(`/api/team/invites/${el.dataset.revokeInvite}`,{method:'DELETE'});toast('Invitation revoked');renderTeam();}catch(error){toast(error.message);el.disabled=false;}});
}

const testMatch=/^\/test\/([^/]+)/.exec(location.pathname);
const inviteMatch=/^\/invite\/([^/]+)/.exec(location.pathname);
async function start(){
  if(testMatch)return renderParticipant(testMatch[1]);
  if(inviteMatch)return renderInvite(inviteMatch[1]);
  try{state.auth=await api('/api/auth/me');renderProjects();}catch(error){if(error.status===401)renderLogin(location.pathname==='/login'?'':'Sign in to open your private workspace.');else renderLogin(error.message);}
}
start();
