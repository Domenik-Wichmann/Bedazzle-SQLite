// An optional Pivot asset must never disable SQL, dataset opening, or Explore.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{const browser=await chromium.launch();
try{for(const missing of ['pivot.js','pivot_query.js']){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/'+missing,r=>r.fulfill({status:404,contentType:'text/plain',body:'Not found'}));
 await page.goto(session.url+'/#'+session.token);
 await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));
 await page.evaluate(()=>workArea());
 await page.locator('#sql-editor').fill('SELECT 42 AS still_working;');await page.locator('#run-query').click();
 await page.waitForFunction(()=>!state.busy&&state.result?.rows[0]?.[0]===42);
 await page.locator('#pivot-mode').click();
 assert.match(await page.locator('#toast-container').textContent(),/Pivot files could not load/);
 assert.equal(await page.evaluate(()=>state.mode),'sql');assert(await page.locator('#sql-pane').isVisible());
 await page.locator('#explore-mode').click();assert(await page.locator('#explore-pane').isVisible());
 await page.locator('#sql-mode').click();await page.locator('#sql-editor').fill('SELECT 43 AS still_working;');await page.locator('#run-query').click();
 await page.waitForFunction(()=>!state.busy&&state.result?.rows[0]?.[0]===43);
 assert.deepEqual(errors,[]);await page.close();
 console.log('PASS: missing '+missing+' preserves SQL before/after Pivot click, leaves mode intact, and keeps Explore usable');
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
