const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');const{chromium}=require('../.test-tools/node_modules/playwright');
const s=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{const b=await chromium.launch(),p=await b.newPage({viewport:{width:1366,height:850}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
const idle=async()=>{await p.waitForFunction(()=>!state.busy);await p.waitForTimeout(150);};
try{
 await p.goto(s.url+'/#'+s.token);await p.locator('#workspace-nav').click();await p.locator('.workspace-card.current .button.primary').click();
 await p.locator('#sql-editor').fill('CREATE TEMP TABLE current_source AS SELECT i,random() AS r FROM range(1234) t(i); SELECT * FROM current_source ORDER BY i;');await p.locator('#run-query').click();await idle();
 const original=await p.evaluate(()=>({rows:state.result.rows,result_id:state.result.result_id}));assert(original.result_id);
 await p.evaluate(()=>runJob('query',{sql:'DROP TABLE current_source;'}));
 await p.locator('#export-results').click();assert.equal(await p.locator('#export-sql').count(),0);
 const csv=path.resolve(s.workspace,'retained-all-'+Date.now()+'.csv');await p.locator('#export-format').selectOption('csv');await p.locator('#export-path').fill(csv);await p.locator('#confirm-export').click();await idle();
 let rows=fs.readFileSync(csv,'utf8').trim().split('\n');assert.equal(rows.length,1235);assert.equal(Number(rows[1].split(',')[1]),original.rows[0][1]);
 await p.locator('#next-page').click();await idle();assert.equal(await p.evaluate(()=>state.result.rows[0][0]),100);
 await p.locator('#export-results').click();await p.locator('#export-scope').selectOption('page');const output=path.resolve(s.workspace,'retained-page-'+Date.now()+'.csv');await p.locator('#export-path').fill(output);await p.locator('#confirm-export').click();await idle();
 rows=fs.readFileSync(output,'utf8').trim().split('\n');assert.equal(rows.length,101);assert.equal(rows[1].split(',')[0],'100');assert.equal(rows[100].split(',')[0],'199');
 assert.deepEqual(errors,[]);console.log('PASS: no SQL export field; all-run/page CSV export and pagination survive source removal and preserve random values exactly');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
