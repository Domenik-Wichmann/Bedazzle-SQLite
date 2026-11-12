const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');const{chromium}=require('../.test-tools/node_modules/playwright');
const s=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{const browser=await chromium.launch(),p=await browser.newPage({viewport:{width:1366,height:850}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 const idle=async()=>{await p.waitForFunction(()=>!state.busy);await p.waitForTimeout(150);};
 const home=async()=>{await p.locator('#workspace-nav').click();await p.locator('#workspace-home').waitFor();};
 try{
  await p.goto(s.url+'/#'+s.token);await home();assert(await p.locator('.workspace-card').count()>=2);assert.equal(await p.locator('#workspace-select').count(),0);
  await p.locator('#workspace-menu-toggle').click();await p.locator('#workspace-menu').waitFor();assert(await p.locator('.workspace-menu-item').count()>=2);await p.keyboard.press('Escape');
  await p.locator('.workspace-card').filter({hasText:'Example workspace'}).first().getByRole('button',{name:'Open workspace',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('#workspace-name')?.textContent==='Example workspace');await idle();
  assert.equal(await p.locator('.dataset-row').count(),2);await p.locator('#run-query').click();await idle();assert.equal(await p.locator('#result-count').textContent(),'1,200');
  await p.locator('#explain-query').click();await idle();await p.locator('#detail-dialog').waitFor();assert(await p.locator('.plan-node').count()>2);await p.locator('#detail-dialog .close-button').click();
  await p.locator('#library-nav').click();await p.locator('.query-actions').first().getByRole('button',{name:'Rename',exact:true}).click();await p.locator('#manage-name').fill('Renamed example query');await p.locator('#manage-name-save').click();await p.locator('#manage-name-dialog').waitFor({state:'hidden'});assert((await p.locator('#library-list').textContent()).includes('Renamed example query'));
  await p.locator('.library-item').filter({hasText:'Renamed example query'}).getByRole('button',{name:'Delete',exact:true}).click();await p.waitForFunction(()=>state.data.saved.length===3);await p.locator('#library-dialog .close-button').click();
  const examplePath=await p.evaluate(()=>state.data.workspace);await p.getByRole('button',{name:'Remove offers',exact:true}).click();await idle();assert.equal(await p.locator('.dataset-row').count(),1);assert(fs.existsSync(path.join(examplePath,'files','offers.csv')));
  await home();await p.locator('.workspace-card.current').getByRole('button',{name:'Rename',exact:true}).click();await p.locator('#manage-name').fill('My renamed example');await p.locator('#manage-name-save').click();await p.locator('#manage-name-dialog').waitFor({state:'hidden'});assert((await p.locator('#workspace-name').textContent()).includes('My renamed example'));
  await p.locator('.workspace-card.current').getByRole('button',{name:'Delete',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace-name')?.textContent!=='My renamed example');await idle();
  await home();await p.locator('.archive-row').filter({hasText:'My renamed example'}).getByRole('button').click();await p.locator('.workspace-card').filter({hasText:'My renamed example'}).waitFor();
  await p.locator('#performance-nav').click();await p.locator('#restore-example').click();await p.waitForFunction(()=>document.querySelector('#workspace-name')?.textContent==='Example workspace');await idle();assert.equal(await p.locator('.dataset-row').count(),2);assert.equal(await p.evaluate(()=>state.data.saved.length),4);
  await home();await p.screenshot({path:'workspace/verification/workspace-home.png'});assert.deepEqual(errors,[]);
  console.log('PASS: clean workspace menu/home/stats; example joins/Explain; query rename/delete; safe dataset removal; workspace rename/archive/restore; fresh example restoration');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
