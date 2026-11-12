const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');const{chromium}=require('../.test-tools/node_modules/playwright');
const s=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{const b=await chromium.launch(),p=await b.newPage();try{
 await p.goto(s.url+'/#'+s.token);await p.locator('#open-file').click();
 await p.route('**/api/picker',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Native file dialog failed: insufficient memory'})}));
 await p.locator('#browse-import').click();await p.locator('#import-error').waitFor();
 assert((await p.locator('#import-error').textContent()).includes('Native file dialog failed'));
 assert((await p.locator('#import-error').textContent()).includes('paste the full file path'));
 assert.equal(await p.locator('#browse-import').isEnabled(),true);
 assert.equal(await p.locator('#toast-container .toast.error').count(),0);
 await p.evaluate(()=>report(new Error('Another visible modal error')));
 assert((await p.locator('#import-error').textContent()).includes('Another visible modal error'));
 assert((await p.locator('.main-footer').textContent()).includes('1.5.0'));
 const invalid=await p.request.post(s.url+'/api/jobs',{headers:{'X-Workbench-Token':s.token},data:{action:'invalid-test-action'}});assert.equal(invalid.status(),400);
 const diagnostic=await p.request.get(s.url+'/api/diagnostics',{headers:{'X-Workbench-Token':s.token}});const data=await diagnostic.json();assert.equal(data.app_version,'1.5.0');assert(data.last_error.error.includes('Unknown operation'));
 console.log('PASS: picker/general errors stay readable inside modal; retry button recovers; build and recorded diagnostics are visible');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
