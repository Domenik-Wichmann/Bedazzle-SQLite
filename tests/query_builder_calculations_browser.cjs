const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION));
(async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(session.url+'/#'+session.token);await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));
  await page.evaluate(async()=>{
   await runSQL("CREATE TABLE calc_products AS SELECT * FROM (VALUES ('a','Hardware','100'),('b','Hardware','200'),('c','Hardware','50'),('d','Software','80'),('e','Software','40'),('f','Software','10')) t(id,category,price); CREATE TABLE calc_discounts AS SELECT * FROM (VALUES ('a','60'),('b','150'),('d','0'),('e','bad'),('f','2.5')) t(id,price);");
   await refresh();workArea();newTab('Calculations','SELECT 42 AS untouched;');
  });
  await page.locator('#query-builder-mode').click();await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.locator('#qb-dataset').selectOption('calc_products');await page.locator('#qb-dataset').selectOption('calc_discounts');
  const field=(t,c)=>page.locator(`.qb-field[data-table="${t}"][data-column="${c}"]`);
  await field('t1','id').dragTo(field('t2','id'));
  for(const [t,c] of [['t1','id'],['t1','price'],['t2','price']])await field(t,c).locator('button').last().click();
  await page.getByRole('button',{name:'+ Calculated column',exact:true}).click();
  let card=page.locator('.qb-calculation').first();
  await card.getByRole('textbox',{name:'Calculated column name',exact:true}).fill('Discount amount');await card.getByRole('textbox',{name:'Calculated column name',exact:true}).press('Tab');
  await field('t1','price').dragTo(card.locator('.qb-operand[data-side="left"]'));
  await field('t2','price').dragTo(card.locator('.qb-operand[data-side="right"]'));
  assert.equal(await card.locator('[aria-label="Arithmetic operation"]').inputValue(),'-');
  assert.deepEqual(await card.locator('[aria-label="Arithmetic operation"] option').allTextContents(),['+','−','×','÷']);
  await page.locator('#run-query').click();await page.waitForFunction(()=>!state.busy&&state.result?.total_rows===6);
  const rows=await page.evaluate(()=>state.result.rows.map(r=>[r[0],r.at(-1)]).sort((a,b)=>a[0].localeCompare(b[0])));
  assert.deepEqual(rows,[['a',40],['b',50],['c',null],['d',80],['e',null],['f',7.5]]);
  assert.equal(await page.locator('#sql-editor').inputValue(),'SELECT 42 AS untouched;');
  await card.locator(':scope > summary').click();assert((await card.boundingBox()).height<85);
  await page.screenshot({path:path.join(session.workspace,'calculated-column-compact.png')});
  await card.locator(':scope > summary').click();
  for(const name of ['calc_products.id','calc_products.price','calc_discounts.price'])await page.getByRole('button',{name:'Remove '+name+' from Output',exact:true}).click();
  await field('t1','category').dragTo(page.locator('#qb-groups'));
  assert.match(await page.locator('#qb-status').textContent(),/choose Sum of result/);
  await card.locator('[aria-label="Calculate"]').selectOption('sum');await page.locator('#run-query').click();
  await page.waitForFunction(()=>!state.busy&&state.result?.rows.some(r=>r[0]==='Hardware'&&r.at(-1)===90));
  await card.locator('[aria-label="Calculate"]').selectOption('totals');await page.locator('#run-query').click();
  await page.waitForFunction(()=>!state.busy&&state.result?.rows.some(r=>r[0]==='Hardware'&&r.at(-1)===140));
  assert(await page.evaluate(()=>state.result.rows.some(r=>r[0]==='Software'&&r.at(-1)===127.5)));
  await card.getByText('Filter & sort',{exact:true}).click();await card.locator('[aria-label="Filter operator"]').selectOption('gt');
  await card.locator('[aria-label="Filter value"]').fill('130');await card.locator('[aria-label="Filter value"]').press('Tab');
  await card.locator('[aria-label="Calculation sort"]').selectOption('desc');await page.locator('#run-query').click();
  await page.waitForFunction(()=>!state.busy&&state.result?.rows.length===1&&state.result.rows[0].at(-1)===140);
  await page.screenshot({path:path.join(session.workspace,'calculated-category-totals.png')});
  await page.locator('#save-query').click();await page.locator('#saved-name').fill('Category discount');await page.locator('#confirm-save').click();await page.locator('#save-dialog').waitFor({state:'hidden'});
  assert(await page.evaluate(()=>state.data.saved.some(s=>s.name==='Category discount'&&s.sql.includes('Discount amount')&&s.sql.includes('HAVING'))));
  await page.reload();await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));await page.evaluate(()=>workArea());await page.locator('#query-builder-mode').click();
  card=page.locator('.qb-calculation').first();assert.equal(await card.locator('[aria-label="Calculate"]').inputValue(),'totals');assert.equal(await card.locator('[aria-label="Calculated column name"]').inputValue(),'Discount amount');
  await page.getByRole('button',{name:'Remove dataset calc_discounts',exact:true}).click();assert.equal(await page.locator('.qb-calculation').count(),0);await page.locator('#qb-undo').click();assert.equal(await page.locator('.qb-calculation').count(),1);
  // Numeric constants and division can be chosen without writing SQL.
  await card.locator('[aria-label="Right field or number"]').selectOption('number');await card.locator('[aria-label="Right number"]').fill('2');await card.locator('[aria-label="Right number"]').press('Tab');
  await card.locator('[aria-label="Arithmetic operation"]').selectOption('/');await card.locator('[aria-label="Filter operator"]').selectOption('');await page.locator('#run-query').click();
  await page.waitForFunction(()=>!state.busy&&state.result?.rows.some(r=>r[0]==='Hardware'&&r.at(-1)===175));
  await page.setViewportSize({width:760,height:850});await page.screenshot({path:path.join(session.workspace,'calculated-column-narrow.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#sql-mode').click();assert.match(await page.locator('#sql-editor').inputValue(),/NULLIF/);assert.deepEqual(errors,[]);
  console.log('PASS: calculation UI: cross-table field drops, row difference, compact card, category sum vs totals, filter/sort, save, reload, table removal/undo, constants/division, SQL handoff, narrow layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
