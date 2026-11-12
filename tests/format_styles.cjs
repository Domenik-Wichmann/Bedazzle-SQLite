const fs=require('fs'),path=require('path'),assert=require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.test-tools/browsers');
const {chromium}=require('../.test-tools/node_modules/playwright');
const session=JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION||'workspace/http-smoke-session.json'));
(async()=>{
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const source="with sample as (select i, 'O''Brien' as name, [1,2,3] as amounts from range(3) r(i)) select i as record_id, name as customer_name, upper(name) as uppercase_name, list_sum(amounts) as total_amount, (i+10)*(i+20) as weighted_score from sample where i>=0 and name is not null order by record_id;";
 try{
  await page.goto(session.url+'/#'+session.token);await page.waitForFunction(()=>state.data&&!state.busy&&document.querySelector('.query-tab'));
  await page.evaluate(()=>workArea());
  const outputs={};let expected;
  for(const style of ['vertical','compact','aligned']){
   await page.locator('#sql-editor').fill(source);
   await page.locator('#beautify-options').click();
   if(style==='compact')await page.locator('#beautify-width').selectOption('80');
   await page.locator('[data-sql-format="'+style+'"]').click();
   outputs[style]=await page.locator('#sql-editor').inputValue();
   assert(outputs[style].includes("'O''Brien'"));
   await page.keyboard.press('Control+z');assert.equal(await page.locator('#sql-editor').inputValue(),source);
   await page.locator('#beautify-query').click();
   assert.equal(await page.locator('#sql-editor').inputValue(),outputs[style]);
   await page.locator('#run-query').click();await page.waitForFunction(()=>!state.busy&&state.result?.rows?.length===3);
   const rows=await page.evaluate(()=>state.result.rows);if(!expected)expected=rows;else assert.deepEqual(rows,expected);
  }
  assert(outputs.compact.split('\n').length<outputs.vertical.split('\n').length);
  assert.notEqual(outputs.aligned,outputs.vertical);
  assert(outputs.compact.split('\n').every(line=>line.length<=80));
  console.log('PASS: three distinct format styles, line limit, keyboard undo and identical real DuckDB results');

  for(const sample of ["SELECT 'hello'\n'world' AS joined;", "SELECT E'escaped\\\' word  with spaces' AS phrase, $$a\nb$$ AS multiline;", "SELECT 1 /* keep /* nested */ comment */ + 2 AS x; -- keep comment\nSELECT 3 AS y;"]){
   const rows=await page.evaluate(async sql=>(await runJob('query',{sql,size:100})).rows,sample);
   for(const style of ['vertical','compact','aligned']){
    await page.locator('#sql-editor').fill(sample);await page.locator('#beautify-options').click();await page.locator('[data-sql-format="'+style+'"]').click();
    assert.deepEqual(await page.evaluate(async()=>(await runJob('query',{sql:$('sql-editor').value,size:100})).rows),rows);
   }
  }
  console.log('PASS: all styles preserve adjacent string concatenation, escaped strings, multiline dollar strings and nested/line comments');

  await page.locator('#beautify-options').focus();await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>sqlFormatStyle),'compact');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.query-tab')&&typeof sqlFormatStyle!=='undefined'&&sqlFormatStyle==='compact');
  assert(await page.locator('#sql-pane').evaluate(el=>el.classList.contains('sql-wrap')));
  await page.setViewportSize({width:760,height:800});
  const long="select '"+'wide literal '.repeat(35)+"' as label, 1 as id; -- keep this comment\nselect $$dollar\nquoted$$ as value;";
  await page.locator('#sql-editor').fill(long);await page.locator('#beautify-query').click();
  await page.waitForTimeout(150);
  assert(await page.locator('#suggestions').evaluate(el=>el.classList.contains('hidden')));
  const metrics=await page.evaluate(()=>{
   const area=$('sql-editor'),mirror=$('sql-highlight'),gutter=$('line-numbers');
   return {width:area.clientWidth,scroll:area.scrollWidth,mirrorWidth:mirror.clientWidth,textHeight:area.scrollHeight,mirrorHeight:mirror.scrollHeight,heights:[...mirror.children].map((el,i)=>[el.getBoundingClientRect().height,gutter.children[i]?.getBoundingClientRect().height])};
  });
  assert(metrics.scroll<=metrics.width+1,JSON.stringify(metrics));
  assert.equal(metrics.mirrorWidth,metrics.width);
  assert(Math.abs(metrics.textHeight-metrics.mirrorHeight)<2,JSON.stringify(metrics));
  assert(metrics.heights.every(([line,gutter])=>Math.abs(line-gutter)<1));
  const preserved=await page.evaluate(source=>{
   const raw=s=>SQLAssist.lex(s).filter(t=>['string','comment','id'].includes(t.kind)).map(t=>s.slice(t.start,t.end));
   return JSON.stringify(raw(source))===JSON.stringify(raw($('sql-editor').value));
  },long);assert(preserved);
  await page.evaluate(()=>document.body.classList.add('sidebar-collapsed'));await page.screenshot({path:'workspace/verification/compact-narrow-wrapping.png'});
  console.log('PASS: menu keyboard navigation, remembered style, compact wrapping and gutter alignment on narrow editor; multiline literals/comments intact');

  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>document.body.classList.remove('sidebar-collapsed'));
  await page.locator('#sql-editor').fill(source);await page.locator('#beautify-query').click();await page.locator('#beautify-options').click();
  await page.waitForTimeout(100);fs.mkdirSync('workspace/verification',{recursive:true});await page.screenshot({path:'workspace/verification/night-format-menu.png'});
  await page.keyboard.press('Escape');
  await page.locator('#pivot-mode').click();
  assert.equal(await page.locator('#pivot-add-to').count(),0);
  const palette=await page.locator('.pivot-field-panel').evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color};});
  assert.equal(palette.background,'rgb(20, 22, 27)');
  await page.screenshot({path:'workspace/verification/night-pivot-fields.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: neutral black night palette, pivot field rail matches theme and Add to dropdown is removed; no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
