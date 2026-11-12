'use strict';
// The result grid, job cancellation, paging, charting and export remain shared.
window.bedazzlePivot = (() => {
  let config, saved=[], last=null, timer=null, revision=0, running=false, initialized=false, sidebarBefore=null;
  let checkpoint='', undoStack=[], redoStack=[], dragged=null, connection=null, connectionVersion=0, pending=false;
  const empty = dataset => ({version:2,dataset:dataset||'',links:[],rows:[],columns:[],values:[],filters:[],sorts:[],collapsed:[],rowTotals:true,columnTotals:true,subtotals:true,order:'asc',decimals:2,live:true});
  function migrate(value){const legacy=!value.version,result={...empty(value.dataset),...value,version:2};if(legacy)result.values=result.values.map(m=>['sum','avg'].includes(m.op)?{...m,numeric:true,numericIgnore:true}:m);return result;}
  const primary = () => state.data?.catalog.find(d=>d.name===config?.dataset);
  const columns = () => [...(primary()?.columns||[]).map(c=>({...c,dataset:config.dataset,original:c.name})),...(config?.links||[]).flatMap(l=>l.fields.map(f=>({...f,name:f.alias,original:f.name,dataset:l.dataset})))];
  const status = text => {$('pivot-status').textContent=text;$('pivot-status').title=text;const hint=$('pivot-feedback');if(hint)hint.textContent=/^(Pending changes|Updating…|Up to date|Waiting for the current operation…|)$/.test(text)?'':text;};
  const snapshot = () => JSON.stringify(config);
  function historyButtons(){if($('pivot-undo'))$('pivot-undo').disabled=!undoStack.length;if($('pivot-redo'))$('pivot-redo').disabled=!redoStack.length;}
  function remember(){const next=snapshot();if(checkpoint&&checkpoint!==next){undoStack.push(checkpoint);if(undoStack.length>50)undoStack.shift();redoStack=[];}checkpoint=next;historyButtons();}
  function restoreHistory(from,to){if(!from.length)return;to.push(snapshot());config=JSON.parse(from.pop());checkpoint=snapshot();revision++;pending=true;persist();render();status('Pending changes');schedule();}
  function schedule(){clearTimeout(timer);if(config.live&&config.values.length&&state.mode==='pivot'&&!$('pivot-connect-dialog')?.open)timer=setTimeout(()=>update().catch(e=>status(e.message)),650);}
  function persist(){localStorage.setItem(draftKey('pivot'),JSON.stringify({config,saved}));}
  function changed(structural=true){
    const available=new Set(columns().map(c=>c.name));
    config.sorts=(config.sorts||[]).filter(r=>config.rows.includes(r.level)&&(r.kind==='label'||r.op==='count'||available.has(r.field))&&(r.categoryFields||[]).every(f=>available.has(f)));
    remember();
    revision++;pending=true;persist();if(structural)render();
    historyButtons();
    status('Pending changes');
    schedule();
  }
  function select(options,current,onchange,label){
    const el=node('select',{'aria-label':label,onchange:e=>onchange(e.target.value)},options.map(([v,l])=>node('option',{value:v},l)));
    el.value=current;return el;
  }
  function button(text,action,label=text){return node('button',{type:'button',class:'pivot-small','aria-label':label,onclick:event=>{try{Promise.resolve(action(event)).catch(report);}catch(error){report(error);}}},text);}
  function eligible(field,zone){if(field==='*')return zone==='values'?'':'Records can only be placed in Values.';if(!columns().some(c=>c.name===field))return 'Connect this dataset before using its fields.';if(!['rows','columns','values','filters'].includes(zone))return 'Choose a pivot area.';return '';}
  function reject(target,message){status(message);if(target){target.classList.remove('pivot-reject');void target.offsetWidth;target.classList.add('pivot-reject');setTimeout(()=>target.classList.remove('pivot-reject'),450);}}
  function clearDrag(){dragged=null;document.querySelectorAll('.pivot-drop,.pivot-field-panel').forEach(e=>e.classList.remove('drop-valid','drop-invalid','drag-over','remove-ready'));$('pivot-remove-hint')?.classList.add('hidden');}
  function startDrag(event,data){event.stopPropagation();dragged=data;event.dataTransfer.setData('application/bedazzle-field',JSON.stringify(data));event.dataTransfer.effectAllowed=data.zone?'move':'copy';for(const zone of ['rows','columns','values','filters'])$('pivot-'+zone).classList.add(eligible(data.field,zone)?'drop-invalid':'drop-valid');if(data.zone){document.querySelector('.pivot-field-panel').classList.add('remove-ready');$('pivot-remove-hint').classList.remove('hidden');}}
  function add(field,zone,record=true){
    const reason=eligible(field,zone);if(reason){reject($('pivot-'+zone),reason);return false;}
    if(zone==='values')config.values.push({field,op:field==='*'?'count':PivotQuery.numeric(columns().find(c=>c.name===field)?.type)?'sum':'counted',label:'',percent:false});
    else if(zone==='filters')config.filters.push({field,op:'equals',value:''});
    else {if(config[zone].includes(field))return;if(config.rows.includes(field)||config.columns.includes(field)){config.rows=config.rows.filter(n=>n!==field);config.columns=config.columns.filter(n=>n!==field);}config[zone].push(field);}
    if(record)changed();return true;
  }
  function drop(event,zone,index=null){
    event.preventDefault();event.currentTarget.classList.remove('drag-over');
    let data;try{data=JSON.parse(event.dataTransfer.getData('application/bedazzle-field'));}catch{return;}
    const reason=eligible(data.field,zone);clearDrag();if(reason){reject(event.currentTarget,reason);return;}
    if(!data.zone){add(data.field,zone);return;}
    if(data.zone!==zone){
      const item=config[data.zone][data.index],field=typeof item==='string'?item:item?.field;
      if(!field)return;
      if(config[zone].includes(field)){reject(event.currentTarget,'This field is already in '+zone+'.');return;}
      config[data.zone].splice(data.index,1);add(field,zone,false);changed();return;
    }
    const items=config[zone],item=items.splice(data.index,1)[0];items.splice(index===null?items.length:index,0,item);changed();
  }
  function removeDrop(event){event.preventDefault();let data;try{data=JSON.parse(event.dataTransfer.getData('application/bedazzle-field'));}catch{return;}clearDrag();if(!data.zone||!config[data.zone]?.[data.index])return;config[data.zone].splice(data.index,1);changed();status('Removed from pivot · Undo to restore');}
  function move(zone,index,delta){const items=config[zone],to=index+delta;if(to<0||to>=items.length)return;[items[index],items[to]]=[items[to],items[index]];changed();}
  function itemCard(zone,item,index){
    const field=typeof item==='string'?item:item.field;
    const card=node('div',{class:'pivot-chip',draggable:'true',ondragstart:e=>startDrag(e,{zone,index,field}),ondragend:clearDrag,ondragover:e=>{e.preventDefault();e.stopPropagation();},ondrop:e=>{e.stopPropagation();drop(e,zone,index);}},
      node('div',{class:'pivot-chip-head',draggable:'true',title:'Drag to move; drag back to Your fields to remove',ondragstart:e=>startDrag(e,{zone,index,field}),ondragend:clearDrag},node('strong',{},field==='*'?'Records':field),
        button('↑',()=>move(zone,index,-1),'Move '+field+' earlier'),button('↓',()=>move(zone,index,1),'Move '+field+' later'),
        button('×',()=>{config[zone].splice(index,1);changed();},'Remove '+field+' from '+zone)));
    if(zone==='values'){
      const meta=columns().find(c=>c.name===field),isNumber=PivotQuery.numeric(meta?.type)||item.numeric;
      const aggregate=select(Object.entries(PivotQuery.aggregates).filter(([op])=>field!=='*'||op==='count'),item.op,v=>{if(['sum','avg'].includes(v)&&!isNumber)return reject(card,'Check this text field as numbers first.');item.op=v;if(!['sum','count','counted','distinct'].includes(v))item.percent=false;changed();},'Summarize '+field);
      for(const option of aggregate.options)if(['sum','avg'].includes(option.value)&&!isNumber){option.disabled=true;option.textContent+=' · check numeric values first';option.title='Text fields support counts. Use Check as numbers in the field options to enable numeric calculations.';}
      aggregate.title=isNumber?'Choose how to summarize this field.':'Sum and Average are unavailable for text. Open field options to check numeric values.';card.append(aggregate);
      const check=node('input',{type:'checkbox',onchange:e=>{item.percent=e.target.checked;changed(false);}});check.checked=!!item.percent;check.disabled=!['sum','count','counted','distinct'].includes(item.op);
      card.append(node('details',{class:'pivot-measure-options'},node('summary',{'aria-label':'Options for '+field},'⋯'),node('div',{class:'pivot-measure-popup'},node('input',{value:item.label||'',placeholder:'Custom heading','aria-label':'Heading for '+field,oninput:e=>{item.label=e.target.value;changed(false);}}),node('label',{class:'pivot-check'},check,'% of grand total'),field!=='*'&&!PivotQuery.numeric(meta?.type)?button(item.numeric?'Recheck numbers':'Check as numbers',()=>checkNumeric(item).catch(report)):null)));
      if(meta?.dataset!==config.dataset&&config.links?.find(l=>l.dataset===meta?.dataset)?.stats?.left_duplicate_keys)card.append(node('span',{class:'pivot-value-warning',title:'This related value is repeated for each matching primary record. Sum and Average summarize those joined records.'},'⚠ Per '+config.dataset+' row'));
    }
    if(zone==='filters')card.append(select([['equals','Equals'],['not','Does not equal'],['contains','Contains'],['gt','Greater than'],['gte','At least'],['lt','Less than'],['lte','At most'],['null','Is NULL'],['notnull','Is not NULL']],item.op,v=>{item.op=v;changed();},'Condition for '+field),
      node('input',{value:item.value,placeholder:'Filter value','aria-label':'Filter value for '+field,...(['null','notnull'].includes(item.op)?{disabled:''}:{}),oninput:e=>{item.value=e.target.value;changed(false);}}));
    return card;
  }
  function fields(){
    const query=$('pivot-search').value.toLowerCase();
    const linked=columns(),links=config.links||[];
    const ordered=[...state.data.catalog].sort((a,b)=>{
      const rank=d=>d.name===config.dataset?0:links.some(l=>l.dataset===d.name)?1:2;return rank(a)-rank(b)||a.name.localeCompare(b.name);
    });
    const groups=ordered.map(dataset=>{
      const connected=dataset.name===config.dataset||links.some(l=>l.dataset===dataset.name);
      const available=connected?linked.filter(c=>c.dataset===dataset.name):dataset.columns.map(c=>({...c,dataset:dataset.name,original:c.name}));
      const matches=available.filter(c=>(c.original+' '+dataset.name).toLowerCase().includes(query));
      if(!matches.length)return null;
      const body=node('div',{},matches.map(c=>{
        const isKey=(dataset.name===config.dataset?links.flatMap(l=>l.keys.map(k=>k.left)):links.find(l=>l.dataset===dataset.name)?.keys.map(k=>k.right)||[]).includes(c.original);
        const zone=PivotQuery.numeric(c.type)&&!/(^|[_\s])(id|number|code)$|id$/i.test(c.original)?'values':'rows';
        const field=node('button',{class:'pivot-field'+(connected?'':' unavailable'),'data-field':c.name,'data-source':dataset.name,draggable:String(connected),'aria-disabled':String(!connected),title:connected?'Click to add to '+zone+'; drag or use the area menu.':'Connect '+dataset.name+' to unlock these fields.',onclick:()=>connected?add(c.name,zone):reject(field,'Connect '+dataset.name+' first.'),ondragstart:e=>{if(!connected){e.preventDefault();return;}startDrag(e,{field:c.name});},ondragend:clearDrag},
          node('span',{class:'pivot-field-icon','aria-hidden':'true'},isKey?'↔':PivotQuery.numeric(c.type)?'#':'Aa'),node('span',{},c.original),node('small',{},connected?'+':'🔒'));
        return node('div',{class:'pivot-field-row'},field,connected?node('details',{class:'pivot-field-menu'},node('summary',{'aria-label':'Choose area for '+c.name,title:'Choose pivot area'},'⋯'),node('div',{},['rows','columns','values','filters'].map(z=>button(z[0].toUpperCase()+z.slice(1),()=>add(c.name,z),'Add '+c.name+' to '+z)))):null);
      }));
      const section=node('details',{class:'pivot-source-group'+(connected?'':' unconnected')},node('summary',{},node('strong',{},dataset.name),node('small',{},dataset.name===config.dataset?'Main':connected?'Connected':'Not connected')),body);
      section.open=connected||!!query;
      if(dataset.name!==config.dataset&&!connected)body.prepend(button('Connect dataset',()=>openConnection(dataset.name),'Connect '+dataset.name));
      return section;
    }).filter(Boolean);
    $('pivot-fields').replaceChildren(...groups);
    if(!groups.length)$('pivot-fields').append(node('p',{class:'form-hint'},'No matching fields.'));
    if($('pivot-connections'))$('pivot-connections').replaceChildren(...links.map(l=>node('div',{class:'pivot-connection-tag'},button('↔ '+l.dataset,()=>openConnection(l.dataset),'Edit connection to '+l.dataset),button('×',()=>removeConnection(l.dataset),'Disconnect '+l.dataset))));
  }
  function statsFrom(result){return Object.fromEntries(result.columns.map((c,i)=>[c.name,Number(result.rows[0][i])]));}
  function validateKeys(target,keys){
    const right=state.data.catalog.find(d=>d.name===target);
    if(!right||target===config.dataset)throw Error('Choose another dataset to connect.');
    if(!keys.length)throw Error('Choose matching fields.');
    const unique=new Set();
    for(const key of keys){
      const a=primary()?.columns.find(c=>c.name===key.left),b=right.columns.find(c=>c.name===key.right);
      if(!a||!b)throw Error('Choose an available field on each side.');
      if(!PivotQuery.keyEligible(a.type)||!PivotQuery.keyEligible(b.type))throw Error('Keys must be scalar fields: text, numbers, dates or booleans.');
      const pair=JSON.stringify([key.left,key.right]);if(unique.has(pair))throw Error('This matching pair is already selected.');unique.add(pair);
    }
  }
  async function fullCheck(target,keys){validateKeys(target,keys);return statsFrom(await runJob('query',{sql:PivotQuery.relationshipSQL(config.dataset,target,keys),size:1}));}
  function connectionChanged(){connection.stats=null;connectionVersion++;renderConnection();}
  function openConnection(target){
    if(!config.dataset)return status('Open a dataset first.');
    const candidates=state.data.catalog.filter(d=>d.name!==config.dataset);
    if(!candidates.length)return status('Open a second dataset first.');
    clearTimeout(timer);
    target=target||candidates.find(d=>!config.links?.some(l=>l.dataset===d.name))?.name||candidates[0].name;
    const old=config.links?.find(l=>l.dataset===target),left=primary(),right=state.data.catalog.find(d=>d.name===target);
    const pair=PivotQuery.suggestionPairs(left,right)[0];
    connection=old?{...JSON.parse(JSON.stringify(old)),stats:null}:{dataset:target,keys:[{left:pair?.left||'',right:pair?.right||'',clean:'exact'}],mode:'left'};
    connectionVersion++;renderConnection();$('pivot-connect-dialog').showModal();
  }
  function connectionMessage(text,error=false){$('pivot-connect-message').textContent=text;$('pivot-connect-message').classList.toggle('error',error);}
  async function checkConnection(){
    const version=connectionVersion;connectionMessage('Checking every record…');
    try{const stats=await fullCheck(connection.dataset,connection.keys);if(version!==connectionVersion)return;connection.stats=stats;renderConnection();}catch(e){connectionMessage(e.message,true);}
  }
  async function suggestConnections(){
    const version=connectionVersion,left=primary(),right=state.data.catalog.find(d=>d.name===connection.dataset),pairs=PivotQuery.suggestionPairs(left,right);
    connectionMessage('Comparing samples…');
    try{
      const result=await runJob('query',{sql:PivotQuery.suggestionSQL(left.name,right.name,pairs),size:20});
      if(version!==connectionVersion)return;
      const ranked=result.rows.map(([i,matches])=>({...pairs[Number(i)],matches:Number(matches)})).filter(p=>p.matches>0).sort((a,b)=>b.matches-a.matches||b.score-a.score).slice(0,4);
      $('pivot-key-suggestions').replaceChildren(node('p',{class:'form-hint'},'Possible matches from at most 200 rows per dataset. Choose one, then check the full datasets.'),...ranked.map(p=>button(`${p.left} ↔ ${p.right} · ${p.matches} shared sample values`,()=>{connection.keys=[{left:p.left,right:p.right,clean:'exact'}];connectionChanged();})));
      connectionMessage(ranked.length?'Suggestions are hints, not confirmed relationships.':'No overlapping values in these samples. Select fields manually.');
    }catch(e){connectionMessage(e.message,true);}
  }
  function renderConnection(){
    const body=$('pivot-connect-body'),right=state.data.catalog.find(d=>d.name===connection.dataset);
    const keySelect=(schema,value,update,label)=>{
      const control=select([['','Choose field…'],...schema.columns.map(c=>[c.name,c.name+' · '+c.type])],value,v=>{update(v);connectionChanged();},label);
      for(const option of control.options){const column=schema.columns.find(c=>c.name===option.value);if(column&&!PivotQuery.keyEligible(column.type)){option.disabled=true;option.textContent+=' · cannot be a key';option.title='Nested and binary fields cannot be used as matching keys.';}}
      return control;
    };
    body.replaceChildren(
      node('div',{class:'pivot-join-head'},node('strong',{},config.dataset),node('span',{'aria-hidden':'true'},'↔'),select(state.data.catalog.filter(d=>d.name!==config.dataset).map(d=>[d.name,d.name]),connection.dataset,v=>{connection={dataset:v,keys:[{left:'',right:'',clean:'exact'}],mode:'left'};connectionChanged();},'Dataset to connect')),
      node('div',{id:'pivot-key-pairs'},connection.keys.map((key,i)=>node('div',{class:'pivot-key-pair'},
        keySelect(primary(),key.left,v=>key.left=v,'Main matching field '+(i+1)),node('span',{'aria-hidden':'true'},'↔'),keySelect(right,key.right,v=>key.right=v,'Related matching field '+(i+1)),
        select([['exact','Exact text'],['trim','Trim spaces'],['fold','Trim + ignore case']],key.clean||'exact',v=>{key.clean=v;connectionChanged();},'Comparison '+(i+1)),button('×',()=>{connection.keys.splice(i,1);connectionChanged();},'Remove matching pair '+(i+1))))),
      node('div',{class:'pivot-connect-tools'},button('+ Matching field',()=>{connection.keys.push({left:'',right:'',clean:'exact'});connectionChanged();}),button('Suggest matches',()=>suggestConnections()),button('Check connection',()=>checkConnection())),
      node('div',{id:'pivot-key-suggestions'}),
      node('label',{},'Records to keep',select([['left','Left join · all '+config.dataset+' records'],['inner','Inner join · only records that match']],connection.mode||'left',v=>{connection.mode=v;connectionVersion++;renderConnection();},'Records to keep')),
      node('p',{class:'pivot-join-explanation'},connection.mode==='inner'?`Keeps only ${config.dataset} records with a match in ${connection.dataset}. Unmatched records from either side are excluded.`:`Keeps every ${config.dataset} record, including those without a match. Unmatched related fields appear as NULL. Records found only in ${connection.dataset} are excluded.`),
      node('p',{class:'form-hint'},'Keys match as text, preserving leading zeros. NULL and empty keys do not match. Trimming and case changes apply only to this connection. All selected pairs must match.'),
      node('div',{id:'pivot-relationship-result'}),node('p',{id:'pivot-connect-message',role:'status','aria-live':'polite'}));
    const result=$('pivot-relationship-result'),s=connection.stats;
    if(s){
      const duplicates=s.right_duplicate_keys>0,both=duplicates&&s.left_duplicate_keys>0,unmatched=s.left_rows-s.matched_left;
      const title=duplicates?(both?'Repeats on both sides':'One main record → many related records'):s.left_duplicate_keys?'Many main records → one related record':'One record → one record';
      result.className='pivot-relationship-result '+(duplicates?'warning':'checked');
      result.append(node('strong',{},(duplicates?'⚠ ':'✓ ')+title),node('p',{},`Full check: ${s.left_rows.toLocaleString()} main records · ${s.right_rows.toLocaleString()} related records. ${s.matched_left.toLocaleString()} main records match (${s.left_rows?(100*s.matched_left/s.left_rows).toFixed(1):'0'}%).`),
        node('p',{},`${s.left_duplicate_keys.toLocaleString()} repeated main keys · ${s.right_duplicate_keys.toLocaleString()} repeated related keys · ${s.left_nulls.toLocaleString()} / ${s.right_nulls.toLocaleString()} records with missing keys.`));
      if(duplicates){
        result.append(node('p',{},both?'Connecting these keys would multiply records and could inflate totals. Add a matching field so the related dataset has a unique key.':'The related keys repeat. Start with that dataset to keep one row per record, then connect this unique lookup. This resets the current pivot; Undo restores it.'));
        if(!both)result.append(button('Start with '+connection.dataset,()=>{const old=config.dataset,newMain=connection.dataset,keys=connection.keys.map(k=>({left:k.right,right:k.left,clean:k.clean}));config=empty(newMain);last=null;changed();$('pivot-connect-dialog').close();openConnection(old);connection.keys=keys;renderConnection();},'Make '+connection.dataset+' the main dataset'));
      }else if(s.left_duplicate_keys)result.append(node('p',{class:'pivot-value-warning'},'Related values repeat for each matching main record. Measures summarize the joined main records.'));
      if(unmatched||s.right_rows-s.matched_right){
        result.append(node('p',{},`${unmatched.toLocaleString()} main records and ${(s.right_rows-s.matched_right).toLocaleString()} related records do not match.`),button('Inspect unmatched main keys',()=>inspectUnmatched('left')),button('Inspect unmatched related keys',()=>inspectUnmatched('right')));
      }
      result.append(node('p',{class:'pivot-join-coverage'},connection.mode==='inner'?`Before pivot filters: this connection keeps ${s.matched_left.toLocaleString()} main records and excludes ${unmatched.toLocaleString()} unmatched main records.`:`Before pivot filters: this connection keeps all ${s.left_rows.toLocaleString()} main records; ${unmatched.toLocaleString()} have no matching related record.`));
      if(!s.matched_left&&s.left_rows>0){const check=node('input',{type:'checkbox',onchange:e=>{connection.allowNoMatch=e.target.checked;renderConnection();}});check.checked=!!connection.allowNoMatch;result.append(node('label',{class:'pivot-check'},check,'Keep this connection despite no matches'));}
    }
    const allowed=s&&!s.right_duplicate_keys&&(s.matched_left>0||!s.left_rows||connection.allowNoMatch);
    $('pivot-connect-apply').disabled=!allowed;
  }
  async function inspectUnmatched(side){
    const version=connectionVersion,result=await runJob('query',{sql:PivotQuery.unmatchedSQL(config.dataset,connection.dataset,connection.keys,side),size:20});
    if(version!==connectionVersion)return;
    result.columns=result.columns.map((column,i)=>({...column,name:connection.keys[i][side==='left'?'left':'right']}));
    const box=$('pivot-key-suggestions');box.replaceChildren(node('p',{},`First ${result.rows.length} unmatched key combinations. NULL keys never match.`),tableFor(result));
  }
  function applyConnection(){
    if($('pivot-connect-apply').disabled)return;
    const existing=config.links?.find(l=>l.dataset===connection.dataset);
    const used=new Set([...(primary()?.columns||[]).map(c=>c.name.toLowerCase()),...(config.links||[]).filter(l=>l.dataset!==connection.dataset).flatMap(l=>l.fields.map(f=>f.alias.toLowerCase()))]);
    const schema=state.data.catalog.find(d=>d.name===connection.dataset);
    const fields=PivotQuery.linkFields(schema,used);
    if(existing){
      const mapping=new Map(existing.fields.map(f=>[f.alias,fields.find(n=>n.name===f.name)?.alias]));
      for(const z of ['rows','columns'])config[z]=config[z].map(f=>mapping.has(f)?mapping.get(f):f).filter(Boolean);
      for(const z of ['values','filters'])config[z]=config[z].filter(m=>!mapping.has(m.field)||mapping.get(m.field)).map(m=>({...m,field:mapping.has(m.field)?mapping.get(m.field):m.field}));
      config.collapsed=[];
    }
    const link={...JSON.parse(JSON.stringify(connection)),fields};
    config.links=(config.links||[]).filter(l=>l.dataset!==link.dataset);config.links.push(link);last=null;changed();$('pivot-connect-dialog').close();
  }
  function removeConnection(dataset){
    const aliases=new Set(config.links.find(l=>l.dataset===dataset).fields.map(f=>f.alias));
    config.links=config.links.filter(l=>l.dataset!==dataset);for(const z of ['rows','columns'])config[z]=config[z].filter(f=>!aliases.has(f));for(const z of ['values','filters'])config[z]=config[z].filter(f=>!aliases.has(f.field));config.collapsed=[];last=null;changed();
  }
  async function checkNumeric(item){
    const field=columns().find(c=>c.name===item.field);if(!field)return;
    const sql=`SELECT count(${sqlName(field.original)}) AS present,count(TRY_CAST(${sqlName(field.original)} AS DOUBLE)) AS numeric FROM ${sqlName(field.dataset)}`;
    const result=await runJob('query',{sql,size:1}),[present,valid]=result.rows[0].map(Number),invalid=present-valid;
    if(!config.values.includes(item))return;
    if(!valid){status('This field has no numeric values. Use Count, Minimum or Maximum.');return;}
    const apply=()=>{item.numeric=true;item.numericIgnore=invalid>0;if(!['sum','avg'].includes(item.op))item.op='sum';changed();};
    if(!invalid){apply();return;}
    $('detail-title').textContent='Use numeric values?';$('detail-eyebrow').textContent=item.field;
    $('detail-content').replaceChildren(node('p',{},`${valid.toLocaleString()} values convert to numbers. ${invalid.toLocaleString()} nonnumeric values would be ignored. Source values are unchanged.`),node('button',{class:'button primary',onclick:()=>{apply();$('detail-dialog').close();}},'Use numbers and ignore nonnumeric values'));
    $('detail-dialog').showModal();
  }
  function addSort(){
    if(!config.rows.length)return status('Add a field to Rows before defining sort rules.');
    const level=config.rows.find(f=>!(config.sorts||[]).some(r=>r.level===f))||config.rows.at(-1);
    config.sorts||=[];config.sorts.push({level,kind:'label',direction:config.order||'asc',numeric:false});$('pivot-sorts').open=true;changed();
  }
  function renderSorts(){
    const rules=config.sorts||[],metadata=columns(),list=$('pivot-sort-list');
    $('pivot-sort-count').textContent=rules.length?` · ${rules.length}`:'';
    const measureLabel=m=>(m.label?.trim()||PivotQuery.aggregates[m.op]+(m.op==='count'?'':' of '+m.field))+(m.percent?' (%)':'');
    list.replaceChildren(...rules.map((rule,i)=>{
      const choices=[['label','Row label'],...config.values.map((m,j)=>['value:'+j,measureLabel(m)+' · all columns']),...metadata.map(c=>['field:'+c.name,'Field: '+c.name])];
      const valueIndex=config.values.findIndex(m=>m.field===rule.field&&m.op===rule.op&&!!m.percent===!!rule.percent);
      let selected=rule.kind==='label'?'label':rule.kind==='field'?'field:'+rule.field:valueIndex>=0&&!rule.categoryFields?.length?'value:'+valueIndex:'saved';
      if(selected==='saved')choices.push(['saved',measureLabel(rule)+' · '+(rule.category?.map(v=>v??'(NULL)').join(' / ')||'all columns')]);
      const field=metadata.find(c=>c.name===(rule.kind==='label'?rule.level:rule.field)),nativeNumber=PivotQuery.numeric(field?.type);
      const number=!!rule.numeric||nativeNumber||(rule.kind!=='label'&&['sum','avg','count','counted','distinct'].includes(rule.op));
      const row=node('div',{class:'pivot-sort-rule'},node('span',{class:'pivot-sort-priority'},i+1),
        node('label',{},'Group',select(config.rows.map(f=>[f,f]),rule.level,v=>{rule.level=v;changed();},'Group for sort '+(i+1))),
        node('label',{class:'pivot-sort-by'},'By',select(choices,selected,v=>{
          delete rule.categoryFields;delete rule.category;
          if(v==='label'){rule.kind='label';rule.numeric=false;delete rule.field;delete rule.op;delete rule.percent;}
          else if(v.startsWith('field:')){rule.kind='field';rule.field=v.slice(6);rule.op='max';rule.numeric=false;rule.percent=false;}
          else if(v.startsWith('value:')){const m=config.values[Number(v.slice(6))];Object.assign(rule,{kind:'value',field:m.field,op:m.op,numeric:['sum','avg'].includes(m.op)&&!!m.numeric,percent:!!m.percent,label:m.label});}
          changed();
        },'Sort by '+(i+1))));
      if(rule.kind==='field'){
        const aggregate=select(Object.entries(PivotQuery.aggregates),rule.op,v=>{rule.op=v;changed();},'Calculation for sort '+(i+1));
        for(const option of aggregate.options)if(['sum','avg'].includes(option.value)&&!nativeNumber&&!rule.numeric){option.disabled=true;option.textContent+=' · select Number first';}
        row.append(aggregate);
      }
      if(!nativeNumber&&rule.kind!=='value'&&(rule.kind==='label'||!['count','counted','distinct'].includes(rule.op))){
        const check=node('input',{type:'checkbox','aria-label':'Compare sort '+(i+1)+' as numbers',onchange:e=>{rule.numeric=e.target.checked;if(!rule.numeric&&['sum','avg'].includes(rule.op))rule.op='max';changed();}});check.checked=!!rule.numeric;
        row.append(node('label',{class:'pivot-check',title:'Compare numeric values; nonnumeric values sort last. Source values stay unchanged.'},check,'Number'));
      }
      row.append(select([['asc',number?'Low → high':'A → Z'],['desc',number?'High → low':'Z → A']],rule.direction,v=>{rule.direction=v;changed();},'Direction for sort '+(i+1)),
        button('↑',()=>move('sorts',i,-1),'Move sort '+(i+1)+' earlier'),button('↓',()=>move('sorts',i,1),'Move sort '+(i+1)+' later'),button('×',()=>{config.sorts.splice(i,1);changed();},'Remove sort '+(i+1)));
      return row;
    }));
    if(!rules.length)list.append(node('span',{class:'pivot-sort-empty'},'Row labels follow the row hierarchy. Add rules to customize the order.'));
    list.append(button('+ Sort',addSort,'Add sort rule'));
  }
  async function sortResult(column){
    if(!applies())return status('Update the pivot before sorting these results.');
    if(!config.rows.length)return status('Add a row group before defining sort rules.');
    const cell=last.cells.find(c=>c.name===column);
    if(!config.rows.includes(column)&&!cell)return;
    const rule=cell?{level:config.rows.at(-1),kind:'value',field:cell.measure.field,op:cell.measure.op,label:cell.measure.label,percent:!!cell.measure.percent,numeric:['sum','avg'].includes(cell.measure.op)&&!!cell.measure.numeric,category:cell.category,categoryFields:cell.category?cell.categoryFields:[]}:{level:column,kind:'label',numeric:false};
    const key=r=>JSON.stringify([r.level,r.kind,r.field,r.op,!!r.percent,r.category??null,r.categoryFields||[]]);
    const old=(config.sorts||[]).find(r=>key(r)===key(rule));rule.direction=old?.direction==='asc'?'desc':'asc';if(old)rule.numeric=old.numeric;
    config.sorts=(config.sorts||[]).filter(r=>r!==old);const first=config.sorts.findIndex(r=>r.level===rule.level);config.sorts.splice(first<0?config.sorts.length:first,0,rule);
    $('pivot-sorts').open=true;changed();await update();
  }
  function render(){
    if(state.mode==='pivot'&&state.data.catalog.some(d=>d.name===config.dataset)){state.selected=config.dataset;renderCatalog();datasetHeading(config.dataset);}
    $('pivot-dataset').replaceChildren(...state.data.catalog.map(d=>node('option',{value:d.name},d.name)));$('pivot-dataset').value=config.dataset;
    for(const zone of ['rows','columns','values','filters']){
      const area=$('pivot-'+zone);area.replaceChildren(...config[zone].map((item,i)=>itemCard(zone,item,i)));
      if(!config[zone].length)area.append(node('p',{class:'pivot-drop-hint'},({rows:'Group records here',columns:'Spread categories across columns',values:'Add fields to summarize',filters:'Keep only matching records'})[zone]));
    }
    for(const key of ['rowTotals','columnTotals','subtotals','live'])$('pivot-'+key).checked=config[key];
    $('pivot-decimals').value=config.decimals;
    $('pivot-layouts').replaceChildren(node('option',{value:''},'Saved layouts…'),...saved.map((s,i)=>node('option',{value:i},s.name)));
    fields();
    renderSorts();
    historyButtons();
  }
  function setup(){
    if(initialized)return;initialized=true;
    config=empty(state.selected);
    try{const data=JSON.parse(localStorage.getItem(draftKey('pivot'))||'null');if(data){if(data.config)config=migrate(data.config);saved=data.saved||[];}}catch{}
    if(!state.data.catalog.some(d=>d.name===config.dataset))config=empty(state.selected);
    checkpoint=snapshot();
    const pane=$('pivot-pane');
    const fieldPanel=node('aside',{class:'pivot-field-panel','aria-label':'Pivot fields',ondragover:e=>{if(dragged?.zone){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('drag-over');}},ondragleave:e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.classList.remove('drag-over');},ondrop:removeDrop},
      node('strong',{},'Your fields'),
      node('label',{},'Dataset',node('select',{id:'pivot-dataset',onchange:e=>{config=empty(e.target.value);last=null;changed();}})),
      button('+ Add dataset',()=>openConnection(),'Add dataset'),node('div',{id:'pivot-connections'}),
      node('input',{id:'pivot-search',type:'search',placeholder:'Find a field…','aria-label':'Find a pivot field',oninput:fields}),
      node('div',{id:'pivot-remove-hint',class:'hidden'},'Drop here to remove from pivot'),
      node('p',{id:'pivot-feedback',role:'status','aria-live':'polite'}),
      node('div',{id:'pivot-fields'}),button('+ Count records',()=>{config.values.push({field:'*',op:'count',label:'',percent:false});changed();}));
    $('work-area').prepend(fieldPanel);
    pane.append(
      node('div',{class:'pivot-top'},
        node('select',{id:'pivot-layouts','aria-label':'Saved pivot layouts',onchange:e=>{if(e.target.value==='')return;const entry=saved[Number(e.target.value)];if(!state.data.catalog.some(d=>d.name===entry.config.dataset)){status('Dataset unavailable');return;}config=migrate(JSON.parse(JSON.stringify(entry.config)));last=null;changed();}}),
        button('Save',openSave,'Save layout'),button('Manage',manage,'Manage layouts'),button('Reset',()=>{config=empty(config.dataset);last=null;changed();}),
        node('button',{id:'pivot-undo',class:'pivot-small',title:'Undo pivot change (Ctrl+Z)','aria-label':'Undo pivot change',onclick:()=>restoreHistory(undoStack,redoStack)},'↶'),
        node('button',{id:'pivot-redo',class:'pivot-small',title:'Redo pivot change (Ctrl+Shift+Z)','aria-label':'Redo pivot change',onclick:()=>restoreHistory(redoStack,undoStack)},'↷'),
        node('span',{id:'pivot-status',role:'status','aria-live':'polite'})),
      node('div',{class:'pivot-zones'},['rows','columns','values','filters'].map(zone=>node('section',{class:'pivot-zone','data-zone':zone},
        node('h3',{},zone[0].toUpperCase()+zone.slice(1)),
        node('div',{id:'pivot-'+zone,class:'pivot-drop',ondragover:e=>{e.preventDefault();e.currentTarget.classList.add('drag-over');},ondragleave:e=>e.currentTarget.classList.remove('drag-over'),ondrop:e=>drop(e,zone)})))),
      node('details',{id:'pivot-sorts',class:'pivot-sorts'},node('summary',{title:'Rules run in order within each row group. Parents and their children stay together.'},'Sorts',node('span',{id:'pivot-sort-count'})),node('div',{id:'pivot-sort-list'})),
      node('div',{class:'pivot-options'},['rowTotals','columnTotals','subtotals','live'].map(key=>{const input=node('input',{id:'pivot-'+key,type:'checkbox',onchange:e=>{config[key]=e.target.checked;changed(false);}});return node('label',{class:'pivot-check'},input,({rowTotals:'Grand total',columnTotals:'Column totals',subtotals:'Subtotals',live:'Auto update'})[key]);}),
        node('label',{},'Decimals',node('select',{id:'pivot-decimals',onchange:e=>{config.decimals=Number(e.target.value);remember();persist();decorate();}},[0,1,2,3,4,6].map(n=>node('option',{value:n},n))))));
    render();
    $('pivot-sorts').open=!!config.sorts?.length;
    const fit=()=>{
      if(state.mode!=='pivot')return;
      const panel=document.querySelector('.editor-panel');
      const chrome=[...panel.children].filter(el=>el!==pane&&getComputedStyle(el).display!=='none').reduce((n,el)=>n+el.offsetHeight,0);
      const content=[...pane.children].reduce((n,el)=>n+el.offsetHeight,0)+32;
      $('work-area').style.setProperty('--pivot-editor-height',Math.min(chrome+content,$('work-area').clientHeight*.5)+'px');
    };
    const observer=new ResizeObserver(fit);for(const el of pane.children)observer.observe(el);observer.observe($('work-area'));
    pane.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();update().catch(report);}});
    document.addEventListener('keydown',event=>{if(state.mode==='pivot'&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.target.closest('input,textarea,select,[contenteditable],dialog')){event.preventDefault();event.shiftKey?restoreHistory(redoStack,undoStack):restoreHistory(undoStack,redoStack);}});
    document.addEventListener('dragend',clearDrag);
    const dialog=node('dialog',{id:'pivot-connect-dialog',class:'modal wide-modal',onclose:()=>{connectionVersion++;if(pending)schedule();}},node('form',{method:'dialog',class:'modal-close-form'},node('button',{class:'close-button','aria-label':'Close dataset connection'},'×')),node('h2',{},'Connect datasets'),node('div',{id:'pivot-connect-body'}),node('div',{class:'modal-footer'},node('span',{},'Check keys before connecting.'),node('button',{id:'pivot-connect-apply',class:'button primary',onclick:applyConnection},'Connect dataset')));
    document.body.append(dialog);
  }
  function enter(){if(sidebarBefore===null)sidebarBefore=document.body.classList.contains('sidebar-collapsed');document.body.classList.add('sidebar-collapsed');$('toggle-sidebar').setAttribute('aria-label','Expand sidebar');setup();if(!state.data.catalog.some(d=>d.name===config.dataset)){config=empty(state.selected);render();}else render();decorate();}
  async function update(sqlOnly=false){
    if(!initialized)setup();
    if(state.mode!=='pivot')return;
    if(state.busy||running){status('Waiting for the current operation…');if(config.live&&!sqlOnly)schedule();return;}
    clearTimeout(timer);running=true;
    const version=revision,c=JSON.parse(JSON.stringify(config));
    $('pivot-pane').setAttribute('aria-busy','true');
    try{
      if(!c.dataset||!c.values.length)throw Error('Choose a dataset and add at least one value.');
      const identifiers=[...(primary()?.columns||[]).map(f=>f.name.toLowerCase()),...(c.links||[]).flatMap(l=>l.fields.map(f=>f.alias.toLowerCase()))];
      if(new Set(identifiers).size!==identifiers.length)throw Error('Source field names changed. Edit the connections to refresh their field names.');
      for(const link of c.links||[]){
        status('Checking '+link.dataset+' keys…');
        const stats=await fullCheck(link.dataset,link.keys);
        if(version!==revision||state.mode!=='pivot')return;
        if(stats.right_duplicate_keys)throw Error(link.dataset+' now has repeated keys. Edit its connection or add another matching field to avoid inflated totals.');
        if(stats.left_rows&&!stats.matched_left&&!link.allowNoMatch)throw Error('No records match '+link.dataset+'. Recheck its connection.');
        const schema=state.data.catalog.find(d=>d.name===link.dataset);
        if(!schema||link.fields.some(f=>!schema.columns.some(col=>col.name===f.name)))throw Error('The schema of '+link.dataset+' changed. Reconnect it.');
        link.stats=stats;const current=config.links.find(l=>l.dataset===link.dataset);if(current)current.stats=stats;
      }
      if(c.links?.length){checkpoint=snapshot();render();}
      if(c.rows.length+c.columns.length+c.values.length>100)throw Error('Use fewer fields for this pivot (maximum 100 fields).');
      const available=new Set(columns().map(c=>c.name));
      for(const field of [...c.rows,...c.columns,...c.filters.map(f=>f.field),...c.values.map(v=>v.field).filter(f=>f!=='*'),...(c.sorts||[]).filter(r=>r.kind!=='label'&&r.op!=='count').map(r=>r.field),...(c.sorts||[]).flatMap(r=>r.categoryFields||[])])if(!available.has(field))throw Error('A saved field is missing: '+field+'. Remove it or choose another dataset.');
      status('Updating…');
      for(const measure of c.values){
        const meta=columns().find(f=>f.name===measure.field);
        if(['sum','avg'].includes(measure.op)&&!PivotQuery.numeric(meta?.type)){
          if(!measure.numeric)throw Error('Open the options for '+measure.field+' and check it as numbers first.');
          const check=await runJob('query',{sql:`SELECT count(${sqlName(measure.field)})-count(TRY_CAST(${sqlName(measure.field)} AS DOUBLE)) AS invalid FROM (${PivotQuery.source(c)}) AS checked`,size:1});
          if(Number(check.rows[0][0])&&!measure.numericIgnore)throw Error('New nonnumeric values found in '+measure.field+'. Recheck the numeric conversion.');
        }
      }
      let categories=[];
      if(c.columns.length){const result=await runJob('query',{sql:PivotQuery.discovery(c),size:100});if(result.clipped_cells||result.has_more||result.total_columns!==result.columns.length)throw Error('Column categories are too large to preview safely. Choose shorter fields or move them to Rows.');categories=result.rows;}
      if(version!==revision||state.mode!=='pivot')return;
      const built=PivotQuery.build(c,categories);
      if(sqlOnly){status('');return built;}
      state.groups=[];state.groupDataset=null;state.groupBase='';state.sort=null;last=built;
      setEditor(built.sql);
      await runSQL(built.sql);
      if(version===revision){pending=false;status('Up to date');}
      else status('Pending changes');
      decorate();persist();return built;
    }catch(error){status(error.message);throw error;}
    finally{running=false;$('pivot-pane').removeAttribute('aria-busy');if(version!==revision&&config.live&&state.mode==='pivot')schedule();}
  }
  function leave(){clearTimeout(timer);clearDrag();if(sidebarBefore!==null){document.body.classList.toggle('sidebar-collapsed',sidebarBefore);$('toggle-sidebar').setAttribute('aria-label',sidebarBefore?'Expand sidebar':'Collapse sidebar');sidebarBefore=null;}}
  async function openSQL(){try{if(config?.values.length&&!state.busy&&!running){const built=await update(true);if(built)setEditor(built.sql);}}finally{setMode('sql');}}
  function applies(){return last&&state.result&&stripSQL(state.result.sql).includes(stripSQL(last.sql));}
  function decorate(){
    if(!initialized||state.mode!=='pivot'||!applies())return;
    const result=state.result,indices=new Map(result.columns.map((c,i)=>[c.name,i])),kind=indices.get(last.rowKind);
    const table=$('result-table');
    if(table?.tHead&&!table.querySelector('.pivot-bands')){
      const bands=node('tr',{class:'pivot-bands'}),cells=new Map(last.cells.map(c=>[c.name,c]));
      const labels=['',...result.columns.filter(c=>c.name!==last.rowKind).map(c=>cells.get(c.name)?.band||'Row groups')];
      let previous=null;
      for(const label of labels){if(previous&&previous.textContent===label)previous.colSpan++;else{previous=node('th',{scope:'colgroup'},label);bands.append(previous);}}
      table.tHead.prepend(bands);table.classList.add('pivot-result');
      if(kind!==undefined)table.tHead.rows[1].cells[kind+1].style.display='none';
      for(const [i,col] of result.columns.entries()){
        const meta=cells.get(col.name),heading=table.tHead.rows[1].cells[i+1]?.firstChild;
        if(meta&&heading?.firstChild){heading.title=col.name;heading.firstChild.textContent=(meta.measure.label?.trim()||PivotQuery.aggregates[meta.measure.op]+(meta.measure.op==='count'?'':' of '+meta.measure.field))+(meta.measure.percent?' (%)':'');}
      }
    }
    const records=[...$('result-table').querySelectorAll('tbody>tr:not(.virtual-spacer)')];
    const visibleParents=new Set();
    records.forEach((tr,r)=>{
      const row=result.rows[r];if(!row)return;
      if(kind!==undefined&&row[kind]!=='Detail')tr.classList.add('pivot-total-row');
      if(kind!==undefined){
        tr.children[kind+1].style.display='none';
        const level=row[kind]==='Grand total'?0:row[kind]==='Detail'?last.config.rows.length:Number(String(row[kind]).split(' · ')[1]);
        for(let i=level;i<last.config.rows.length;i++)tr.children[i+1].textContent=i===0?'Grand total':'';
        const prefix=n=>JSON.stringify(last.config.rows.slice(0,n).map(f=>row[indices.get(f)]));
        for(let i=0;i<level-1;i++)if(visibleParents.has(prefix(i+1)))tr.children[i+1].textContent='';
        if(row[kind]!=='Detail'&&level>0)visibleParents.add(prefix(level));
      }
      if(last.config.subtotals&&kind!==undefined&&String(row[kind]).startsWith('Subtotal · ')){
        const depth=Number(String(row[kind]).split(' · ')[1]),group={fields:last.config.rows.slice(0,depth),values:last.config.rows.slice(0,depth).map(f=>row[indices.get(f)])};
        const signature=JSON.stringify(group),closed=(config.collapsed||[]).some(g=>JSON.stringify(g)===signature),td=tr.children[depth];
        if(td&&!td.querySelector('.pivot-fold')){
          const fold=node('button',{class:'pivot-fold','aria-expanded':String(!closed),'aria-label':(closed?'Expand ':'Collapse ')+group.values.map(v=>v??'NULL').join(' / '),onclick:()=>{
            config.collapsed=(config.collapsed||[]).filter(g=>JSON.stringify(g)!==signature);if(!closed)config.collapsed.push(group);changed(false);update().catch(report);
          }},closed?'＋':'−');td.prepend(fold);
        }
      }
      for(const cell of last.cells){const i=indices.get(cell.name),td=tr.children[i+1];if(i===undefined||!td)continue;
        const v=row[i];td.replaceChildren();
        const text=typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:config.decimals})+(cell.measure.percent?'%':''):v===null?'—':String(v);
        td.append(node('button',{class:'pivot-cell',title:'Inspect source records · '+(v===null?'NULL':v),'aria-label':'Inspect records for '+cell.name,onclick:()=>drill(row,cell).catch(report)},text));
      }
    });
  }
  async function drill(row,cell){
    if(!applies())return;
    const built=last,c=built.config,result=state.result,indices=new Map(result.columns.map((v,i)=>[v.name,i]));
    const kind=built.rowKind?row[indices.get(built.rowKind)]:'Detail';
    const depth=kind==='Grand total'?0:kind==='Detail'?c.rows.length:Number(String(kind).split(' · ')[1]);
    const terms=c.rows.slice(0,depth).map(field=>`${sqlName(field)} IS NOT DISTINCT FROM ${sqlValue(row[indices.get(field)])}`);
    if(cell.condition)terms.push(cell.condition);
    const sql=`SELECT * FROM (${built.source}) AS source${terms.length?' WHERE '+terms.join(' AND '):''}`;
    const data=await runJob('query',{sql,size:20});
    $('detail-title').textContent='Records behind this value';$('detail-eyebrow').textContent=cell.name;
    $('detail-content').replaceChildren(node('p',{class:'form-hint'},`Showing ${data.rows.length} of ${Number(data.total_rows??data.rows.length).toLocaleString()} matching records. Filters and row / column groups are applied. Counts and numeric aggregates may exclude NULL or invalid values.`),tableFor(data),
      node('button',{class:'button secondary',onclick:()=>{$('detail-dialog').close();newTab('Pivot source records',sql+';');runSQL(sql).catch(report);}},'Open all records in SQL ↗'));
    $('detail-dialog').showModal();
  }
  function openSave(){
    $('detail-title').textContent='Save pivot layout';$('detail-eyebrow').textContent='PIVOT LIBRARY';
    const input=node('input',{id:'pivot-save-name',maxlength:100,placeholder:'e.g. Revenue by region and month'});
    const save=node('button',{class:'button primary',onclick:()=>{
      const name=input.value.trim();if(!name){input.focus();return;}
      const existing=saved.findIndex(s=>s.name===name);if(existing>=0){message.textContent='That name already exists. Choose a new name or delete the old layout in Manage layouts.';return;}
      saved.push({name,config:JSON.parse(JSON.stringify(config))});persist();render();$('detail-dialog').close();status('Layout saved on this browser for this workspace.');
    }},'Save layout');const message=node('p',{role:'status'});
    $('detail-content').replaceChildren(node('p',{class:'form-hint'},'Saves fields, measures, filters and totals in this browser, scoped to this workspace. Save generated SQL in the query library for a portable copy.'),node('label',{},'Layout name',input),message,save);
    $('detail-dialog').showModal();input.focus();
  }
  function manage(){
    $('detail-title').textContent='Saved pivot layouts';$('detail-eyebrow').textContent='PIVOT LIBRARY';
    const list=node('div');
    function draw(){list.replaceChildren(...saved.map((s,i)=>node('div',{class:'pivot-saved-row'},node('strong',{},s.name),node('span',{},s.config.dataset),button('Delete',()=>{saved.splice(i,1);persist();render();draw();}))));if(!saved.length)list.append(node('p',{},'No saved layouts yet.'));}draw();
    $('detail-content').replaceChildren(list);$('detail-dialog').showModal();
  }
  return {enter,leave,openSQL,update,decorate,sortResult};
})();
