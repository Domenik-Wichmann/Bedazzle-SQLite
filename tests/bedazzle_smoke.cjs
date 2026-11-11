const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync('workspace/http-smoke-session.json','utf8'));
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const idle=async()=>{await page.locator('#job-strip').waitFor({state:'hidden',timeout:30000});await page.waitForTimeout(100);};
 const query=async(sql)=>{await page.locator('#sql-mode').click();await page.locator('#sql-editor').fill(sql);await page.locator('#run-query').click();await idle();};
 try{
  await page.goto(session.url+'/#'+session.token);
  await page.locator('#workspace-nav').click();
  assert.equal(await page.title(),'Bedazzle');
  assert.equal(await page.locator('.workspace-heading').count(),0);
  await page.locator('#sql-editor').fill('SELECT\n  i,\n  i % 3 AS k\nFROM\n  range(156) t(i)\nORDER BY\n  i;');
  const positions=await page.locator('#line-numbers').evaluate(element=>{
   const first=document.createRange(),last=document.createRange();first.setStart(element.firstChild,0);first.setEnd(element.firstChild,1);
   const n=element.firstChild.length;last.setStart(element.firstChild,n-1);last.setEnd(element.firstChild,n);
   return {first:first.getBoundingClientRect().toJSON(),last:last.getBoundingClientRect().toJSON(),space:getComputedStyle(element).whiteSpace};
  });
  assert.equal(positions.space,'pre');assert(positions.last.y>positions.first.y+100);assert(Math.abs(positions.last.x-positions.first.x)<5);
  await page.locator('#run-query').click();await idle();
  assert.equal((await page.locator('#result-count').textContent()).trim(),'156');
  assert((await page.locator('#query-stat').textContent()).includes('of 156'));
  assert.equal(await page.locator('.celebration').count(),1);
  const effect=await page.locator('.celebration').evaluate(element=>{
   const rect=element.getBoundingClientRect(),css=getComputedStyle(element);
   return {width:rect.width,height:rect.height,pointer:css.pointerEvents,background:css.backgroundColor,shadow:css.boxShadow,buttons:element.querySelectorAll('button').length};
  });
  assert(effect.width<120&&effect.height<80);assert.equal(effect.pointer,'none');
  assert.equal(effect.background,'rgba(0, 0, 0, 0)');assert.equal(effect.shadow,'none');assert.equal(effect.buttons,0);
  await page.locator('#next-page').click();await idle();
  assert((await page.locator('#query-stat').textContent()).includes('Rows 101–156 of 156'));
  console.log('PASS: vertical line-number gutter, compact header, exact 156-result count and Done celebration');

  assert.equal(await page.locator('#help-toggle').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('.help-badge').count(),0);
  await page.locator('#help-toggle').click();
  await page.locator('.help-badge').first().waitFor();
  await page.getByRole('button',{name:/^Help:.*Run query/}).click();
  assert((await page.locator('.help-popover').textContent()).includes('Ctrl+Enter'));
  await page.locator('.help-close').click();
  await page.locator('#open-file').click();
  await page.getByRole('button',{name:'Help: Dataset name',exact:true}).waitFor();
  await page.getByRole('button',{name:'Help: Dataset name',exact:true}).click();
  assert((await page.locator('.help-popover').textContent()).includes('double quotes'));
  await page.locator('.help-close').click();
  await page.locator('#import-path').fill(path.resolve('examples/catalogs.csv'));
  const original='My browser dataset '+Date.now();
  await page.locator('#import-name').fill(original);
  await page.locator('#confirm-import').click();await idle();
  await page.waitForFunction(name=>[...document.querySelectorAll('.dataset-text strong')].some(x=>x.textContent===name),original);
  await idle();
  await page.locator('#help-toggle').click();
  assert.equal(await page.locator('.help-badge').count(),0);
  assert.equal((await page.locator('#workspace-title').textContent()).trim(),'catalogs.csv');
  console.log('PASS: optional help starts off, works inside import dialogs, and clears completely');

  await page.locator('#rename-current').click();
  const renamed='Renamed "catalogs" '+Date.now();await page.locator('#rename-name').fill(renamed);
  await page.locator('#confirm-rename').click();await idle();
  await page.locator('#rename-dialog').waitFor({state:'hidden'});
  assert((await page.locator('#workspace-subtitle').textContent()).includes('Renamed'));
  await query('SELECT count(*) AS records FROM "'+original.replaceAll('"','""')+'";');
  assert.equal((await page.locator('#result-table tbody tr td').nth(1).textContent()).trim(),'6');
  console.log('PASS: custom import name, quoted dataset rename, and saved SQL compatibility alias');

  const downloadEvent=page.waitForEvent('download');await page.locator('#download-instructions').click();await page.locator('#save-instructions').click();
  const download=await downloadEvent;assert.equal(download.suggestedFilename(),'Bedazzle-Agent-Instructions.md');
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const guide=Buffer.concat(chunks).toString('utf8');
  fs.writeFileSync(path.resolve('workspace/verification/Bedazzle-Agent-'+Date.now()+'.md'),guide);
  assert(guide.includes(renamed.replaceAll('"','\\"')));assert(guide.includes('## Exporting complete results'));assert(!guide.includes(session.token));
  console.log('PASS: downloadable full agent guide includes current schema without the session token');await page.locator('#instructions-dialog .close-button').click();

  await page.locator('#sql-editor').fill('SELECT a.i FROM range(1000000) a(i),range(1000000) b(i) WHERE (a.i*b.i)%7=0;');
  await page.locator('#run-query').click();
  await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='Counting…');
  assert.equal(await page.locator('#result-table tbody tr').count(),100);
  await page.locator('#cancel-job').click();await idle();
  assert.equal((await page.locator('#result-count').textContent()).trim(),'Count stopped');
  assert.equal(await page.locator('#result-table tbody tr').count(),100);
  console.log('PASS: long count exposes a page immediately; cancelling retains that page without a false total');
  await query('SELECT * FROM range(156);');
  await page.locator('.celebration').waitFor({state:'hidden',timeout:3000});
  await page.screenshot({path:'workspace/verification/bedazzle.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await query('SELECT 42;');
  assert.equal(await page.locator('.confetti').count(),0);
  console.log('PASS: reduced-motion setting suppresses confetti');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
