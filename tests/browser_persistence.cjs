const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json','utf8'));

(async()=>{
  const browser=await chromium.launch({headless:true});
  const errors=[];
  try{
    const first=await browser.newContext({viewport:{width:1366,height:960}});
    const page=await first.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(session.url+'/#'+session.token);
    await page.locator('#workspace-nav').click();await page.locator('.workspace-card.current .button.primary').click();
    await page.locator('#sql-editor').fill("SELECT 'server-backed draft' AS note;");
    await page.waitForTimeout(900);
    const response=await page.request.get(session.url+'/api/bootstrap',{headers:{'X-Workbench-Token':session.token}});
    const saved=await response.json();
    assert(saved.drafts.tabs.some(tab=>tab.sql.includes('server-backed draft')));
    const second=await browser.newContext({viewport:{width:1366,height:960}});
    const restored=await second.newPage();
    restored.on('pageerror',error=>errors.push(error.message));
    await restored.goto(session.url+'/#'+session.token);
    await restored.locator('.query-tab.active').waitFor();
    assert((await restored.locator('#sql-editor').inputValue()).includes('server-backed draft'));
    assert.equal(await restored.locator('#job-strip').isVisible(),false);
    console.log('PASS: SQL draft restored from the server in a fresh browser context, without executing it');
    await restored.locator('#performance-nav').click();
    await restored.locator('#settings-dialog').waitFor({state:'visible'});
    await restored.locator('#save-settings').click();
    await restored.locator('#settings-dialog').waitFor({state:'hidden'});
    await restored.locator('#load-demo').click();
    await restored.waitForFunction(()=>document.querySelector('#result-table tbody')?.children.length===6);
    console.log('PASS: sample loading still works after changing performance settings');
    await restored.locator('#import-parquet').click();
    const output=await restored.locator('#import-output').inputValue();
    assert(output.includes('imports'));
    assert.equal(fs.existsSync(output),false);
    await restored.locator('#import-dialog .close-button').click();
    await restored.screenshot({path:'workspace/verification/final-workspace.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: fresh conversion output path and no browser exceptions');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
