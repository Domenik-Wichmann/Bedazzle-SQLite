const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const failedEnhancement of [false,true]){
   const context=await browser.newContext(),page=await context.newPage(),errors=[],unsupported=[];
   page.on('pageerror',error=>errors.push(error.message));
   // Reproduce an already-running server with the old static-asset allowlist.
   await page.route(/\/(?:theme\.(?:js|css)|sql_presentation\.js|sql-formatter\.min\.js|charts\.(?:js|css)|echarts\.min\.js)(?:\?.*)?$/,route=>{
    unsupported.push(route.request().url());return route.fulfill({status:404,body:'Not found'});
   });
   if(failedEnhancement)await page.route('**/editor.js',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+'\nsetupEditor=function(){throw new Error("Simulated editor enhancement failure");};'});
   });
   await page.goto(session.url+'/#'+session.token);
   await page.waitForFunction(()=>typeof workspaceOverview!=='undefined'&&workspaceOverview?.items?.length);
   const originalWorkspace=await page.evaluate(()=>state.data.workspaces.selected);
   await page.locator('#workspace-nav').click();
   await page.locator('#workspace-home').waitFor({state:'visible'});
   assert(await page.locator('.workspace-card').count());
   await page.locator('.workspace-card.current .button.primary').click();
   await page.locator('#work-area').waitFor({state:'visible'});
   await page.locator('#workspace-menu-toggle').click();
   const target=page.locator('.workspace-menu-item:not(.selected)').first();
   const id=await target.getAttribute('data-workspace-id');
   await target.click();
   await page.waitForFunction(id=>state.data?.workspaces?.selected===id,id);
   await page.locator('#workspace-nav').click();
   await page.locator('#workspace-home').waitFor({state:'visible'});
   assert.deepEqual(unsupported,[]);
   assert.deepEqual(errors,[]);
   if(!failedEnhancement){
    await page.locator('.workspace-card.current .button.primary').click();
    await page.locator('#sql-editor').fill('select 1 as value;');
    await page.locator('#beautify-query').click();
    assert((await page.locator('#sql-editor').inputValue()).startsWith('SELECT\n'));
    await page.evaluate(async()=>{workArea();await runSQL("SELECT * FROM (VALUES ('A',10),('B',20)) t(label,value)");setResultView('chart');});
    await page.locator('#chart-content svg').waitFor();
    assert.equal(await page.evaluate(()=>quickChart.getOption().series[0].data.length),2);
   }
   console.log('PASS: workspace home, opening and switching '+(failedEnhancement?'after an editor enhancement fails':'using only legacy asset routes; Beautify works'));
   await page.evaluate(id=>changeWorkspace({id}),originalWorkspace);
   await page.waitForFunction(id=>state.data?.workspaces?.selected===id,originalWorkspace);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
