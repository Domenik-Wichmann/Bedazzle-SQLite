import json
from pathlib import Path
import tempfile
import time
import unittest

from engine import ROOT, create_connection, perform, page, reader, literal, identifier
from app_server import Jobs

TEST_ROOT = ROOT / 'workspace' / 'automated-tests'
TEST_ROOT.mkdir(parents=True, exist_ok=True)
SETTINGS = {'memory_mb': 256, 'threads': 1, 'spill_gb': 1, 'timeout': 30, 'profile': 'balanced'}


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=TEST_ROOT)
        self.root = Path(self.directory.name).resolve()
        assert self.root.is_relative_to(TEST_ROOT.resolve())
        self.conn = create_connection(self.root, SETTINGS, 'unit')
        self.source = self.root / "O'Brien.csv"
        self.source.write_text('id,client,value\n001,Acme,12.50\n002,Acme,13.00\n003,Northwind,8.25\n', encoding='utf-8')

    def tearDown(self):
        self.conn.close()
        self.directory.cleanup()

    def perform(self, action, payload):
        return perform(self.conn, action, payload, 'jobtest')

    def test_text_import_preserves_identifiers_and_schema_survives_reopen(self):
        result = self.perform('open', {'path': str(self.source), 'name': 'quoted source'})
        self.assertEqual(result['name'], 'quoted source')
        self.assertEqual(self.conn.execute('SELECT id FROM "quoted source" ORDER BY id').fetchall(), [('001',),('002',),('003',)])
        self.conn.close()
        self.conn = create_connection(self.root, SETTINGS, 'reopen')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM "quoted source"').fetchone()[0], 3)
        self.assertEqual(self.conn.execute("SELECT current_setting('threads')").fetchone()[0], 1)

    def test_conversion_preserves_all_records_and_never_overwrites(self):
        target = self.root / 'output.parquet'
        result = self.perform('convert', {'path': str(self.source), 'output': str(target)})
        self.assertEqual(result['exported_rows'], 3)
        self.assertEqual(self.conn.execute(f'SELECT id FROM {literal(target.as_posix())} ORDER BY id').fetchall()[0], ('001',))
        before = target.read_bytes()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.perform('convert', {'path': str(self.source), 'output': str(target)})
        self.assertEqual(before, target.read_bytes())
        self.assertTrue(self.source.exists())

    def test_full_exports_exceed_preview_and_roundtrip_all_formats(self):
        sql = "SELECT i AS id, 'hello, world' AS text FROM range(1234) t(i)"
        preview = page(self.conn, sql, size=100)
        self.assertEqual(len(preview['rows']), 100)
        self.assertTrue(preview['has_more'])
        for format_name in ['parquet','csv','tsv','json','ndjson']:
            with self.subTest(format=format_name):
                target = self.root / ('full.' + format_name)
                result = self.perform('export', {'sql':sql,'output':str(target),'format':format_name})
                self.assertEqual(result['exported_rows'], 1234)
                self.assertEqual(self.conn.execute(f'SELECT count(*) FROM {reader(target)}').fetchone()[0], 1234)
                if format_name == 'json':
                    self.assertEqual(len(json.loads(target.read_text())), 1234)
                if format_name == 'ndjson':
                    self.assertEqual(len(target.read_text().splitlines()), 1234)

    def test_ordered_paging_has_no_missing_or_repeated_records(self):
        sql = 'SELECT i FROM range(237) t(i) ORDER BY i'
        values, offset = [], 0
        while True:
            result = page(self.conn, sql, offset, 100)
            values.extend(row[0] for row in result['rows'])
            if not result['has_more']:
                break
            offset = result['next_offset']
        self.assertEqual(values, list(range(237)))

    def test_preview_cell_budget_does_not_skip_wide_rows(self):
        sql = 'SELECT ' + ','.join(f'i AS c{n}' for n in range(120)) + ' FROM range(120) t(i) ORDER BY i'
        result = page(self.conn, sql, size=500)
        self.assertLessEqual(len(result['rows']) * len(result['columns']), 10000)
        self.assertTrue(result['has_more'])
        next_page = page(self.conn, sql, result['next_offset'], 500)
        self.assertEqual(next_page['rows'][0][0], len(result['rows']))

    def test_preview_clips_text_and_protects_large_integer_precision(self):
        result = page(self.conn, "SELECT repeat('x', 20000) AS long_text, 9223372036854775807::BIGINT AS id")
        self.assertEqual(result['rows'][0][1], '9223372036854775807')
        self.assertLess(len(result['rows'][0][0]), 4200)
        self.assertEqual(result['clipped_cells'], 1)

    def test_failed_conversion_removes_partial_file(self):
        bad = self.root / 'bad.csv'
        bad.write_text('a,b\n1,2\n3,4,5\n')
        target = self.root / 'bad.parquet'
        with self.assertRaises(Exception):
            self.perform('convert', {'path': str(bad), 'output': str(target), 'options': {'delimiter': ','}})
        self.assertFalse(target.exists())
        self.assertFalse(list(self.root.glob('*.partial')))

    def test_profile_and_explain_work(self):
        self.perform('open', {'path': str(self.source), 'name':'sample'})
        profile = self.perform('profile', {'name': 'sample'})['profile']
        self.assertEqual(len(profile['rows']), 3)
        plan = self.perform('explain', {'sql':'SELECT count(*) FROM sample'})['plan']
        self.assertIn('aggregate', plan.lower())

    def test_exact_total_for_paged_grouped_limited_and_empty_results(self):
        previews=[]
        result=perform(self.conn,'query',{'sql':'SELECT i FROM range(1234) t(i)','size':100},'count',on_preview=previews.append)
        self.assertEqual(result['total_rows'],1234)
        self.assertEqual(len(result['rows']),100)
        self.assertEqual(previews[0]['total_status'],'counting')
        self.assertNotIn('total_rows',previews[0])
        grouped=self.perform('query',{'sql':'SELECT i%156 AS k,count(*) FROM range(10000) t(i) GROUP BY k','size':100})
        self.assertEqual(grouped['total_rows'],156)
        limited=self.perform('query',{'sql':'SELECT i FROM range(10000) t(i) LIMIT 156','size':100})
        self.assertEqual(limited['total_rows'],156)
        empty=self.perform('query',{'sql':'SELECT i FROM range(1234) t(i)','offset':2000})
        self.assertEqual(empty['rows'],[])
        self.assertEqual(empty['total_rows'],1234)

    def test_count_does_not_repeat_setup_and_keeps_temp_table_connection(self):
        result=self.perform('query',{'sql':'CREATE TEMP TABLE temp_rows AS SELECT * FROM range(156); SELECT * FROM temp_rows;','size':100})
        self.assertEqual(result['total_rows'],156)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM temp_rows').fetchone()[0],156)

    def test_trailing_comments_and_quoted_semicolons_survive_paging_count_sort_export(self):
        sql="SELECT i, '; -- literal' AS text FROM range(156) t(i); /* nested /* note */ end */ -- trailing note"
        result=self.perform('query',{'sql':sql})
        self.assertEqual(result['total_rows'],156)
        self.assertEqual(result['rows'][0][1],'; -- literal')
        sorted_result=self.perform('query',{'sql':sql,'sort':{'column':'i','direction':'DESC'}})
        self.assertEqual(sorted_result['rows'][0][0],155)
        target=self.root/'comments.parquet'
        exported=self.perform('export',{'sql':sql,'format':'parquet','output':str(target)})
        self.assertEqual(exported['exported_rows'],156)

    def test_rename_keeps_old_sql_working_and_can_rename_back(self):
        self.perform('open',{'path':str(self.source),'name':'original'})
        self.perform('query',{'sql':'CREATE VIEW dependent AS SELECT * FROM original'})
        first=self.perform('rename',{'name':'original','new_name':'My "sales" data'})
        self.assertEqual(first['name'],'My "sales" data')
        self.perform('rename',{'name':first['name'],'new_name':'Final data'})
        restored=self.perform('rename',{'name':'Final data','new_name':'original'})
        self.assertEqual({item['name'] for item in restored['catalog']},{'original','dependent'})
        for name in ['original','My "sales" data','Final data','dependent']:
            self.assertEqual(self.conn.execute(f'SELECT count(*) FROM {identifier(name)}').fetchone()[0],3)
        with self.assertRaisesRegex(ValueError,'already'):
            self.perform('open',{'path':str(self.source),'name':'ORIGINAL'})


class IsolatedWorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=TEST_ROOT)
        root = Path(self.directory.name).resolve()
        assert root.is_relative_to(TEST_ROOT.resolve())
        self.jobs = Jobs(root)
        self.jobs.store.put('settings', SETTINGS)

    def tearDown(self):
        self.jobs.close()
        # Wait for the watcher to close database/pipe handles before removing files.
        deadline = time.time() + 8
        while self.jobs.active_id and time.time() < deadline:
            time.sleep(.05)
        self.directory.cleanup()

    def wait(self, job_id, timeout=15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            job = self.jobs.status(job_id)
            if job.get('finished'):
                return job
            time.sleep(.05)
        self.fail('Worker did not finish within the test deadline')

    def test_cancel_recovers_workspace_and_reapplies_settings(self):
        job = self.jobs.submit('query', {'sql':'SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)'})
        time.sleep(.7)
        self.jobs.cancel()
        self.assertEqual(self.wait(job['id'])['status'], 'cancelled')
        next_job = self.jobs.submit('query', {'sql':"SELECT 42, current_setting('threads')"})
        result = self.wait(next_job['id'])
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['result']['rows'], [[42, 1]])

    def test_time_limit_stops_worker(self):
        self.jobs.store.put('settings', {**SETTINGS, 'timeout':1})
        job = self.jobs.submit('query', {'sql':'SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)'})
        self.assertEqual(self.wait(job['id'])['status'], 'timed_out')

    def test_count_delivers_preview_before_cancellation(self):
        item=self.jobs.submit('query',{'sql':'SELECT a.i FROM range(1000000) a(i),range(1000000) b(i) WHERE (a.i*b.i)%7=0','size':100})
        deadline=time.time()+12
        while time.time()<deadline:
            job=self.jobs.status(item['id'])
            if job.get('preview'):
                break
            time.sleep(.05)
        self.assertEqual(job['preview']['total_status'],'counting')
        self.assertEqual(len(job['preview']['rows']),100)
        self.jobs.cancel()
        self.assertEqual(self.wait(item['id'])['status'],'cancelled')


if __name__ == '__main__':
    unittest.main()
