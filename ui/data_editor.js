'use strict';
// Separate from the SQL editor: drafts are persisted in the workspace database.
const dataEditor = {view:null, selected:new Set(), active:null, busy:false, workspace:null};
function deButton(id, text, fn, className='button secondary compact') {
  return node('button',{id,type:'button',class:className,onclick:()=>Promise.resolve().then(fn).catch(report)},text);
}
async function deJob(payload) {
  if(dataEditor.busy)throw new Error('Wait for the editor operation to finish.');
  dataEditor.busy=true;
  for(const el of $('data-editor').querySelectorAll('button,input,select,textarea'))el.disabled=true;
  try{return await runJob('data_editor',payload);}
  finally{
    dataEditor.busy=false;
    for(const el of $('data-editor').querySelectorAll('button,input,select,textarea'))el.disabled=false;
  }
}
function dePayload(op, extra={}) {
  return {op,id:dataEditor.view?.session.id,expected_revision:dataEditor.view?.session.revision,search:$('de-search').value,offset:dataEditor.view?.offset||0,...extra};
}
async function dePage(extra={}){deRender(await deJob(dePayload('page',extra)));}
async function deChange(op,extra={}){deRender(await deJob(dePayload(op,extra)));}
function deRender(result) {
  dataEditor.view=result;dataEditor.selected.clear();dataEditor.active=null;
  const s=result.session;
  $('de-title').textContent=s.title;
  $('de-status').textContent=`${result.total.toLocaleString()} matching rows · ${result.changes.updated} changed · ${result.changes.added} added · ${result.changes.deleted} deleted · Draft saved on disk`;
  $('de-range').textContent=result.rows.length?`${result.offset+1}–${result.next_offset} of ${result.total}`:'No matching rows';
  $('de-undo').disabled=s.revision===0;$('de-redo').disabled=s.revision>=s.tip;
  $('de-prev').disabled=result.offset===0;$('de-next').disabled=result.next_offset>=result.total;
  $('de-columns').replaceChildren(...s.columns.map(c=>node('option',{value:c.name},c.name)));
  const head=node('tr',{},node('th',{},node('input',{type:'checkbox','aria-label':'Select all visible rows',onchange:e=>{
    for(const input of $('de-grid').querySelectorAll('.de-row-select')){input.checked=e.target.checked;input.dispatchEvent(new Event('change'));}
  }})),...s.columns.map(c=>node('th',{title:c.type},c.name,node('small',{},c.type))));
  const body=node('tbody');
  result.rows.forEach((row,r)=>{
    const check=node('input',{type:'checkbox',class:'de-row-select','aria-label':`Select row ${result.offset+r+1}`,onchange:e=>{
      if(e.target.checked)dataEditor.selected.add(row[0]);else dataEditor.selected.delete(row[0]);
      $('de-delete').textContent=`Delete selected (${dataEditor.selected.size})`;
    }});
    const tr=node('tr',{},node('td',{},check));
    s.columns.forEach((c,i)=>{
      const value=row[i+1];
      const button=node('button',{type:'button',class:'de-cell'+(value===null?' de-null':'')+(result.dirty?.[row[0]]?.[i]?' de-modified':''),
        'aria-label':`Row ${result.offset+r+1}, ${c.name}`,title:'Click to select · Enter or double-click to edit · Paste a rectangle',
        onfocus:()=>{dataEditor.active={r,c:i};},onclick:()=>{dataEditor.active={r,c:i};},
        ondblclick:()=>deOpenCell(row[0],c.name).catch(report),
        onkeydown:e=>{
          if(e.key==='Enter'||e.key==='F2'){e.preventDefault();deOpenCell(row[0],c.name).catch(report);}
          if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)){
            e.preventDefault();const nr=r+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0),nc=i+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0);
            body.children[nr]?.children[nc+1]?.querySelector('button')?.focus();
          }
        }},value===null?'NULL':value===''?'(empty)':value.length===512?value+'…':value);
      tr.append(node('td',{},button));
    });body.append(tr);
  });
  $('de-grid').replaceChildren(node('thead',{},head),body);$('de-delete').textContent='Delete selected (0)';
}
async function deOpen() {
  if(!state.result?.selectable)throw new Error('Run a SELECT first, then export its full result to the editor.');
  const result=await deJob({op:'open',sql:state.result.sql,result_id:state.result.result_id,title:'Edited query results'});
  $('de-search').value='';deRender(result);$('data-editor').showModal();
}
async function deDrafts() {
  const result=await deJob({op:'list'});
  $('de-draft-list').replaceChildren(...result.drafts.map(d=>node('div',{class:'de-draft'},
    node('span',{},d.title,node('small',{},new Date(d.created*1000).toLocaleString())),
    deButton('', 'Open',async()=>{
      const view=await deJob({op:'page',id:d.id});$('de-search').value='';deRender(view);
      $('de-drafts').close();$('data-editor').showModal();
    }),deButton('','Discard',async()=>{
      if(!confirm(`Permanently discard the editor draft “${d.title}” and its undo history? Saved datasets and source files remain available.`))return;
      await deJob({op:'discard',id:d.id});await deDrafts();
    }))));
  if(!result.drafts.length)$('de-draft-list').textContent='No editor drafts in this workspace.';
  if(!$('de-drafts').open)$('de-drafts').showModal();
}
async function deOpenCell(row,column) {
  const result=await deJob(dePayload('cell',{row,column}));
  dataEditor.cell={row,column};$('de-cell-title').textContent=column;
  $('de-cell-value').value=result.value??'';$('de-cell-null').checked=result.value===null;
  $('de-cell-value').disabled=result.value===null;
  inlineError('de-cell-error',null);$('de-cell-dialog').showModal();
}
// Clipboard TSV, including spreadsheet-quoted tabs, newlines and doubled quotes.
function deParsePaste(text) {
  const rows=[[]];let value='',quoted=false,start=true;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'&&(quoted||start)){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
      start=false;
    }else if(!quoted&&(ch==='\t'||ch==='\n'||ch==='\r')){
      rows.at(-1).push(value);value='';start=true;
      if(ch!=='\t'){if(ch==='\r'&&text[i+1]==='\n')i++;rows.push([]);}
    }else{value+=ch;start=false;}
  }
  if(quoted)throw new Error('The pasted text has an unclosed quote.');
  if(value!==''||rows.at(-1).length)rows.at(-1).push(value);else rows.pop();
  return rows;
}
async function dePaste(text) {
  if(!dataEditor.active)return;
  const {r,c}=dataEditor.active,view=dataEditor.view,rows=deParsePaste(text),cells=[];
  for(let y=0;y<rows.length;y++)for(let x=0;x<rows[y].length;x++){
    if(!view.rows[r+y]||!view.session.columns[c+x])throw new Error('The pasted rectangle extends beyond this page or its columns. Use a smaller selection.');
    cells.push({row:view.rows[r+y][0],column:view.session.columns[c+x].name,value:rows[y][x]});
  }
  if(cells.length)await deChange('cells',{cells});
}
function deSaveMode() {
  const mode=$('de-save-mode').value,source=['source','original'].includes(mode);
  show('de-save-working',mode==='working');show('de-save-export',mode==='export');show('de-save-source',source);
  $('de-save-description').textContent={working:'Create a new database dataset from the complete edited result. The draft stays available.',
    source:'Update and delete matching source-table records and insert added rows. Other source records stay intact. Successful save starts a fresh undo history.',
    original:'Rewrite the complete original file with your record changes, preserving records outside this result. A backup is kept beside it. File quoting and formatting may be normalized. Successful save starts a fresh undo history.',
    export:'Write the complete edited result to a new file. Existing files are protected.'}[mode];
  if(source){
    const previous=$('de-save-target').value||state.selected;
    const targets=state.data.catalog.filter(i=>mode==='original'?!!i.path:!i.path);
    $('de-save-target').replaceChildren(...targets.map(i=>node('option',{value:i.name},i.name)));
    if(targets.some(i=>i.name===previous))$('de-save-target').value=previous;
    deSaveTarget();
  }
}
function deSaveTarget() {
  const target=state.data.catalog.find(i=>i.name===$('de-save-target').value);
  const columns=dataEditor.view.session.columns.map(c=>c.name);
  $('de-save-keys').replaceChildren(...(target?.columns||[]).filter(c=>columns.includes(c.name)).map(c=>node('option',{value:c.name},c.name)));
  const guess=[...$('de-save-keys').options].find(o=>/^(id|sku|.*_id)$/i.test(o.value));if(guess)guess.selected=true;
  $('de-save-path').textContent=target?.path||'Database table';
}
function deSaveOpen() {
  inlineError('de-save-error',null);$('de-save-name').value=dataEditor.view.session.title;
  $('de-save-target').replaceChildren(...state.data.catalog.map(i=>node('option',{value:i.name},i.name+(i.path?' · file':' · database'))));
  if(state.selected)$('de-save-target').value=state.selected;
  const changes=dataEditor.view.changes;
  $('de-save-changes').textContent=`Pending changes: ${changes.updated} updated rows, ${changes.added} added, ${changes.deleted} deleted. Saves include the complete editor dataset, regardless of the row filter.`;
  $('de-save-ack').checked=false;deSaveMode();$('de-save-dialog').showModal();
}
async function deSave() {
  const mode=$('de-save-mode').value;
  if(['source','original'].includes(mode)&&!$('de-save-ack').checked)throw new Error('Check the destination confirmation before applying changes.');
  const result=await deJob(dePayload('save',{mode,name:$('de-save-name').value,target:$('de-save-target').value,
    keys:[...$('de-save-keys').selectedOptions].map(o=>o.value),format:$('de-save-format').value,output:$('de-save-output').value}));
  $('de-save-dialog').close();await dePage();
  toast(result.backup?'Original file saved. Backup: '+result.backup:'Saved '+(result.saved_to||result.path),false,result.path||null);
}
function installDataEditor() {
  const dialog=node('dialog',{id:'data-editor',class:'de-fullscreen'});
  dialog.append(node('header',{class:'de-header'},node('div',{},node('h2',{id:'de-title'},'Data editor'),node('p',{id:'de-status',role:'status'})),
    deButton('de-save-open','Save as…',deSaveOpen,'button primary'),deButton('de-close','Close editor',()=>dialog.close())),
    node('div',{class:'de-toolbar'},deButton('de-undo','Undo',()=>deChange('undo')),deButton('de-redo','Redo',()=>deChange('redo')),
      deButton('de-add','Add row',()=>deChange('add',{offset:0,search:''}).then(()=>{$('de-search').value='';return dePage({offset:Math.max(0,dataEditor.view.total-dataEditor.view.page_size)});})),
      deButton('de-delete','Delete selected (0)',async()=>{if(!dataEditor.selected.size)throw new Error('Select rows using their checkboxes.');await deChange('delete',{rows:[...dataEditor.selected]});}),
      node('input',{id:'de-search',placeholder:'Find rows containing…','aria-label':'Find rows'}),deButton('de-find','Find rows',()=>dePage({offset:0})),
      deButton('de-clear','Clear',()=>{$('de-search').value='';return dePage({offset:0});})),
    node('details',{class:'de-bulk'},node('summary',{},'Find/replace and bulk values'),node('div',{class:'de-toolbar'},
      node('label',{},'Column',node('select',{id:'de-columns'})),node('label',{},'Find text',node('input',{id:'de-find-text'})),
      node('label',{},'Replacement / value',node('input',{id:'de-replacement'})),
      deButton('de-replace','Replace in all matching rows',()=>deChange('replace',{column:$('de-columns').value,find:$('de-find-text').value,replacement:$('de-replacement').value})),
      deButton('de-set','Set value in all matching rows',()=>deChange('set',{column:$('de-columns').value,value:$('de-replacement').value})),
      deButton('de-set-null','Set NULL in all matching rows',()=>deChange('set',{column:$('de-columns').value,value:null})))),
    node('p',{class:'form-hint'},'Select a cell and paste a rectangle. Double-click or press Enter to edit the full value. NULL and empty text are distinct. Bulk actions use all rows matching Find rows.'),
    node('div',{class:'de-grid-wrap'},node('table',{id:'de-grid'})),node('div',{class:'de-footer'},
      deButton('de-prev','Previous',()=>dePage({offset:Math.max(0,dataEditor.view.offset-dataEditor.view.page_size)})),node('span',{id:'de-range'}),
      deButton('de-next','Next',()=>dePage({offset:dataEditor.view.next_offset})),node('span',{},'Closing keeps your draft. Reopen it from Editor drafts.')),
    node('div',{class:'modal-error hidden',role:'alert'}));
  dialog.addEventListener('cancel',e=>{if(dataEditor.busy)e.preventDefault();});
  dialog.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||e.target.matches('input,textarea,select')||dataEditor.busy)return;
    if(e.key.toLowerCase()==='z'){e.preventDefault();deChange(e.shiftKey?'redo':'undo').catch(report);}
    else if(e.key.toLowerCase()==='y'){e.preventDefault();deChange('redo').catch(report);}
    else if(e.key.toLowerCase()==='s'){e.preventDefault();deSaveOpen();}
  });
  document.body.append(dialog);
  $('de-grid').addEventListener('paste',e=>{e.preventDefault();dePaste(e.clipboardData.getData('text/plain')).catch(report);});
  $('de-search').addEventListener('keydown',e=>{if(e.key==='Enter')dePage({offset:0}).catch(report);});
  document.body.append(node('dialog',{id:'de-drafts',class:'modal wide-modal'},node('h2',{},'Editor drafts'),node('div',{id:'de-draft-list'}),deButton('','Close',()=>$('de-drafts').close())));
  document.body.append(node('dialog',{id:'de-cell-dialog',class:'modal'},node('h2',{id:'de-cell-title'}),
    node('label',{},node('input',{id:'de-cell-null',type:'checkbox',onchange:()=>{$('de-cell-value').disabled=$('de-cell-null').checked;}}),' NULL (no value)'),
    node('label',{},'Full value',node('textarea',{id:'de-cell-value',rows:12,spellcheck:'false'})),node('div',{id:'de-cell-error',class:'modal-error hidden',role:'alert'}),
    node('div',{class:'modal-footer'},deButton('','Cancel',()=>$('de-cell-dialog').close()),deButton('de-cell-apply','Apply',async()=>{
      await deChange('cells',{cells:[{...dataEditor.cell,value:$('de-cell-null').checked?null:$('de-cell-value').value}]});$('de-cell-dialog').close();
    },'button primary'))));
  document.body.append(node('dialog',{id:'de-save-dialog',class:'modal'},node('h2',{},'Save edited data'),
    node('label',{},'Save destination',node('select',{id:'de-save-mode',onchange:deSaveMode},
      ...[['working','Working dataset'],['source','Source records · database table'],['original','Original file'],['export','New exported file']].map(([value,text])=>node('option',{value},text)))),
    node('p',{id:'de-save-description',class:'modal-description'}),
    node('p',{id:'de-save-changes',class:'form-hint'}),
    node('div',{id:'de-save-working'},node('label',{},'New dataset name',node('input',{id:'de-save-name',maxlength:100}))),
    node('div',{id:'de-save-source'},node('label',{},'Destination dataset',node('select',{id:'de-save-target',onchange:deSaveTarget})),
      node('p',{id:'de-save-path'}),node('label',{},'Record key columns (Ctrl-click to select several)',node('select',{id:'de-save-keys',multiple:'',size:5})),
      node('p',{class:'form-hint'},'Keys must be unique and non-NULL in the original result, edited result and destination. Original values are checked for conflicts. Include all source columns when adding records.'),
      node('label',{},node('input',{id:'de-save-ack',type:'checkbox'}),' Apply these changes to this source destination.')),
    node('div',{id:'de-save-export'},node('label',{},'Format',node('select',{id:'de-save-format'},...['csv','tsv','parquet','json','ndjson'].map(f=>node('option',{value:f},f.toUpperCase())))),
      node('label',{},'Output path',node('input',{id:'de-save-output'})),deButton('de-save-browse','Choose file…',async()=>{
        const f=$('de-save-format').value,path=await picker('save',f,`edited-results.${f}`);if(path)$('de-save-output').value=path;
      })),node('div',{id:'de-save-error',class:'modal-error hidden',role:'alert'}),
    node('div',{class:'modal-footer'},deButton('','Cancel',()=>$('de-save-dialog').close()),deButton('de-save-confirm','Save',deSave,'button primary'))));
}
installDataEditor();
