const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(session.url+'/#'+session.token);await page.waitForFunction(()=>!!state.data);
 await page.evaluate(async()=>{
   await runSQL(`CREATE OR REPLACE TABLE pivot_sales AS SELECT * FROM (VALUES ('East','A','Jan',10),('East','A','Feb',20),('East','B','Jan',5),('West','C','Feb',15)) t(region,team,month,amount);`);
   await refresh();workArea();
 });
 await page.locator('#pivot-mode').click();await page.locator('#pivot-dataset').selectOption('pivot_sales');
 assert(await page.evaluate(()=>document.body.classList.contains('sidebar-collapsed')));
 const rail=await page.locator('.pivot-field-panel').boundingBox(),area=await page.locator('#work-area').boundingBox(),resultPanel=await page.locator('.results-panel').boundingBox();
 assert(Math.abs(rail.height-area.height)<2);assert(rail.width>=230);assert(resultPanel.x>=rail.x+rail.width);
 assert.equal(await page.getByRole('button',{name:'View SQL ↗',exact:true}).count(),0);
 await page.locator('#pivot-live').uncheck();
 async function field(name,zone){const field=page.locator('.pivot-field').filter({hasText:new RegExp('^'+(name==='amount'?'#':'Aa')+name+'\\+$')});if(zone===(name==='amount'?'values':'rows'))await field.click();else await field.dragTo(page.locator('#pivot-'+zone));}
 await field('region','rows');await field('team','rows');await field('month','columns');await field('amount','values');
 await page.locator('#run-query').click();await page.waitForFunction(()=>!state.busy&&state.result?.sql.includes('GROUPING SETS'));
 assert.match(await page.locator('#pivot-status').textContent(),/Up to date/);
 const result=await page.evaluate(()=>state.result);const total=result.rows.find(r=>r[2]==='Grand total');assert.deepEqual(total.slice(3),[35,15,50]); // Feb, Jan, all
 assert.equal(await page.locator('.pivot-total-row').count(),3);
 assert.equal(result.rows[0][0],'East');assert.equal(result.rows[0][2],'Subtotal · 1');
 await page.getByRole('button',{name:'Collapse East',exact:true}).click();await page.waitForFunction(()=>!state.busy&&state.result?.rows.length===4);
 assert.deepEqual((await page.evaluate(()=>state.result.rows)).find(r=>r[2]==='Grand total').slice(3),[35,15,50]);
 await page.getByRole('button',{name:'Expand East',exact:true}).click();await page.waitForFunction(()=>!state.busy&&state.result?.rows.length===6);
 await page.locator('#pivot-pane').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(session.workspace,'pivot-desktop.png')});
 await page.locator('.pivot-cell').first().click();await page.locator('#detail-dialog[open]').waitFor();assert.match(await page.locator('#detail-content').textContent(),/matching records/);await page.locator('#detail-dialog .close-button').click();
 // Reorder and move fields through actual HTML drag/drop, then update.
 await page.locator('#pivot-rows .pivot-chip').nth(1).dragTo(page.locator('#pivot-filters'));
 assert.equal(await page.locator('#pivot-rows .pivot-chip').count(),1);assert.equal(await page.locator('#pivot-filters .pivot-chip').count(),1);
 await page.locator('#pivot-filters input').fill('A');await page.locator('#run-query').click();await page.waitForFunction(()=>!state.busy&&state.result?.rows.some(r=>r.includes('Grand total')&&r.at(-1)===30));
 await page.locator('#pivot-live').check();await page.locator('#pivot-filters input').fill('B');await page.waitForFunction(()=>!state.busy&&state.result?.rows.some(r=>r.includes('Grand total')&&r.at(-1)===5));
 await page.locator('#pivot-filters input').fill('A');await page.waitForFunction(()=>!state.busy&&state.result?.rows.some(r=>r.includes('Grand total')&&r.at(-1)===30));await page.locator('#pivot-live').uncheck();
 // Multiple measures and persisted layout.
 await page.getByRole('button',{name:'+ Count records',exact:true}).click();
 await page.getByRole('button',{name:'Save layout',exact:true}).click();await page.locator('#pivot-save-name').fill('Monthly sales');await page.locator('#detail-content').getByRole('button',{name:'Save layout',exact:true}).click();
 await page.reload();await page.waitForFunction(()=>!!state.data);await page.evaluate(()=>workArea());await page.locator('#pivot-mode').click();
 assert.equal(await page.locator('#pivot-values .pivot-chip').count(),2);assert.equal(await page.locator('#pivot-filters input').inputValue(),'A');
 await page.locator('#run-query').click();await page.waitForFunction(()=>!state.busy&&state.result?.sql.includes('count(*)'));
 await page.locator('#export-results').click();const output=path.join(session.workspace,'pivot-browser-'+Date.now()+'.csv');await page.locator('#export-format').selectOption('csv');await page.locator('#export-path').fill(output);await page.locator('#confirm-export').click();await page.waitForFunction(()=>!state.busy&&!document.querySelector('#export-dialog').open);assert(fs.readFileSync(output,'utf8').includes('Grand total'));
 await page.locator('#sql-mode').click();await page.waitForFunction(()=>state.mode==='sql');assert((await page.locator('#sql-editor').inputValue()).includes('GROUPING SETS'));
 assert(!(await page.evaluate(()=>document.body.classList.contains('sidebar-collapsed'))));
 await page.locator('#pivot-mode').click();await page.locator('#pivot-pane').evaluate(e=>e.scrollTop=0);
 await page.setViewportSize({width:760,height:850});await page.evaluate(()=>document.body.classList.add('sidebar-collapsed'));await page.screenshot({path:path.join(session.workspace,'pivot-narrow.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS: Pivot tab, click-to-add, drag/drop, multi-level totals, collapse/expand without changing totals, drill-through, filters, multiple values, saved layout reload, CSV export, SQL handoff and narrow layout');
 console.log('Screenshots: '+session.workspace);
}catch(error){console.error(await page.locator('#pivot-status').textContent());console.error(await page.locator('#toast-container').textContent());console.error(errors);await page.screenshot({path:'workspace/pivot-failure.png'});throw error;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
