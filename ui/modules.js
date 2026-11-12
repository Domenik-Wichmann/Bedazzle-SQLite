'use strict';
const moduleState={modules:[],runs:[],definition:null,run:null,sql:'',busy:false,columns:[]};
async function refreshModules(){
  const data=await api('/api/modules');moduleState.modules=data.modules;moduleState.runs=data.runs;moduleState.profiles=data.profiles||{};
  const errors=JSON.stringify(data.errors||[]);
  if(data.errors?.length&&moduleState.lastErrors!==errors)toast('Some modules could not load: '+data.errors.map(item=>item.module+' — '+item.error).join('; '),true);
  moduleState.lastErrors=errors;
  $('module-menu').replaceChildren(node('option',{value:''},'Send to module…'),node('option',{value:'chart-studio'},'Chart studio'),node('option',{value:'chart-dashboards'},'Saved chart dashboards…'),node('option',{value:'data-editor'},'Data editor'),node('option',{value:'editor-drafts'},'Editor drafts…'),...data.modules.map(item=>node('option',{value:item.id},item.name)),node('option',{value:'history'},'Previous module runs…'));
  return data;
}
function moduleField(field){
  const id='module-option-'+field.key;let input;
  if(['column','columns','select'].includes(field.type)){
    input=node('select',{id,multiple:field.type==='columns'?'':null,size:field.type==='columns'?4:null});
    const options=field.type==='select'?field.choices:[...(field.type==='column'?[['','Not mapped']]:[]),...moduleState.columns.map(c=>[c.name,c.name])];
    input.append(...options.map(([value,label])=>node('option',{value},label)));
    if(field.default!==undefined)input.value=field.default;
    if(field.type==='columns'){
      const guessed=moduleState.columns.find(c=>/^(image|photo|thumbnail|picture)$|(?:image|photo|thumbnail|picture).*(url|src|link)|(url|src|link).*(image|photo|thumbnail|picture)/i.test(c.name))||moduleState.columns.find(c=>/url/i.test(c.name));
      if(guessed)input.value=guessed.name;
    }
  }else if(field.type==='boolean'){
    input=node('input',{id,type:'checkbox'});input.checked=!!field.default;
  }else if(field.type==='text')input=node('input',{id,type:'text',maxlength:field.max_length||2000,value:field.default||''});
  else input=node('input',{id,type:'number',min:field.min,max:field.max,value:field.default,step:1});
  if(field.key.endsWith('_aspect_percent')){input.step='0.01';input.max=field.max/100;input.value=(field.default||0)/100;}
  input.title=field.help||field.label;
  return node('label',{class:field.type==='boolean'?'module-checkbox':''},field.label,input,field.help?node('small',{},field.help):null);
}
async function openModule(id){
  if(state.busy)throw new Error('Wait for the current operation or cancel it first.');
  if(!state.result?.selectable||state.result.statement_count!==1)throw new Error('Run one SELECT query first. A module processes its full results, not just the visible page.');
  await refreshModules();moduleState.definition=moduleState.modules.find(item=>item.id===id);
  if(!moduleState.definition)throw new Error('That module is no longer installed.');
  moduleState.sql=state.result.sql;moduleState.run=null;moduleState.busy=false;
  $('module-title').textContent=moduleState.definition.name;
  $('module-start').textContent=id==='image_checker'?'Run check':'Run module';
  $('module-description').textContent=moduleState.definition.description;
  $('module-input-note').textContent=`Full SELECT result${state.result.total_rows!==undefined?' · '+Number(state.result.total_rows).toLocaleString()+' rows':''} · A frozen working copy protects merge identities. Original files stay intact.`;
  $('module-source-sql').textContent=moduleState.sql;
  $('module-fields').replaceChildren();
  $('module-status').textContent='Reading the result columns…';show('module-options');show('module-outcome',false);show('module-start');show('module-resume',false);show('module-cancel',false);
  $('module-start').disabled=true;$('module-progress').value=0;
  inlineError('module-error',null);$('module-dialog').showModal();
  try{
    const output=await runJob('module_schema',{sql:moduleState.sql});moduleState.columns=output.columns;
    const basic=node('div',{class:'module-fields'}),advanced=node('div',{class:'module-fields'}),requirements=node('div',{class:'module-fields'}),expected=node('div',{class:'module-fields'}),similarity=node('div',{class:'module-fields'});
    for(const field of moduleState.definition.fields){
      const group=id!=='image_checker'?basic:field.key.startsWith('similarity_')?similarity:['workers','timeout','max_mb','max_pixels','max_frames','retries','run_timeout','allow_private'].includes(field.key)?advanced:
        field.key.startsWith('expected_')||field.key==='dimension_rule'?expected:
        ['url_columns','record_id'].includes(field.key)?basic:requirements;
      group.append(moduleField(field));
    }
    if(id==='image_checker')$('module-fields').replaceChildren(basic,moduleProfiles(),
      node('details',{class:'module-limits'},node('summary',{},'Image requirements (optional)'),requirements),
      node('details',{class:'module-limits'},node('summary',{},'Compare against columns in your data (optional)'),expected),
      node('details',{class:'module-limits'},node('summary',{},'Visual similarity'),similarity),
      node('details',{class:'module-limits'},node('summary',{},'Limits and networking'),advanced));
    else $('module-fields').replaceChildren(basic);
    $('module-status').textContent='Choose URL columns and optional expectations, then run. URL checks contact the image servers directly from this laptop.';
  }catch(error){inlineError('module-error',error);show('module-start',false);}
  finally{$('module-start').disabled=false;}
}
function moduleOptions(){
  const result={};
  for(const field of moduleState.definition.fields){const input=$('module-option-'+field.key);
    result[field.key]=field.type==='columns'?[...input.selectedOptions].map(o=>o.value):field.type==='number'?(field.key.endsWith('_aspect_percent')?Math.round(Number(input.value)*100):Number(input.value)):field.type==='boolean'?input.checked:input.value;
  }return result;
}
async function runModule(resume=false,recheck=null){
  if(moduleState.busy)return;
  moduleState.busy=true;$('module-outcome').inert=true;show('module-cancel');if($('module-review-tools'))$('module-review-tools').inert=true;if($('module-evidence'))$('module-evidence').inert=true;show('module-start',false);show('module-resume',false);inlineError('module-error',null);
  $('module-progress').value=0;
  $('module-status').textContent=resume?'Resuming saved work…':'Saving the complete result snapshot…';
  $('module-fields').inert=true;
  try{
    const payload=resume?{run_id:moduleState.run.id,...(recheck||{})}:{module:moduleState.definition.id,sql:moduleState.sql,options:moduleOptions()};
    const result=await runJob('module_run',payload);moduleState.run=result.run;
    await showModuleOutcome(result.run);window.bedazzle?.celebrate('Checked');
  }catch(error){
    inlineError('module-error',error);await refreshModules().catch(()=>{});
    if(moduleState.run?.id){moduleState.run=moduleState.runs.find(item=>item.id===moduleState.run.id)||moduleState.run;show('module-resume');}
    else show('module-start');
  }finally{moduleState.busy=false;$('module-outcome').inert=false;show('module-cancel',false);$('module-fields').inert=false;if($('module-review-tools'))$('module-review-tools').inert=false;if($('module-evidence'))$('module-evidence').inert=false;}
}
async function showModuleOutcome(run){
  $('module-outcome').classList.remove('module-similarity-mode');$('module-report-preview').classList.remove('module-pair-view');
  moduleState.run=run;show('module-options',false);show('module-outcome');show('module-start',false);show('module-resume',false);
  $('module-progress').value=100;
  const summary=run.summary||{};
  const image=run.module==='image_checker';
  $('module-status').textContent=image?`Completed · ${Number(summary.unique_urls||0).toLocaleString()} unique URLs · ${Number(summary.checked_cells||0).toLocaleString()} input URL cells`:'Completed · '+run.dataset;
  $('module-summary').replaceChildren(...(image?['pass','warning','fail','limited','blocked'].map(key=>[key,summary[key]||0]):Object.entries(summary).slice(0,12)).map(([key,value])=>node('div',{class:'module-stat '+key},node('strong',{},typeof value==='number'?value.toLocaleString():String(value)),node('span',{},key.replaceAll('_',' ')))));
  $('module-merge').disabled=run.input_released||!(run.merge||run.can_merge);
  $('module-merged-name').value='';
  $('module-review-tools')?.remove();$('module-evidence')?.remove();
  $('module-report-preview').textContent='Loading a small preview…';
  if(run.module==='image_checker'&&['2.0.0','2.1.0'].includes(run.version)){
    await imageReview(run);
  }else if(run.module==='image_checker'){
    const output=await runJob('query',{sql:'SELECT row_id,url_column,image_url,verdict,http_status,format,width,height,image_bytes,error FROM '+sqlName(run.dataset)+' ORDER BY row_id,url_column LIMIT 20;',size:20,exact_total:false,record_history:false});
    $('module-report-preview').replaceChildren(tableFor(output));
  }else $('module-report-preview').textContent='Open the report dataset to explore every field.';
  await refreshModules();
}
async function moduleHistory(){
  await refreshModules();$('module-history-list').replaceChildren();
  if(!moduleState.runs.length)$('module-history-list').append(node('p',{},'No module runs in this workspace yet.'));
  for(const run of moduleState.runs){
    const row=node('div',{class:'module-run'},node('div',{},node('strong',{},run.name),node('small',{},new Date(run.created*1000).toLocaleString()+' · '+run.status+(run.completed!==undefined?' · '+run.completed+'/'+run.total+' URLs':''))));
    row.append(node('button',{class:'button secondary',onclick:async()=>{try{
      moduleState.run=run;$('module-history-dialog').close();$('module-title').textContent=run.name;
      $('module-description').textContent='Saved module run · the original result snapshot is retained.';
      inlineError('module-error',null);show('module-options',false);show('module-cancel',false);show('module-start',false);$('module-dialog').showModal();
      if(run.status==='completed')await showModuleOutcome(run);
      else{show('module-outcome',false);show('module-resume');$('module-status').textContent='Continue unfinished URLs using the saved input and the original options. Checks already saved are reused.';}
    }catch(error){report(error);}}},run.status==='completed'?'Open report':'Resume…'));
    row.append(node('button',{class:'button secondary',onclick:async()=>{
      if(!confirm('Delete this saved run and its files? First remove its report and any merged datasets from the sidebar. This cannot be undone.'))return;
      try{await runJob('module_manage',{operation:'delete_run',run_id:run.id});row.remove();toast('Saved run deleted.');}catch(error){report(error);}
    }},'Delete saved files'));
    $('module-history-list').append(row);
  }$('module-history-dialog').showModal();
}
function setupModules(){
  const controls=node('div',{class:'module-actions'},node('select',{id:'module-menu','aria-label':'Send results to a module',title:'Process the complete SELECT with an installed module'},node('option',{value:''},'Send to module…')));
  $('export-results').after(controls);
  refreshModules().catch(report);
  bind('module-menu','change',async()=>{const id=$('module-menu').value;$('module-menu').value='';if(id==='chart-studio')await csOpen();else if(id==='chart-dashboards')await csLibrary();else if(id==='data-editor')await deOpen();else if(id==='editor-drafts')await deDrafts();else if(id==='history')await moduleHistory();else if(id)await openModule(id);});
  bind('module-start','click',()=>runModule());bind('module-resume','click',()=>runModule(true));bind('module-cancel','click',cancelJob);
  bind('module-view-report','click',async()=>{$('module-dialog').close();await selectDataset(moduleState.run.dataset);});
  bind('module-export-report','click',async()=>{const result=await runJob('query',{sql:'SELECT * FROM '+sqlName(moduleState.run.dataset)+';',size:20,retain_result:true,record_history:false});openExport(result);});
  bind('module-merge','click',async()=>{
    try{const result=await runJob('module_merge',{run_id:moduleState.run.id,name:$('module-merged-name').value.trim()||undefined});$('module-dialog').close();await selectDataset(result.name);toast(result.message);}
    catch(error){inlineError('module-error',error);}
  });
  window.addEventListener('bedazzle-job',event=>{if(!moduleState.busy)return;const activity=event.detail.activity;
    if(activity.run_id)moduleState.run={...(moduleState.run||{}),id:activity.run_id};
    $('module-status').textContent=activity.label+' · '+(activity.detail||'');$('module-progress').value=activity.percent||0;
  });
  $('module-dialog').addEventListener('cancel',event=>{if(moduleState.busy){event.preventDefault();toast('Use Cancel check to stop, or wait for this run. Saved checks can be resumed.');}});
  $('module-dialog-close').addEventListener('click',event=>{if(moduleState.busy){event.preventDefault();toast('Use Cancel check first.');}});
}

function moduleProfiles(){
  const picker=node('select',{'aria-label':'Requirement profile'},node('option',{value:''},'Choose a saved profile…'),
    ...Object.keys(moduleState.profiles||{}).sort().map(name=>node('option',{value:name},name)));
  const name=node('input',{maxlength:80,placeholder:'Profile name','aria-label':'Profile name'});
  const message=node('small',{'role':'status'});
  picker.onchange=()=>{
    const values=moduleState.profiles[picker.value];if(!values)return;
    for(const [key,value] of Object.entries(values)){const input=$('module-option-'+key);if(input)input.value=key.endsWith('_aspect_percent')?value/100:value;}
    name.value=picker.value;$('module-option-min_width')?.closest('details')?.setAttribute('open','');message.textContent='Requirements applied. Column mappings and network permissions stay specific to this run.';
  };
  const save=node('button',{type:'button',class:'button secondary',onclick:async()=>{
    try{const result=await runJob('module_manage',{operation:'save_profile',name:name.value,options:moduleOptions()});moduleState.profiles=result.profiles;
      picker.replaceChildren(node('option',{value:''},'Choose a saved profile…'),...Object.keys(result.profiles).sort().map(n=>node('option',{value:n},n)));picker.value=name.value.trim();message.textContent='Profile saved in this workspace.';
    }catch(error){inlineError('module-error',error);}
  }},'Save requirements');
  const remove=node('button',{type:'button',class:'button secondary',onclick:async()=>{
    try{if(!picker.value)return;const result=await runJob('module_manage',{operation:'delete_profile',name:picker.value});moduleState.profiles=result.profiles;picker.selectedOptions[0].remove();name.value='';message.textContent='Profile removed.';}catch(error){inlineError('module-error',error);}
  }},'Delete profile');
  return node('fieldset',{class:'module-profile'},node('legend',{},'Reusable requirements'),node('div',{class:'module-outcome-actions'},picker,name,save,remove),message);
}

async function imageReview(run){
  moduleState.review={filter:'all',offset:0,selected:new Map(),run:run.id};
  const filter=node('select',{id:'module-review-filter','aria-label':'Review filter'},...[
    ['all','All findings'],...['pass','warning','fail','limited','blocked'].map(v=>[v,v[0].toUpperCase()+v.slice(1)]),['attention','Needs attention'],['missing','Missing images (404 / 410)'],['access','Access denied / rate limited'],
    ['requirements','Requirement failures'],['incomplete','Incomplete validation'],['duplicates','Exact content at different URLs'],['shared','Shared content to review'],['transparent','Fully transparent'],['similar','Visually similar candidates'],['changed','Changes since previous run']
  ].map(([value,label])=>node('option',{value},label)));
  const tools=node('section',{id:'module-review-tools'},node('h3',{},'Review and fix'),
    node('p',{class:'form-hint'},'Filters cover the full report. Each page shows up to 20 cells; select cells for targeted rechecks. Shared content is a review signal, not proof of a placeholder.'),
    node('div',{class:'module-outcome-actions'},filter,
      node('button',{class:'button secondary module-cell-action',onclick:()=>imageImpact()},'Rank affected URLs'),
      node('button',{class:'button secondary module-cell-action',onclick:()=>imageRemediation()},'Export remediation…'),
      node('label',{class:'module-checkbox'},node('input',{id:'module-export-sensitive',type:'checkbox'}),'Include full URLs in exports')));
  $('module-report-preview').before(tools);
  filter.onchange=()=>{moduleState.review.filter=filter.value;moduleState.review.offset=0;moduleState.review.pairHash=null;(filter.value==='similar'&&run.version==='2.1.0'?imageSimilarityPage():imageReviewPage()).catch(error=>inlineError('module-error',error));};
  const coverage=run.summary?.coverage||{};
  const evidence=node('details',{id:'module-evidence'},node('summary',{},'Coverage, evidence and retained data'),
    node('p',{class:'form-hint'},`${coverage.full||0} fully decoded · ${coverage.partial||0} partially decoded · ${coverage.unverified||0} unverified cells. Counts describe validation coverage, independently of requirements. Each URL retains its observation timestamp.`),
    node('p',{class:'form-hint'},'Access denied and rate limits do not prove an image is missing. Thumbnails are fetched again through the checker only when requested, without browser cookies. Full reports can contain signed URL tokens; remediation exports redact them by default.'),
    node('pre',{class:'module-evidence-text'},JSON.stringify({version:run.version,created:new Date(run.created*1000).toISOString(),options:run.options},null,2)),
    node('p',{class:'form-hint'},'Retention policy: reports and snapshots stay local until you release input. Release input removes the original rows and URL queue; the report remains. Merge and recheck then become unavailable. Existing merged datasets must be removed first.'),
    node('button',{class:'button secondary',disabled:run.input_released?'':null,onclick:async()=>{
      if(!confirm('Release this run’s input snapshot and saved URL queue? The report remains, but merge and recheck will no longer be available.'))return;
      try{const result=await runJob('module_manage',{operation:'release_input',run_id:run.id});run.input_released=true;run.can_merge=false;run.merge=null;await showModuleOutcome(run);toast(result.message);}catch(error){inlineError('module-error',error);}
    }},run.input_released?'Input released':'Release retained input'));
  $('module-outcome').append(evidence);
  const retry=node('select',{id:'module-recheck-mode','aria-label':'Recheck scope'},...[
    ['failures','Retry failed / blocked / limited URLs'],['selected','Recheck selected cells'],['stale','Recheck observations older than age'],['all','Recheck all URLs']
  ].map(([value,label])=>node('option',{value},label)));
  const age=node('input',{type:'number',min:1,max:3650,value:7,'aria-label':'Observation age in days',title:'Age in days',class:'module-age'});
  const ageLabel=node('label',{class:'module-age-label'},'Age in days',age);ageLabel.hidden=true;retry.onchange=()=>{ageLabel.hidden=retry.value!=='stale';};
  const retryButton=node('button',{class:'button primary',disabled:run.input_released?'':null,onclick:async()=>{
    if(moduleState.busy)return;
    if(retry.value==='selected'&&!moduleState.review.selected.size){inlineError('module-error',new Error('Select at least one image cell first.'));return;}
    await runModule(true,{recheck:retry.value,selected:[...moduleState.review.selected.values()],days:Number(age.value)});
  }},'Start new recheck');
  tools.append(node('div',{class:'module-outcome-actions module-cell-actions'},retry,ageLabel,retryButton),node('p',{class:'form-hint module-cell-actions'},'Rechecks create a new run and preserve this report. Selecting one cell rechecks its URL for every linked record.'));
  for(const button of $('module-summary').children){button.setAttribute('role','button');button.tabIndex=0;const activate=()=>{filter.value=button.classList[1];filter.dispatchEvent(new Event('change'));};button.onclick=activate;button.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};}
  if(run.version==='2.1.0'){
    tools.append(node('button',{class:'button secondary module-open-pairs',onclick:()=>{filter.value='similar';filter.dispatchEvent(new Event('change'));}},'Review similar pairs'));
    const summary=run.summary?.similarity;
    if(summary)tools.append(node('p',{id:'module-similarity-summary',class:'form-hint'},imageSimilaritySummary(summary)));
  }
  await imageReviewPage();
}

function imageWhere(){
  return {...Object.fromEntries(['pass','warning','fail','limited','blocked'].map(v=>[v,'verdict='+sqlValue(v)])),all:'true',attention:"verdict<>'pass'",missing:"retrieval_status='missing'",access:"retrieval_status IN ('access_denied','rate_limited','server_error')",requirements:"requirements_status='fail'",incomplete:"coverage<>'full'",duplicates:'same_content_urls>1',shared:'shared_image_review',transparent:'fully_transparent',similar:moduleState.run.version==='2.1.0'?'similarity_matches>0':'perceptual_group_urls>1 AND NOT coalesce(uniform_image,false)',changed:"change_status NOT IN ('reused','unchanged','first_check')"}[moduleState.review.filter]||'true';
}

async function imageReviewPage(){
  $('module-review-tools')?.classList.remove('module-pair-mode');$('module-report-preview').classList.remove('module-pair-view');$('module-outcome').classList.remove('module-similarity-mode');
  const review=moduleState.review,run=moduleState.run;
  const output=await runJob('query',{sql:`SELECT row_id,url_column,record_id,safe_url,verdict,retrieval_status,coverage,issue,suggested_action,display_width,display_height,image_bytes,content_affected_records,url_affected_records,perceptual_group_urls,change_status,dhash,sha256${run.version==='2.1.0'?',similarity_matches,similarity_best_score,similarity_search_status':''} FROM ${sqlName(run.dataset)} WHERE ${imageWhere()} ORDER BY ${review.filter==='similar'?'dhash,':['duplicates','shared'].includes(review.filter)?'sha256,':''}row_id,url_column LIMIT 21 OFFSET ${review.offset}`,size:21,exact_total:false,record_history:false});
  if(moduleState.review!==review)return;
  const rows=output.rows.slice(0,20),body=node('tbody');
  for(const values of rows){
    const row=Object.fromEntries(output.columns.map((c,i)=>[c.name,values[i]])),key=JSON.stringify([row.row_id,row.url_column]);
    const checked=node('input',{type:'checkbox','aria-label':`Select row ${row.row_id}, ${row.url_column}`});checked.checked=review.selected.has(key);
    checked.onchange=()=>{if(checked.checked){if(review.selected.size>=100){checked.checked=false;toast('Select up to 100 cells per recheck.');return;}review.selected.set(key,{row_id:row.row_id,url_column:row.url_column});}else review.selected.delete(key);};
    const preview=node('div',{class:'module-thumbnail'});
    const button=node('button',{class:'button secondary',onclick:async()=>{
      button.disabled=true;button.textContent='Fetching…';
      try{const result=await runJob('module_manage',{operation:'preview',run_id:run.id,row_id:row.row_id,url_column:row.url_column});
        if(result.thumbnail)preview.replaceChildren(node('img',{src:result.thumbnail,alt:`Image for row ${row.row_id}`,width:128,loading:'lazy'}),node('small',{},'Fetched now'));
        else preview.textContent=result.error||'Preview unavailable within checking limits.';
      }catch(error){preview.textContent=error.message;}finally{button.disabled=false;button.textContent='Refresh thumbnail';}
    }},'Load thumbnail');
    body.append(node('tr',{},node('td',{},checked),node('td',{},node('strong',{},String(row.record_id??row.row_id)),node('small',{},row.url_column),node('span',{class:'module-safe-url',title:row.safe_url},row.safe_url)),
      node('td',{},node('strong',{},row.verdict),node('small',{},row.retrieval_status.replaceAll('_',' ')+' · '+row.coverage),node('p',{},row.issue||'No issues detected'),node('small',{},row.suggested_action)),
      node('td',{},`${row.display_width??'?'} × ${row.display_height??'?'} px`,node('small',{},`${row.image_bytes??'?'} bytes · ${row.url_affected_records} records use this URL`),node('small',{},row.change_status.replaceAll('_',' ')),run.version==='2.1.0'?node('small',{},`Visual matching: ${row.similarity_matches} candidates; ${row.similarity_search_status.replaceAll('_',' ')}`):null,row.perceptual_group_urls>1?node('small',{},`${row.perceptual_group_urls} distinct contents share this visual hash; review similarity`):null),node('td',{},preview,button,run.version==='2.1.0'&&row.similarity_matches>0?node('button',{class:'button secondary',onclick:()=>{review.pairHash=row.sha256;review.pairOffset=0;review.pairDecision='all';review.filter='similar';$('module-review-filter').value='similar';imageSimilarityPage().catch(report);}},`Compare ${row.similarity_matches} matches`):null)));
  }
  const table=node('table',{class:'data-table module-review-table'},node('thead',{},node('tr',{},...['Select','Record / URL','Finding','Measurements','Preview'].map(label=>node('th',{},label)))),body);
  const previous=node('button',{class:'button secondary',disabled:review.offset===0?'':null,onclick:()=>{review.offset=Math.max(0,review.offset-20);imageReviewPage().catch(report);}},'Previous');
  const next=node('button',{class:'button secondary',disabled:output.rows.length<=20?'':null,onclick:()=>{review.offset+=20;imageReviewPage().catch(report);}},'Next');
  $('module-report-preview').replaceChildren(rows.length?table:node('p',{},'No findings match this filter.'),node('div',{class:'module-outcome-actions'},previous,node('span',{},rows.length?`Cells ${review.offset+1}–${review.offset+rows.length}`:'0 cells'),next));
}

async function imageImpact(){
  try{
    const result=await runJob('query',{sql:`SELECT safe_url,retrieval_status,count(DISTINCT row_id) AS affected_records,count(*) AS affected_cells FROM ${sqlName(moduleState.run.dataset)} WHERE ${imageWhere()} GROUP BY image_url,safe_url,retrieval_status ORDER BY affected_records DESC,affected_cells DESC LIMIT 20`,size:20,exact_total:false,record_history:false});
    $('module-report-preview').replaceChildren(node('button',{class:'button secondary',onclick:()=>imageReviewPage().catch(report)},'Back to image review'),node('p',{class:'form-hint'},'Top 20 URLs by affected source records within the selected filter. Choose a filter to return to image review.'),tableFor(result));
  }catch(error){inlineError('module-error',error);}
}

async function imageRemediation(){
  try{
    const sensitive=$('module-export-sensitive').checked;
    const columns=`row_id,record_id,url_column,${sensitive?'image_url':'safe_url AS image_url'},verdict,retrieval_status,coverage,requirements_status,issue,suggested_action,display_width,display_height,image_bytes,detected_mime,expected_width,expected_height,expected_bytes,expected_mime,content_affected_records,url_affected_records,shared_image_review,perceptual_group_urls,dhash,sha256,checked_at,decoder_version,decoder_capabilities,change_status${moduleState.run.version==='2.1.0'?',similarity_matches,similarity_best_score,similarity_search_status,phash,fingerprint_version':''}`;
    const result=await runJob('query',{sql:`SELECT ${columns} FROM ${sqlName(moduleState.run.dataset)} WHERE ${imageWhere()} ORDER BY url_affected_cells DESC,row_id,url_column`,size:20,retain_result:true,record_history:false});openExport(result);
  }catch(error){inlineError('module-error',error);}
}

function imageSimilaritySummary(summary){
  const interrupted=summary.report_synchronized===false||moduleState.run?.similarity_rebuilding;
  const prefix=interrupted?'The last rebuild did not finish updating report counts. Rebuild matches to synchronize them. ':'';
  if(!summary.enabled)return 'Visual matching is off. Open Review similar pairs to build matches from saved fingerprints.';
  return prefix+`${summary.pairs.toLocaleString()} visual candidate pairs · ${summary.eligible_contents.toLocaleString()} eligible distinct contents · ${summary.sensitivity} search ${summary.status}.`+
    (summary.status==='limited'?` Results are incomplete: ${summary.limited_contents} content searches were truncated and ${summary.not_searched} were not searched. No match does not mean unique.`:' Candidates require human review; agreement scores are not probabilities.')+
    ' Blank, transparent, low-detail and incompletely decoded images are excluded.';
}

async function imageSimilarityPage(){
  const run=moduleState.run,review=moduleState.review;
  review.pairOffset=review.pairOffset||0;review.pairDecision=review.pairDecision||'unreviewed';
  const output=await runJob('module_manage',{operation:'similarity_pairs',run_id:run.id,offset:review.pairOffset,decision:review.pairDecision,sha256:review.pairHash});
  if(moduleState.review!==review)return;
  const summary=output.summary;
  $('module-review-tools').classList.add('module-pair-mode');$('module-report-preview').classList.add('module-pair-view');$('module-outcome').classList.add('module-similarity-mode');
  const panel=node('section',{id:'module-similarity-pairs',class:'module-similarity-pairs'},node('h3',{},'Compare visually similar images'),
    node('p',{class:'form-hint'},imageSimilaritySummary(summary)),
    node('p',{class:'form-hint'},'Each pair contains different file bytes. Scores compare visual fingerprints, not product identity. Only the first frame is compared for animations. Thumbnails are fetched again when requested. Review decisions follow the same pair of contents across rechecks.'));
  panel.prepend(node('button',{class:'button secondary',onclick:()=>{$('module-review-filter').value='all';$('module-review-filter').dispatchEvent(new Event('change'));}},'Back to image results'));
  const sensitivity=node('select',{'aria-label':'Similarity sensitivity'},...['strict','balanced','broad'].map(v=>node('option',{value:v},v[0].toUpperCase()+v.slice(1))));sensitivity.value=summary.sensitivity;
  const color=node('input',{type:'checkbox','aria-label':'Include color variants'});color.checked=summary.include_color_variants;
  const seconds=node('input',{type:'number',min:5,max:300,value:summary.seconds_limit,'aria-label':'Similarity time limit',class:'module-age'});
  const rebuild=node('button',{class:'button secondary',onclick:async()=>{
    rebuild.disabled=true;inlineError('module-error',null);
    try{
      run.similarity_rebuilding=true;
      const result=await runJob('module_manage',{operation:'similarity_rebuild',run_id:run.id,options:{similarity_enabled:true,similarity_sensitivity:sensitivity.value,similarity_color_variants:color.checked,similarity_seconds:Number(seconds.value)}});
      run.similarity_rebuilding=false;run.summary.similarity=result.summary;review.pairOffset=0;
      if($('module-similarity-summary'))$('module-similarity-summary').textContent=imageSimilaritySummary(result.summary);
      await imageSimilarityPage();
    }catch(error){inlineError('module-error',error);}finally{rebuild.disabled=false;}
  }},'Rebuild matches');
  if(review.pairHash)panel.append(node('button',{class:'button secondary',onclick:()=>{review.pairHash=null;review.pairOffset=0;imageSimilarityPage().catch(report);}},'Show matches for all images'));
  panel.append(node('details',{},node('summary',{},'Adjust matching — uses saved fingerprints, no downloads'),node('div',{class:'module-outcome-actions'},
    node('label',{},'Sensitivity',sensitivity),node('label',{class:'module-checkbox'},color,'Include color variants'),node('label',{},'Time limit (seconds)',seconds),rebuild)));
  const status=node('select',{'aria-label':'Pair review status'},...[
    ['unreviewed','Unreviewed pairs'],['all','All pairs'],['similar','Likely duplicate'],['different','Different images']
  ].map(([value,label])=>node('option',{value},label)));status.value=review.pairDecision;
  status.onchange=()=>{review.pairDecision=status.value;review.pairOffset=0;imageSimilarityPage().catch(report);};
  const exportButton=node('button',{class:'button secondary',onclick:async()=>{
    try{
      const saved=await runJob('module_manage',{operation:'similarity_export',run_id:run.id,decision:review.pairDecision,sha256:review.pairHash,include_full_urls:$('module-export-sensitive').checked});
      const result=await runJob('query',{sql:saved.sql,size:20,retain_result:true,record_history:false});openExport(result);
    }catch(error){inlineError('module-error',error);}
  }},'Export pairs…');
  panel.append(node('div',{class:'module-outcome-actions'},status,exportButton),node('p',{role:'status'},`${output.total.toLocaleString()} matching pairs · showing ${output.pairs.length?review.pairOffset+1:0}–${review.pairOffset+output.pairs.length}`));
  for(const pair of output.pairs){
    const card=node('article',{class:'module-pair','data-pair-id':pair.id},node('h4',{},`${pair.score}% fingerprint agreement`),
      node('p',{class:'form-hint'},`Structure: ${pair.phash_distance}/64 different bits · gradients: ${pair.dhash_distance}/64 · aspect difference: ${Math.round(pair.aspect_difference*100)}% · average color difference: ${pair.color_difference}/255`),
      pair.first_frame_only?node('p',{class:'form-hint'},'Includes an animation: comparison uses its first frame.'):null);
    const sides=node('div',{class:'module-pair-sides'}),previews=[];
    for(const side of ['left','right']){
      const representative=pair[side],preview=node('div',{class:'module-pair-preview'});previews.push([side,representative,preview]);
      sides.append(node('div',{},node('strong',{},representative?`Record ${representative.record_id??representative.row_id} · ${representative.url_column}`:'Image content'),
        node('p',{class:'module-pair-url'},pair[side+'_url']),node('small',{},`${pair[side+'_width']} × ${pair[side+'_height']} px${representative?' · '+representative.affected_records+' records use this URL':''}`),representative?node('p',{class:'form-hint'},`${representative.mime||'Unknown format'} - ${humanBytes(representative.image_bytes)} - ${representative.verdict} - ${representative.coverage} validation`,representative.issue?node('span',{},' - '+representative.issue):null):null,preview));
    }
    const load=node('button',{class:'button secondary',onclick:async()=>{
      load.disabled=true;load.textContent='Loading previews…';
      try{
        for(const [side,representative,preview] of previews){
          if(!representative){preview.textContent='No linked report cell available.';continue;}
          const result=await runJob('module_manage',{operation:'preview',run_id:run.id,row_id:representative.row_id,url_column:representative.url_column});
          preview.replaceChildren(result.thumbnail?node('img',{src:result.thumbnail,alt:`${side} image for similarity pair ${pair.id}`,width:256,height:256}):node('p',{},result.error||'Preview unavailable.'));
        }
      }catch(error){inlineError('module-error',error);}finally{load.disabled=false;load.textContent='Refresh both previews';}
    }},'Load both previews');
    const decision=node('select',{'aria-label':`Decision for pair ${pair.id}`},...[
      ['unreviewed','Unreviewed'],['similar','Likely duplicate'],['different','Different images']
    ].map(([value,label])=>node('option',{value},label)));decision.value=pair.decision;
    const note=node('input',{type:'text',maxlength:500,value:pair.note,placeholder:'Optional review note','aria-label':`Note for pair ${pair.id}`});
    const save=node('button',{class:'button primary',onclick:async()=>{
      save.disabled=true;
      try{await runJob('module_manage',{operation:'similarity_decide',run_id:run.id,pair_id:pair.id,decision:decision.value,note:note.value});toast('Review saved. Source records stay intact.');await imageSimilarityPage();}
      catch(error){inlineError('module-error',error);}finally{save.disabled=false;}
    }},'Save review');
    const recheck=node('button',{class:'button secondary',disabled:run.input_released?'':null,onclick:async()=>{
      const selected=previews.filter(([,item])=>item).map(([,item])=>({row_id:item.row_id,url_column:item.url_column}));
      await runModule(true,{recheck:'selected',selected});
    }},'Recheck these images');
    card.append(sides,node('div',{class:'module-outcome-actions'},load,decision,note,save,recheck));panel.append(card);
  }
  if(!output.pairs.length)panel.append(node('p',{},output.total?'No pairs on this page. Use Previous.':'No pairs match this review status. You can select All pairs or adjust matching. A missing match does not prove an image is unique.'));
  panel.append(node('div',{class:'module-outcome-actions'},
    node('button',{class:'button secondary',disabled:review.pairOffset===0?'':null,onclick:()=>{review.pairOffset=Math.max(0,review.pairOffset-20);imageSimilarityPage().catch(report);}},'Previous pairs'),
    node('button',{class:'button secondary',disabled:review.pairOffset+20>=output.total?'':null,onclick:()=>{review.pairOffset+=20;imageSimilarityPage().catch(report);}},'Next pairs')));
  $('module-report-preview').replaceChildren(panel);$('module-report-preview').scrollTop=0;
}
