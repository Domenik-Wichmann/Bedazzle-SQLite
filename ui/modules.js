'use strict';
const moduleState={modules:[],runs:[],definition:null,run:null,sql:'',busy:false,columns:[]};
async function refreshModules(){
  const data=await api('/api/modules');moduleState.modules=data.modules;moduleState.runs=data.runs;
  const errors=JSON.stringify(data.errors||[]);
  if(data.errors?.length&&moduleState.lastErrors!==errors)toast('Some modules could not load: '+data.errors.map(item=>item.module+' — '+item.error).join('; '),true);
  moduleState.lastErrors=errors;
  $('module-menu').replaceChildren(node('option',{value:''},'Send to module…'),...data.modules.map(item=>node('option',{value:item.id},item.name)),node('option',{value:'history'},'Previous module runs…'));
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
    const basic=node('div',{class:'module-fields'}),advanced=node('div',{class:'module-fields'});
    for(const field of moduleState.definition.fields)(['workers','timeout','max_mb','max_pixels','max_frames','retries','run_timeout','allow_private'].includes(field.key)?advanced:basic).append(moduleField(field));
    $('module-fields').replaceChildren(basic,node('details',{class:'module-limits'},node('summary',{},'Limits and networking'),advanced));
    $('module-status').textContent='Choose URL columns and optional expectations, then run. URL checks contact the image servers directly from this laptop.';
  }catch(error){inlineError('module-error',error);show('module-start',false);}
  finally{$('module-start').disabled=false;}
}
function moduleOptions(){
  const result={};
  for(const field of moduleState.definition.fields){const input=$('module-option-'+field.key);
    result[field.key]=field.type==='columns'?[...input.selectedOptions].map(o=>o.value):field.type==='number'?Number(input.value):field.type==='boolean'?input.checked:input.value;
  }return result;
}
async function runModule(resume=false){
  if(moduleState.busy)return;
  moduleState.busy=true;show('module-cancel');show('module-start',false);show('module-resume',false);inlineError('module-error',null);
  $('module-progress').value=0;
  $('module-status').textContent=resume?'Resuming saved work…':'Saving the complete result snapshot…';
  $('module-fields').inert=true;
  try{
    const payload=resume?{run_id:moduleState.run.id}:{module:moduleState.definition.id,sql:moduleState.sql,options:moduleOptions()};
    const result=await runJob('module_run',payload);moduleState.run=result.run;
    await showModuleOutcome(result.run);window.bedazzle?.celebrate('Checked');
  }catch(error){
    inlineError('module-error',error);await refreshModules().catch(()=>{});
    if(moduleState.run?.id){moduleState.run=moduleState.runs.find(item=>item.id===moduleState.run.id)||moduleState.run;show('module-resume');}
    else show('module-start');
  }finally{moduleState.busy=false;show('module-cancel',false);$('module-fields').inert=false;}
}
async function showModuleOutcome(run){
  moduleState.run=run;show('module-options',false);show('module-outcome');show('module-start',false);show('module-resume',false);
  $('module-progress').value=100;
  const summary=run.summary||{};
  const image=run.module==='image_checker';
  $('module-status').textContent=image?`Completed · ${Number(summary.unique_urls||0).toLocaleString()} unique URLs · ${Number(summary.checked_cells||0).toLocaleString()} input URL cells`:'Completed · '+run.dataset;
  $('module-summary').replaceChildren(...(image?['pass','warning','fail','limited','blocked'].map(key=>[key,summary[key]||0]):Object.entries(summary).slice(0,12)).map(([key,value])=>node('div',{class:'module-stat '+key},node('strong',{},typeof value==='number'?value.toLocaleString():String(value)),node('span',{},key.replaceAll('_',' ')))));
  $('module-merge').disabled=!(run.merge||run.can_merge);
  $('module-merged-name').value='';
  $('module-report-preview').textContent='Loading a small preview…';
  if(run.module==='image_checker'){
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
    $('module-history-list').append(row);
  }$('module-history-dialog').showModal();
}
function setupModules(){
  const controls=node('div',{class:'module-actions'},node('select',{id:'module-menu','aria-label':'Send results to a module',title:'Process the complete SELECT with an installed module'},node('option',{value:''},'Send to module…')));
  $('export-results').after(controls);
  refreshModules().catch(report);
  bind('module-menu','change',async()=>{const id=$('module-menu').value;$('module-menu').value='';if(id==='history')await moduleHistory();else if(id)await openModule(id);});
  bind('module-start','click',()=>runModule());bind('module-resume','click',()=>runModule(true));bind('module-cancel','click',cancelJob);
  bind('module-view-report','click',async()=>{$('module-dialog').close();await selectDataset(moduleState.run.dataset);});
  bind('module-export-report','click',()=>{$('export-sql').value='SELECT * FROM '+sqlName(moduleState.run.dataset)+';';$('export-path').value='';inlineError('export-error',null);$('export-dialog').showModal();});
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
