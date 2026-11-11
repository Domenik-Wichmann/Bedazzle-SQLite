'use strict';
const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('fieldwork-token') || '';
if (token) sessionStorage.setItem('fieldwork-token', token);
if (location.hash) history.replaceState(null, '', location.pathname);
const state = {data: null, selected: null, result: null, profile: null, view: 'table', mode: 'sql',
  importMode: 'open', busy: false, previous: [], groups: [], groupDataset: null, expanded: new Map(),
  library: 'saved', sort: null, sqlBeforeBuilder: '', activeSQL: '', groupBase: '', tabs: [], activeTab: null};
const labels = {catalog: 'Opening your workspace', preview: 'Previewing your file', open: 'Opening your dataset',
  convert: 'Converting to Parquet', query: 'Running your query', export: 'Exporting full results',
  count: 'Counting every record', profile: 'Profiling your dataset', explain: 'Inspecting the query plan', rename: 'Renaming dataset'};
let draftTimer=null;

function node(tag, attrs = {}, ...children) {
  const item = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') item.className = value;
    else if (key === 'text') item.textContent = value;
    else if (key.startsWith('on')) item.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) item.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) item.append(child.nodeType ? child : document.createTextNode(String(child)));
  return item;
}
function show(id, visible = true) { $(id).classList.toggle('hidden', !visible); }
function humanBytes(value) {
  if (!value) return '0 B';
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toLocaleString(undefined, {maximumFractionDigits: index ? 1 : 0})} ${['B','KB','MB','GB','TB'][index]}`;
}
function sqlName(value) { return '"' + String(value).replaceAll('"', '""') + '"'; }
function sqlValue(value) { return value === null ? 'NULL' : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'"; }
function stripSQL(value) { return value.trim().replace(/;+\s*$/, ''); }
function selectedSource() { return state.data?.catalog.find(item => item.name === state.selected); }
function datasetHeading(name){
  const source=state.data?.catalog.find(item=>item.name===name);
  $('workspace-title').textContent=source?.path?source.path.split(/[\\/]/).pop():name||'Pick a file';
  $('workspace-subtitle').textContent=source?`SQL: ${sqlName(name)} · ${source.columns.length} columns`:'CSV, Parquet, JSON and a bit of SQL';
}
function toast(message, error = false, path = null) {
  const item = node('div', {class: 'toast' + (error ? ' error' : '')}, message);
  item.append(node('button',{class:'toast-dismiss','aria-label':'Dismiss notification',onclick:()=>item.remove()},'×'));
  if (path) {
    item.append(node('small', {}, path));
    item.append(node('button', {onclick: () => api('/api/reveal', {path}).catch(report)}, 'Show in folder ↗'));
  }
  $('toast-container').append(item);
  while($('toast-container').children.length>2)$('toast-container').firstElementChild.remove();
  setTimeout(() => item.remove(), error || path ? 14000 : 5500);
}
function report(error) { const message=error.message||String(error);toast(message,!/^Cancelled\./.test(message)); }
function inlineError(id, error) { $(id).textContent = error ? error.message || String(error) : ''; show(id, !!error); }
async function api(url, payload) {
  const response = await fetch(url, {method: payload === undefined ? 'GET' : 'POST',
    headers: {'X-Workbench-Token': token, 'Content-Type': 'application/json'},
    ...(payload === undefined ? {} : {body: JSON.stringify(payload)})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function refresh() {
  state.data = await api('/api/bootstrap');
  renderCatalog(); renderResources();
  $('saved-count').textContent = state.data.saved.length;
}
function setBusy(value, action = '') {
  state.busy = value;
  show('job-strip', value);
  $('job-label').textContent = labels[action] || 'Working';
  $('job-detail').textContent = ['convert','export'].includes(action) ? 'Writing directly to disk. Your source file stays intact.' : 'Native DuckDB is working. You can cancel at any time.';
  $('job-progress').style.width = '0%';
  for (const id of ['run-query','confirm-import','preview-import','load-demo','count-rows','run-profile','confirm-export','save-settings','next-page','previous-page','explain-query']) $(id).disabled = value;
  show('import-busy', value && action === 'preview');
  if (!value) updatePaging();
}
async function runJob(action, payload = {}, onPreview = null) {
  if (state.busy) throw new Error('An operation is already running. Wait for it or use Cancel.');
  setBusy(true, action);
  let terminalError = null;
  try {
    const submitted = await api('/api/jobs', {action, payload});
    let previewShown=false;
    for (;;) {
      await pause(300);
      const job = await api('/api/jobs/' + submitted.id+(previewShown?'?preview=0':''));
      if(job.preview&&!previewShown&&onPreview){onPreview(job.preview);previewShown=true;$('job-label').textContent='Counting all matching results';$('job-detail').textContent='Your page is ready. The exact total is still being counted.';}
      $('job-time').textContent = `${Math.floor(Date.now()/1000 - job.created)}s`;
      if (job.progress !== null) $('job-progress').style.width = Math.min(100, job.progress) + '%';
      if (job.finished) {
        if (job.status !== 'succeeded') throw new Error(job.error || 'Operation stopped.');
        return job.result;
      }
    }
  } catch (error) { terminalError = error; throw error; }
  finally {
    try { await refresh(); } catch (error) { if (!terminalError) report(error); }
    setBusy(false);
  }
}
async function cancelJob() { await api('/api/cancel', {}); $('job-detail').textContent = 'Stopping the worker and cleaning up temporary files…'; }

function renderCatalog() {
  const datasets = state.data.catalog;
  if (state.selected && !datasets.some(item => item.name === state.selected)) state.selected = null;
  if (!state.selected && datasets.length) state.selected = datasets[0].name;
  $('datasets').replaceChildren();
  if (!datasets.length) $('datasets').append(node('p', {class:'sidebar-empty'}, 'Your files will feel at home here.'));
  for (const dataset of datasets) {
    const button = node('button', {class:'dataset-item' + (dataset.name === state.selected ? ' selected' : ''), title: dataset.path || dataset.name,
      onclick: () => selectDataset(dataset.name).catch(report)},
      node('span', {class:'dataset-icon'}, dataset.kind.slice(0,3).toUpperCase()),
      node('span', {class:'dataset-text'}, node('strong', {}, dataset.name), node('small', {}, dataset.error ? 'Source unavailable' : `${dataset.columns.length} columns${dataset.bytes ? ' · ' + humanBytes(dataset.bytes) : ''}`)));
    $('datasets').append(node('div',{class:'dataset-row'},button,
      node('button',{class:'dataset-rename','aria-label':'Rename '+dataset.name,title:'Rename dataset',onclick:()=>openRename(dataset.name)},'✎')));
  }
  const previous = $('builder-dataset').value;
  fillOptions('builder-dataset', datasets.map(item => [item.name, item.name]));
  $('builder-dataset').value = datasets.some(d => d.name === previous) ? previous : state.selected || '';
  builderColumns();
}
function renderResources() {
  const {effective, hardware} = state.data;
  $('resource-summary').textContent = effective.error ? 'Low resources · check settings' : `${effective.memory_mb} MB budget · ${effective.threads} thread${effective.threads === 1 ? '' : 's'}`;
  $('footer-resources').textContent = `${(hardware.available_mb/1024).toFixed(1)} GB RAM available · ${hardware.disk_free_gb} GB disk free`;
}
function workArea() { show('empty-state', false); show('work-area'); }
function setEditor(sql) {
  $('sql-editor').value = sql;
  updateLines();
  localStorage.setItem('fieldwork-editor', sql);
  const tab=state.tabs.find(item=>item.id===state.activeTab);
  if(tab){tab.sql=sql;persistTabs();}
}
function persistTabs(){
  const snapshot={active:state.activeTab,updated:Date.now(),tabs:state.tabs.map(tab=>({id:tab.id,name:tab.name,sql:tab.sql}))};
  localStorage.setItem('fieldwork-tabs',JSON.stringify(snapshot));
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>api('/api/drafts',snapshot).catch(()=>{}),650);
}
function cacheTab(){
  const tab=state.tabs.find(item=>item.id===state.activeTab);
  if(!tab)return;
  Object.assign(tab,{sql:$('sql-editor').value,result:state.result,groups:[...state.groups],groupDataset:state.groupDataset,groupBase:state.groupBase,previous:[...state.previous],sort:state.sort});
}
function renderTabs(){
  $('query-tabs').replaceChildren(...state.tabs.map(tab=>node('div',{class:'query-tab'+(tab.id===state.activeTab?' active':'')},
    node('button',{onclick:()=>switchTab(tab.id),title:tab.name},tab.name),
    node('button',{class:'tab-close','aria-label':'Close '+tab.name,onclick:()=>closeTab(tab.id)},'×'))),
    node('button',{class:'new-tab','aria-label':'New SQL tab',title:'New SQL tab',onclick:()=>newTab()},'+'));
}
function switchTab(id){
  if(state.busy)return toast('Wait for the current operation or cancel it before switching tabs.');
  cacheTab();
  const tab=state.tabs.find(item=>item.id===id);if(!tab)return;
  state.activeTab=id;state.result=tab.result||null;state.groups=tab.groups||[];state.groupDataset=tab.groupDataset||null;
  state.groupBase=tab.groupBase||'';state.previous=tab.previous||[];state.sort=tab.sort||null;state.expanded.clear();
  setEditor(tab.sql);setMode('sql');renderTabs();workArea();
  if(state.result)renderResults();else{
    $('result-count').textContent='—';$('query-stat').textContent='No query run in this tab';
    $('result-message').className='result-message';$('result-message').replaceChildren('Run a query to see its results.');
  }
  setResultView('table');updatePaging();persistTabs();
}
function newTab(name,sql){
  if(state.busy)return toast('Wait for the current operation or cancel it first.');
  if(state.tabs.length>=10)return toast('Up to 10 SQL tabs can stay open. Save a query and close a tab to make room.');
  cacheTab();
  const tab={id:crypto.randomUUID(),name:name||'Query '+(state.tabs.length+1),sql:sql||'SELECT 42 AS a_good_place_to_start;'};
  state.tabs.push(tab);switchTab(tab.id);
}
function closeTab(id){
  if(state.busy)return toast('Wait for the current operation or cancel it first.');
  if(state.tabs.length===1){toast('Keep one SQL tab open. You can replace its SQL or start a new tab.');return;}
  cacheTab();const index=state.tabs.findIndex(item=>item.id===id);state.tabs.splice(index,1);
  if(state.activeTab===id){state.activeTab=null;switchTab(state.tabs[Math.max(0,index-1)].id);}else{renderTabs();persistTabs();}
}
function updateLines() {
  const count=$('sql-editor').value.split('\n').length;
  $('line-numbers').textContent = Array.from({length: count}, (_, i) => i+1).join('\n');
  $('line-numbers').style.flexBasis=Math.max(48,28+String(count).length*8)+'px';
}
async function selectDataset(name) {
  if (state.busy) return toast('Wait for the current operation or cancel it first.');
  state.selected = name; state.profile = null; state.groups = []; state.groupDataset = null;
  $('builder-dataset').value = name;
  renderCatalog(); builderColumns(); workArea();
  const source = selectedSource();
  datasetHeading(name);
  if(state.tabs.length<10)newTab(name,`SELECT *\nFROM ${sqlName(name)};`);
  else setEditor(`SELECT *\nFROM ${sqlName(name)};`);
  setMode('sql');
  await runSQL($('sql-editor').value);
}
function fillOptions(id, items) {
  $(id).replaceChildren(...items.map(([value,label]) => node('option', {value}, label)));
}
function builderColumns() {
  const source = state.data?.catalog.find(item => item.name === $('builder-dataset').value);
  const values = (source?.columns || []).map(col => [col.name, col.name]);
  const selectedGroups = new Set(Array.from($('group-columns').selectedOptions).map(o => o.value));
  const filter = $('filter-column').value, measure = $('measure-column').value;
  fillOptions('filter-column', [['','No filter'], ...values]);
  fillOptions('measure-column', values);
  fillOptions('group-columns', values);
  if (values.some(v => v[0] === filter)) $('filter-column').value = filter;
  if (values.some(v => v[0] === measure)) $('measure-column').value = measure;
  for (const option of $('group-columns').options) option.selected = selectedGroups.has(option.value);
}
function setMode(mode) {
  state.mode = mode;
  $('sql-mode').classList.toggle('selected', mode === 'sql');
  $('explore-mode').classList.toggle('selected', mode === 'explore');
  show('sql-pane', mode === 'sql'); show('explore-pane', mode === 'explore');
}
function buildQuery() {
  const dataset = $('builder-dataset').value;
  if (!dataset) throw new Error('Open a dataset first.');
  const groups = Array.from($('group-columns').selectedOptions).map(o => o.value);
  let aggregate = $('aggregate').value;
  if (groups.length && aggregate === 'none') {aggregate = 'count';$('aggregate').value='count';}
  const measure = sqlName($('measure-column').value);
  const expressions = {count:'count(*)', sum:`sum(TRY_CAST(${measure} AS DOUBLE))`, avg:`avg(TRY_CAST(${measure} AS DOUBLE))`,
    min:`min(${measure})`, max:`max(${measure})`, distinct:`count(DISTINCT ${measure})`};
  const alias = aggregate === 'count' ? 'records' : aggregate + '_' + $('measure-column').value;
  let select = aggregate === 'none' ? '*' : [...groups.map(sqlName), `${expressions[aggregate]} AS ${sqlName(alias)}`].join(',\n       ');
  let sql = `SELECT ${select}\nFROM ${sqlName(dataset)}`;
  const filter = $('filter-column').value, value = $('filter-value').value, op = $('filter-op').value;
  let where='';
  if (filter) {
    const name = sqlName(filter);
    let condition;
    if (op === 'contains') condition = `contains(lower(CAST(${name} AS VARCHAR)), lower(${sqlValue(value)}))`;
    else if (op === 'equals') condition = `CAST(${name} AS VARCHAR) = ${sqlValue(value)}`;
    else if (op === 'null') condition = `${name} IS NULL`;
    else if (op === 'notnull') condition = `${name} IS NOT NULL`;
    else {
      if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('Enter a number for this filter condition.');
      condition = `TRY_CAST(${name} AS DOUBLE) ${op === 'gt' ? '>' : '<'} ${Number(value)}`;
    }
    where='\nWHERE '+condition;
    sql += where;
  }
  if (aggregate !== 'none' && groups.length) sql += '\nGROUP BY ' + groups.map(sqlName).join(', ');
  if (aggregate !== 'none') sql += `\nORDER BY ${sqlName(alias)} DESC` + (groups.length ? ', ' + groups.map(sqlName).join(', ') : '');
  return {sql: sql + ';', groups, dataset, aggregate, base:`SELECT * FROM ${sqlName(dataset)}${where}`};
}
async function executeEditor() {
  let sql;
  if (state.mode === 'explore') {
    const built = buildQuery();
    state.groups = built.groups; state.groupDataset = built.dataset;state.groupBase=built.base;
    sql = built.sql; setEditor(sql);
    if (['sum','avg'].includes(built.aggregate)) toast('Sum and average convert values to numbers; non-numeric values are ignored.');
  } else {
    const area = $('sql-editor');
    sql = area.selectionStart !== area.selectionEnd ? area.value.slice(area.selectionStart, area.selectionEnd) : area.value;
    state.groups = []; state.groupDataset = null;state.groupBase='';
  }
  state.previous = []; state.sort = null;
  await runSQL(sql);
}
async function runSQL(sql, offset = 0, reset = true, extra = {}) {
  if (!sql.trim()) throw new Error('Write a query first.');
  workArea();
  if (reset) state.previous = [];
  let previewed=false;
  try {
    const result = await runJob('query', {sql, offset, size:Number($('page-size').value),force_count:reset,...extra},preview=>{
      previewed=true;
      state.result=preview;state.activeSQL=sql;state.expanded.clear();renderResults();setResultView('table');
    });
    state.result = result; state.activeSQL = sql; state.expanded.clear();
    cacheTab();
    $('editor-status').textContent = `Finished in ${(result.elapsed_ms/1000).toFixed(2)}s`;
    renderResults(); setResultView('table');
    window.bedazzle?.celebrate('Done',`${result.total_rows !== undefined ? Number(result.total_rows).toLocaleString()+' results' : result.rows.length+' rows'} · ${(result.elapsed_ms/1000).toFixed(2)}s`);
  } catch (error) {
    if(previewed&&state.result?.total_status==='counting'){
      state.result.total_status='stopped';cacheTab();renderResults();setResultView('table');
      $('editor-status').textContent='Count stopped · preview kept';throw error;
    }
    state.result = null; updatePaging(); show('table-view', false); show('chart-view',false); show('profile-view',false);
    show('result-message'); $('result-message').className = 'result-message error-result';
    $('result-message').textContent = error.message;
    $('editor-status').textContent = 'Query stopped';
    throw error;
  }
}
function tableFor(result, {interactive=false, mini=false} = {}) {
  const table = node('table');
  const header = node('tr', {}, node('th', {class:'row-number'}, '#'));
  for (const col of result.columns) {
    const content = node(interactive && result.selectable ? 'button' : 'span',
      interactive && result.selectable ? {onclick:() => sortColumn(col.name).catch(report), title:'Sort this complete query by ' + col.name} : {},
      col.name, node('span', {class:'column-type'}, col.type));
    header.append(node('th', {}, content));
  }
  table.append(node('thead', {}, header));
  const body = node('tbody');
  if (!result.rows.length) body.append(node('tr', {}, node('td', {colspan:result.columns.length+1,class:'result-empty'}, 'No matching rows. Try a different filter or query.')));
  result.rows.forEach((row, index) => {
    const tr = node('tr', {}, node('td',{class:'row-number'},result.offset+index+1));
    row.forEach((value, columnIndex) => {
      const col = result.columns[columnIndex];
      const td = node('td', {title:value === null ? 'NULL' : String(value)});
      if (/INT|DECIMAL|DOUBLE|FLOAT|HUGE|REAL/.test(col.type)) td.classList.add('numeric');
      if (interactive && columnIndex === 0 && state.groups.length && state.groupDataset) {
        td.append(node('button', {class:'drill-button',onclick:() => toggleGroup(tr,index,row).catch(report)},
          node('span', {}, '▸'), value === null ? 'NULL' : String(value)));
      } else if (value === null) td.append(node('span', {class:'null-value'}, 'NULL'));
      else td.textContent = String(value);
      td.addEventListener('dblclick', () => { navigator.clipboard.writeText(value === null ? '' : String(value)).then(() => toast('Cell copied.')).catch(report); });
      tr.append(td);
    });
    if (interactive) tr.addEventListener('dblclick', event => { if (event.target.classList.contains('row-number')) showRow(row); });
    body.append(tr);
  });
  table.append(body);
  return table;
}
function renderResults() {
  const result = state.result;
  if (!result) return;
  show('result-message',false);
  const table = tableFor(result, {interactive:true}); table.id = 'result-table';
  $('table-scroll').replaceChildren(table);
  const total=result.total_rows;
  $('result-count').textContent = total!==undefined?Number(total).toLocaleString():result.total_status==='counting'?'Counting…':result.total_status==='stopped'?'Count stopped':result.rows.length.toLocaleString();
  const range=`Rows ${result.rows.length?(result.offset+1).toLocaleString():0}–${(result.offset+result.rows.length).toLocaleString()}`;
  $('query-stat').textContent = `${range}${total!==undefined?' of '+Number(total).toLocaleString():result.total_status==='counting'?' · counting total…':result.total_status==='stopped'?' · total count stopped':''} · ${result.total_columns} columns${result.elapsed_ms!==undefined?' · '+(result.elapsed_ms/1000).toFixed(2)+'s':''}`;
  const notes = [];
  if (result.total_columns > result.columns.length) notes.push(`Showing ${result.columns.length} of ${result.total_columns} columns. Select fewer columns in SQL to see the others.`);
  if (result.clipped_cells) notes.push('Long values are shortened in the preview. Full exports preserve them.');
  if (result.statement_count > 1) notes.push('This script ran multiple statements. To page or export its final SELECT, run that SELECT separately.');
  if (result.has_more && !/\border\s+by\b/i.test(result.sql)) notes.push('Add ORDER BY if you need a consistent row order across pages.');
  $('result-notice').textContent = notes.join(' '); show('result-notice',!!notes.length);
  updatePaging(); prepareChart();
}
function updatePaging() {
  const result = state.result;
  $('previous-page').disabled = state.busy || !state.previous.length;
  $('next-page').disabled = state.busy || !result?.has_more || result.statement_count > 1;
  $('page-label').textContent = result ? `${result.rows.length ? result.offset+1 : 0}–${result.offset+result.rows.length}` : '—';
}
function setResultView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('selected',button.dataset.view === view));
  show('table-view',view === 'table' && !!state.result);
  show('chart-view',view === 'chart'); show('profile-view',view === 'profile');
  show('result-message',view === 'table' && !state.result);
  if (view === 'chart') renderChart();
}
async function sortColumn(column) {
  if (!state.result || state.result.statement_count !== 1) throw new Error('Run a single SELECT before sorting its results.');
  const direction = state.sort?.column === column && state.sort.direction === 'ASC' ? 'DESC' : 'ASC';
  const base = state.sort?.base || state.result.sql;
  state.sort = {column,direction,base};
  await runSQL(base,0,true,{sort:{column,direction}});
  setEditor(state.result.sql);
}
function showRow(row) {
  $('detail-title').textContent = 'Record details'; $('detail-eyebrow').textContent = 'THIS RESULT PAGE';
  $('detail-content').replaceChildren(...row.map((cell,index) => node('div',{class:'detail-row'},node('strong',{},state.result.columns[index].name),node('span',{},cell === null ? 'NULL' : String(cell)))));
  $('detail-dialog').showModal();
}
async function toggleGroup(tr,index,row) {
  const key = String(index);
  if (state.expanded.has(key)) { state.expanded.get(key).remove(); state.expanded.delete(key); tr.querySelector('.drill-button>span').textContent='▸'; return; }
  const source = state.groupDataset;
  const conditions = state.groups.map(name => {
    const columnIndex = state.result.columns.findIndex(c => c.name === name);
    return `${sqlName(name)} IS NOT DISTINCT FROM ${sqlValue(row[columnIndex])}`;
  });
  const base=state.groupBase||`SELECT * FROM ${sqlName(source)}`;
  const sql = `SELECT * FROM (\n${base}\n) AS group_records\nWHERE ${conditions.join(' AND ')};`;
  const details = await runJob('query',{sql,size:25,offset:0,exact_total:false});
  const cell = node('td',{colspan:state.result.columns.length+1},
    node('div',{class:'expanded-heading'},`Showing ${details.rows.length} records from this group${details.has_more?' · open to explore all':''}`,
      node('button',{class:'text-button',onclick:() => {state.groups=[]; setMode('sql');setEditor(sql);runSQL(sql).catch(report);}},'Explore these records ↗')),
    node('div',{class:'expanded-table'},tableFor(details)));
  const expanded = node('tr',{class:'expanded-row'},cell);
  tr.after(expanded); state.expanded.set(key,expanded); tr.querySelector('.drill-button>span').textContent='▾';
}
function prepareChart() {
  if (!state.result) return;
  const columns = state.result.columns;
  fillOptions('chart-label',columns.map(c=>[c.name,c.name]));
  const numeric = columns.filter(c=>/INT|DECIMAL|DOUBLE|FLOAT|REAL/.test(c.type));
  fillOptions('chart-value',numeric.map(c=>[c.name,c.name]));
  if (numeric.length) $('chart-value').value = numeric[numeric.length-1].name;
}
function renderChart() {
  $('chart-content').replaceChildren();
  if (!state.result?.rows.length || !$('chart-value').value) return $('chart-content').append(node('p',{class:'chart-empty'},'Run a query with a numeric column to make a chart. Counts and grouped summaries work well.'));
  const label = state.result.columns.findIndex(c=>c.name === $('chart-label').value);
  const value = state.result.columns.findIndex(c=>c.name === $('chart-value').value);
  const rows = state.result.rows.slice(0,30).filter(row=>row[value] !== null && Number.isFinite(Number(row[value])));
  const maximum = Math.max(1,...rows.map(row=>Math.abs(Number(row[value]))));
  for (const row of rows) {
    const bar = node('div',{class:'bar'+(Number(row[value]) < 0 ? ' bar-negative' : '')});
    bar.style.width = Math.abs(Number(row[value]))/maximum*100+'%';
    $('chart-content').append(node('div',{class:'bar-row'},node('span',{class:'bar-label',title:String(row[label])},row[label] ?? 'NULL'),node('div',{class:'bar-track'},bar),node('span',{class:'bar-value'},Number(row[value]).toLocaleString(undefined,{maximumFractionDigits:3}))));
  }
}

function importOptions() { return {types:$('import-types').value,delimiter:$('import-delimiter').value,header:$('import-header').checked}; }
function setImportMode(mode) {
  state.importMode = mode;
  $('import-direct').classList.toggle('selected',mode === 'open'); $('import-convert').classList.toggle('selected',mode === 'convert');
  show('conversion-output',mode === 'convert');
  $('import-title').textContent = mode === 'open' ? 'Open a local file' : 'Import as Parquet';
  $('import-description').textContent = mode === 'open' ? 'No upload. We read the file right where it lives.' : 'Create a compressed Parquet copy and open it for analysis.';
  $('confirm-import').textContent = mode === 'open' ? 'Open dataset ↗' : 'Convert & open ↗';
  suggestOutput();
}
function suggestOutput() {
  const path = $('import-path').value;
  const stem = (path.split(/[\\/]/).pop() || 'dataset').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_') || 'dataset';
  if (!$('import-output').dataset.custom) $('import-output').value = state.data.workspace + '\\imports\\' + stem + '-' + Date.now() + '.parquet';
  $('import-name').placeholder=stem+' (or choose your own name)';
}
function openImport(mode) {
  delete $('import-output').dataset.custom;
  $('import-name').value='';
  inlineError('import-error',null);setImportMode(mode);$('import-dialog').showModal();
}
async function picker(mode,extension,filename='') { return (await api('/api/picker',{mode,extension,filename})).path; }
async function browseImport() {
  const path = await picker('open','csv');
  if (path) { $('import-path').value = path; show('import-preview',false);suggestOutput(); }
}
async function previewImport() {
  inlineError('import-error',null);
  try {
    const output = await runJob('preview',{path:$('import-path').value,options:importOptions()});
    $('import-preview').replaceChildren(tableFor(output.preview));show('import-preview');
    $('import-file-info').textContent = `${humanBytes(output.file.bytes)} · ${output.schema.length} columns · first ${output.preview.rows.length} rows`;
  } catch(error) { inlineError('import-error',error); }
}
async function confirmImport() {
  inlineError('import-error',null);
  if (!$('import-path').value.trim()) return inlineError('import-error',new Error('Choose a source file first.'));
  if (state.importMode === 'convert' && !$('import-output').value.trim()) return inlineError('import-error',new Error('Choose where to save the Parquet file.'));
  const action = state.importMode;
  $('import-dialog').close();
  try {
    const output = await runJob(action,{path:$('import-path').value,options:importOptions(),output:$('import-output').value,name:$('import-name').value.trim()||undefined});
    if (action === 'convert') {toast(`Parquet ready · ${Number(output.exported_rows).toLocaleString()} rows · ${humanBytes(output.bytes)}`,false,output.path);window.bedazzle?.celebrate('Parquet ready',Number(output.exported_rows).toLocaleString()+' rows');}
    else toast('Dataset opened. Your source file stays where it is.');
    await selectDataset(output.name);
  } catch(error) { $('import-dialog').showModal();inlineError('import-error',error); }
}
function openExport() {
  if (!state.result?.selectable) throw new Error('Run a SELECT query first, then export its complete result.');
  $('export-sql').value = state.result.sql;
  $('export-path').value = '';inlineError('export-error',null);$('export-dialog').showModal();
}
async function confirmExport() {
  inlineError('export-error',null);
  if (!$('export-path').value.trim()) return inlineError('export-error',new Error('Choose where to save the export.'));
  $('export-dialog').close();
  try {
    const output = await runJob('export',{sql:$('export-sql').value,format:$('export-format').value,output:$('export-path').value});
    toast(`Export complete · ${Number(output.exported_rows).toLocaleString()} rows · ${humanBytes(output.bytes)}`,false,output.path);
    window.bedazzle?.celebrate('Export done',Number(output.exported_rows).toLocaleString()+' rows saved');
  } catch(error) { $('export-dialog').showModal();inlineError('export-error',error); }
}
async function showSettings() {
  await refresh();
  if(state.data.effective.error)toast(state.data.effective.error,true);
  const hw = state.data.hardware, settings = state.data.settings;
  $('hardware-cards').replaceChildren(...[
    [`${(hw.total_mb/1024).toFixed(0)} GB`,'Installed RAM'],[`${(hw.available_mb/1024).toFixed(1)} GB`,'Available RAM'],[`${hw.disk_free_gb} GB`,'Free workspace disk']
  ].map(([value,label])=>node('div',{},node('strong',{},value),node('span',{},label))));
  for (const [id,key] of [['profile','profile'],['memory','memory_mb'],['threads','threads'],['spill','spill_gb'],['timeout','timeout']]) $('setting-'+id).value = settings[key];
  inlineError('settings-error',null);$('settings-dialog').showModal();
}
async function saveSettings() {
  try {
    state.data = {...state.data,...await api('/api/settings',{profile:$('setting-profile').value,memory_mb:Number($('setting-memory').value),threads:Number($('setting-threads').value),spill_gb:Number($('setting-spill').value),timeout:Number($('setting-timeout').value)})};
    renderResources();$('settings-dialog').close();toast('Performance settings saved. Every new operation uses them.');
  } catch(error) { inlineError('settings-error',error); }
}
async function openLibrary(kind) {
  await refresh();state.library = kind;$('library-title').textContent=kind === 'saved' ? 'Query library' : 'Recent queries';
  $('library-search').value='';renderLibrary();$('library-dialog').showModal();
}
function renderLibrary() {
  const search=$('library-search').value.toLowerCase();
  const items=state.data[state.library].filter(item=>(item.name+' '+item.sql).toLowerCase().includes(search));
  $('library-list').replaceChildren();
  if (!items.length) return $('library-list').append(node('p',{class:'library-empty'},state.library === 'saved' ? 'Save a query to keep it here for next time.' : 'Your recent queries will appear here.'));
  for (const item of items) {
    const button=node('button',{class:'library-item-main',onclick:()=>{setEditor(item.sql);setMode('sql');workArea();$('library-dialog').close();}},
      node('strong',{},item.name || item.sql.split('\n')[0].slice(0,90)),node('code',{},item.sql),node('small',{},new Date(item.created*1000).toLocaleString()));
    const row=node('div',{class:'library-item'},button);
    if (state.library === 'saved') row.append(node('button',{class:'text-button',onclick:async()=>{try{const data=await api('/api/remove-saved',{id:item.id});state.data.saved=data.saved;$('saved-count').textContent=data.saved.length;renderLibrary();}catch(error){report(error);}}},'Remove'));
    $('library-list').append(row);
  }
}
function saveDialog() { if (!$('sql-editor').value.trim()) throw new Error('Write a query first.');$('saved-name').value='';$('save-dialog').showModal();$('saved-name').focus(); }
async function saveQuery() {
  const output=await api('/api/save',{name:$('saved-name').value,sql:$('sql-editor').value});
  state.data.saved=output.saved;$('saved-count').textContent=output.saved.length;$('save-dialog').close();toast('Query saved to your library.');
}
function showSchema() {
  const source=selectedSource();if(!source) throw new Error('Open a dataset first.');
  $('detail-title').textContent=source.name+' · columns';$('detail-eyebrow').textContent='CLICK A NAME TO INSERT IT INTO SQL';
  $('detail-content').replaceChildren(node('div',{class:'schema-list'},source.columns.map(column=>node('button',{onclick:()=>{insertSQL(sqlName(column.name));$('detail-dialog').close();}},column.name,node('small',{},column.type)))));
  $('detail-dialog').showModal();
}
function insertSQL(text) { const area=$('sql-editor');area.setRangeText(text,area.selectionStart,area.selectionEnd,'end');setMode('sql');area.focus();updateLines();cacheTab();persistTabs();localStorage.setItem('fieldwork-editor',area.value); }
async function explain() {
  const sql=state.mode==='explore'?buildQuery().sql:$('sql-editor').value;
  const output=await runJob('explain',{sql});
  $('detail-title').textContent='How DuckDB reads this query';$('detail-eyebrow').textContent='QUERY PLAN · NO DATA QUERY EXECUTED';
  $('detail-content').replaceChildren(node('pre',{},output.plan));$('detail-dialog').showModal();
}
async function profile() {
  if(!state.selected) throw new Error('Choose a dataset first.');
  const output=await runJob('profile',{name:state.selected});state.profile=output.profile;
  $('profile-table').replaceChildren(tableFor(output.profile));setResultView('profile');
}
function autocomplete() {
  const names=[...new Set([...state.data.catalog.map(item=>item.name),...state.data.catalog.flatMap(item=>item.columns.map(c=>c.name))])].slice(0,100);
  $('suggestions').replaceChildren(...names.map(name=>node('button',{onclick:()=>{insertSQL(sqlName(name));show('suggestions',false);}},name)));
  show('suggestions',!!names.length);
}
function openRename(name=state.selected){
  if(state.busy)return toast('Wait for the current operation or cancel it first.');
  if(!name)return toast('Open a dataset first.');
  $('rename-name').value=name;$('rename-dialog').dataset.original=name;
  inlineError('rename-error',null);$('rename-dialog').showModal();$('rename-name').select();
}
async function renameDataset(){
  const old=$('rename-dialog').dataset.original;
  const wasSelected=state.selected===old;
  try{
    const renamed=await runJob('rename',{name:old,new_name:$('rename-name').value});
    if(wasSelected)state.selected=renamed.name;
    state.tabs.forEach(tab=>{if(tab.name===old)tab.name=renamed.name;});
    renderTabs();persistTabs();renderCatalog();datasetHeading(state.selected);
    $('rename-dialog').close();toast('Dataset renamed. Earlier SQL using its old name still works.');
  }catch(error){inlineError('rename-error',error);}
}
function bind(id,event,handler) { $(id).addEventListener(event,e=>{Promise.resolve().then(()=>handler(e)).catch(report);}); }

async function init() {
  const busy=node('div',{id:'import-busy',class:'callout hidden'},'Previewing in the native engine… ',node('button',{class:'text-button',onclick:()=>cancelJob().catch(report)},'Cancel preview'));
  $('import-dialog').insertBefore(busy,$('import-dialog').querySelector('.modal-footer'));
  await refresh();
  if(state.data.effective.error)toast(state.data.effective.error,true);
  const tabBar=node('div',{id:'query-tabs',class:'query-tabs','aria-label':'SQL tabs'});
  document.querySelector('.editor-panel').prepend(tabBar);
  try{
    const local=JSON.parse(localStorage.getItem('fieldwork-tabs')||'null');
    const remote=state.data.drafts;
    const saved=remote&&(!local||remote.updated>=local.updated)?remote:local;
    if(saved&&Array.isArray(saved.tabs)&&saved.tabs.length){state.tabs=saved.tabs.slice(0,10).filter(tab=>typeof tab.sql==='string'&&typeof tab.name==='string');state.activeTab=saved.active;}
  }catch{}
  if(!state.tabs.length)state.tabs=[{id:crypto.randomUUID(),name:'Query 1',sql:localStorage.getItem('fieldwork-editor')||'SELECT 42 AS a_good_place_to_start;'}];
  if(!state.tabs.some(tab=>tab.id===state.activeTab))state.activeTab=state.tabs[0].id;
  setEditor(state.tabs.find(tab=>tab.id===state.activeTab).sql);renderTabs();
  bind('open-file','click',()=>openImport('open'));bind('empty-open','click',()=>openImport('open'));bind('sidebar-add','click',()=>openImport('open'));
  bind('import-parquet','click',()=>openImport('convert'));bind('import-direct','click',()=>setImportMode('open'));bind('import-convert','click',()=>setImportMode('convert'));
  bind('browse-import','click',browseImport);bind('preview-import','click',previewImport);bind('confirm-import','click',confirmImport);
  bind('import-path','input',()=>{show('import-preview',false);suggestOutput();});
  bind('rename-current','click',()=>openRename());bind('confirm-rename','click',renameDataset);
  bind('import-output','input',()=>{$('import-output').dataset.custom='true';});
  bind('browse-parquet','click',async()=>{const path=await picker('save','parquet',$('import-output').value);if(path){$('import-output').value=path;$('import-output').dataset.custom='true';}});
  bind('load-demo','click',async()=>{const output=await runJob('open',{path:state.data.demo_path,options:{types:'auto'}});await selectDataset(output.name);});
  bind('workspace-nav','click',()=>{workArea();$('sql-editor').focus();});
  bind('sql-mode','click',()=>setMode('sql'));bind('explore-mode','click',()=>setMode('explore'));
  bind('builder-dataset','change',()=>{state.selected=$('builder-dataset').value;builderColumns();});
  bind('view-generated','click',()=>{setEditor(buildQuery().sql);setMode('sql');});
  bind('run-query','click',executeEditor);bind('cancel-job','click',cancelJob);
  bind('sql-editor','input',()=>{updateLines();localStorage.setItem('fieldwork-editor',$('sql-editor').value);cacheTab();persistTabs();show('suggestions',false);});
  $('sql-editor').addEventListener('scroll',()=>{$('line-numbers').scrollTop=$('sql-editor').scrollTop;});
  $('sql-editor').addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();executeEditor().catch(report);}
    if((event.ctrlKey||event.metaKey)&&event.code==='Space'){event.preventDefault();autocomplete();}
    if(event.key==='Tab'){event.preventDefault();insertSQL('  ');}
    if(event.key==='Escape')show('suggestions',false);
    if((event.ctrlKey||event.metaKey)&&event.key==='s'){event.preventDefault();try{saveDialog();}catch(error){report(error);}}
  });
  bind('next-page','click',async()=>{state.previous.push(state.result.offset);await runSQL(state.result.sql,state.result.next_offset,false);});
  bind('previous-page','click',async()=>{const previous=state.previous.pop();await runSQL(state.result.sql,previous,false);});
  bind('page-size','change',async()=>{if(state.result)await runSQL(state.result.sql);});
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>setResultView(button.dataset.view));
  bind('chart-label','change',renderChart);bind('chart-value','change',renderChart);
  bind('run-profile','click',profile);bind('count-rows','click',async()=>{if(!state.selected)throw new Error('Choose a dataset first.');const result=await runJob('count',{name:state.selected});toast(`${result.name}: ${Number(result.count).toLocaleString()} records in the complete dataset.`);});
  bind('export-results','click',openExport);bind('confirm-export','click',confirmExport);
  bind('export-format','change',()=>{$('export-path').value='';});
  bind('browse-export','click',async()=>{const format=$('export-format').value;const path=await picker('save',format,`${state.selected||'results'}-${Date.now()}.${format}`);if(path)$('export-path').value=path;});
  bind('performance-nav','click',showSettings);bind('save-settings','click',saveSettings);
  bind('library-nav','click',()=>openLibrary('saved'));bind('history-nav','click',()=>openLibrary('history'));bind('library-search','input',renderLibrary);
  bind('save-query','click',saveDialog);bind('confirm-save','click',saveQuery);bind('show-schema','click',showSchema);bind('explain-query','click',explain);
  bind('quit','click',async()=>{if(state.busy&&!confirm('Stop the running operation and quit Bedazzle?'))return;clearTimeout(draftTimer);await api('/api/drafts',JSON.parse(localStorage.getItem('fieldwork-tabs')));await api('/api/shutdown',{});document.body.replaceChildren(node('div',{class:'result-message'},'Bedazzle has stopped.',node('small',{},'You can close this tab. Your workspace is saved.')));});
  if(state.data.catalog.length)workArea();
  // Restore metadata only. Never re-run saved SQL or expensive scans on launch.
  if(state.data.active_job){
    setBusy(true,'catalog');
    const id=state.data.active_job;
    for(;;){await pause(300);const job=await api('/api/jobs/'+id);if(job.finished){if(job.status!=='succeeded')toast(job.error,true);break;}}
    await refresh();setBusy(false);
  }
  if(state.data.catalog.length){
    show('work-area');show('empty-state',false);
    datasetHeading(state.selected);
  }
  const startup=await api('/api/startup',{});
  if(startup.convert){$('import-path').value=startup.convert;openImport('convert');}
  else if(startup.paths?.length){
    let last;
    for(const path of startup.paths)last=await runJob('open',{path,options:{types:'text'}});
    if(last)await selectDataset(last.name);
  }
}
init().catch(error=>{report(error);$('workspace-subtitle').textContent=error.message;});
