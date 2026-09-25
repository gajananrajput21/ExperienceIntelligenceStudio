const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const state = { data: null, auth: null, team: null, lastInviteUrl: '', view: 'projects', selectedPrototype: null, selectedStudy: null, setupStep: 1 };
const DEFAULT_METRICS = ['task_success_rate','time_on_task','click_count','misclicks','hesitation','ease','confidence','session_replay'];
const METRIC_OPTIONS = [
  ['task_success_rate','Task success rate','Successful participants divided by all participants'],
  ['time_on_task','Time on task','Average completion time for successful sessions'],
  ['click_count','Click count','Average actions taken per participant'],
  ['path_efficiency','Path efficiency','Expected actions compared with actual clicks'],
  ['misclicks','Misclicks','Clicks with no detected interface response'],
  ['backtracking','Backtracking','Participants returning to a previously visited view'],
  ['hesitation','Hesitation','Pointer pauses lasting at least 1.2 seconds'],
  ['drop_off_rate','Drop-off rate','Sessions that ended without successful completion'],
  ['ease','Ease score','Participant rating from 1 to 7'],
  ['confidence','Confidence','Participant rating from 1 to 5'],
  ['completion_method','Completion method','Automatic versus participant-confirmed completion'],
  ['session_replay','Session replay','Privacy-safe interaction playback'],
  ['click_map','Click map','Where participants clicked in the prototype'],
  ['dwell_map','Dwell map','Where participants paused their pointer'],
];

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
  const metricOptions=METRIC_OPTIONS.map(([value,label,description])=>`<label class="metric-choice"><input type="checkbox" name="metrics" value="${value}" ${DEFAULT_METRICS.includes(value)?'checked':''}><span><strong>${label}</strong><small>${description}</small></span></label>`).join('');
  const content=top('Create a usability study',`Define one realistic task for ${escapeHtml(proto.name)} and choose the evidence you want to collect.`,`<button class="btn" data-project="${proto.projectId}">Cancel</button>`)+`<div class="steps"><div class="step on"></div><div class="step on"></div><div class="step on"></div></div><div class="grid two"><form id="study-form" class="card form"><div class="field"><label>Study title</label><input name="title" required placeholder="Review a low-quality interaction"></div><div class="field"><label>Participant target</label><input name="participantTarget" type="number" min="1" max="500" value="50" required><small>The participant link closes automatically after 50 sessions.</small></div><div class="field"><label>Scenario</label><textarea name="scenario" placeholder="You are a support manager reviewing yesterday's interactions."></textarea><small>Give context without naming the control to click.</small></div><div class="field"><label>Task instruction</label><textarea name="instruction" required placeholder="Find an interaction with a low quality score and open its evaluation."></textarea></div><div class="field"><label>Success rule</label><input name="successSelector" required value="#open-evaluation" placeholder="text:Automatic"><small>Use an element ID, a data-testid selector, or visible text such as text:Automatic.</small></div><fieldset class="metric-builder"><legend>What do you want to measure?</legend><p>Select multiple metrics. Only selected measurements will appear in results.</p><div class="metric-choices">${metricOptions}</div></fieldset><div class="field"><label>Expected successful action count <span class="sub">Optional</span></label><input name="expectedActionCount" type="number" min="1" max="100" placeholder="Example: 3"><small>Used to calculate path efficiency when that metric is selected.</small></div><div class="field"><label>Custom post-task question <span class="sub">Optional</span></label><textarea name="customQuestion" maxlength="300" placeholder="What made this task confusing?"></textarea></div><input type="hidden" name="prototypeId" value="${proto.id}"><div id="form-error"></div><button class="btn primary" type="submit">Publish participant test</button></form><section class="card"><h2>Live task preview</h2><p>Use the preview to confirm the success element exists and the journey is achievable.</p><iframe class="preview-frame" style="height:460px" sandbox="allow-scripts allow-forms allow-modals" src="/prototype/${proto.id}/index.html"></iframe></section></div>`;
  app.innerHTML=shell(content,'studies'); bind();
}
async function renderStudies(){
  await refresh();
  const rows=state.data.studies.map(s=>{const sessions=state.data.sessions.filter(x=>x.studyId===s.id);const target=s.participantTarget||50;return `<div class="study-row"><div><strong>${escapeHtml(s.title)}</strong><span class="sub">${escapeHtml(s.task.instruction)}</span></div><span class="pill green">Published</span><span><strong>${sessions.length} / ${target}</strong><span class="sub">participants</span></span><div class="actions"><button class="btn small" data-copy="${s.id}">Copy link</button><button class="btn small primary" data-result="${s.id}">Results</button></div></div>`}).join('');
  app.innerHTML=shell(top('Studies','Published prototype tests and participant activity.')+`<section class="card">${rows||'<p>No studies published yet.</p>'}</section>`,'studies'); bind();
}
async function renderResults(studyId){
  if(!studyId){ await refresh(); studyId=state.data.studies.at(-1)?.id; }
  if(!studyId){ app.innerHTML=shell(top('Results','Evidence appears after you publish a study and collect participant sessions.')+`<section class="empty"><h2>No results yet</h2><p>Create a study to begin collecting evidence.</p></section>`,'results');bind();return; }
  const data=await api(`/api/studies/${studyId}/results`); state.selectedStudy=studyId;
  const m=data.metrics; const selected=data.study.measurementPlan?.metrics||DEFAULT_METRICS;
  const metricCard=(label,value,description)=>`<div class="card metric"><div class="label">${label}</div><div class="value">${value}</div><span class="sub">${description}</span></div>`;
  const cards={
    task_success_rate:()=>metricCard('Task success rate',`${m.taskSuccessRate}%`,`${data.sessions.filter(x=>x.outcome==='success').length} of ${m.participants} participants`),
    time_on_task:()=>metricCard('Average successful time',m.averageSuccessTimeSeconds?`${m.averageSuccessTimeSeconds}s`:'—','Successful sessions only'),
    click_count:()=>metricCard('Average click count',m.averageClicks||'—','Clicks per participant'),
    path_efficiency:()=>metricCard('Path efficiency',m.pathEfficiency?`${m.pathEfficiency}%`:'—','Expected actions compared with actual clicks'),
    misclicks:()=>metricCard('Possible misclicks',m.misclicks,'System-inferred clicks without a detected response'),
    backtracking:()=>metricCard('Backtracking',m.backtracks,'Repeated previously visited views'),
    hesitation:()=>metricCard('Hesitation signals',m.hesitationCount,'Pointer pauses of at least 1.2 seconds'),
    drop_off_rate:()=>metricCard('Drop-off rate',`${m.dropOffRate}%`,'Sessions not completed successfully'),
    ease:()=>metricCard('Average ease',m.averageEase?`${m.averageEase}/7`:'—','Participant-rated task ease'),
    confidence:()=>metricCard('Average confidence',m.averageConfidence?`${m.averageConfidence}/5`:'—','Participant-rated completion confidence'),
    completion_method:()=>metricCard('Completion method',`${m.automaticCompletions} / ${m.participantConfirmedCompletions}`,'Automatic / participant-confirmed'),
    session_replay:()=>metricCard('Session replays',data.sessions.length,'Privacy-safe interaction playbacks'),
    click_map:()=>metricCard('Click-map signals',data.sessions.reduce((sum,session)=>sum+session.events.filter(event=>event.type==='element_clicked').length,0),'Recorded click locations'),
    dwell_map:()=>metricCard('Dwell-map signals',m.hesitationCount,'Recorded pointer pauses'),
  };
  const metricCards=selected.filter(metric=>cards[metric]).map(metric=>cards[metric]()).join('');
  const replayEnabled=selected.includes('session_replay');
  const sessionRows=data.sessions.map((s,i)=>`<div class="session-row"><div><strong>Participant ${String(i+1).padStart(2,'0')}</strong><span class="sub">${formatDate(s.startedAt)} · ${s.eventCount} events</span></div><span class="${s.outcome==='success'?'status-success':'status-progress'}">${escapeHtml(s.outcome.replace('_',' '))}</span><span>${s.durationMs?Math.round(s.durationMs/1000)+' sec':'—'}</span><button class="btn small" data-session="${s.id}">${replayEnabled?'Watch replay':'Evidence'}</button></div>`).join('');
  const content=top(escapeHtml(data.study.title),'Only the measurements selected for this study are shown. Inferred behavioral signals remain traceable to participant evidence.',`<button class="btn" data-copy="${studyId}">Copy participant link</button><button class="btn primary" data-refresh-result="${studyId}">Refresh results</button>`)+`<section class="card sample-progress"><div><span class="eyebrow">Recruitment progress</span><h2>${m.participants} of ${m.participantTarget} participants</h2><p>${m.participantTarget-m.participants>0?`${m.participantTarget-m.participants} more sessions needed to reach the study target.`:'The participant target has been reached.'}</p></div><div class="progress-visual"><strong>${m.participantProgress}%</strong><div class="progress-track"><span style="width:${m.participantProgress}%"></span></div></div></section><div class="metric-grid">${metricCards}</div><section class="card" style="margin-top:18px"><h2>Participant sessions</h2>${sessionRows||'<p>No one has taken this study yet. Copy the participant link to run the first session.</p>'}</section>`;
  app.innerHTML=shell(content,'results'); bind();
}
async function renderSession(studyId,sessionId){
  const data=await api(`/api/studies/${studyId}/results`); const s=data.sessions.find(x=>x.id===sessionId); if(!s)return;
  const events=s.events.map(e=>`<div class="event"><span>${(e.elapsedMs/1000).toFixed(1)}s</span><strong>${escapeHtml(e.type)}</strong><span>${escapeHtml(JSON.stringify(e.detail))}</span></div>`).join('');
  const selected=data.study.measurementPlan?.metrics||DEFAULT_METRICS; const replayEnabled=selected.includes('session_replay');
  const replayEvents=s.events.filter(event=>['element_clicked','pointer_pause','scroll_changed','navigation','form_submitted','success_rule_met','participant_marked_complete'].includes(event.type));
  const markers=s.events.filter(event=>['element_clicked','pointer_pause'].includes(event.type)&&event.detail?.viewportWidth&&event.detail?.viewportHeight).map(event=>`<span class="map-marker ${event.type==='element_clicked'?'click':'dwell'}" style="left:${Math.max(0,Math.min(100,event.detail.x/event.detail.viewportWidth*100))}%;top:${Math.max(0,Math.min(100,event.detail.y/event.detail.viewportHeight*100))}%" title="${event.type==='element_clicked'?'Click':'Pointer pause'} at ${(event.elapsedMs/1000).toFixed(1)} seconds"></span>`).join('');
  const replay=replayEnabled?`<section class="card replay-card"><div class="replay-header"><div><h2>Interaction replay</h2><p>Video-like reconstruction from masked interaction events. It is not a camera or screen recording.</p></div><div class="actions"><label class="speed-control">Speed <select id="replay-speed"><option value="1">1×</option><option value="2">2×</option><option value="4" selected>4×</option><option value="8">8×</option></select></label><button class="btn" id="toggle-map">Show interaction map</button><button class="btn primary" id="play-replay">Play replay</button></div></div><div class="replay-stage" id="replay-stage"><iframe id="replay-frame" sandbox="allow-scripts allow-forms allow-modals" src="/prototype/${data.study.prototypeId}/index.html"></iframe><div class="replay-map" aria-hidden="true">${markers}</div><span class="replay-cursor" id="replay-cursor"></span><div class="replay-caption" id="replay-caption" role="status" aria-live="polite">Ready to replay ${replayEvents.length} interaction signals</div></div><p class="sub">Typed values are never stored. Click, dwell and misclick indicators are behavioral proxies and should be interpreted with participant feedback.</p></section>`:'';
  const feedback=s.response?`<div class="divider"></div><h3>Post-task feedback</h3>${s.response.ease?`<p>Ease: <strong>${s.response.ease}/7</strong></p>`:''}${s.response.confidence?`<p>Confidence: <strong>${s.response.confidence}/5</strong></p>`:''}${s.response.comment?`<p>${escapeHtml(s.response.comment)}</p>`:''}${s.response.customAnswer?`<p><strong>${escapeHtml(data.study.measurementPlan?.customQuestion||'Custom response')}</strong><br>${escapeHtml(s.response.customAnswer)}</p>`:''}`:'';
  const content=top('Participant evidence',`Replay and chronological evidence for ${escapeHtml(data.study.title)}. Input values are never captured.`,`<button class="btn" data-result="${studyId}">Back to results</button>`)+replay+`<div class="grid two evidence-grid"><section class="card"><h2>Session summary</h2><p><strong>Outcome:</strong> ${escapeHtml(s.outcome)}<br><strong>Duration:</strong> ${s.durationMs?Math.round(s.durationMs/1000)+' seconds':'In progress'}<br><strong>Events:</strong> ${s.eventCount}</p>${feedback}</section><section><h2>Evidence timeline</h2><div class="evidence">${events||'<div class="event"><span>—</span><strong>No events</strong><span>The session has not produced evidence yet.</span></div>'}</div></section></div>`;
  app.innerHTML=shell(content,'results'); bind();
  if(replayEnabled){
    const frame=document.querySelector('#replay-frame'); const cursor=document.querySelector('#replay-cursor'); const caption=document.querySelector('#replay-caption'); const play=document.querySelector('#play-replay'); let timers=[];
    const clearReplay=()=>{timers.forEach(clearTimeout);timers=[];cursor.classList.remove('visible');};
    const describeEvent=(event)=>({element_clicked:'Click',pointer_pause:'Pause',scroll_changed:'Scroll',navigation:'Navigation',form_submitted:'Form submitted',success_rule_met:'Success detected',participant_marked_complete:'Participant confirmed completion'})[event.type]||event.type;
    play.onclick=()=>{clearReplay();play.disabled=true;play.textContent='Replaying…';caption.textContent='Loading the tested prototype…';frame.src=frame.src;frame.onload=()=>{const speed=Number(document.querySelector('#replay-speed').value||4);replayEvents.forEach((event,index)=>{timers.push(setTimeout(()=>{const detail=event.detail||{};if(detail.viewportWidth&&detail.viewportHeight&&Number.isFinite(detail.x)&&Number.isFinite(detail.y)){cursor.style.left=`${detail.x/detail.viewportWidth*100}%`;cursor.style.top=`${detail.y/detail.viewportHeight*100}%`;cursor.classList.add('visible');}caption.textContent=`${(event.elapsedMs/1000).toFixed(1)}s · ${describeEvent(event)}`;frame.contentWindow?.postMessage({source:'eis-replay',event},'*');if(index===replayEvents.length-1){play.disabled=false;play.textContent='Replay again';caption.textContent=`Replay complete · ${replayEvents.length} interaction signals`;timers.push(setTimeout(()=>cursor.classList.remove('visible'),700));}},Math.max(0,event.elapsedMs/speed)));});if(!replayEvents.length){play.disabled=false;play.textContent='Play replay';caption.textContent='No replay signals were captured for this session.';}};};
    document.querySelector('#toggle-map').onclick=e=>{const shown=document.querySelector('#replay-stage').classList.toggle('show-map');e.currentTarget.textContent=shown?'Hide interaction map':'Show interaction map';};
  }
}

async function renderParticipant(studyId){
  let payload;
  try{ payload=await api(`/api/studies/${studyId}`); }catch(e){app.innerHTML=`<div class="consent"><h1>Study unavailable</h1><p>${escapeHtml(e.message)}</p></div>`;return;}
  const {study,prototype}=payload;
  const replayEnabled=(study.measurementPlan?.metrics||DEFAULT_METRICS).includes('session_replay');
  app.innerHTML=`<main class="test-shell"><div class="test-top"><div class="brand" style="color:var(--ink);margin:0"><div class="brand-mark">EI</div><div><strong>Experience Intelligence</strong><span style="color:var(--muted)">Participant study</span></div></div><span class="pill">About 3 minutes</span></div><section class="consent"><div class="eyebrow">Usability study</div><h1>${escapeHtml(study.title)}</h1><p>You will complete one task using an interactive prototype. We collect clicks, navigation, timing and task feedback.${replayEnabled?' Your interactions will also create a video-like session replay for the research team.':''}</p><ul><li>Typed values are masked and never stored.</li><li>No camera, microphone or screen recording is used.</li><li>No account is required, and you can leave at any time.</li></ul><button class="btn primary" id="consent">I agree — start study</button></section></main>`;
  document.querySelector('#consent').onclick=()=>startParticipant(study,prototype);
}
async function startParticipant(study,prototype){
  let session;
  try{session=await api('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studyId:study.id})});}catch(error){app.innerHTML=`<main class="test-shell"><section class="consent" style="text-align:center"><div class="empty-icon">✓</div><h1>Study closed</h1><p>${escapeHtml(error.message)}</p><p class="sub">Thank you for your interest. You may close this window.</p></section></main>`;return;}
  let sequence=0; const started=Date.now(); let complete=false;
  app.innerHTML=`<main class="test-shell"><div class="test-top"><strong>${escapeHtml(study.title)}</strong><span class="pill green">Task in progress</span></div><section class="test-card"><div class="task-strip"><div><div class="eyebrow">Your task</div><strong>${escapeHtml(study.task.instruction)}</strong>${study.task.scenario?`<p>${escapeHtml(study.task.scenario)}</p>`:''}</div><div class="task-actions"><button class="btn primary" id="mark-complete">I completed this task</button><button class="btn" id="give-up">I cannot complete this</button></div></div><div class="test-frame-wrap"><div id="prototype-status" class="prototype-status" role="status" aria-live="polite"><strong>Loading prototype…</strong><span>Large HTML prototypes can take a few seconds.</span></div><iframe id="runner" class="test-frame" sandbox="allow-scripts allow-forms allow-modals" src="/prototype/${prototype.id}/index.html"></iframe></div></section></main>`;
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
  async function finishTask(outcome,eventType){
    if(complete)return;
    complete=true; clearTimeout(loadTimer);
    document.querySelectorAll('.task-actions button').forEach(button=>button.disabled=true);
    window.removeEventListener('message',listener);
    try{await record(eventType,{method:'participant_confirmation'},Date.now()-started);}catch(error){console.warn('Could not record completion event',error);}
    renderSurvey(study,session,started,outcome);
  }
  document.querySelector('#mark-complete').onclick=e=>{e.currentTarget.textContent='Completing…';finishTask('success','participant_marked_complete');};
  document.querySelector('#give-up').onclick=e=>{e.currentTarget.textContent='Ending task…';finishTask('failed','participant_could_not_complete');};
}
function renderSurvey(study,session,started,outcome){
  let ease=0,confidence=0; const selected=study.measurementPlan?.metrics||DEFAULT_METRICS; const askEase=selected.includes('ease'); const askConfidence=selected.includes('confidence'); const customQuestion=study.measurementPlan?.customQuestion;
  const easeField=askEase?`<div class="field"><label>How easy or difficult was this task?</label><div class="scale" data-scale="ease">${[1,2,3,4,5,6,7].map(n=>`<button type="button" data-value="${n}">${n}</button>`).join('')}</div><small>1 = very difficult · 7 = very easy</small></div>`:'';
  const confidenceField=askConfidence?`<div class="field"><label>How confident are you that you completed it correctly?</label><div class="scale" data-scale="confidence" style="grid-template-columns:repeat(5,1fr)">${[1,2,3,4,5].map(n=>`<button type="button" data-value="${n}">${n}</button>`).join('')}</div><small>1 = not confident · 5 = very confident</small></div>`:'';
  const customField=customQuestion?`<div class="field"><label>${escapeHtml(customQuestion)}</label><textarea name="customAnswer" placeholder="Optional"></textarea></div>`:'';
  app.innerHTML=`<main class="test-shell"><section class="survey card"><div class="eyebrow">Task ${outcome==='success'?'completed':'ended'}</div><h1>One last step</h1><form id="survey" class="form">${easeField}${confidenceField}${customField}<div class="field"><label>What, if anything, was confusing?</label><textarea name="comment" placeholder="Optional"></textarea></div><div id="form-error"></div><button class="btn primary" type="submit">Submit feedback</button></form></section></main>`;
  document.querySelectorAll('.scale').forEach(group=>group.onclick=e=>{const b=e.target.closest('button');if(!b)return;group.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');if(group.dataset.scale==='ease')ease=Number(b.dataset.value);else confidence=Number(b.dataset.value);});
  document.querySelector('#survey').onsubmit=async e=>{e.preventDefault();if((askEase&&!ease)||(askConfidence&&!confidence)){document.querySelector('#form-error').innerHTML='<div class="error">Please select the required rating.</div>';return;}const formData=new FormData(e.target);await api(`/api/sessions/${session.id}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome,durationMs:Date.now()-started,response:{ease,confidence,comment:formData.get('comment'),customAnswer:formData.get('customAnswer')}})});app.innerHTML=`<main class="test-shell"><section class="consent" style="text-align:center"><div class="empty-icon">✓</div><h1>Thank you</h1><p>Your responses were recorded. You can now close this window.</p></section></main>`;};
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
  const study=document.querySelector('#study-form');if(study)study.onsubmit=async e=>{e.preventDefault();const formData=new FormData(study);const input=Object.fromEntries(formData);input.metrics=formData.getAll('metrics');if(!input.metrics.length){document.querySelector('#form-error').innerHTML='<div class="error">Select at least one metric.</div>';return;}if(input.metrics.includes('path_efficiency')&&!input.expectedActionCount){document.querySelector('#form-error').innerHTML='<div class="error">Enter the expected action count to measure path efficiency.</div>';return;}try{const result=await api('/api/studies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});await refresh();await navigator.clipboard.writeText(`${location.origin}/test/${result.id}`).catch(()=>{});toast('Study published and link copied');renderResults(result.id);}catch(error){document.querySelector('#form-error').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;}};
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
