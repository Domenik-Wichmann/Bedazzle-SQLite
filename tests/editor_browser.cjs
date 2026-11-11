const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');const{chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync('workspace/http-smoke-session.json'));
(async()=>{const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(session.url+'/#'+session.token);await page.locator('#workspace-nav').click();await page.locator('.workspace-card.current .button.primary').click();
 await page.locator('#sql-editor').fill('SELECT c.cl FROM catalogs AS c;');
 await page.locator('#sql-editor').evaluate(e=>{e.focus();e.setSelectionRange(11,11);});await page.keyboard.press('Control+Space');
 await page.waitForFunction(()=>completionLoaded);await page.locator('#suggestions button').filter({hasText:'client'}).first().waitFor();
 await page.keyboard.press('Tab');assert((await page.locator('#sql-editor').inputValue()).includes('c."client"'));
 await page.locator('#sql-editor').fill('SELECT regexp_mat');await page.keyboard.press('Control+Space');
 await page.locator('#suggestions button').filter({hasText:'regexp_matches'}).first().waitFor();await page.keyboard.press('Enter');
 assert((await page.locator('#sql-editor').inputValue()).includes('regexp_matches()'));
 const metrics=await page.evaluate(()=>{setEditor(Array.from({length:1500},(_,i)=>'-- line '+i).join('\n'));const gutter=$('line-numbers').firstChild;const start=performance.now();for(let n=0;n<100;n++){ $('sql-editor').value+='a';updateLines();}return {ms:(performance.now()-start)/100,same:gutter===$('line-numbers').firstChild};});
 assert(metrics.same);console.log('PASS: alias-aware replacement, live DuckDB function metadata, keyboard acceptance; 1500-line gutter update '+metrics.ms.toFixed(3)+' ms');
 await page.locator('#sql-editor').fill('SELECT 999 AS debounced_draft;');await page.waitForTimeout(1000);await page.reload();await page.locator('.query-tab.active').waitFor();assert((await page.locator('#sql-editor').inputValue()).includes('debounced_draft'));assert.deepEqual(errors,[]);
 console.log('PASS: debounced drafts persist after reload without running SQL');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
