/* Result controls operate on retained rows; the displayed SQL stays reproducible. */
'use strict';
(() => {
  const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 8v6l-4 2v-8Z"/></svg>';
  const dialog=node('dialog',{id:'result-filter-dialog',class:'result-filter-card','aria-labelledby':'rf-title'});
  const title=node('h2',{id:'rf-title'}),status=node('p',{id:'rf-status',role:'status'});
  const kind=node('select',{id:'rf-kind','aria-label':'Filter type'},...[
    ['values','Choose values'],['contains','Contains text'],['starts_with','Starts with'],['equals','Exact text'],['not_contains','Does not contain'],['null','Is NULL (missing)'],['not_null','Is not NULL']
  ].map(([value,label])=>node('option',{value},label)));
  const search=node('input',{id:'rf-search',type:'search',placeholder:'Search all values, then press Enter','aria-label':'Find values'});
  const find=node('button',{id:'rf-find',type:'button',class:'button secondary',onclick:()=>loadValues(true)},'Search');
  const list=node('div',{id:'rf-values',class:'rf-values','aria-label':'Available values'});
  const summary=node('p',{id:'rf-selection',class:'rf-selection',role:'status'});
  const more=node('button',{id:'rf-more',type:'button',class:'button secondary',onclick:()=>loadValues(false)},'Load more values');
  const valuesPane=node('div',{class:'rf-values-pane'},node('div',{class:'rf-search'},search,find),
    node('div',{class:'rf-selection-actions'},
      node('button',{type:'button',onclick:()=>selectAll(true)},'Select all values'),
      node('button',{type:'button',onclick:()=>selectAll(false)},'Clear selection'),
      node('button',{type:'button',onclick:()=>selectShown()},'Only shown')),
    summary,list,more);
  const text=node('input',{id:'rf-text',placeholder:'Enter text and press Enter','aria-label':'Filter text'});
  const caseSensitive=node('input',{id:'rf-case',type:'checkbox'});
  const textPane=node('div',{class:'rf-text-pane'},node('label',{},'Match text',text),node('label',{class:'rf-case-label'},caseSensitive,'Case sensitive'),node('p',{class:'rf-hint'},'Text conditions do not match NULL. Choose Is NULL for missing values.'));
  const cancelLoad=node('button',{type:'button',class:'button secondary',onclick:()=>cancelJob().catch(report)},'Cancel loading');
  const applyButton=node('button',{id:'rf-apply',type:'button',class:'button primary',onclick:()=>applyCard().catch(report)},'Apply filter');
  dialog.append(node('div',{class:'rf-heading'},title,node('button',{type:'button',class:'close-button','aria-label':'Close column filter',onclick:()=>dialog.close()},'×')),
    node('p',{class:'rf-hint'},'Searches the complete saved result, with other column filters applied. Values load in batches; large results may take time. This never edits the source.'),
    node('label',{},'Filter type',kind),textPane,valuesPane,status,
    node('div',{class:'rf-footer'},node('button',{id:'rf-reset',type:'button',class:'button secondary',onclick:()=>applyCard(true).catch(report)},'Remove column filter'),cancelLoad,applyButton));
  document.body.append(dialog);
  let current=null,loading=false;
  const restartMessage='Result filters need the updated background engine. Use Quit in Bedazzle, run Start Bedazzle.cmd again, then refresh this page.';
  function backendReady(){
    const version=(state.data?.app_version||'0.0').split('.').map(Number);
    if(version[0]>1||version[0]===1&&version[1]>=7)return true;
    toast(restartMessage,true);return false;
  }
  dialog.addEventListener('close',()=>{current=null;});
  const planFor=result=>structuredClone(result.result_view||{filters:[],sort:null});
  const fail=message=>{status.textContent=message;};
  function loadingUI(value){
    loading=value;find.disabled=more.disabled=applyButton.disabled=value;kind.disabled=value;
    cancelLoad.hidden=!value;
    dialog.setAttribute('aria-busy',String(value));
  }
  function selectionSummary(){
    if(current)summary.textContent=current.selection==='exclude'?(current.selected.size?'All values except '+current.selected.size.toLocaleString()+' unchecked value(s)':'All values selected'):
      current.selected.size.toLocaleString()+' value(s) selected';
  }
  function checked(token){return current.selection==='include'?current.selected.has(token):!current.selected.has(token);}
  function setChoice(item,value){
    const keep=current.selection==='include'?value:!value;
    if(keep && !current.selected.has(item.token) && current.selected.size>=1000)throw Error('Use a text condition instead of more than 1,000 selected/excluded values.');
    if(keep)current.selected.set(item.token,{token:item.token,value:item.value});else current.selected.delete(item.token);
  }
  function refreshChecks(){for(const input of list.querySelectorAll('input'))input.checked=checked(input.dataset.token);selectionSummary();}
  function selectAll(value){if(!current||loading)return;current.selection=value?'exclude':'include';current.selected.clear();refreshChecks();}
  function selectShown(){if(!current||loading)return;current.selection='include';current.selected.clear();try{for(const item of current.shown)setChoice(item,true);refreshChecks();}catch(error){fail(error.message);}}
  async function loadValues(reset){
    if(!current||loading)return;
    const context=current;if(reset){context.offset=0;context.shown=[];list.replaceChildren();}
    loadingUI(true);status.textContent='Scanning saved rows for distinct values…';
    try{
      const value=await runJob('result_values',{result_id:context.resultId,column:context.column,search:search.value,offset:context.offset});
      if(current!==context||!dialog.open)return;
      for(const item of value.items){
        const input=node('input',{type:'checkbox','data-token':item.token});input.checked=checked(item.token);
        input.addEventListener('change',()=>{try{setChoice(item,input.checked);selectionSummary();}catch(error){input.checked=checked(item.token);fail(error.message);}});
        const label=item.token==='null'?'NULL (missing)':item.label===''?'(empty text)':/^ +$/.test(item.label)?'('+item.label.length+' spaces)':item.label+(item.truncated?'…':'');
        list.append(node('label',{class:'rf-value',title:item.truncated?item.characters.toLocaleString()+' characters; exact value identity is preserved':label},input,node('span',{class:'rf-value-label'},label),node('span',{class:'rf-value-count'},item.count.toLocaleString())));
      }
      context.shown.push(...value.items);context.offset=value.next_offset;context.loaded=true;
      more.hidden=!value.has_more||context.shown.length>=1000;
      status.textContent=!context.shown.length?'No matching values.':context.shown.length.toLocaleString()+' values shown. Counts are exact within the other filters.'+(search.value?' Use Contains text to match every value containing this text.':'')+
        (value.search_limit_reached||value.has_more&&context.shown.length>=1000?' Refine the search to find more values.':'');
      selectionSummary();
    }catch(error){if(current===context)fail(error.message);}
    finally{loadingUI(false);}
  }
  function changeKind(){
    const values=kind.value==='values';valuesPane.hidden=!values;
    textPane.hidden=values||kind.value==='null'||kind.value==='not_null';
    if(values&&current&&!current.loaded)loadValues(true);else status.textContent='Apply updates both the results and SQL. Empty text removes this column filter.';
  }
  kind.addEventListener('change',changeKind);
  search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadValues(true);}});
  text.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyCard().catch(report);}});
  async function applyCard(remove=false){
    if(!current||loading)return;
    if(state.result?.result_id!==current.resultId||state.activeTab!==current.tab)throw Error('Results changed. Reopen the column filter.');
    const plan=planFor(state.result);plan.filters=plan.filters.filter(item=>item.column!==current.column);
    if(!remove){
      const item={column:current.column,kind:kind.value};
      if(item.kind==='values')Object.assign(item,{selection:current.selection,values:[...current.selected.values()]});
      else Object.assign(item,{text:text.value,case_sensitive:caseSensitive.checked});
      plan.filters.push(item);
    }
    dialog.close();await apply(plan);
  }
  async function apply(plan){
    if(!backendReady())return;
    const source=state.result;
    if(state.busy)throw Error('Wait for the current operation or cancel it first.');
    if(!source?.result_id)throw Error('Run the query once before filtering its retained results.');
    const draft=$('sql-editor').value,keepDraft=draft.trim()!==source.sql.trim();
    if(keepDraft&&state.tabs.length>=10)throw Error('Close a SQL tab first. Your unsaved SQL draft was preserved.');
    cacheTab();persistTabs();
    const shared=state.tabs.some(tab=>tab.id!==state.activeTab&&tab.result?.result_id===source.result_id);
    const result=await runJob('query',{sql:source.sql,result_id:source.result_id,view:plan,retain_result:true,size:Number($('page-size').value),...(!keepDraft&&!shared?{replace_result_id:source.result_id}:{})});
    if(!result.result_view)throw Error(restartMessage);
    if(keepDraft)newTab(plan.filters.length?'Filtered results':'Sorted results',result.sql);
    setMode('sql');setEditor(result.sql);state.result=result;state.activeSQL=result.sql;state.sort=result.result_view.sort;
    state.previous=[];state.expanded.clear();clearVirtualPage();cacheTab();persistTabs();workArea();renderResults();setResultView('table');
    $('editor-status').textContent='SQL updated · applied to saved results without rerunning the source';
  }
  function open(column){
    if(!backendReady())return;
    if(state.busy)return toast('Wait for the current operation or cancel it first.');
    const result=state.result;if(!result?.result_id)return;
    const existing=planFor(result).filters.find(item=>item.column===column);
    current={column,resultId:result.result_id,tab:state.activeTab,selection:existing?.selection||'exclude',selected:new Map((existing?.values||[]).map(v=>[v.token,v])),offset:0,shown:[],loaded:false};
    title.textContent='Filter '+column;kind.value=existing?.kind||'values';text.value=existing?.text||'';caseSensitive.checked=existing?.case_sensitive===true;
    search.value='';list.replaceChildren();status.textContent='';more.hidden=true;loadingUI(false);selectionSummary();
    dialog.showModal();changeKind();(kind.value==='values'?search:textPane.hidden?kind:text).focus();
  }
  window.bedazzleResultFilters={
    open,apply,
    async sort(column){const plan=planFor(state.result);plan.sort={column,direction:plan.sort?.column===column&&plan.sort.direction==='ASC'?'DESC':'ASC'};await apply(plan);},
    header(th,column,result){
      const sort=result.result_view?.sort;if(sort?.column===column){th.setAttribute('aria-sort',sort.direction==='ASC'?'ascending':'descending');th.firstChild.append(node('span',{class:'rf-sort-arrow','aria-hidden':'true'},sort.direction==='ASC'?' ↑':' ↓'));}
      const active=result.result_view?.filters.some(item=>item.column===column);
      const button=node('button',{type:'button',class:'result-filter-button'+(active?' active':''),'aria-label':'Filter '+column,'aria-haspopup':'dialog',title:'Filter '+column,onclick:event=>{event.stopPropagation();open(column);}});
      button.innerHTML=icon;const heading=th.firstChild,group=node('div',{class:'result-column-header'},heading,button);th.append(group);
    },
    summary(){
      let bar=$('result-filter-summary');if(!bar){bar=node('div',{id:'result-filter-summary',class:'result-filter-summary'});$('table-scroll').before(bar);}
      bar.replaceChildren();const result=state.result,plan=planFor(result);bar.hidden=!plan.filters.length&&!plan.sort;
      if(plan.filters.length)bar.append(node('span',{},result.total_rows.toLocaleString()+' of '+(result.unfiltered_rows??result.total_rows).toLocaleString()+' saved rows'));
      for(const item of plan.filters)bar.append(node('button',{type:'button',title:'Edit this column filter',onclick:()=>open(item.column)},item.column+' · '+(item.kind==='values'?(item.selection==='exclude'?'except ':'')+item.values.length+' values':item.kind.replaceAll('_',' '))));
      if(plan.filters.length)bar.append(node('button',{type:'button',onclick:()=>apply({...plan,filters:[]}).catch(report)},'Clear all filters'));
      if(plan.sort)bar.append(node('button',{type:'button',onclick:()=>apply({...plan,sort:null}).catch(report),title:'Remove header sorting'},plan.sort.column+' '+(plan.sort.direction==='ASC'?'↑':'↓')+' · clear sort'));
    }
  };
})();
