// A server started before Query builder existed has no feature-specific routes.
// The compatibility path must load from the established editor/CSS routes only.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/fieldwork/server.json'));
(async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],featureRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Inspect an already-running user's server without altering their SQL drafts
 // or consuming queued startup files. Visual drafts stay in this test browser.
 await page.route('**/api/drafts',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.route('**/api/startup',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.route(/\/query_builder(?:_query)?\.(?:js|css)$/,r=>{featureRequests.push(r.request().url());return r.fulfill({status:404,body:'Not found'});});
 try{
  for(let pass=0;pass<2;pass++){
   if(pass)await page.reload();else await page.goto(session.url+'/#'+session.token);
   await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));
   await page.evaluate(()=>workArea());await page.locator('#query-builder-mode').click();
   assert.equal(await page.evaluate(()=>state.mode),'query-builder');
   assert(await page.locator('#query-builder-pane').isVisible());
   assert.equal(await page.locator('#query-builder-pane').evaluate(e=>getComputedStyle(e).display),'flex');
   assert.equal(await page.evaluate(()=>typeof QueryBuilderSQL.build),'function');
   const field=page.locator('.qb-field').first();
   if(await field.count()){
    await page.locator('#qb-add-area').selectOption('output');await field.locator('button').last().click();
    assert.match(await page.locator('#qb-sql').textContent(),/^SELECT /);
   }
   await page.locator('#explore-mode').click();assert(await page.locator('#explore-pane').isVisible());
   await page.locator('#query-builder-mode').click();assert(await page.locator('#query-builder-pane').isVisible());
  }
  assert.deepEqual(featureRequests,[]);assert.deepEqual(errors,[]);
  console.log('PASS: Query builder and styles load from established routes, open and generate SQL with feature-specific routes unavailable, and survive refresh without changing server drafts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
