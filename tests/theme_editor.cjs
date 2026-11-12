const fs = require('fs'), path = require('path'), assert = require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('.test-tools/browsers');
const {chromium} = require('../.test-tools/node_modules/playwright');
const session = JSON.parse(fs.readFileSync(process.env.BEDAZZLE_TEST_SESSION || 'workspace/http-smoke-session.json'));
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({viewport:{width:1440,height:900}, colorScheme:'light'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(session.url + '/#' + session.token);
    await page.locator('.query-tab.active').waitFor();
    const toggle = page.locator('#theme-toggle');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await toggle.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await toggle.getAttribute('aria-label'), 'Switch to light mode');
    const box = await toggle.boundingBox();
    assert(box.x + box.width > 1400 && box.y < 20);
    await page.reload();
    await page.locator('.query-tab.active').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    // A loopback port change on the next app launch must preserve the choice.
    const other = await context.newPage();
    await other.route('http://127.0.0.1:65531/**', route => route.fulfill({
      contentType:route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
      body:route.request().url().endsWith('.js') ? fs.readFileSync('ui/theme.js','utf8') : '<html><head><script src="/theme.js"></script></head><body><button id="theme-toggle"></button></body></html>'
    }));
    await other.goto('http://127.0.0.1:65531/');
    assert.equal(await other.locator('html').getAttribute('data-theme'), 'dark');
    await other.close();
    console.log('PASS: top-right accessible toggle, reload and new-port persistence');

    const sql = "select 'O''Brien' as author, 1.25e2 as amount, upper('hello') as greeting /* keep me */ where true;";
    await page.locator('#sql-editor').fill(sql);
    await page.waitForFunction(() => document.querySelector('#sql-highlight .sql-function'));
    for (const kind of ['keyword','string','number','function','comment','literal']) assert(await page.locator('.sql-' + kind).count(), kind);
    const resultBefore = await page.evaluate(() => state.result?.result_id);
    await page.locator('#beautify-query').click();
    const formatted = await page.locator('#sql-editor').inputValue();
    assert(formatted.includes('\n  ') && formatted.startsWith('SELECT'));
    assert(formatted.includes("'O''Brien'") && formatted.includes('/* keep me */'));
    assert.equal(await page.evaluate(() => state.result?.result_id), resultBefore);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#sql-editor').inputValue(), sql);
    await page.locator('#beautify-query').click();
    await page.reload();
    await page.locator('.query-tab.active').waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), formatted);
    await page.locator('#run-query').click();
    await page.waitForFunction(() => state.result?.rows?.[0]?.[0] === "O'Brien");
    assert.deepEqual(await page.evaluate(() => state.result.rows[0]), ["O'Brien",125,'HELLO']);
    console.log('PASS: syntax colors, DuckDB formatting, literal/comment preservation, undo, saved draft, real execution');

    await page.evaluate(() => {
      setEditor('select 1; select 2+3 as total;');
      $('sql-editor').setSelectionRange(10,28);
    });
    await page.locator('#beautify-query').click();
    assert((await page.locator('#sql-editor').inputValue()).startsWith('select 1; SELECT\n'));
    const invalid = "select 'unterminated";
    await page.locator('#sql-editor').fill(invalid);
    await page.locator('#beautify-query').click();
    assert.equal(await page.locator('#sql-editor').inputValue(), invalid);
    console.log('PASS: selection-only formatting and safe handling of unfinished SQL');

    await page.locator('#sql-editor').fill('SELECT $$<img src=x onerror=alert(1)>$$ AS text, "A ""quoted"" name", 12.5e-2; /* outer /* nested */ comment */');
    await page.waitForFunction(() => document.querySelector('#sql-highlight .sql-string')?.textContent.includes('<img'));
    assert.equal(await page.locator('#sql-highlight img').count(), 0);
    assert.equal(await page.locator('#sql-highlight .sql-string').textContent(), '$$<img src=x onerror=alert(1)>$$');
    await page.evaluate(() => {
      setEditor(Array.from({length:200}, (_, i) => '-- ' + i + ' ' + 'long text '.repeat(40)).join('\n'));
      $('sql-editor').scrollTop = 1000; $('sql-editor').scrollLeft = 300;
      $('sql-editor').dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() => $('sql-highlight').scrollTop === $('sql-editor').scrollTop && $('sql-highlight').scrollLeft === $('sql-editor').scrollLeft);
    console.log('PASS: safe rendered SQL, dollar strings, nested comments and synchronized scrolling');

    await page.evaluate(() => {setEditor("-- Customer rollup\nWITH sales AS (\n  SELECT 'Acme' AS client, 125.50 AS revenue\n)\nSELECT\n  client,\n  SUM(revenue) AS total_revenue,\n  COUNT(*) AS orders\nFROM sales\nWHERE revenue > 0\nGROUP BY client\nORDER BY total_revenue DESC;");$('sql-editor').scrollTop=0;$('sql-editor').scrollLeft=0;$('sql-editor').dispatchEvent(new Event('scroll'));});
    await page.waitForTimeout(100);
    await page.evaluate(() => { $('toast-container').replaceChildren(); document.querySelectorAll('.celebration').forEach(item => item.remove()); });
    fs.mkdirSync('workspace/verification', {recursive:true});
    await page.screenshot({path:'workspace/verification/dark-sql-editor.png'});
    await toggle.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.waitForTimeout(200);
    await page.screenshot({path:'workspace/verification/light-sql-editor.png'});
    await page.setViewportSize({width:760,height:800});
    assert(await page.locator('#beautify-query').isVisible());
    assert(await toggle.isVisible());
    assert.deepEqual(errors, []);
    console.log('PASS: both palettes and compact viewport; no browser errors');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
