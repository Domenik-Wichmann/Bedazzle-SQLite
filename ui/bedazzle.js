'use strict';
(() => {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let helpOn=false, queued=false, popover=null, lastCelebration=0;
  const badges=new Map();
  const explanations={
    'open-file':'Open a CSV, TSV, Parquet, JSON or NDJSON file in place. This creates a SQL dataset without uploading or copying the file.',
    'empty-open':'Choose a local file. You can preview how it will be read, give it a SQL name, and open it directly or convert it.',
    'sidebar-add':'Add another local file to this workspace. Existing datasets stay available for joins.',
    'import-parquet':'Make a compressed Parquet copy, then open it as a dataset. This is usually a better working format for a large CSV.',
    'import-direct':'Query the original file directly. CSV parsing happens again when a query scans it.',
    'import-convert':'Stream the source into ZSTD-compressed Parquet. Your source is kept intact; choose a new output filename.',
    'import-path':'The full path to a file on this laptop. Browse opens the native Windows file dialog; the browser does not upload the file.',
    'import-name':'Optional SQL name for this dataset. Spaces and punctuation are allowed; use double quotes, such as FROM "My catalogs". Leave blank for an automatic name.',
    'import-types':'Text keeps IDs and leading zeros intact. Automatic detection samples the file and may choose number/date types. Use explicit SQL types for exact decimal arithmetic.',
    'import-delimiter':'How fields are separated in a CSV/TSV. Use automatic detection or choose the actual separator.',
    'import-header':'Enable this when the first row contains column names. Disable it when the first row is data.',
    'import-output':'A new .parquet file to create. Existing files are protected. Leave enough space on that drive for the output.',
    'preview-import':'Read at most 20 preview rows with your import options. This checks column names and values without loading the whole file into the interface.',
    'confirm-import':'Open the file as a dataset, or convert it and open the completed Parquet copy. Large conversions can be cancelled.',
    'browse-import':'Choose a source file using the Windows file picker. If it opens behind the browser, check the taskbar. You can also paste a path.',
    'browse-parquet':'Choose a new Parquet output path. Your original input is not replaced.',
    'run-query':'Run the editor SQL, or just the selected SQL text. Ctrl+Enter does the same. A result page appears first; the complete result count follows.',
    'sql-editor':'Write DuckDB SQL here. Ctrl+Enter runs it; Ctrl+Space suggests names; Ctrl+S saves a named query. Select part of a script to run only that part.',
    'sql-mode':'Edit the actual DuckDB SQL. You can join datasets, use CTEs, group, pivot, and create persistent working tables.',
    'explore-mode':'Build a query with a dataset, filter, grouping columns, and a measure. View generated SQL lets you inspect or edit the result.',
    'builder-dataset':'The dataset to explore. Its name is the identifier used after FROM in SQL.',
    'filter-column':'Choose a column to filter across the full dataset. No filter leaves every record eligible.',
    'filter-op':'Contains and equals compare text. Greater/less than convert values to numbers. NULL checks find missing values.',
    'filter-value':'The value to look for. The filter applies before grouping. NULL conditions do not need a value.',
    'group-columns':'Select grouping columns. Hold Ctrl to select several, or Ctrl-click a selected column to deselect it. Grouped rows can be expanded to see matching records.',
    'aggregate':'Count rows or distinct values; sum or average numeric values; or find a minimum/maximum. Clear grouping columns to return to individual rows.',
    'measure-column':'The column to aggregate. Sum/average use numeric conversion and ignore nonnumeric values. Minimum/maximum use the original column type.',
    'view-generated':'Put the visual explorer query into the SQL editor. No query runs until you press Run.',
    'show-schema':'See the selected dataset’s column names and types. Click a column name to insert a safely quoted identifier into SQL.',
    'explain-query':'Ask DuckDB how it plans to execute a SELECT. This shows the plan without running the data query.',
    'save-query':'Save this editor’s SQL with a name. Saved queries live in this workspace and do not execute when reopened.',
    'confirm-save':'Store a named query in the query library. The original SQL text is preserved.',
    'saved-name':'A friendly title for the saved query, such as “URLs shared by clients”. This is independent of dataset names.',
    'export-results':'Export every row matched by the SQL, not only the visible page. A LIMIT written in your SQL still applies.',
    'export-format':'Parquet preserves types and compresses well. CSV/TSV are broadly compatible; JSON is one array; NDJSON is one record per line.',
    'export-path':'Where the complete result should be written. Choose a new filename; existing output is never silently overwritten.',
    'export-sql':'The exact SELECT to export. You can edit it here. Export reruns it, so changed source data can change the output.',
    'browse-export':'Choose an output file with the correct extension for the selected export format.',
    'confirm-export':'Stream the complete SELECT output directly to disk. The preview/page limit does not limit export rows or values.',
    'count-rows':'Count all records in the selected dataset. This is different from the total of your current filtered or grouped query.',
    'run-profile':'Scan the selected dataset for per-column types, NULLs, ranges and statistics. This can take time on a large CSV.',
    'page-size':'Maximum rows requested for one result page. Wide or long-text results can have fewer rows to keep memory and rendering bounded.',
    'next-page':'Fetch the next page of this SQL result. Use ORDER BY for repeatable ordering. Deep pages can take longer to compute.',
    'previous-page':'Return to the previous page. The exact result total is separate from the number of visible rows.',
    'chart-label':'Which result column labels each bar. Charts show up to 30 records from this result page.',
    'chart-value':'A numeric result column to plot. Aggregate with SQL first for a whole-dataset summary.',
    'cancel-job':'Stop this operation’s worker. If only the total count is still running, the page already shown stays visible.',
    'rename-current':'Rename the selected dataset. This changes its SQL identifier, not the filename. Earlier SQL names remain available as compatibility aliases.',
    'rename-name':'The new SQL dataset name. Names must be unique. Double quotes let you use names with spaces.',
    'confirm-rename':'Rename the dataset atomically. Previous SQL using its old name keeps working, and the source file is not moved.',
    'performance-nav':'See installed/free RAM and disk space. Choose memory, threads, temporary disk and an operation time limit.',
    'setting-profile':'Balanced picks conservative defaults. Quiet caps queries at two threads to leave more room for other applications.',
    'setting-memory':'DuckDB’s buffer budget in MB. Zero chooses an adaptive budget. Other allocations and the interface use additional RAM.',
    'setting-threads':'CPU threads for a query. Zero chooses automatically. Fewer threads can reduce memory use and laptop fan activity.',
    'setting-spill':'Maximum temporary disk space for query operations that spill to disk. Converted/exported output files need separate room.',
    'setting-timeout':'How long one operation may run before it is stopped. Use Until I cancel for a deliberately long import or export.',
    'save-settings':'Save performance limits for the next operation. The current operation must finish or be cancelled first.',
    'load-demo':'Open the tiny included catalogs CSV so you can try SQL, grouping, charts and exports without touching your own files.',
    'library-nav':'Open saved named SQL queries. Loading one changes the editor; it does not execute SQL.',
    'history-nav':'See recent successful queries in this workspace and load one back into the editor.',
    'library-search':'Filter saved/recent queries by their name or SQL text.',
    'download-instructions':'Download a Markdown guide for an LLM or coding agent. It includes Bedazzle’s features, SQL examples and your current dataset names/column types, with no row data.',
    'workspace-nav':'Return to the SQL workspace. You can also run SQL without opening a file, for example SELECT 42.',
    'quit':'Stop the local server and any running worker, save your SQL drafts, and leave persistent workspace data on disk.'
  };
  function make(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;}
  function closeHelp(){popover?.remove();popover=null;}
  function description(control){
    if(explanations[control.id])return explanations[control.id];
    if(control.classList.contains('dataset-item'))return 'Open a preview of this dataset in a SQL tab. The pencil beside it changes its SQL name.';
    if(control.classList.contains('dataset-rename'))return explanations['rename-current'];
    if(control.classList.contains('drill-button'))return 'Expand or collapse the records in this group. The visual explorer’s filter is preserved.';
    if(control.closest('.query-tab'))return control.classList.contains('tab-close')?'Close this SQL tab. Save a named query first if you want to keep it in the library.':'Switch SQL tabs. Each tab keeps its own editor and bounded result preview.';
    if(control.classList.contains('new-tab'))return 'Open another SQL tab. Up to ten tabs can stay open; drafts are saved automatically.';
    if(control.closest('th'))return 'Sort the complete SELECT result by this column. Click again to reverse the direction.';
    if(control.dataset.view==='table')return 'Show the current page of query results, with the exact total displayed once counting finishes.';
    if(control.dataset.view==='chart')return 'Make a bar chart from numeric columns in the current result page.';
    if(control.dataset.view==='profile')return explanations['run-profile'];
    if(control.classList.contains('close-button'))return 'Close this window without starting an operation.';
    if(control.classList.contains('library-item-main'))return 'Load this saved/recent query into the editor without running it.';
    if(control.classList.contains('text-button')&&control.textContent==='Remove')return 'Remove this saved query from the library. Dataset files are unaffected.';
    if(control.closest('.schema-list'))return 'Insert this column’s quoted name at the cursor in the SQL editor.';
    return control.title||control.getAttribute('aria-label')||'Use this control to work with the current file or query. The downloaded Agent Instructions guide has more examples.';
  }
  function title(control){return control.getAttribute('aria-label')||control.labels?.[0]?.childNodes[0]?.textContent?.trim()||control.textContent?.trim().slice(0,65)||control.id.replaceAll('-',' ');}
  function showHelp(control,badge){
    closeHelp();
    const box=make('div','help-popover');box.setAttribute('role','tooltip');
    box.append(make('strong','',title(control)),make('p','',description(control)));
    const close=make('button','help-close','×');close.setAttribute('aria-label','Close help');close.onclick=closeHelp;box.append(close);
    (control.closest('dialog[open]')||document.body).append(box);popover=box;
    const rect=badge.getBoundingClientRect();
    const left=Math.max(10,Math.min(innerWidth-320,rect.right-280));
    box.style.left=left+'px';box.style.top=Math.max(10,Math.min(innerHeight-box.offsetHeight-12,rect.bottom+8))+'px';
  }
  function placeHelp(){
    queued=false;if(!helpOn)return;
    const controls=[...document.querySelectorAll('button,input,select,textarea')].filter(c=>!c.closest('.help-popover,.celebration,.toast')&&!c.classList.contains('help-badge')&&c.id!=='help-toggle'&&!c.closest('#help-toggle')&&c.offsetWidth>0&&c.offsetHeight>0);
    const live=new Set(controls);
    for(const [control,badge] of badges)if(!live.has(control)||!control.isConnected){badge.remove();badges.delete(control);}
    for(const control of controls){
      const rect=control.getBoundingClientRect();
      if(rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth){badges.get(control)?.remove();badges.delete(control);continue;}
      let badge=badges.get(control);
      if(!badge){badge=make('button','help-badge','i');badge.type='button';badge.setAttribute('aria-label','Help: '+title(control));badge.onclick=e=>{e.stopPropagation();showHelp(control,badge);};badges.set(control,badge);}
      const owner=control.closest('dialog[open]')||document.body;
      if(badge.parentNode!==owner)owner.append(badge);
      badge.style.left=Math.min(innerWidth-20,Math.max(2,rect.right-7))+'px';badge.style.top=Math.max(2,rect.top-6)+'px';
    }
  }
  function queueHelp(){if(helpOn&&!queued){queued=true;requestAnimationFrame(placeHelp);}}
  function toggleHelp(){
    helpOn=!helpOn;document.body.classList.toggle('help-enabled',helpOn);
    document.getElementById('help-toggle').setAttribute('aria-pressed',String(helpOn));
    document.getElementById('help-toggle-label').textContent=helpOn?'Tips on':'Tips off';
    closeHelp();
    if(helpOn)placeHelp();else{for(const badge of badges.values())badge.remove();badges.clear();}
  }
  function celebrate(heading='Done',detail=''){
    document.querySelector('.celebration')?.remove();
    const card=make('div','celebration');card.setAttribute('role','status');
    const dismiss=make('button','celebration-dismiss','×');dismiss.setAttribute('aria-label','Dismiss celebration');dismiss.onclick=()=>card.remove();
    card.append(make('span','celebration-emoji','🎉'),make('strong','',heading+'!'),make('p','',detail),dismiss);
    if(!reduced.matches)for(let i=0;i<30;i++){
      const piece=make('span','confetti');piece.setAttribute('aria-hidden','true');
      piece.style.setProperty('--x',(Math.random()*440-220)+'px');piece.style.setProperty('--y',(-70-Math.random()*250)+'px');piece.style.setProperty('--r',(Math.random()*720-360)+'deg');
      piece.style.setProperty('--delay',(Math.random()*.25)+'s');piece.style.setProperty('--color',['#d9b469','#b9dfad','#d1b8e8','#f0c7c0','#97c9bc'][i%5]);card.append(piece);
    }
    document.body.append(card);lastCelebration=performance.now();setTimeout(()=>card.remove(),3200);
  }
  function sparkle(event){
    if(reduced.matches||!event.isTrusted)return;
    const control=event.target.closest('.button.primary,.segmented button,.new-tab');
    if(!control||control.disabled)return;
    const rect=control.getBoundingClientRect();
    const originX=event.clientX||rect.left+rect.width/2,originY=event.clientY||rect.top+rect.height/2;
    for(let i=0;i<7;i++){
      const star=make('span','click-sparkle','✦');star.setAttribute('aria-hidden','true');star.style.left=originX+'px';star.style.top=originY+'px';
      star.style.setProperty('--sx',(Math.random()*80-40)+'px');star.style.setProperty('--sy',(-15-Math.random()*60)+'px');
      (control.closest('dialog[open]')||document.body).append(star);setTimeout(()=>star.remove(),800);
    }
  }
  async function downloadInstructions(){
    const response=await fetch('/api/agent-instructions',{headers:{'X-Workbench-Token':sessionStorage.getItem('fieldwork-token')||''}});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'Could not download instructions.');
    const url=URL.createObjectURL(new Blob([value.markdown],{type:'text/markdown;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=value.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.getElementById('help-toggle').addEventListener('click',toggleHelp);
  document.getElementById('download-instructions').addEventListener('click',()=>downloadInstructions().catch(e=>alert(e.message)));
  document.addEventListener('click',event=>{sparkle(event);if(!event.target.closest('.help-popover,.help-badge'))closeHelp();queueHelp();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&popover){event.preventDefault();closeHelp();}});
  document.addEventListener('scroll',queueHelp,true);window.addEventListener('resize',queueHelp);
  new MutationObserver(mutations=>{if(mutations.some(m=>[...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1&&!n.matches?.('.help-badge,.help-popover,.click-sparkle'))))queueHelp();}).observe(document.body,{childList:true,subtree:true});
  window.bedazzle={celebrate};
})();
