/* Durable companion activity with independent follow, visibility and position controls. */
'use strict';
(() => {
  const panel = document.createElement('aside');
  panel.id = 'claude-activity';
  panel.className = 'companion-panel';
  panel.setAttribute('aria-label', 'Claude activity');
  const toolbar = document.createElement('div'); toolbar.className = 'companion-toolbar';
  const visibility = document.createElement('button'); visibility.type = 'button'; visibility.id = 'claude-activity-toggle';
  visibility.setAttribute('aria-controls', panel.id);
  visibility.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18m-13 4h8m-8 3h5"/></svg>';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.id = 'follow-claude-toggle';
  let following = localStorage.getItem('bedazzle-follow-claude') !== 'paused';
  let minimized = localStorage.getItem('bedazzle-claude-panel-visible') !== 'true';
  const header = document.createElement('div'); header.className = 'companion-panel-header';
  const handle = document.createElement('div'); handle.className = 'companion-drag-handle'; handle.tabIndex = 0;
  handle.setAttribute('role', 'group'); handle.setAttribute('aria-label', 'Move Claude activity panel');
  handle.title = 'Drag to move. Use arrow keys when focused; Shift moves farther.';
  handle.textContent = '⠿ Claude activity';
  const followStatus = document.createElement('span'); followStatus.className = 'companion-follow-status';
  const minimize = document.createElement('button'); minimize.type = 'button'; minimize.className = 'companion-minimize';
  minimize.setAttribute('aria-label', 'Minimize Claude activity'); minimize.title = 'Minimize Claude activity';
  minimize.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  header.append(handle, followStatus, minimize);
  const content = document.createElement('div'); content.className = 'companion-panel-content';
  panel.append(header, content); document.body.append(panel);
  toolbar.append(visibility, toggle); document.getElementById('theme-toggle').before(toolbar);
  const openedAt=Date.now()/1000;
  const label = () => {
    toggle.innerHTML = following
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14m8-14v14"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
    toggle.setAttribute('aria-label', following ? 'Pause following Claude' : 'Follow Claude');
    toggle.title = following ? 'Pause following Claude — jobs keep running' : 'Follow Claude — show incoming results';
    toggle.setAttribute('aria-pressed', String(following));
    followStatus.textContent = following ? 'Following' : 'Paused';
  };
  label();
  toggle.onclick = () => { following = !following; localStorage.setItem('bedazzle-follow-claude', following ? 'on' : 'paused'); label(); };
  let position = null, dragging = null;
  try {
    const saved = JSON.parse(localStorage.getItem('bedazzle-claude-panel-position'));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = saved;
  } catch (_) { /* Invalid saved positions fall back to the corner. */ }
  function place(x, y, save = false) {
    const bounds = panel.getBoundingClientRect(), padding = 12;
    position = {x: Math.max(padding, Math.min(x, innerWidth - bounds.width - padding)), y: Math.max(padding, Math.min(y, innerHeight - bounds.height - padding))};
    panel.style.left = position.x + 'px'; panel.style.top = position.y + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    if (save) localStorage.setItem('bedazzle-claude-panel-position', JSON.stringify(position));
  }
  function visibilityLabel() {
    panel.hidden = minimized;
    visibility.setAttribute('aria-expanded', String(!minimized));
    visibility.setAttribute('aria-label', minimized ? 'Show Claude activity' : 'Hide Claude activity');
    visibility.title = minimized ? 'Show Claude activity' : 'Hide Claude activity';
    if (!minimized && position) place(position.x, position.y);
  }
  function setMinimized(value) {
    minimized = value;
    localStorage.setItem('bedazzle-claude-panel-visible', String(!minimized));
    visibilityLabel();
  }
  visibility.onclick = () => setMinimized(!minimized);
  minimize.onclick = () => { setMinimized(true); visibility.focus(); };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setMinimized(true); visibility.focus(); }
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const bounds = panel.getBoundingClientRect();
    dragging = {id:event.pointerId, x:event.clientX - bounds.left, y:event.clientY - bounds.top};
    handle.setPointerCapture(event.pointerId); header.classList.add('dragging'); event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (dragging?.id === event.pointerId) place(event.clientX - dragging.x, event.clientY - dragging.y);
  });
  function endDrag(event) {
    if (dragging?.id !== event.pointerId) return;
    dragging = null; header.classList.remove('dragging');
    if (position) place(position.x, position.y, true);
  }
  handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', endDrag);
  handle.addEventListener('keydown', event => {
    const direction = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[event.key];
    if (!direction) return;
    event.preventDefault(); const bounds = panel.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
    place(bounds.left + direction[0]*step, bounds.top + direction[1]*step, true);
  });
  const constrain = () => { if (!minimized && position) place(position.x, position.y); };
  window.addEventListener('resize', constrain);
  new ResizeObserver(constrain).observe(panel);
  visibilityLabel();
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Claude activity and saved results';
  const list = document.createElement('div');
  details.append(summary, list); content.append(details);
  const actions = document.createElement('div'); actions.className = 'companion-panel-actions'; content.append(actions);
  const responses = document.createElement('button'); responses.textContent = 'Inspect recent tool responses';
  responses.onclick = async () => {
    try {
      const value = await api('/api/companion-responses');
      const output = document.createElement('pre'); output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto';
      output.textContent=JSON.stringify(value.responses,null,2); list.append(output); details.open=true;
    } catch (error) { report(error); }
  };
  actions.append(responses);
  const approvals=document.createElement('button');approvals.textContent='Tasks and approvals';
  approvals.onclick=()=>api('/api/companion-control',{}).catch(report);actions.append(approvals);
  const cancel=document.createElement('button');cancel.textContent='Cancel Claude job';
  cancel.onclick=async()=>{try{const boot=await api('/api/bootstrap');if(!boot.active_job)return;const job=await api('/api/jobs/'+boot.active_job);if(job.action==='companion')await api('/api/companion-cancel',{id:job.id});}catch(error){report(error)}};
  actions.append(cancel);
  const navigationStatus=document.createElement('div');navigationStatus.setAttribute('role','status');content.append(navigationStatus);
  let sequence = 0, workspace = '';
  const launchArtifact=window.bedazzleRequestedArtifact||new URLSearchParams(location.search).get('companion_show');
  let requestedShow = launchArtifact ? {id:launchArtifact,explicit:true} : null;
  window.bedazzleRequestedArtifact=null;
  if(new URLSearchParams(location.search).has('companion_show')) {
    const consumed=new URL(location.href);consumed.searchParams.delete('companion_show');history.replaceState(null,'',consumed.pathname+consumed.search+consumed.hash);
  }
  const seen = new Set();
  async function poll() {
    try {
      const value = await api('/api/companion?after=' + sequence);
      if (workspace !== value.workspace) { workspace = value.workspace; sequence = 0; seen.clear(); list.replaceChildren(); }
      for (const event of value.events) {
        sequence = Math.max(sequence, event.seq);
        const row = document.createElement('div');
        row.style.cssText = 'border-top:1px solid #888;padding:5px;white-space:pre-wrap;overflow-wrap:anywhere';
        row.textContent = event.type + (event.sql ? '\n' + event.sql : '') + (event.error ? '\n' + event.error : '') + (event.version ? '\nVersion: ' + event.version + (typeof event.edited==='boolean' ? (event.edited ? ' (edited)' : ' (original)') : '') : '');
        list.append(row);
        if (following) details.open = true;
      }
      for (const artifact of value.artifacts) {
        if (!artifact.result_id || seen.has(artifact.id)) continue;
        seen.add(artifact.id);
        const row = document.createElement('div');
        row.textContent = (artifact.edited ? 'Includes edited source(s): ' : 'Original source(s): ') + artifact.inputs.join(', ');
        const open = document.createElement('button'); open.textContent = 'Show retained result';
        open.onclick = () => {requestedShow={id:artifact.id,explicit:true};navigationStatus.textContent='Opening saved result...';};
        row.append(open); list.append(row);
        if(following && artifact.created>=openedAt && (!requestedShow || (!requestedShow.explicit && artifact.created>requestedShow.created))) requestedShow={id:artifact.id,explicit:false,created:artifact.created};
      }
      while (list.children.length > 100) list.firstChild.remove();
      if(requestedShow && state.data && state.tabs.length && !state.busy) {
        if(!requestedShow.explicit && !following){requestedShow=null;return;}
        const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable||document.querySelector('dialog[open]');
        if(!requestedShow.explicit && editing)return;
        const artifact=value.artifacts.find(item=>item.id===requestedShow.id)||await api('/api/companion-artifact?id='+encodeURIComponent(requestedShow.id));
        if(artifact?.result_id) {
          const name='Claude '+artifact.id.slice(0,6),existing=state.tabs.find(tab=>tab.name===name && tab.sql===artifact.sql);
          if(!existing && state.tabs.length>=10){if(requestedShow.explicit)navigationStatus.textContent='Close a SQL tab to show this result. Existing drafts were preserved.';return;}
          const boot=await api('/api/bootstrap');if(boot.active_job)return;
          if(existing) switchTab(existing.id); else newTab(name,artifact.sql);
          await runSQL(artifact.sql,0,true,{result_id:artifact.result_id});
          requestedShow=null;navigationStatus.textContent='Last shown result: '+artifact.id+'; '+(artifact.edited?'includes edited source(s): ':'original source(s): ')+artifact.inputs.join(', ');
        }
      }
    } catch (_) { /* Server unavailable or startup still in progress; retry without navigating. */ }
    finally {setTimeout(poll, 1500);}
  }
  poll();
})();
