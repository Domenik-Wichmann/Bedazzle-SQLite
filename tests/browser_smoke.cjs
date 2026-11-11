// Isolated headless tests. This never attaches to the user's browser profile.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('.test-tools/browsers');
const {chromium} = require('../.test-tools/node_modules/playwright');
const session = JSON.parse(fs.readFileSync('workspace/http-smoke-session.json','utf8'));
const artifacts = path.resolve('workspace/verification');
fs.mkdirSync(artifacts,{recursive:true});

async function main() {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1040}});
  const page = await context.newPage();
  const savedName='Paging browser check '+Date.now();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const waitIdle = async () => {
    await page.locator('#job-strip').waitFor({state:'hidden',timeout:30000});
    await page.waitForTimeout(100);
  };
  const query = async sql => {
    await page.locator('#sql-mode').click();
    await page.locator('#sql-editor').fill(sql);
    await page.locator('#run-query').click();
    await waitIdle();
  };
  try {
    await page.goto(session.url+'/#'+session.token);
    await page.locator('.dataset-item[title$="catalogs.csv"]').first().waitFor();
    await page.locator('.dataset-item[title$="catalogs.csv"]').first().click();
    await waitIdle();
    assert.equal(await page.locator('#result-table tbody tr').count(),6);
    console.log('PASS: dataset selection renders a native SQL preview');

    await query('SELECT i AS id, i % 5 AS group_id FROM range(1234) t(i) ORDER BY i;');
    assert.equal(await page.locator('#result-table tbody tr').count(),100);
    await page.locator('#next-page').click();await waitIdle();
    assert.equal((await page.locator('#page-label').textContent()).trim(),'101–200');
    assert.equal((await page.locator('#result-table tbody tr').first().locator('td').nth(1).textContent()).trim(),'100');
    await page.locator('#previous-page').click();await waitIdle();
    assert.equal((await page.locator('#page-label').textContent()).trim(),'1–100');
    console.log('PASS: server-side next/previous paging and visible row ranges');
    const oldTab=(await page.locator('.query-tab').count())-1;
    await page.locator('.new-tab').click();
    await query("SELECT 'another tab' AS note;");
    await page.locator('.query-tab').nth(oldTab).locator('button').first().click();
    assert((await page.locator('#sql-editor').inputValue()).includes('range(1234)'));
    assert.equal(await page.locator('#result-table tbody tr').count(),100);
    await page.locator('.query-tab').last().locator('.tab-close').click();
    console.log('PASS: SQL tabs retain their editor and bounded query results');

    await page.locator('#save-query').click();await page.locator('#saved-name').fill(savedName);
    await page.locator('#confirm-save').click();
    await page.locator('#save-dialog').waitFor({state:'hidden'});
    await page.locator('#library-nav').click();await page.locator('#library-search').fill(savedName);
    assert.equal(await page.locator('.library-item').count(),1);
    await page.locator('.library-item-main').click();
    console.log('PASS: save, search, and restore query through the UI');

    await page.locator('#explore-mode').click();
    const options = await page.locator('#builder-dataset option').evaluateAll(items=>items.map(item=>({value:item.value,text:item.textContent})));
    const source = options.find(item=>item.value.startsWith('catalogs'));
    await page.locator('#builder-dataset').selectOption(source.value);
    await page.locator('#group-columns').selectOption('client');
    await page.locator('#aggregate').selectOption('count');
    await page.locator('#run-query').click();await waitIdle();
    assert.equal(await page.locator('#result-table > tbody > tr').count(),3);
    await page.locator('.drill-button').first().click();await waitIdle();
    assert.equal(await page.locator('.expanded-table tbody tr').count(),3);
    await page.screenshot({path:path.join(artifacts,'grouping.png'),fullPage:true});
    await page.locator('.drill-button').first().click();
    assert.equal(await page.locator('.expanded-row').count(),0);
    await page.locator('#filter-column').selectOption('catalog');
    await page.locator('#filter-op').selectOption('equals');
    await page.locator('#filter-value').fill('Spring');
    await page.locator('#run-query').click();await waitIdle();
    await page.locator('.drill-button').first().click();await waitIdle();
    assert.equal(await page.locator('.expanded-table tbody tr').count(),2);
    assert((await page.locator('.expanded-table').textContent()).includes('Spring'));
    await page.locator('#filter-column').selectOption('');
    await page.locator('#run-query').click();await waitIdle();
    await page.locator('[data-view="chart"]').click();
    assert.equal(await page.locator('.bar-row').count(),3);
    await page.screenshot({path:path.join(artifacts,'chart.png'),fullPage:true});
    console.log('PASS: visual grouping, expandable records, and chart rendering');

    await page.locator('[data-view="profile"]').click();await page.locator('#run-profile').click();await waitIdle();
    assert.equal(await page.locator('#profile-table tbody tr').count(),5);
    console.log('PASS: on-demand data profile through the UI');

    await page.locator('#import-parquet').click();
    await page.locator('#import-path').fill(path.resolve('examples/catalogs.csv'));
    const parquet=path.join(session.workspace,'browser-'+Date.now()+'.parquet');
    await page.locator('#import-output').fill(parquet);
    await page.locator('#preview-import').click();await waitIdle();
    assert.equal(await page.locator('#import-preview tbody tr').count(),6);
    await page.locator('#confirm-import').click();await waitIdle();
    await page.locator('#import-dialog').waitFor({state:'hidden'});
    // Conversion is followed by an automatic preview job.
    await page.waitForFunction(()=>document.querySelector('#workspace-title').textContent.startsWith('browser-'));
    await waitIdle();
    assert(fs.existsSync(parquet));
    console.log('PASS: Import as Parquet dialog → preview → conversion → opened dataset');

    await query('SELECT i, \'full-result\' AS label FROM range(1234) t(i) ORDER BY i;');
    const exported=path.join(session.workspace,'browser-export-'+Date.now()+'.csv');
    await page.locator('#export-results').click();await page.locator('#export-format').selectOption('csv');
    await page.locator('#export-path').fill(exported);await page.locator('#confirm-export').click();await waitIdle();
    assert.equal(fs.readFileSync(exported,'utf8').trim().split(/\r?\n/).length,1235);
    await page.locator('#export-results').click();await page.locator('#export-path').fill(exported);
    await page.locator('#confirm-export').click();await waitIdle();
    assert((await page.locator('#export-error').textContent()).includes('already exists'));
    await page.locator('#export-dialog .close-button').click();
    console.log('PASS: UI export includes all 1,234 rows and refuses overwrite');

    await page.locator('#performance-nav').click();
    await page.locator('#settings-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#hardware-cards > div').count(),3);
    await page.locator('#setting-memory').fill('256');await page.locator('#setting-threads').fill('1');
    await page.locator('#setting-profile').selectOption('quiet');await page.locator('#save-settings').click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
    await page.locator('#sql-mode').click();
    await page.locator('#sql-editor').fill('SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i);');
    await page.locator('#run-query').click();await page.locator('#job-strip').waitFor({state:'visible'});
    await page.locator('#cancel-job').click();await waitIdle();
    assert((await page.locator('#result-message').textContent()).includes('Cancelled'));
    await query('SELECT 42 AS recovered;');
    assert.equal((await page.locator('#result-table tbody tr td').nth(1).textContent()).trim(),'42');
    console.log('PASS: performance UI, responsive cancellation, and successful next query');

    await page.setViewportSize({width:1024,height:900});
    await page.screenshot({path:path.join(artifacts,'laptop.png'),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false,'Document overflows horizontally at laptop width');
    await page.setViewportSize({width:1440,height:1040});
    await page.locator('#import-parquet').click();
    await page.screenshot({path:path.join(artifacts,'import.png'),fullPage:true});
    await page.locator('#import-dialog .close-button').click();
    await page.reload();await page.locator('.dataset-item').first().waitFor();
    assert((await page.locator('#sql-editor').inputValue()).includes('recovered'));
    assert.equal(await page.locator('#job-strip').isVisible(),false);
    console.log('PASS: responsive laptop layout and editor restoration without rerunning SQL');
    assert.deepEqual(errors,[],'Browser errors: '+errors.join('\n'));
    console.log('PASS: no JavaScript exceptions or browser console errors');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
