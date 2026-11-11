'use strict';
let focusView='', virtualTimer=null, virtualGeneration=0, virtualScroll=0;
function draftKey(kind){return 'bedazzle:'+(state.data?.workspace||'startup')+':'+kind;}
function focusPanel(view){
  focusView=view;$('work-area').dataset.focus=view;show('focus-tabs',!!view);
  for(const button of document.querySelectorAll('[data-focus]'))button.classList.toggle('selected',button.dataset.focus===view);
  for(const name of ['editor','results']){const button=$('expand-'+name);if(!button)continue;button.textContent=view?'↙':'⛶';button.setAttribute('aria-label',view?'Restore split view':'Expand '+name);button.title=button.getAttribute('aria-label');}
}
function clearVirtualPage(){clearTimeout(virtualTimer);virtualGeneration++;virtualScroll=0;$('table-scroll').scrollTop=0;}
function virtualGeometry(result){
  const count=Math.max(0,Math.min(result.logical_size,(result.total_rows??result.page_start+result.rows.length)-result.page_start));
  return {count,unit:Math.min(32,6000000/Math.max(1,count))};
}
function virtualRowAt(result,pixel){
  const {unit,count}=virtualGeometry(result),start=result.offset-result.page_start,n=result.rows.length;
  const header=$('result-table')?.tHead?.getBoundingClientRect().height||0;
  const y=Math.max(0,pixel-header),before=start*unit;
  const row=y<before?y/unit:y<before+n*32?start+(y-before)/32:start+n+(y-before-n*32)/unit;
  return Math.max(0,Math.min(count-1,Math.floor(row)));
}
function virtualPixelAt(result,row){
  const {unit}=virtualGeometry(result),start=result.offset-result.page_start,n=result.rows.length;
  const header=$('result-table')?.tHead?.getBoundingClientRect().height||0;
  return header+(row<start?row*unit:row<start+n?start*unit+(row-start)*32:start*unit+n*32+(row-start-n)*unit);
}
function renderVirtualRows(){
  const result=state.result,scroller=$('table-scroll');
  scroller.classList.toggle('virtual-page',!!(result?.logical_size>500&&result.total_rows!==undefined&&result.statement_count===1&&result.selectable));
  if(!scroller.classList.contains('virtual-page')||result.statement_count!==1||!result.selectable)return;
  const body=$('result-table')?.tBodies[0];if(!body)return;
  body.querySelectorAll('.virtual-spacer').forEach(item=>item.remove());
  const {count,unit}=virtualGeometry(result),start=result.offset-result.page_start;
  // Cap the proportional scroll track below browser element-height limits.
  const spacer=height=>{const cell=node('td',{colspan:result.columns.length+1});cell.style.height=Math.max(0,height)+'px';return node('tr',{class:'virtual-spacer','aria-hidden':'true'},cell);};
  body.prepend(spacer(start*unit));body.append(spacer((count-start-result.rows.length)*unit));scroller.scrollTop=virtualScroll;
}
async function loadVirtualWindow(){
  const result=state.result;if(!result||result.logical_size<=500||result.total_rows===undefined||state.busy||result.statement_count!==1||!result.selectable)return;
  const {count}=virtualGeometry(result),scroller=$('table-scroll'),wanted=virtualRowAt(result,scroller.scrollTop);
  const loadedStart=result.offset-result.page_start,visible=Math.ceil(scroller.clientHeight/32)+5;
  if(wanted>=loadedStart&&wanted+visible<loadedStart+result.rows.length)return;
  const batch=Math.max(1,result.rows.length||100),window=Math.max(0,Math.min(count-batch,wanted-50));
  if(window===loadedStart)return;
  const generation=virtualGeneration;virtualScroll=scroller.scrollTop;
  try{
    const next=await runJob('query',{sql:result.sql,offset:result.page_start,size:result.logical_size,window});
    if(generation!==virtualGeneration)return;
    const anchor=virtualRowAt(result,scroller.scrollTop);
    virtualScroll=virtualPixelAt(next,anchor);
    state.result=next;state.expanded.clear();renderResults();cacheTab();virtualTimer=setTimeout(loadVirtualWindow,120);
  }catch(error){report(error);}
}
function renderPlan(output){
  const tree=node('div',{class:'plan-tree'});
  const branch=item=>{
    const info=node('dl',{class:'plan-info'});
    for(const [key,value] of Object.entries(item.extra_info||{}))info.append(node('dt',{},key),node('dd',{},Array.isArray(value)?value.join('\n'):String(value)));
    return node('li',{},node('article',{class:'plan-node'},node('strong',{},item.name?.trim().replaceAll('_',' ')||'Operation'),info),item.children?.length?node('ul',{},item.children.map(branch)):null);
  };
  tree.append(node('p',{class:'form-hint'},'Read from the leaves upward: scans feed filters, joins and aggregations. Row counts are planner estimates. Explain does not run the query.'),node('ul',{},(output.tree||[]).map(branch)));
  $('detail-content').replaceChildren(tree,node('details',{},node('summary',{},'Raw plan JSON'),node('pre',{},output.plan)));
}
async function refreshRepository(){renderRepository(await api('/api/repository'));}
function renderRepository(value){
  $('repository-status').textContent=value.message;$('repository-link').disabled=!value.available||value.linked;
  $('repository-check').disabled=!value.available||!value.linked;$('repository-update').disabled=!value.available||!value.linked||value.modified||!value.behind||!!value.ahead;
}
async function repositoryAction(action){
  for(const button of document.querySelectorAll('.repository-actions button'))button.disabled=true;
  $('repository-status').textContent=action==='link'?'Connecting this folder. Your current files are kept…':'Contacting GitHub…';
  try{renderRepository(await api('/api/repository',{action}));}catch(error){await refreshRepository().catch(()=>{});$('repository-status').textContent=error.message;}
}
async function changeWorkspace(value){
  if(state.busy)throw new Error('Wait for the current operation or cancel it first.');
  clearTimeout(draftTimer);cacheTab();persistTabs();clearTimeout(draftTimer);
  await api('/api/drafts',JSON.parse(localStorage.getItem(draftKey('tabs'))));await api('/api/workspace',value);location.reload();
}
async function instructions(copy){
  const status=$('instructions-status');status.textContent='Preparing instructions…';
  try{const value=await api('/api/agent-instructions');
    if(copy){await navigator.clipboard.writeText(value.markdown);status.textContent='Copied. Paste the whole guide into your LLM.';}
    else{const url=URL.createObjectURL(new Blob([value.markdown],{type:'text/markdown;charset=utf-8'}));const link=node('a',{href:url,download:value.filename});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Downloaded.';}
  }catch(error){status.textContent=error.message;}
}
function setupWorkbench(){
  const registry=state.data.workspaces;
  fillOptions('workspace-select',registry.items.map(item=>[item.id,item.name]));$('workspace-select').value=registry.selected;
  $('workspace-name').textContent=registry.items.find(item=>item.id===registry.selected).name;
  $('page-size').value=state.data.settings.default_page_size||100;
  $('setting-page-size').replaceChildren(...[...$('page-size').options].map(option=>option.cloneNode(true)));
  bind('workspace-select','change',async()=>{try{await changeWorkspace({id:$('workspace-select').value});}catch(error){$('workspace-select').value=registry.selected;throw error;}});
  bind('new-workspace','click',()=>{$('new-workspace-name').value='';inlineError('workspace-error',null);$('workspace-dialog').showModal();$('new-workspace-name').focus();});
  bind('create-workspace','click',async()=>{try{await changeWorkspace({name:$('new-workspace-name').value});}catch(error){inlineError('workspace-error',error);}});
  bind('expand-results','click',()=>focusPanel(focusView?'':'results'));
  for(const button of document.querySelectorAll('[data-focus]'))button.onclick=()=>focusPanel(button.dataset.focus);
  bind('expand-detail','click',()=>{const expanded=$('detail-dialog').classList.toggle('detail-fullscreen');$('expand-detail').textContent=expanded?'↙':'⛶';$('expand-detail').setAttribute('aria-label',expanded?'Restore details':'Expand details');});
  bind('toggle-sidebar','click',()=>{const collapsed=document.body.classList.toggle('sidebar-collapsed');localStorage.setItem('bedazzle-sidebar',String(collapsed));$('toggle-sidebar').setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');});
  document.body.classList.toggle('sidebar-collapsed',localStorage.getItem('bedazzle-sidebar')==='true'||(innerWidth<760&&localStorage.getItem('bedazzle-sidebar')===null));
  const divider=$('panel-divider');
  const resize=y=>{const bounds=$('work-area').getBoundingClientRect(),ratio=Math.max(.2,Math.min(.75,(y-bounds.top)/bounds.height));$('work-area').style.setProperty('--editor-share',ratio+'fr');$('work-area').style.setProperty('--result-share',(1-ratio)+'fr');divider.setAttribute('aria-valuenow',Math.round(ratio*100));};
  divider.onpointerdown=event=>{divider.setPointerCapture(event.pointerId);document.body.classList.add('resizing-panels');};
  divider.onpointermove=event=>{if(divider.hasPointerCapture(event.pointerId))resize(event.clientY);};
  divider.onpointerup=event=>{divider.releasePointerCapture(event.pointerId);document.body.classList.remove('resizing-panels');};
  divider.onkeydown=event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();resize(divider.getBoundingClientRect().top+(event.key==='ArrowUp'?-30:30));}};
  $('table-scroll').addEventListener('scroll',()=>{virtualScroll=$('table-scroll').scrollTop;clearTimeout(virtualTimer);virtualTimer=setTimeout(loadVirtualWindow,140);},{passive:true});
  bind('copy-instructions','click',()=>instructions(true));bind('save-instructions','click',()=>instructions(false));
  for(const action of ['link','check','update'])bind('repository-'+action,'click',()=>repositoryAction(action));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))focusPanel('');});
  for(const [key,value] of Object.entries({'aria-valuemin':'20','aria-valuemax':'75','aria-valuenow':'42'}))divider.setAttribute(key,value);
}
