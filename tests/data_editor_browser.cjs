const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_EDITOR_SESSION||'workspace/http-smoke-session.json'));
(async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const idle=async()=>{await page.waitForFunction(()=>!state.busy&&!dataEditor.busy);};
 const request=async(url,payload)=>{
  const r=await fetch(session.url+url,{method:payload?'POST':'GET',headers:{'X-Workbench-Token':session.token,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
  const value=await r.json();assert(r.ok,JSON.stringify(value));return value;
 };
 const job=async(action,payload)=>{
  const {id}=await request('/api/jobs',{action,payload});
  for(let i=0;i<600;i++){const j=await request('/api/jobs/'+id);if(j.finished){assert.equal(j.status,'succeeded',JSON.stringify(j));return j.result;}await new Promise(r=>setTimeout(r,50));}
  throw new Error('Job timed out');
 };
 const query=async sql=>{
  await page.locator('#sql-editor').fill(sql);await page.locator('#run-query').click();await idle();
 };
 const cell=async(value)=>{
  await page.locator('#de-grid tbody tr').first().locator('.de-cell').nth(1).dblclick();
  await page.locator('#de-cell-dialog').waitFor();
  assert.equal(await page.locator('#de-cell-title').textContent(),'name');
  await page.locator('#de-cell-value').fill(value);await page.locator('#de-cell-apply').click();await idle();await page.locator('#de-cell-dialog').waitFor({state:'hidden'});
 };
 try{
  for(const d of (await request('/api/bootstrap')).catalog.filter(d=>['editor file','Browser edited working copy'].includes(d.name)))await job('remove_dataset',{name:d.name});
  await job('query',{sql:"DROP TABLE IF EXISTS editor_browser; DROP SEQUENCE IF EXISTS editor_runs; CREATE TABLE editor_browser AS SELECT i::INTEGER AS id, 'name '||i AS name FROM range(230) t(i); CREATE SEQUENCE editor_runs START 1"});
  const source=path.join(session.workspace,'editor-original.csv');fs.writeFileSync(source,'id;name\n001;original\n002;outside\n');
  await job('open',{path:source,name:'editor file',options:{delimiter:';'}});
  await page.goto(session.url+'/#'+session.token);await page.locator('#module-menu option[value="data-editor"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#open-data-editor,#data-editor-drafts').count(),0);
  await page.locator('#workspace-nav').click();await page.locator('.workspace-card.current .button.primary').click();
  await query("SELECT id,name,nextval('editor_runs') AS run FROM editor_browser ORDER BY id");
  await page.locator('#module-menu option[value="data-editor"]').waitFor({state:'attached'});
  await page.evaluate(()=>refreshModules());
  await page.locator('#module-menu').selectOption('data-editor');await page.locator('#data-editor').waitFor();await idle();
  assert.equal(await page.locator('#de-grid tbody tr').count(),100);
  assert((await page.locator('#de-status').textContent()).includes('230 matching'));
  assert.equal((await job('query',{sql:"SELECT currval('editor_runs')"})).rows[0][0],230);
  await cell('edited through browser');
  assert((await page.locator('#de-status').textContent()).includes('1 changed'));
  await page.locator('#de-undo').click();await idle();assert.equal(await page.locator('#de-grid tbody tr').first().locator('.de-cell').nth(1).textContent(),'name 0');
  await page.locator('#de-redo').click();await idle();
  // Rectangular paste is one undoable, typed operation.
  await page.locator('#de-grid tbody tr').nth(1).locator('.de-cell').nth(1).focus();
  await page.locator('#de-grid').evaluate(el=>el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:(()=>{const d=new DataTransfer();d.setData('text/plain','pasted one\npasted two');return d;})()})));
  await idle();assert.equal(await page.locator('#de-grid tbody tr').nth(2).locator('.de-cell').nth(1).textContent(),'pasted two');
  await page.locator('#de-save-open').click();await page.locator('#de-save-name').fill('Browser edited working copy');await page.locator('#de-save-confirm').click();await page.locator('#de-save-dialog').waitFor({state:'hidden'});await idle();
  assert.equal((await job('query',{sql:'SELECT count(*) FROM "Browser edited working copy"'})).rows[0][0],230);
  await page.locator('#de-save-open').click();await page.locator('#de-save-mode').selectOption('source');await page.locator('#de-save-target').selectOption('editor_browser');await page.locator('#de-save-keys').selectOption(['id']);await page.locator('#de-save-ack').check();await page.locator('#de-save-confirm').click();await page.locator('#de-save-dialog').waitFor({state:'hidden'});await idle();
  assert.equal((await job('query',{sql:'SELECT name FROM editor_browser WHERE id=0'})).rows[0][0],'edited through browser');
  assert.equal((await job('query',{sql:'SELECT name FROM editor_browser WHERE id=2'})).rows[0][0],'pasted two');
  await page.locator('#de-next').click();await idle();assert((await page.locator('#de-range').textContent()).includes('101–200'));
  await page.locator('#de-close').click();await page.reload();await page.locator('#module-menu option[value="editor-drafts"]').waitFor({state:'attached'});await page.locator('#module-menu').selectOption('editor-drafts');await page.locator('#de-draft-list').getByRole('button',{name:'Open',exact:true}).first().click();await page.locator('#data-editor').waitFor();await idle();
  assert((await page.locator('#de-status').textContent()).includes('230 matching'));
  await page.locator('#de-save-open').click();await page.locator('#de-save-mode').selectOption('export');const exported=path.join(session.workspace,'browser-edited.csv');await page.locator('#de-save-format').selectOption('csv');await page.locator('#de-save-output').fill(exported);await page.locator('#de-save-confirm').click();await page.locator('#de-save-dialog').waitFor({state:'hidden'});await idle();assert.equal(fs.readFileSync(exported,'utf8').trim().split('\n').length,231);
  await page.locator('#de-close').click();await query('SELECT * FROM "editor file" WHERE id=\'001\'');
  await page.locator('#module-menu').selectOption('data-editor');await page.locator('#data-editor').waitFor();await idle();await cell('saved;with\nquotes');
  await page.locator('#de-save-open').click();await page.locator('#de-save-mode').selectOption('original');await page.locator('#de-save-target').selectOption('editor file');await page.locator('#de-save-keys').selectOption(['id']);await page.locator('#de-save-ack').check();await page.locator('#de-save-confirm').click();await page.locator('#de-save-dialog').waitFor({state:'hidden'});await idle();
  assert.equal((await job('query',{sql:'SELECT name FROM "editor file" WHERE id=\'001\''})).rows[0][0],'saved;with\nquotes');
  assert.equal((await job('query',{sql:'SELECT name FROM "editor file" WHERE id=\'002\''})).rows[0][0],'outside');
  assert(fs.readdirSync(session.workspace).some(f=>f.startsWith('editor-original.csv.')&&f.endsWith('.bak')));
  fs.mkdirSync('workspace/verification',{recursive:true});await page.screenshot({path:'workspace/verification/data-editor.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: retained query → full editor, typed edits, paste, undo/redo, paging, persistent drafts, working dataset, source-table save, new export, original-file rewrite and backup; no browser errors');
 }catch(e){console.error('UI error:',await page.locator('dialog[open] .modal-error').allTextContents(),await page.locator('.toast').allTextContents(),errors);await page.screenshot({path:'workspace/verification/data-editor-error.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
