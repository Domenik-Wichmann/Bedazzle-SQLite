'use strict';
let workspaceOverview=null,manageAction=null;
async function loadWorkspaceOverview(){workspaceOverview=await api('/api/workspaces');state.data.workspaces={...state.data.workspaces,...workspaceOverview};renderWorkspaceMenu();return workspaceOverview;}
function renderWorkspaceMenu(){
 const current=workspaceOverview.items.find(item=>item.id===workspaceOverview.selected);
 $('workspace-nav-label').textContent=current?.name||'Workspace';$('workspace-name').textContent=current?.name||'Workspace';
 $('workspace-menu-list').replaceChildren(...workspaceOverview.items.map(item=>node('button',{'data-workspace-id':item.id,class:'workspace-menu-item'+(item.id===workspaceOverview.selected?' selected':''),onclick:()=>changeWorkspace({id:item.id}).catch(report)},node('span',{class:'workspace-avatar'},item.example?'◈':item.name.slice(0,1).toUpperCase()),node('span',{},item.name),item.id===workspaceOverview.selected?node('small',{},'Current'):null)));
}
function editName(title,value,action){manageAction=action;$('manage-name-title').textContent=title;$('manage-name').value=value;inlineError('manage-error',null);$('manage-name-dialog').showModal();$('manage-name').select();}
async function manageWorkspace(action,id,name){
 if(state.busy)throw new Error('Finish or cancel the current operation first.');
 if(action==='archive'&&id===state.data.workspaces.selected){flushDrafts();clearTimeout(draftTimer);await api('/api/drafts',JSON.parse(localStorage.getItem(draftKey('tabs'))));}
 const result=await api('/api/workspace-manage',{action,id,name});
 if(result.reload){location.reload();return result;}
 await loadWorkspaceOverview();if(!$('workspace-home').classList.contains('hidden'))renderWorkspaceHome();return result;
}
function renderWorkspaceHome(){
 const data=workspaceOverview;
 $('workspace-total').textContent=data.items.length+' workspace'+(data.items.length===1?'':'s');
 $('workspace-cards').replaceChildren(...data.items.map(item=>{
  const card=node('article',{class:'workspace-card'+(item.id===data.selected?' current':'')},
   node('div',{class:'workspace-card-top'},node('span',{class:'workspace-avatar'},item.example?'◈':item.name.slice(0,1).toUpperCase()),node('span',{class:'workspace-kind'},item.example?'EXAMPLE':item.id===data.selected?'CURRENT WORKSPACE':'LOCAL WORKSPACE')),
   node('h3',{},item.name),node('div',{class:'workspace-metrics'},...[[item.datasets,'datasets'],[item.queries,'saved queries'],[humanBytes(item.source_bytes),'source files']].map(([n,label])=>node('div',{},node('strong',{},n),node('small',{},label)))),
   node('p',{class:'workspace-dates'},'Last worked on '+new Date(item.last_activity*1000).toLocaleString(),node('br'), 'Created '+new Date(item.created*1000).toLocaleDateString()),
   node('div',{class:'workspace-card-actions'},node('button',{class:'button primary',onclick:()=>{if(item.id===data.selected){workArea();$('sql-editor').focus();}else changeWorkspace({id:item.id}).catch(report);}},'Open workspace'),
    node('button',{class:'text-button',onclick:()=>editName('Rename workspace',item.name,name=>manageWorkspace('rename',item.id,name))},'Rename'),
    node('button',{class:'text-button delete-action',onclick:async()=>{if(confirm('Delete workspace “'+item.name+'” from the workspace list? Its saved work will be archived locally and can be restored below. External source files are not deleted.'))await manageWorkspace('archive',item.id).catch(report);}},'Delete')));
  return card;
 }));
 $('archived-workspaces').replaceChildren(...data.archived.map(item=>node('div',{class:'archive-row'},node('span',{},item.name),node('button',{class:'text-button',onclick:()=>manageWorkspace('restore',item.id).catch(report)},'Restore workspace'))));
 show('archived-section',data.archived.length>0);
}
async function showWorkspaceHome(){
 if(state.busy)throw new Error('Finish or cancel the current operation first.');
 flushDrafts();$('workspace-menu').classList.add('hidden');await loadWorkspaceOverview();
 show('work-area',false);show('empty-state',false);show('workspace-home');show('focus-tabs',false);$('workspace-nav').classList.add('active');renderWorkspaceHome();
  document.body.classList.add('home-view');
}
async function removeDataset(name){
 if(state.busy)throw new Error('Finish or cancel the current operation first.');
 const source=state.data.catalog.find(item=>item.name===name);
 if(!confirm('Remove dataset “'+name+'”? '+(source?.path?'Its source file stays on disk.':'This deletes the stored database table and its rows.')+' Saved SQL is kept, but queries referencing this dataset may need updating.'))return;
 await runJob('remove_dataset',{name});
 state.result=null;state.profile=null;state.tabs.forEach(tab=>tab.result=null);show('table-view',false);show('result-message');$('result-message').textContent='Dataset removed. Open another dataset or run SQL.';$('result-count').textContent='—';$('query-stat').textContent='No result';updatePaging();datasetHeading(state.selected);
 toast('Dataset removed. External files were kept.');
}
async function restoreExample(){
 const button=$('restore-example');button.disabled=true;
 try{const result=await manageWorkspace('example');$('settings-dialog').close();await changeWorkspace({id:result.id});}
 catch(error){report(error);}finally{button.disabled=false;}
}
function setupOrganization(){
 bind('workspace-nav','click',showWorkspaceHome);
 bind('workspace-menu-toggle','click',async()=>{await loadWorkspaceOverview();const open=$('workspace-menu').classList.toggle('hidden')===false;$('workspace-menu-toggle').setAttribute('aria-expanded',String(open));});
 bind('workspace-home-menu','click',showWorkspaceHome);
 bind('home-new-workspace','click',()=>{$('new-workspace').click();});
 bind('restore-example','click',restoreExample);
 bind('manage-name-save','click',async()=>{try{await manageAction($('manage-name').value);$('manage-name-dialog').close();}catch(error){inlineError('manage-error',error);}});
 document.addEventListener('click',event=>{if(!event.target.closest('.workspace-nav-group')){$('workspace-menu').classList.add('hidden');$('workspace-menu-toggle').setAttribute('aria-expanded','false');}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')$('workspace-menu').classList.add('hidden');});
 loadWorkspaceOverview().catch(report);
}
