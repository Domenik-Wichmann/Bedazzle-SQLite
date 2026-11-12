'use strict';
let completionItems=[],completionIndex=0,completionTimer,completionFunctions=[],completionLoaded=false;
let editorSaveTimer;
function flushDrafts(){clearTimeout(editorSaveTimer);cacheTab();persistTabs();localStorage.setItem(draftKey('editor'),$('sql-editor').value);}
const commonFunctions='count sum avg min max coalesce nullif cast try_cast concat lower upper trim substring length regexp_matches regexp_replace string_agg list distinct date_trunc date_diff strftime row_number rank dense_rank lag lead first_value last_value read_csv read_parquet read_json_auto unnest round abs ceil floor sqrt split_part replace contains starts_with ends_with json_extract'.split(' ').map(name=>({name,parameters:[],returns:''}));
function closeCompletion(){clearTimeout(completionTimer);show('suggestions',false);completionItems=[];$('sql-editor').setAttribute('aria-expanded','false');$('sql-editor').removeAttribute('aria-activedescendant');}
function chooseCompletion(index){
 const choice=completionItems[index];if(!choice)return;
 const area=$('sql-editor');area.setRangeText(choice.insert,choice.start,choice.end,'end');
 if(choice.kind==='function')area.setSelectionRange(area.selectionStart-1,area.selectionStart-1);
 closeCompletion();area.focus();updateLines();cacheTab();persistTabs();
}
function highlightCompletion(){
 [...$('suggestions').children].forEach((button,index)=>{button.classList.toggle('active',index===completionIndex);button.setAttribute('aria-selected',String(index===completionIndex));});
 $('sql-editor').setAttribute('aria-activedescendant','completion-'+completionIndex);
 $('suggestions').children[completionIndex]?.scrollIntoView({block:'nearest'});
}
function suggestSQL(manual=false){
 const area=$('sql-editor');if(area.selectionStart!==area.selectionEnd||document.activeElement!==area)return closeCompletion();
 completionItems=SQLAssist.complete(area.value,area.selectionStart,state.data?.catalog||[],completionFunctions.length?completionFunctions:commonFunctions,manual);
 if(!completionItems.length)return closeCompletion();
 completionIndex=0;
 $('suggestions').replaceChildren(...completionItems.map((item,index)=>node('button',{id:'completion-'+index,role:'option',title:item.detail,onmousedown:e=>{e.preventDefault();chooseCompletion(index);}},node('strong',{},item.label),node('small',{},item.kind+' · '+item.detail))));
 const style=getComputedStyle(area),line=parseFloat(style.lineHeight)||23.4;
 const prefix=area.value.slice(0,area.selectionStart),row=(prefix.match(/\n/g)||[]).length,col=prefix.length-prefix.lastIndexOf('\n')-1;
 const rect=area.getBoundingClientRect();
 const caret=typeof sqlCaretPosition==='function'?sqlCaretPosition(area):null;
 $('suggestions').style.position='fixed';
 $('suggestions').style.left=Math.max(10,Math.min(innerWidth-400,caret?caret.left:rect.left+76+col*7.8-area.scrollLeft))+'px';
 const top=Math.max(10,Math.min(innerHeight-180,caret?caret.bottom+4:rect.top+12+(row+1)*line-area.scrollTop));
 $('suggestions').style.top=top+'px';
 $('suggestions').style.bottom='auto';$('suggestions').style.maxHeight=Math.min(240,innerHeight-top-12)+'px';
 show('suggestions');area.setAttribute('aria-expanded','true');highlightCompletion();
}
async function autocomplete(){
 suggestSQL(true);
 if(!completionLoaded&&!state.busy){
  try{const result=await runJob('completion_metadata',{});completionFunctions=result.functions;completionLoaded=true;suggestSQL(true);}catch(error){report(error);}
 }
}
function setupEditor(){
 const beautify=$('beautify-query');
 if(typeof beautifySQL==='function'&&typeof sqlFormatter!=='undefined'){beautify?.addEventListener('click',beautifySQL);setupBeautify();}
 else if(beautify){beautify.disabled=true;beautify.title='SQL formatting is unavailable. Reload Bedazzle to try again.';}
 if(typeof scheduleSQLHighlight==='function'){
  $('sql-pane').classList.add('sql-highlight-ready');
  $('sql-editor').addEventListener('scroll',scheduleSQLHighlight);
  scheduleSQLHighlight();
 }
 const area=$('sql-editor');$('suggestions').setAttribute('role','listbox');
 area.setAttribute('role','combobox');area.setAttribute('aria-autocomplete','list');area.setAttribute('aria-controls','suggestions');area.setAttribute('aria-expanded','false');
 area.addEventListener('input',event=>{clearTimeout(completionTimer);if(event.isComposing)return;completionTimer=setTimeout(()=>suggestSQL(),90);});
 area.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.isComposing)return;
  if(!$('suggestions').classList.contains('hidden')){
   if(['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)){
    event.preventDefault();event.stopImmediatePropagation();clearTimeout(completionTimer);
    if(event.key==='Escape')closeCompletion();else if(event.key==='Enter'||event.key==='Tab')chooseCompletion(completionIndex);
    else{completionIndex=(completionIndex+(event.key==='ArrowDown'?1:-1)+completionItems.length)%completionItems.length;highlightCompletion();}
   }
  }
 },true);
 area.addEventListener('blur',closeCompletion);area.addEventListener('scroll',closeCompletion);area.addEventListener('click',closeCompletion);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDrafts();});
}
