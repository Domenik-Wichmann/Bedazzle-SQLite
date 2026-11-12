'use strict';
window.bedazzleQueryBuilder = (() => {
  let config,key,before=null,history=[],future=[],pending=null;
  const zones={output:'Output',groups:'Group by',values:'Aggregates',filters:'Filters',sort:'Sort'};
  const empty=()=>({tables:[],joins:[],output:[],groups:[],values:[],filters:[],sort:[],calculations:[],match:'all',distinct:false,limit:''});
  const catalog=()=>state.data?.catalog||[];
  const label=f=>f.op==='records'?'All records':(config.tables.find(t=>t.id===f.table)?.name||'?')+'.'+f.column;
  const snapshot=()=>JSON.stringify(config);
  const status=text=>{$('qb-status').textContent=text;$('qb-status').classList.toggle('hidden',!text);};
  const normalizeLimit=value=>/^\d+$/.test(String(value))&&Number(value)>0?String(Math.min(1e9,Number(value))):'';
  function persist(){localStorage.setItem(key,snapshot());}
  function change(fn,renderAll=true){history.push(snapshot());if(history.length>60)history.shift();future=[];fn();persist();if(renderAll)render();else preview();}
  function undo(redo=false){const from=redo?future:history,to=redo?history:future;if(!from.length)return;to.push(snapshot());config=JSON.parse(from.pop());persist();render();}
  function button(text,action,name=text){return node('button',{type:'button',class:'qb-button','aria-label':name,onclick:()=>{try{Promise.resolve(action()).catch(report);}catch(e){report(e);}}},text);}
  function select(options,value,action,name){const el=node('select',{'aria-label':name,onchange:e=>action(e.target.value)},options.map(([v,l])=>node('option',{value:v},l)));el.value=value;return el;}
  function input(value,placeholder,action,type='text'){return node('input',{type,value:value??'',placeholder,'aria-label':placeholder,onchange:e=>action(e.target.value)});}
  function drag(event,data){event.stopPropagation();event.dataTransfer.setData('application/bedazzle-query-field',JSON.stringify(data));event.dataTransfer.effectAllowed=data.zone?'move':'copy';}
  function read(event){try{return JSON.parse(event.dataTransfer.getData('application/bedazzle-query-field'));}catch{return null;}}
  function accept(event){if(event.dataTransfer.types.includes('application/bedazzle-query-field')){event.preventDefault();event.currentTarget.classList.add('qb-over');}}
  function clearOver(event){event.currentTarget.classList.remove('qb-over');}
  function add(zone,f,source=null,index=null){
    if(f.op==='records'&&zone!=='values')return status('Count rows belongs in Aggregates.');
    change(()=>{
      if(source===zone){const item=config[zone].splice(f.index,1)[0];config[zone].splice(index??config[zone].length,0,item);return;}
      if(source)config[source].splice(f.index,1);
      const item={table:f.table,column:f.column};
      if(['output','groups','sort'].includes(zone)&&config[zone].some(x=>x.table===f.table&&x.column===f.column))return;
      if(zone==='filters')Object.assign(item,{op:'eq',kind:'text',value:''});
      if(zone==='values')Object.assign(item,{op:f.op==='records'?'records':'count',alias:'',having:{},sort:''});
      if(zone==='sort')item.direction='asc';
      config[zone].splice(index??config[zone].length,0,item);
      if(zone==='groups')config.output=config.output.filter(x=>x.table!==f.table||x.column!==f.column);
    });
  }
  function drop(event,zone,index=null){event.preventDefault();event.stopPropagation();clearOver(event);const f=read(event);if(f)add(zone,f,f.zone,index);}
  function connect(a,b){
    if(a.table===b.table)return status('Connect fields from two different dataset cards. Add a dataset twice for a self join.');
    if(config.tables.findIndex(t=>t.id===a.table)>config.tables.findIndex(t=>t.id===b.table))[a,b]=[b,a];
    if(config.joins.some(j=>j.left.table===a.table&&j.left.column===a.column&&j.right.table===b.table&&j.right.column===b.column))return;
    change(()=>{const type=config.joins.find(j=>j.right.table===b.table)?.type||'LEFT';config.joins.push({left:{table:a.table,column:a.column},right:{table:b.table,column:b.column},type});});pending=null;
  }
  function addTable(name){
    if(!name)return;
    change(()=>{let i=1;while(config.tables.some(t=>t.id==='t'+i))i++;const n=config.tables.length;config.tables.push({id:'t'+i,name,x:24+(n%3)*290,y:24+Math.floor(n/3)*330});});
  }
  function removeTable(id){change(()=>{config.tables=config.tables.filter(t=>t.id!==id);config.joins=config.joins.filter(j=>j.left.table!==id&&j.right.table!==id);for(const zone of Object.keys(zones))config[zone]=config[zone].filter(f=>f.table!==id||f.op==='records');config.calculations=(config.calculations||[]).filter(v=>v.left?.table!==id&&v.right?.table!==id);});}
  function filterControls(f,action,aggregate=false,emptyLabel='No aggregate filter'){
    return node('div',{class:'qb-filter-controls'},select(aggregate?[['',emptyLabel],...Object.entries(QueryBuilderSQL.operators).filter(([op])=>!['contains','starts'].includes(op))]:Object.entries(QueryBuilderSQL.operators),f.op||'',v=>action({op:v}),'Filter operator'),
      !aggregate?select([['text','Text'],['number','Number'],['date','Date']],f.kind||'text',v=>action({kind:v}),'Compare as'):null,
      f.op&&!['null','notnull'].includes(f.op)?input(f.value,'Filter value',v=>action({value:v})):null);
  }
  function chip(zone,f,index){
    const move=delta=>{const to=index+delta;if(to<0||to>=config[zone].length)return;change(()=>{[config[zone][index],config[zone][to]]=[config[zone][to],config[zone][index]];});};
    const chip=node('article',{class:'qb-chip',draggable:'true',ondragstart:e=>drag(e,{...f,zone,index}),ondragover:accept,ondragleave:clearOver,ondrop:e=>drop(e,zone,index)},
      node('div',{class:'qb-chip-head'},node('strong',{},label(f)),button('↑',()=>move(-1),'Move '+label(f)+' earlier'),button('↓',()=>move(1),'Move '+label(f)+' later'),button('×',()=>change(()=>config[zone].splice(index,1)),'Remove '+label(f)+' from '+zones[zone])));
    if(zone==='filters')chip.append(filterControls(f,patch=>change(()=>Object.assign(f,patch))));
    if(zone==='sort')chip.append(select([['asc','Ascending'],['desc','Descending']],f.direction,v=>change(()=>f.direction=v),'Sort direction'));
    if(zone==='output'||zone==='values')chip.append(input(f.alias,'Output heading',v=>change(()=>f.alias=v,false)));
    if(zone==='values'){
      chip.append(select(Object.entries(QueryBuilderSQL.aggregates).filter(([op])=>f.op==='records'?op==='records':op!=='records'),f.op,v=>change(()=>f.op=v),'Aggregate function'),
        select([['','No aggregate sort'],['asc','Ascending'],['desc','Descending']],f.sort||'',v=>change(()=>f.sort=v),'Aggregate sort'),
        node('details',{open:f.having?.op?'':null},node('summary',{},'Filter aggregate (HAVING)'),filterControls(f.having||{},patch=>change(()=>f.having={...f.having,...patch}),true)));
      if(['sum','avg'].includes(f.op))chip.append(node('small',{},'Converts to numbers; nonnumeric values become NULL and are ignored.'));
    }
    return chip;
  }
  function addCalculation(){
    change(()=>{(config.calculations??=[]).push({id:crypto.randomUUID(),alias:'',left:null,right:null,operator:'-',mode:config.groups.length||config.values.length?'totals':'row',leftAggregate:'sum',rightAggregate:'sum',filter:{},sort:'',editing:true});});
    $('qb-calculations').scrollIntoView({block:'nearest'});
    $('qb-calculations').lastElementChild?.querySelector('input')?.focus();
  }
  function operandControl(v,side){
    const title=side==='left'?'Left':'Right',f=v[side];
    const options=[['','Choose column…'],['number','Number…'],...config.tables.flatMap(t=>(catalog().find(s=>s.name===t.name)?.columns||[]).map(c=>[JSON.stringify({table:t.id,column:c.name}),t.name+'.'+c.name]))];
    const value=f?(Object.hasOwn(f,'number')?'number':JSON.stringify({table:f.table,column:f.column})):'';
    if(value&&!options.some(([key])=>key===value))options.push([value,'Missing field: '+label(f)]);
    const control=node('div',{class:'qb-operand','data-side':side,ondragover:accept,ondragleave:clearOver,ondrop:e=>{
      e.preventDefault();e.stopPropagation();clearOver(e);const data=read(e);
      if(data?.table&&data.column)change(()=>v[side]={table:data.table,column:data.column});
    }},node('small',{},title+' · drop a field'),select(options,value,key=>change(()=>v[side]=key==='number'?{number:''}:key?JSON.parse(key):null),title+' field or number'));
    if(f&&Object.hasOwn(f,'number'))control.append(input(f.number,title+' number',n=>change(()=>f.number=n,false),'number'));
    if(v.mode==='totals'&&f&&!Object.hasOwn(f,'number'))control.append(select(Object.entries(QueryBuilderSQL.aggregates).filter(([op])=>op!=='records'),v[side+'Aggregate']||'sum',op=>change(()=>v[side+'Aggregate']=op),title+' total function'));
    return control;
  }
  function calculationCard(v,index){
    const operandLabel=f=>!f?'…':Object.hasOwn(f,'number')?(f.number||'…'):label(f);
    const symbol={'+':'+','-':'−','*':'×','/':'÷'}[v.operator]||'?';
    const formula=(v.mode!=='row'?(QueryBuilderSQL.calculationModes[v.mode]+' · '):'')+operandLabel(v.left)+' '+symbol+' '+operandLabel(v.right);
    const card=node('details',{class:'qb-calculation',open:v.editing!==false?'':null},
      node('summary',{onclick:e=>{v.editing=!e.currentTarget.parentElement.open;persist();}},node('strong',{},v.alias?.trim()||'Calculated column '+(index+1)),node('small',{title:formula},formula)),
      node('div',{class:'qb-calculation-body'},input(v.alias,'Calculated column name',value=>change(()=>v.alias=value)),
        node('div',{class:'qb-formula'},operandControl(v,'left'),select(Object.entries(QueryBuilderSQL.mathOperators),v.operator,op=>change(()=>v.operator=op),'Arithmetic operation'),operandControl(v,'right')),
        select(Object.entries(QueryBuilderSQL.calculationModes),v.mode,mode=>change(()=>v.mode=mode),'Calculate'),
        node('small',{},v.mode==='totals'?'Summarize each field first, then do the math.':v.mode==='row'?'Calculate for each joined row.':'Do the math for each joined row, then summarize the results.'),
        node('details',{open:v.options?'':null},node('summary',{onclick:e=>{v.options=!e.currentTarget.parentElement.open;persist();}},'Filter & sort'),
          filterControls(v.filter||{},patch=>change(()=>v.filter={...v.filter,...patch}),true,'No calculation filter'),
          select([['','No calculation sort'],['asc','Ascending'],['desc','Descending']],v.sort||'',sort=>change(()=>v.sort=sort),'Calculation sort')),
        node('small',{},'Numeric math; missing or nonnumeric inputs stay NULL. Division by zero returns NULL.'),
        node('div',{class:'qb-calculation-actions'},button('↑',()=>{if(index>0)change(()=>{[config.calculations[index-1],config.calculations[index]]=[v,config.calculations[index-1]];});},'Move calculation earlier'),button('↓',()=>{if(index<config.calculations.length-1)change(()=>{[config.calculations[index+1],config.calculations[index]]=[v,config.calculations[index+1]];});},'Move calculation later'),button('Remove',()=>change(()=>config.calculations.splice(index,1)),'Remove calculated column'))));
    return card;
  }
  function renderZones(){
    $('qb-zones').replaceChildren(...Object.entries(zones).map(([zone,title])=>{
      const area=node('section',{id:'qb-'+zone,class:'qb-zone',ondragover:accept,ondragleave:clearOver,ondrop:e=>drop(e,zone)},node('h3',{},title,node('small',{},String(config[zone].length))));
      if(config[zone].length)area.append(...config[zone].map((f,i)=>chip(zone,f,i)));
      else area.append(node('p',{class:'qb-empty'},zone==='output'?(config.groups.length||config.values.length?'Grouped fields and aggregates form the output':'Drop columns here · empty selects all fields'):zone==='groups'?'Drop fields to group the results':zone==='values'?'Drop fields to summarize':'Drop fields here'));
      return area;
    }));
    if(config.calculations?.length)$('qb-zones').prepend(node('section',{id:'qb-calculations',class:'qb-zone'},node('h3',{},'Calculated columns',node('small',{},String(config.calculations.length))),...config.calculations.map(calculationCard)));
  }
  function fieldRow(t,col){
    const f={table:t.id,column:col.name};
    const row=node('div',{class:'qb-field',draggable:'true','data-table':t.id,'data-column':col.name,ondragstart:e=>drag(e,f),ondragover:accept,ondragleave:clearOver,ondrop:e=>{e.preventDefault();e.stopPropagation();clearOver(e);const a=read(e);if(a&&!a.zone)connect(a,f);}},
      button('○',()=>{if(pending){connect(pending,f);pending=null;render();}else{pending=f;render();status('Click the connection circle on a field in another dataset.');}},'Connect '+label(f)),
      node('span',{class:'qb-field-name',title:col.name},col.name),node('small',{},col.type),
      button('+',()=>add($('qb-add-area').value,f),'Add '+label(f)+' to selected area'));
    if(pending?.table===t.id&&pending.column===col.name)row.classList.add('qb-pending');
    if(config.output.some(x=>x.table===f.table&&x.column===f.column)||config.groups.some(x=>x.table===f.table&&x.column===f.column))row.classList.add('qb-selected');
    return row;
  }
  function drawLines(){
    const svg=$('qb-lines'),world=$('qb-world');if(!svg||!world)return;svg.replaceChildren();
    const bounds=world.getBoundingClientRect();
    for(const j of config.joins){
      const find=f=>[...world.querySelectorAll('.qb-field')].find(el=>el.dataset.table===f.table&&el.dataset.column===f.column);
      const a=find(j.left)?.getBoundingClientRect(),b=find(j.right)?.getBoundingClientRect();if(!a||!b)continue;
      const x1=a.right-bounds.left,y1=a.top+a.height/2-bounds.top,x2=b.left-bounds.left,y2=b.top+b.height/2-bounds.top;
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',`M${x1},${y1} C${x1+60},${y1} ${x2-60},${y2} ${x2},${y2}`);svg.append(p);
    }
  }
  function renderCanvas(){
    const world=$('qb-world');world.replaceChildren();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='qb-lines';svg.setAttribute('aria-hidden','true');world.append(svg);
    world.style.width=Math.max(900,...config.tables.map(t=>t.x+290))+'px';world.style.height=Math.max(400,...config.tables.map(t=>t.y+340))+'px';
    if(!config.tables.length)world.append(node('p',{class:'qb-canvas-empty'},'Add datasets above, then drag between matching columns to join them.'));
    for(const t of config.tables){
      const schema=catalog().find(s=>s.name===t.name);
      const header=node('header',{tabindex:'0','aria-label':'Move '+t.name+' with arrow keys'},node('strong',{},t.name),node('small',{},t.id),button('×',()=>removeTable(t.id),'Remove dataset '+t.name));
      const card=node('article',{class:'qb-table','data-id':t.id},header,node('div',{class:'qb-fields',onscroll:drawLines},schema?schema.columns.map(c=>fieldRow(t,c)):node('p',{},'Dataset unavailable. Remove this card or restore the dataset.')));
      card.style.left=t.x+'px';card.style.top=t.y+'px';
      let origin;
      header.onpointerdown=e=>{if(e.target.closest('button'))return;origin={x:e.clientX,y:e.clientY,tx:t.x,ty:t.y,snapshot:snapshot()};header.setPointerCapture(e.pointerId);};
      header.onpointermove=e=>{if(!origin)return;t.x=Math.max(0,origin.tx+e.clientX-origin.x);t.y=Math.max(0,origin.ty+e.clientY-origin.y);card.style.left=t.x+'px';card.style.top=t.y+'px';drawLines();};
      header.onpointerup=e=>{if(!origin)return;history.push(origin.snapshot);future=[];origin=null;header.releasePointerCapture(e.pointerId);persist();renderCanvas();};
      header.onkeydown=e=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(!delta)return;e.preventDefault();change(()=>{t.x=Math.max(0,t.x+delta[0]);t.y=Math.max(0,t.y+delta[1]);});};
      world.append(card);
    }
    requestAnimationFrame(drawLines);
    $('qb-connections').replaceChildren(...config.joins.map((j,i)=>node('div',{class:'qb-connection'},node('span',{title:label(j.left)+' = '+label(j.right)},label(j.left)+' = '+label(j.right)),select([['LEFT','Keep all left rows'],['INNER','Matching rows only'],['FULL','Keep both sides']],j.type,v=>change(()=>{config.joins.filter(x=>x.right.table===j.right.table).forEach(x=>x.type=v);}),'Join type'),button('×',()=>change(()=>config.joins.splice(i,1)),'Remove connection '+(i+1)))));
  }
  function sql(){return QueryBuilderSQL.build(config,catalog());}
  function preview(){
    try{$('qb-sql').textContent=sql();status('');}
    catch(e){$('qb-sql').textContent='';status(e.message);}
    $('qb-undo').disabled=!history.length;$('qb-redo').disabled=!future.length;
  }
  function render(){
    $('qb-distinct').checked=config.distinct;$('qb-match').value=config.match;$('qb-limit').value=config.limit;
    renderZones();renderCanvas();preview();
  }
  function enter(){
    workArea();
    before={sidebar:document.body.classList.contains('sidebar-collapsed'),focus:focusView,editor:$('work-area').style.getPropertyValue('--editor-share'),results:$('work-area').style.getPropertyValue('--result-share')};
    document.body.classList.add('sidebar-collapsed','query-builder-active');$('toggle-sidebar').setAttribute('aria-label','Expand sidebar');focusPanel('');
    $('work-area').style.setProperty('--editor-share','1fr');$('work-area').style.setProperty('--result-share','260px');
    key=draftKey('query-builder:'+state.activeTab);history=[];future=[];pending=null;
    try{config=JSON.parse(localStorage.getItem(key))||empty();}catch{config=empty();}
    if(!Array.isArray(config.tables)||!Array.isArray(config.values))config=empty();
    config.limit=normalizeLimit(config.limit);
    const chooser=select([['','+ Add dataset…'],...catalog().map(s=>[s.name,s.name])],'',name=>{addTable(name);chooser.value='';},'Add dataset');chooser.id='qb-dataset';
    const addArea=select(Object.entries(zones),'output',()=>{},'Click + adds field to');addArea.id='qb-add-area';
    const distinct=node('input',{id:'qb-distinct',type:'checkbox',onchange:e=>change(()=>config.distinct=e.target.checked,false)});distinct.checked=config.distinct;
    const match=select([['all','All (AND)'],['any','Any (OR)']],config.match,v=>change(()=>config.match=v,false),'Filter combination');match.id='qb-match';
    const limit=input(config.limit,'Row limit (optional)',v=>{const normalized=normalizeLimit(v);limit.value=normalized;if(config.limit!==normalized)change(()=>config.limit=normalized,false);},'number');limit.id='qb-limit';
    limit.min='0';limit.max='1000000000';limit.step='1';
    limit.addEventListener('keydown',e=>{
      if(['-','+','e','E','.'].includes(e.key)||(e.key==='ArrowDown'&&Number(limit.value)<=0))e.preventDefault();
    });
    limit.addEventListener('beforeinput',e=>{if(e.data&&/[^0-9]/.test(e.data))e.preventDefault();});
    limit.addEventListener('input',()=>{
      const normalized=normalizeLimit(limit.value);limit.value=normalized;
      if(config.limit!==normalized)change(()=>config.limit=normalized,false);
    });
    $('query-builder-pane').replaceChildren(
      node('div',{class:'qb-toolbar'},chooser,node('label',{},'+ adds to ',addArea),button('Count rows',()=>add('values',{op:'records'})),button('+ Calculated column',addCalculation),
        node('label',{},distinct,' Distinct output'),node('label',{},'Filters match ',match),limit,node('div',{id:'qb-connections'}),
        Object.assign(button('↶',()=>undo(),'Undo'),{id:'qb-undo'}),Object.assign(button('↷',()=>undo(true),'Redo'),{id:'qb-redo'}),
        button('Open SQL',openSQL),button('Reset',()=>change(()=>config=empty()))),
      node('p',{id:'qb-status',role:'status',class:'hidden'}),
      node('div',{class:'qb-workspace'},node('div',{class:'qb-canvas-section'},node('div',{id:'qb-canvas',class:'qb-canvas'},node('div',{id:'qb-world'}))),node('div',{id:'qb-zones'})),
      node('pre',{id:'qb-sql',class:'hidden'}));
    if(!config.tables.length&&state.selected&&catalog().some(s=>s.name===state.selected))addTable(state.selected);else render();
  }
  function leave(){persist();pending=null;document.body.classList.remove('query-builder-active');if(before){document.body.classList.toggle('sidebar-collapsed',before.sidebar);$('toggle-sidebar').setAttribute('aria-label',before.sidebar?'Expand sidebar':'Collapse sidebar');$('work-area').style.setProperty('--editor-share',before.editor);$('work-area').style.setProperty('--result-share',before.results);focusPanel(before.focus);before=null;}}
  async function run(){if(state.busy)return;const query=sql();state.groups=[];state.groupDataset=null;state.groupBase='';state.sort=null;await runSQL(query);status('');}
  function openSQL(){const query=sql();setEditor(query);setMode('sql');}
  window.addEventListener('resize',drawLines);
  return {enter,leave,sql,run,openSQL};
})();
