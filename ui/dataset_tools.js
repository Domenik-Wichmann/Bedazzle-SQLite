/* Dataset selection is metadata-only; samples never replace SQL-tab contents. */
'use strict';
(() => {
  const card=node('section',{id:'dataset-context',class:'dataset-context','aria-label':'Selected dataset tools'}),selected=node('strong'),description=node('p');
  card.append(selected,description,node('div',{},node('button',{type:'button',onclick:()=>preview(state.selected)},'Preview 10 rows'),node('button',{type:'button',onclick:()=>queryTab(state.selected)},'New SELECT tab')));
  $('datasets').after(card);
  const dialog=node('dialog',{id:'dataset-preview-dialog',class:'dataset-preview-card','aria-labelledby':'dataset-preview-title'});
  const title=node('h2',{id:'dataset-preview-title'}),status=node('p',{id:'dataset-preview-status',role:'status'}),grid=node('div',{id:'dataset-preview-grid',class:'dataset-preview-grid'});
  const download=node('button',{id:'dataset-preview-download',type:'button',class:'button primary',onclick:()=>downloadSample().catch(report)},'Download CSV');
  const cancel=node('button',{type:'button',class:'button secondary',onclick:()=>cancelJob().catch(report)},'Cancel loading');
  dialog.append(node('div',{class:'dataset-preview-heading'},title,node('button',{type:'button',class:'close-button','aria-label':'Close dataset preview',onclick:()=>dialog.close()},'×')),
    node('p',{class:'form-hint'},'Up to ten rows in source read order. This preview does not run or replace a SQL tab. A few rows do not establish data quality.'),status,grid,
    node('div',{class:'dataset-preview-footer'},cancel,node('button',{id:'dataset-preview-query',type:'button',class:'button secondary',onclick:()=>{const name=current?.name;if(name&&queryTab(name))dialog.close();else status.textContent=state.busy?'Wait for preview loading to finish.':'Close an unused SQL tab to create another. Existing SQL was preserved; the sample can still be downloaded.';}},'New SELECT tab'),download));
  document.body.append(dialog);
  let current=null;
  function ready(){const [major,minor]=(state.data?.app_version||'0.0').split('.').map(Number);if(major>1||major===1&&minor>=8)return true;toast('Dataset samples need the updated background engine. Use Quit, run Start Bedazzle.cmd again, then refresh.',true);return false;}
  function context(){const item=state.data?.catalog.find(item=>item.name===state.selected);card.hidden=!item;if(item){selected.textContent=item.name;description.textContent='Selected for Columns, Count, Profile and Visual explorer. Your SQL tabs stay unchanged.';}}
  function queryTab(name){return name?newTab(name,`SELECT *\nFROM ${sqlName(name)}\nLIMIT 100;`):null;}
  function release(context){if(!context?.resultId||context.releasing||context.downloading||state.busy)return;context.releasing=true;api('/api/release-result',{result_id:context.resultId}).catch(()=>{context.releasing=false;});}
  dialog.addEventListener('close',()=>{if(current){current.closed=true;release(current);}current=null;});
  async function preview(name){
    if(!ready())return;
    if(state.busy)return toast('Wait for the current operation or cancel it first.');
    if(dialog.open)dialog.close();await selectDataset(name);
    const context={name,closed:false};current=context;title.textContent=name+' · first 10 rows';status.textContent='Loading up to ten rows…';grid.replaceChildren();download.disabled=true;cancel.hidden=false;dialog.showModal();
    try{
      const value=await runJob('dataset_preview',{name});context.resultId=value.sample.result_id;if(context.closed)return;
      const table=tableFor(value.sample,{inspectRows:false});table.id='dataset-preview-table';grid.replaceChildren(table);
      status.textContent=value.sample.total_rows.toLocaleString()+' sample row(s) · '+value.sample.total_columns.toLocaleString()+' columns'+(value.sample.total_columns>value.sample.columns.length?' · Some columns are hidden in this preview.':'')+(value.sample.clipped_cells?' · Long cells are shortened on screen.':'')+' CSV includes all columns and full values within the sample download limit.';
      download.disabled=false;
    }catch(error){if(!context.closed)status.textContent=error.message;}
    finally{cancel.hidden=true;if(context.closed)release(context);}
  }
  function saveBlob(blob,filename){const url=URL.createObjectURL(blob),link=node('a',{href:url,download:filename});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function downloadSample(){
    const context=current;if(!context?.resultId||state.busy)return;context.downloading=true;download.disabled=true;cancel.hidden=false;
    try{
      const value=await runJob('dataset_sample_csv',{result_id:context.resultId});
      cancel.hidden=true;
      const response=await fetch('/api/dataset-sample-csv?result_id='+encodeURIComponent(value.result_id),{headers:{'X-Workbench-Token':token,'X-Workbench-Workspace':state.data.workspaces.selected}});
      if(!response.ok){const error=await response.json();throw Error(error.error||'Sample download failed.');}
      saveBlob(await response.blob(),value.filename);
      if(!context.closed)status.textContent='Downloaded '+value.rows+' sample rows. The SQL tabs and source dataset were unchanged.';
    }catch(error){if(!context.closed)status.textContent=error.message;}
    finally{context.downloading=false;download.disabled=false;cancel.hidden=true;if(context.closed)release(context);}
  }
  const include=node('input',{id:'instructions-include-samples',type:'checkbox'});
  const choices=node('div',{id:'instructions-sample-datasets',class:'instructions-sample-datasets','aria-label':'Datasets to sample'});
  const sampleGroup=node('div',{class:'instructions-sample-group'},node('p',{class:'form-hint'},'Adds actual values: up to five rows from each checked dataset. Choose at most twenty. Long/wide samples are bounded and labelled.'),choices);sampleGroup.hidden=!include.checked;
  const guideDialog=$('instructions-dialog');guideDialog.querySelector('p').textContent='The complete guide, dataset names and column types. You can optionally include sample values below.';
  const stopGuide=node('button',{id:'instructions-cancel-samples',type:'button',class:'button secondary',onclick:()=>cancelJob().catch(report)},'Cancel samples');stopGuide.hidden=true;guideDialog.querySelector('.modal-footer').append(stopGuide);
  guideDialog.querySelector('.modal-footer').before(node('label',{class:'instructions-sample-toggle'},include,'Include up to 5 sample rows per dataset'),sampleGroup);
  let guideWorkspace=null;
  function saveGuideSelection(){localStorage.setItem(draftKey('guide-sample-datasets'),JSON.stringify([...choices.querySelectorAll('input:checked')].map(input=>input.value)));}
  function guideChoices(){
    if(guideWorkspace!==state.data?.workspace){guideWorkspace=state.data?.workspace;choices.replaceChildren();include.checked=localStorage.getItem(draftKey('guide-include-samples'))==='true';sampleGroup.hidden=!include.checked;}
    const initial=!choices.children.length;
    let stored=null;try{const parsed=JSON.parse(localStorage.getItem(draftKey('guide-sample-datasets')));if(Array.isArray(parsed)&&parsed.every(v=>typeof v==='string'))stored=parsed;}catch{}
    const checked=new Set(initial&&stored?stored:[...choices.querySelectorAll('input:checked')].map(input=>input.value));
    choices.replaceChildren(...(state.data?.catalog||[]).map((item,index)=>{const input=node('input',{type:'checkbox',value:item.name});input.checked=initial&&!stored?index<20:checked.has(item.name);
      input.onchange=()=>{if(choices.querySelectorAll('input:checked').length>20){input.checked=false;$('instructions-status').textContent='Choose at most twenty datasets for samples.';}saveGuideSelection();};
      return node('label',{},input,node('span',{},item.name));}));
  }
  include.onchange=()=>{sampleGroup.hidden=!include.checked;localStorage.setItem(draftKey('guide-include-samples'),String(include.checked));};
  document.getElementById('download-instructions').addEventListener('click',guideChoices);
  guideDialog.addEventListener('toggle',event=>{if(event.newState==='open')guideChoices();});
  async function instructions(copy){
    const status=$('instructions-status'),copyButton=$('copy-instructions'),saveButton=$('save-instructions');
    const withSamples=include.checked;
    if(withSamples&&!ready()){status.textContent='Restart the updated Bedazzle background engine with Quit and Start Bedazzle.cmd before including samples.';return;}
    if(state.busy)return status.textContent='Wait for the current operation before preparing sample data.';
    copyButton.disabled=saveButton.disabled=include.disabled=true;for(const input of choices.querySelectorAll('input'))input.disabled=true;stopGuide.hidden=!withSamples;status.textContent='Preparing instructions…';
    try{
      const datasets=[...choices.querySelectorAll('input:checked')].map(input=>input.value);
      saveGuideSelection();
      if(withSamples&&!datasets.length)throw Error('Choose at least one dataset for sample rows.');
      const value=withSamples?await runJob('agent_instructions',{datasets}):await api('/api/agent-instructions');
      stopGuide.hidden=true;
      if(!guideDialog.open){status.textContent='Preparation finished without copying or downloading. Choose Copy or Download when ready.';return;}
      if(copy)await navigator.clipboard.writeText(value.markdown);else saveBlob(new Blob([value.markdown],{type:'text/markdown;charset=utf-8'}),value.filename);
      status.textContent=(copy?'Copied.':'Downloaded.')+(withSamples?' Included samples for '+value.sampled_datasets+' dataset(s).'+(value.samples_limited?' Some samples are shortened or unavailable; see the guide.':''):' Schema only; no sample row values were added.');
    }catch(error){status.textContent=error.message;}
    finally{copyButton.disabled=saveButton.disabled=include.disabled=false;for(const input of choices.querySelectorAll('input'))input.disabled=false;stopGuide.hidden=true;}
  }
  window.bedazzleDatasetTools={context,preview,queryTab,instructions};
})();
