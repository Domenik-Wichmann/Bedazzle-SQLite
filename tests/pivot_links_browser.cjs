const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const field=(source,name)=>page.locator('.pivot-field').filter({has:page.locator('span')}).and(page.locator(`[data-source="${source}"][data-field="${name}"]`));
async function idle(){await page.waitForFunction(()=>!state.busy);}
try{
 await page.goto(session.url+'/#'+session.token);await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));
 await page.evaluate(async()=>{
  await runSQL(`CREATE OR REPLACE TABLE link_sales AS SELECT * FROM (VALUES ('001','A',10,'10'),('001','A',20,'bad'),('002','B',7,'7'),('missing','A',8,'8'),(NULL,'A',1,NULL)) t("Agent ID",company,amount,text_amount); CREATE OR REPLACE TABLE link_employees AS SELECT * FROM (VALUES ('001','A','Ada',100),('001','B','Ada B',200),('002','B','Bob',300),(NULL,'A','No ID',500)) t("Employee Number",company,name,pay); CREATE OR REPLACE TABLE link_none AS SELECT 'ZZZ' AS unrelated_id;`);
  await refresh();workArea();
 });
 await page.locator('#pivot-mode').click();await page.locator('#pivot-dataset').selectOption('link_sales');await page.locator('#pivot-live').uncheck();
 const locked=page.locator('.pivot-source-group').filter({has:page.locator('summary strong',{hasText:'link_employees'})});await locked.locator('summary').first().click();
 assert.equal(await field('link_employees','name').getAttribute('aria-disabled'),'true');assert.equal(await field('link_employees','name').getAttribute('draggable'),'false');
 await field('link_employees','name').click({force:true});assert.match(await page.locator('#pivot-feedback').textContent(),/Connect/);
 await page.getByRole('button',{name:'Add dataset',exact:true}).click();await page.getByRole('combobox',{name:'Dataset to connect',exact:true}).selectOption('link_employees');
 await page.getByRole('button',{name:'Suggest matches',exact:true}).click();await page.waitForFunction(()=>!state.busy&&document.querySelector('#pivot-key-suggestions').textContent.includes('sample'));
 await page.getByRole('combobox',{name:'Main matching field 1',exact:true}).selectOption('Agent ID');await page.getByRole('combobox',{name:'Related matching field 1',exact:true}).selectOption('Employee Number');
 await page.getByRole('button',{name:'Check connection',exact:true}).click();await idle();await page.waitForFunction(()=>document.querySelector('#pivot-relationship-result').textContent.includes('Repeats on both sides'));
 assert(await page.locator('#pivot-connect-apply').isDisabled());
 await page.getByRole('button',{name:'+ Matching field',exact:true}).click();await page.getByRole('combobox',{name:'Main matching field 2',exact:true}).selectOption('company');await page.getByRole('combobox',{name:'Related matching field 2',exact:true}).selectOption('company');
 await page.getByRole('button',{name:'Check connection',exact:true}).click();await idle();await page.waitForFunction(()=>!document.querySelector('#pivot-connect-apply').disabled);
 assert.match(await page.locator('#pivot-relationship-result').textContent(),/3 main records match/);await page.screenshot({path:path.join(session.workspace,'pivot-connection.png')});
 await page.getByRole('button',{name:'Inspect unmatched main keys',exact:true}).click();await idle();assert.match(await page.locator('#pivot-key-suggestions').textContent(),/missing/);
 await page.locator('#pivot-connect-apply').click();assert.equal(await field('link_employees','link_employees · name').getAttribute('aria-disabled'),'false');
 await field('link_employees','link_employees · name').click();await field('link_sales','amount').click();await field('link_employees','link_employees · pay').click();
 assert.match(await page.locator('#pivot-values').textContent(),/Per link_sales row/);
 await page.locator('#run-query').click();await idle();await page.waitForFunction(()=>state.result?.rows.some(r=>r[1]==='Grand total'&&r[2]===46&&r[3]===500));
 // Records is valid only in Values. An invalid drop keeps the original chip.
 await page.getByRole('button',{name:'+ Count records',exact:true}).click();const records=page.locator('#pivot-values .pivot-chip').filter({hasText:'Records'});
 const hints=await records.locator('.pivot-chip-head').evaluate(el=>{el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}));const flags={valid:document.querySelector('#pivot-values').classList.contains('drop-valid'),invalid:document.querySelector('#pivot-rows').classList.contains('drop-invalid'),remove:document.querySelector('.pivot-field-panel').classList.contains('remove-ready')};el.dispatchEvent(new DragEvent('dragend',{bubbles:true}));return flags;});assert.deepEqual(hints,{valid:true,invalid:true,remove:true});
 await records.locator('.pivot-chip-head').dragTo(page.locator('#pivot-rows'));
 assert.equal(await records.count(),1);assert.equal(await page.locator('#pivot-rows .pivot-chip').count(),1);assert.match(await page.locator('#pivot-feedback').textContent(),/only be placed in Values/);
 await records.locator('.pivot-chip-head').dragTo(page.locator('.pivot-field-panel'));assert.equal(await records.count(),0);await page.getByRole('button',{name:'Undo pivot change',exact:true}).click();assert.equal(await records.count(),1);await page.getByRole('button',{name:'Redo pivot change',exact:true}).click();assert.equal(await records.count(),0);
 // Text sums are unavailable until an explicit numeric check, including invalid-value acknowledgement.
 await page.locator('[aria-label="Choose area for text_amount"]').click();await page.getByRole('button',{name:'Add text_amount to values',exact:true}).click();const text=page.locator('#pivot-values .pivot-chip').filter({hasText:'text_amount'});
 assert(await text.locator('option[value="sum"]').isDisabled());await text.locator('summary').click();await text.getByRole('button',{name:'Check as numbers',exact:true}).click();await idle();await page.locator('#detail-dialog[open]').waitFor();assert.match(await page.locator('#detail-content').textContent(),/1 nonnumeric/);
 await page.getByRole('button',{name:'Use numbers and ignore nonnumeric values',exact:true}).click();assert(!(await text.locator('option[value="sum"]').isDisabled()));await page.locator('#run-query').click();await idle();await page.waitForFunction(()=>state.result?.rows.some(r=>r[1]==='Grand total'&&r.at(-1)===25));
 await page.getByRole('button',{name:'Save layout',exact:true}).click();await page.locator('#pivot-save-name').fill('Connected employees');await page.locator('#detail-content').getByRole('button',{name:'Save layout',exact:true}).click();
 await page.reload();await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));await page.evaluate(()=>workArea());await page.locator('#pivot-mode').click();assert.equal(await field('link_employees','link_employees · name').getAttribute('aria-disabled'),'false');
 await page.locator('#run-query').click();await idle();await page.waitForFunction(()=>state.result?.rows.some(r=>r[1]==='Grand total'&&r.at(-1)===25));await page.screenshot({path:path.join(session.workspace,'pivot-linked.png')});
 // A connection with no overlap requires explicit acknowledgement.
 await page.getByRole('button',{name:'Add dataset',exact:true}).click();await page.getByRole('combobox',{name:'Dataset to connect',exact:true}).selectOption('link_none');
 await page.getByRole('combobox',{name:'Main matching field 1',exact:true}).selectOption('Agent ID');await page.getByRole('combobox',{name:'Related matching field 1',exact:true}).selectOption('unrelated_id');await page.getByRole('button',{name:'Check connection',exact:true}).click();await idle();
 assert(await page.locator('#pivot-connect-apply').isDisabled());await page.getByRole('checkbox',{name:'Keep this connection despite no matches',exact:true}).check();await page.locator('#pivot-connect-apply').click();
 await page.getByRole('button',{name:'Disconnect link_none',exact:true}).click();await page.getByRole('button',{name:'Undo pivot change',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Edit connection to link_none',exact:true}).count(),1);await page.getByRole('button',{name:'Redo pivot change',exact:true}).click();
 // Reversing a one-to-many relationship guides the user to a safe main table.
 await page.locator('#pivot-dataset').selectOption('link_employees');await page.getByRole('button',{name:'Add dataset',exact:true}).click();await page.getByRole('combobox',{name:'Dataset to connect',exact:true}).selectOption('link_sales');
 await page.getByRole('combobox',{name:'Main matching field 1',exact:true}).selectOption('Employee Number');await page.getByRole('combobox',{name:'Related matching field 1',exact:true}).selectOption('Agent ID');await page.getByRole('button',{name:'+ Matching field',exact:true}).click();await page.getByRole('combobox',{name:'Main matching field 2',exact:true}).selectOption('company');await page.getByRole('combobox',{name:'Related matching field 2',exact:true}).selectOption('company');await page.getByRole('button',{name:'Check connection',exact:true}).click();await idle();
 assert(await page.locator('#pivot-connect-apply').isDisabled());await page.getByRole('button',{name:'Make link_sales the main dataset',exact:true}).click();assert.equal(await page.locator('#pivot-dataset').inputValue(),'link_sales');assert.equal(await page.getByRole('combobox',{name:'Main matching field 1',exact:true}).inputValue(),'Agent ID');
 await page.getByRole('button',{name:'Check connection',exact:true}).click();await idle();await page.locator('#pivot-connect-apply').click();await page.locator('#pivot-layouts').selectOption('0');
 await page.setViewportSize({width:760,height:850});await page.screenshot({path:path.join(session.workspace,'pivot-linked-narrow.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1440,height:1000});
 // A changed source must be rechecked before every calculation.
 await page.evaluate(async()=>{await runJob('query',{sql:`INSERT INTO link_employees VALUES ('001','A','Duplicate',999)`});});await page.locator('#run-query').click();await idle();await page.waitForFunction(()=>document.querySelector('#pivot-feedback').textContent.includes('repeated keys'));
 // Existing saved text-number calculations retain their original TRY_CAST/ignore-invalid behavior.
 await page.evaluate(()=>{const key=draftKey('pivot'),old=JSON.parse(localStorage.getItem(key));old.config={dataset:'link_sales',rows:[],columns:[],values:[{field:'text_amount',op:'sum'}],filters:[],live:false};localStorage.setItem(key,JSON.stringify(old));});
 await page.reload();await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));await page.evaluate(()=>workArea());await page.locator('#pivot-mode').click();await page.locator('#run-query').click();await idle();await page.waitForFunction(()=>state.result?.rows[0]?.[0]===25);
 assert.deepEqual(errors,[]);console.log('PASS: locked datasets, sampled suggestions, mismatched/composite keys, duplicate blocking, unmatched inspection, joined values/totals, invalid drops, drag-back, undo/redo, explicit text conversion, saved links and changed-source rechecks');console.log('Screenshots: '+session.workspace);
}catch(e){console.error(await page.locator('#pivot-feedback').textContent());console.error(await page.locator('#pivot-connect-message').textContent().catch(()=>''));console.error(errors);await page.screenshot({path:'workspace/pivot-links-failure.png'});throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
