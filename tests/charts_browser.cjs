const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION));
(async()=>{
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1500,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER:',m.text());});
 const chooseValues=async(id,names)=>{
  const picker=page.locator('#'+id+'-picker');
  if(!(await picker.evaluate(el=>el.open)))await picker.locator('summary').click();
  const values=await picker.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value));
  for(const value of values)await picker.getByRole('checkbox',{name:value,exact:true}).setChecked(names.includes(value));
  await picker.locator('summary').click();
  assert.deepEqual(await page.locator('#'+id).evaluate(select=>[...select.selectedOptions].map(o=>o.value)),values.filter(v=>names.includes(v)));
  assert.equal(await picker.locator('.cs-value-chip').count(),names.length);
 };
 try{
  await page.goto(session.url+'/#'+session.token);await page.waitForFunction(()=>!!state.data&&!state.busy);
  await page.evaluate(async()=>{workArea();await runSQL('SELECT '+Array.from({length:60},(_,i)=>i+' AS field_'+i).join(','));setResultView('chart');});
  await page.locator('#chart-value-toggle').click();assert.equal(await page.locator('#chart-value-picker input').count(),60);
  const expanded=await page.locator('#chart-value-picker .cs-values-options').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
  assert(expanded.height>1800,'All 60 options should take their natural vertical space');assert.equal(expanded.height,expanded.scroll);assert.equal(expanded.overflow,'visible');
  await page.locator('#chart-value-picker').getByRole('checkbox',{name:'field_0',exact:true}).check();
  await page.locator('#chart-value-picker').getByRole('checkbox',{name:'field_59',exact:true}).press('Escape');
  assert(!(await page.locator('#chart-value-picker').evaluate(el=>el.open)));assert.equal(await page.locator('#chart-value-picker .cs-value-chip').count(),2);
  await page.evaluate(async()=>{workArea();await runSQL("SELECT 'Category '||(i%6) AS category, CASE WHEN i%2=0 THEN 'East' ELSE 'West' END AS region, i+1 AS revenue, (i+1)*2 AS cost FROM range(1200) t(i)");setResultView('chart');});
  await page.locator('#chart-content svg').waitFor();
  await chooseValues('chart-value',['revenue','cost']);await page.locator('#chart-type').selectOption('line');
  assert.equal(await page.evaluate(()=>quickChart.getOption().series.length),2);
  await page.locator('#module-menu').selectOption('chart-studio');await page.locator('#chart-studio').waitFor({state:'visible'});await page.waitForFunction(()=>!state.busy&&!!chartStudio.chart);
  await page.locator('#cs-title').fill('Revenue overview');await chooseValues('cs-ys',['revenue','cost']);await page.locator('#cs-type').selectOption('line');await page.locator('#cs-split').selectOption('region');await page.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);
  await page.locator('#cs-ys-toggle').click();await page.screenshot({path:path.join(session.workspace,'chart-values-expanded.png')});
  await page.locator('#cs-ys-picker').getByRole('checkbox',{name:'cost',exact:true}).press('Escape');assert(await page.locator('#chart-studio').isVisible());assert(!(await page.locator('#cs-ys-picker').evaluate(el=>el.open)));
  assert.equal(await page.evaluate(()=>chartStudio.preview.matching_rows),1200);assert.equal(await page.evaluate(()=>chartStudio.chart.getOption().series.length),4);
  assert.equal(await page.evaluate(()=>chartStudio.preview.rows.reduce((s,r)=>s+r[2],0)),720600);
  await page.locator('#cs-save').click();await page.waitForFunction(()=>!!chartStudio.id&&!state.busy);
  const layout=await page.evaluate(()=>{const rect=id=>{const b=$(id).getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,right:b.right};};return {studio:rect('chart-studio'),canvas:rect('cs-canvas'),settings:rect('cs-controls')};});
  assert.equal(layout.studio.w,1500);assert.equal(layout.studio.h,1000);assert.equal(layout.studio.x,0);assert.equal(layout.studio.y,0);assert(layout.settings.x>=layout.canvas.right);assert(layout.canvas.h>800);assert(layout.canvas.w>1000);
  await page.locator('#cs-toggle-settings').click();assert(!(await page.locator('#cs-controls').isVisible()));assert((await page.locator('#cs-canvas').boundingBox()).width>layout.canvas.w+250);await page.locator('#cs-toggle-settings').click();
  await page.getByText('Appearance & interaction',{exact:true}).click();await page.locator('#cs-numberStyle').selectOption('compact');await page.locator('#cs-legend').uncheck();await page.locator('#cs-zoom').uncheck();await page.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);
  assert.equal(await page.evaluate(()=>chartStudio.chart.getOption().legend[0].show),false);assert.equal(await page.evaluate(()=>chartStudio.chart.getOption().dataZoom.length),0);
  await page.locator('#cs-legend').check();await page.locator('#cs-zoom').check();await page.locator('#cs-numberStyle').selectOption('number');
  await page.getByText('Chart details',{exact:true}).click();await page.locator('#cs-connectGaps').check();await page.locator('#cs-lineWidth').fill('5');await page.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);
  assert.equal(await page.evaluate(()=>chartStudio.chart.getOption().series[0].connectNulls),true);assert.equal(await page.evaluate(()=>chartStudio.chart.getOption().series[0].lineStyle.width),5);
  await page.locator('#cs-save').click();await page.waitForFunction(()=>!state.busy);
  const source=await page.evaluate(()=>chartStudio.source),popup=page.waitForEvent('popup');await page.locator('#cs-detach').click();let child=await popup;child.on('pageerror',e=>errors.push(e.message));
  await child.locator('#chart-studio[open] #cs-canvas svg').waitFor();assert.equal(await page.locator('#chart-studio').count(),0);
  assert.equal(await page.locator('#cs-owner-link').evaluate(e=>e.style.background),await child.locator('#cs-link').evaluate(e=>e.style.background));
  const resultsPopup=page.waitForEvent('popup');await page.locator('#detach-results').click();const resultsChild=await resultsPopup;await resultsChild.locator('#result-table').waitFor({state:'attached'});
  assert.equal(await resultsChild.locator('.detached-pair-color').evaluate(e=>e.style.background),await child.locator('#cs-link').evaluate(e=>e.style.background));await resultsChild.close();assert(!child.isClosed());
  const other=await page.context().newPage();await other.goto(session.url+'/#'+session.token);await other.waitForFunction(()=>!!state.data&&!state.busy);
  await other.evaluate(async()=>{workArea();await runSQL('SELECT 1 AS x,99 AS value');await csOpen();});
  const otherPopup=other.waitForEvent('popup');await other.locator('#cs-detach').click();const otherChild=await otherPopup;await otherChild.locator('#cs-link').waitFor();
  assert.notEqual(await otherChild.locator('#cs-link').evaluate(e=>e.style.background),await child.locator('#cs-link').evaluate(e=>e.style.background));assert.equal(await other.evaluate(()=>chartStudio.info.rows),1);assert.equal(await page.evaluate(()=>chartStudio.info.rows),1200);
  const otherClosed=otherChild.waitForEvent('close');await other.close();await otherClosed;assert(!child.isClosed());
  assert.equal(await page.evaluate(()=>chartStudio.source),source);await child.locator('#cs-title').fill('Linked chart');await child.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);assert((await child.locator('#cs-canvas').innerText()).includes('Linked chart'));
  const childDownload=child.waitForEvent('download');await child.getByRole('button',{name:'Export SVG',exact:true}).click();assert((await childDownload).suggestedFilename().endsWith('.svg'));
  await child.screenshot({path:path.join(session.workspace,'chart-studio-detached.png')});
  await child.setViewportSize({width:460,height:740});await child.locator('#cs-toggle-settings').click();assert(await child.locator('#cs-detach').isVisible());assert(await child.locator('#cs-link').isVisible());assert(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await child.close();await page.locator('#chart-studio[open]').waitFor();assert.equal(await page.locator('#cs-title').inputValue(),'Linked chart');
  if(!(await page.locator('#cs-controls').isVisible()))await page.locator('#cs-toggle-settings').click();
  const nextPopup=page.waitForEvent('popup');await page.locator('#cs-detach').click();child=await nextPopup;await child.locator('#cs-link').waitFor();await child.locator('#cs-link').dblclick();await page.locator('#chart-studio[open]').waitFor();assert(child.isClosed());
  const blocked=await page.evaluate(()=>{const open=window.open;window.open=()=>null;csDetach();window.open=open;return !csPortal.child&&$('chart-studio').open;});assert(blocked);
  await page.locator('#cs-title').fill('Revenue overview');
  for(const type of ['bar','horizontal','stacked','line','smooth','area','stacked-area','heatmap']){
   await page.locator('#cs-type').selectOption(type);await page.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);
   assert(await page.locator('#cs-canvas svg').count(),type);
  }
  await chooseValues('cs-ys',['revenue']);await page.locator('#cs-split').selectOption('');
  for(const type of ['radar','pie','donut','rose','treemap','funnel','histogram','boxplot']){
   await page.locator('#cs-type').selectOption(type);await page.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);assert(await page.locator('#cs-canvas svg').count(),type);
  }
  await page.locator('#cs-x').selectOption('cost');await page.locator('#cs-type').selectOption('scatter');await page.locator('#cs-update').click();await page.waitForFunction(()=>!state.busy&&!chartStudio.dirty);
  for(const format of ['PNG','SVG']){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export '+format,exact:true}).click();const download=await pending;await download.saveAs(path.join(session.workspace,'chart-export.'+format.toLowerCase()));assert(fs.statSync(path.join(session.workspace,'chart-export.'+format.toLowerCase())).size>500);}
  await page.screenshot({path:path.join(session.workspace,'chart-studio.png')});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(async()=>{await api('/api/clear-results',{});state.result=null;});
  await page.reload();await page.waitForFunction(()=>!!state.data&&!state.busy);await page.locator('#chart-dashboards-nav').click();await page.locator('#chart-dashboards').waitFor({state:'visible'});await page.locator('.cs-dashboard-canvas svg').waitFor();
  assert.equal(await page.locator('.cs-chart-card').count(),1);assert(await page.locator('.cs-dashboard-canvas').innerText().then(t=>t.includes('Revenue overview')));
  await page.screenshot({path:path.join(session.workspace,'chart-dashboard.png')});
  await page.emulateMedia({media:'print'});assert(await page.locator('.cs-dashboard-canvas svg').isVisible());assert(!(await page.getByRole('button',{name:'Print / PDF',exact:true}).isVisible()));
  await page.pdf({path:path.join(session.workspace,'chart-dashboard.pdf'),format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
  await page.getByRole('button',{name:'Edit',exact:true}).click();await page.waitForFunction(()=>!!chartStudio.chart&&!state.busy);assert.equal(await page.locator('#cs-title').inputValue(),'Revenue overview');assert.equal(await page.locator('#cs-type').inputValue(),'line');assert(await page.locator('#cs-connectGaps').isChecked());assert.equal(await page.locator('#cs-lineWidth').inputValue(),'5');
  const finalPopup=page.waitForEvent('popup');await page.locator('#cs-detach').click();const finalChild=await finalPopup;await finalChild.locator('#cs-link').waitFor();const finalClosed=finalChild.waitForEvent('close');await page.reload();await finalClosed;await page.waitForFunction(()=>!!state.data&&!state.busy);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,chartTypes:17,fullRows:1200,exports:['png','svg'],savedAfterReload:true,screenshots:session.workspace}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
