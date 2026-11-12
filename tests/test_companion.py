"""Real stdio MCP -> authenticated HTTP -> spawned DuckDB worker regressions."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app_server import Server
from companion_store import Ledger, digest


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'workspace')
        self.home = Path(self.temp.name)
        (self.home / 'workspaces.json').write_text(json.dumps({'selected': 'primary', 'items': [{'id': 'primary', 'name': 'Test'}], 'example_offered': True}))
        self.server = Server(('127.0.0.1', 0), self.home)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        (self.home / 'server.json').write_text(json.dumps({'url': 'http://127.0.0.1:' + str(self.server.server_port), 'token': self.server.token}))
        self.ledger = Ledger(self.home)
        self.task = self.ledger.put('task', {'roots': [str(self.home)], 'scope': 'Inspect prices and approved corrections', 'active': True, 'budget': 1048576})['id']
        self.proc = subprocess.Popen([sys.executable, str(ROOT / 'companion_mcp.py'), '--workspace', str(self.home)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        self.seq = 0

    def tearDown(self):
        self.proc.terminate()
        self.proc.communicate(timeout=10)
        self.server.shutdown()
        self.server.jobs.close()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def rpc(self, method, params=None):
        self.seq += 1
        self.proc.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': self.seq, 'method': method, 'params': params or {}}) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        self.assertTrue(line, 'MCP server exited')
        return json.loads(line)

    def call(self, op, **args):
        result = self.rpc('tools/call', {'name': 'bedazzle_' + op, 'arguments': {'task': self.task, **args}})
        self.assertNotIn('error', result, result)
        raw = result['result']
        self.assertLessEqual(len(json.dumps(raw, ensure_ascii=False).encode()), 65536)
        return json.loads(raw['content'][0]['text'])

    def job(self, op, **args):
        submitted = self.call(op, **args)
        self.assertIn('id', submitted, submitted)
        deadline = time.time() + 40
        while time.time() < deadline:
            result = self.call('job', job=submitted['id'])
            if result.get('finished'):
                return result
            time.sleep(.08)
        self.fail('Job timed out')

    def success(self, op, **args):
        job = self.job(op, **args)
        self.assertEqual(job['status'], 'succeeded', job)
        return job['result']

    def approve(self, identity):
        approval = self.ledger.get('approval', identity)
        self.ledger.put('approval', {**approval, 'status': 'approved'}, identity)

    def test_two_gates_and_transport(self):
        init = self.rpc('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}})
        self.assertIn('serverInfo', init['result'])
        self.assertGreater(len(self.rpc('tools/list')['result']['tools']), 10)
        self.assertTrue(self.success('capabilities')['modules'])
        file = self.home / 'bad.csv'
        file.write_text('id,price\n1,bad\n2,12\n')
        before = digest(file)
        original = self.success('import', path=str(file))['version']['id']
        artifact = self.success('query', versions=[original], sql='SELECT count(*) AS failures FROM v0 WHERE TRY_CAST(price AS DOUBLE) IS NULL')['artifact']
        rows = self.success('preview', artifact=artifact['id'])['rows']
        self.assertEqual(rows, [['1']])
        proposal = self.success('propose_edit', version=original, changes=[{'row': 1, 'column': 'price', 'value': '10'}])
        denied = self.job('apply_edit', approval=proposal['id'])
        self.assertEqual(denied['status'], 'failed')
        self.approve(proposal['id'])
        edited = self.success('apply_edit', approval=proposal['id'])['version']['id']
        self.assertEqual(self.job('schema', version=edited)['status'], 'failed')
        approval = self.success('request_analysis', version=edited)
        self.assertNotEqual(approval['id'], proposal['id'])
        self.approve(approval['id'])
        corrected = self.success('query', versions=[edited], sql='SELECT count(*) FROM v0 WHERE TRY_CAST(price AS DOUBLE) IS NULL')['artifact']
        self.assertTrue(corrected['edited'])
        self.assertEqual(self.success('preview', artifact=corrected['id'])['rows'], [['0']])
        self.assertEqual(self.success('preview', artifact=artifact['id'])['rows'], [['1']])
        self.assertEqual(digest(file), before)
        for sql in ["SELECT * FROM read_csv('C:/secret.csv')", 'DELETE FROM v0', 'SELECT * FROM duckdb_tables()', 'SELECT * FROM main.v0', 'SELECT * FROM v0; SELECT 1', "SELECT getenv('PATH')"]:
            self.assertEqual(self.job('query', versions=[original], sql=sql)['status'], 'failed', sql)
        again = self.success('propose_edit', version=edited, changes=[{'row': 1, 'column': 'price', 'value': '11'}])
        self.approve(again['id'])
        newer = self.success('apply_edit', approval=again['id'])['version']['id']
        self.assertEqual(self.job('profile', version=newer)['status'], 'failed')

    def test_large_results_and_budget(self):
        path = self.home / 'large.parquet'
        # Fixture generation occurs locally, outside the MCP execution boundary.
        import duckdb
        conn = duckdb.connect()
        conn.execute("COPY (SELECT i, CASE WHEN i=0 THEN repeat('x',1000000) ELSE repeat('x',100) END AS huge FROM range(1000000) t(i)) TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(path)])
        conn.close()
        version = self.success('import', path=str(path))['version']['id']
        artifact = self.success('query', versions=[version], sql='SELECT * FROM v0')['artifact']
        self.assertEqual(artifact['rows'], 1000000)
        preview = self.success('preview', artifact=artifact['id'])
        self.assertLessEqual(len(preview['rows']), 200)
        self.assertLessEqual(len(preview['rows'][0][1]), 512)
        cell=self.success('cell',artifact=artifact['id'],row=1,column='huge',chars=6000)
        self.assertEqual(cell['total_utf8_bytes'],1000000)
        self.assertTrue(cell['truncated'])
        self.assertLessEqual(len(cell['value']),5000)
        self.assertEqual(self.job('query', versions=[version], sql='SELECT * FROM v0 WHERE i<2')['status'], 'succeeded')
        task = self.ledger.task(self.task)
        self.ledger.put('task', {**task, 'budget': task.get('transferred', 0)}, self.task)
        blocked = self.rpc('tools/call', {'name': 'bedazzle_versions', 'arguments': {'task': self.task}})
        self.assertTrue(blocked['result']['isError'])

    def test_images_and_lineage(self):
        from image_fixture import Images
        images = Images()
        try:
            task = self.ledger.task(self.task)
            self.ledger.put('task', {**task, 'allow_private_images': True}, self.task)
            path = self.home / 'urls.csv'
            path.write_text('id,url\n1,' + images.url + '/ok.png\n2,' + images.url + '/missing\n3,' + images.url + '/huge\n')
            version = self.success('import', path=str(path))['version']['id']
            report = self.success('images', version=version, options={'url_columns': ['url'], 'allow_private': True, 'retries': 0})
            preview = self.success('preview', artifact=report['artifact']['id'])
            self.assertEqual(len(preview['rows']), 3)
            self.assertIn('row_id', preview['columns'])
            self.assertEqual(images.hits['/ok.png'], 1)
            self.assertEqual(images.hits['/huge'], 1)
            self.assertEqual(self.job('browse', path=str(ROOT.parent))['status'], 'failed')
            self.success('profile', version=version)
            self.success('image_pairs',artifact=report['artifact']['id'])
            rechecked=self.success('image_recheck',artifact=report['artifact']['id'],mode='failures')
            self.assertNotEqual(rechecked['artifact']['module_run'],report['artifact']['module_run'])
            merge=self.success('image_merge',artifact=report['artifact']['id'])
            self.assertEqual(merge['status'],'pending')
            self.approve(merge['id'])
            merged=self.success('image_merge',artifact=report['artifact']['id'])['version']['id']
            self.assertEqual(self.job('schema',version=merged)['status'],'failed')
            grant=self.success('request_analysis',version=merged);self.approve(grant['id'])
            edited_report=self.success('images',version=merged,options={'url_columns':['url'],'allow_private':True,'retries':0})
            from module_runtime import read_run,run_path
            record=read_run(self.home,edited_report['run_id'])
            report_file=run_path(self.home,record['id'])/record['report']
            imported_report=self.success('import',path=str(report_file))['version']
            self.assertTrue(imported_report['edited'])
            self.assertEqual(self.job('schema',version=imported_report['id'])['status'],'failed')
        finally:
            images.close()

    def test_reimport_join_and_idempotency(self):
        path = self.home / 'input.csv'
        path.write_text('id,value\n1,bad\n')
        version = self.success('import', path=str(path))['version']['id']
        approval = self.success('propose_edit', version=version, changes=[{'row': 1, 'column': 'value', 'value': 'good'}])
        self.approve(approval['id'])
        edited = self.success('apply_edit', approval=approval['id'])['version']['id']
        self.assertEqual(self.success('apply_edit', approval=approval['id'])['version']['id'], edited)
        self.assertEqual(self.job('query', versions=[version, edited], sql='SELECT * FROM v0 JOIN v1 USING(id)')['status'], 'failed')
        original_copy = self.ledger.get('version', edited)
        renamed = self.home / 'renamed.parquet'
        import shutil
        shutil.copyfile(original_copy['path'], renamed)
        imported = self.success('import', path=str(renamed))['version']
        self.assertTrue(imported['edited'])
        self.assertEqual(self.job('schema', version=imported['id'])['status'], 'failed')
        request = self.success('request_analysis', version=edited)
        self.approve(request['id'])
        artifact = self.success('query', versions=[version, edited], sql='SELECT v0.id, v1.value FROM v0 JOIN v1 USING(id)')['artifact']
        retained=self.home/'results'/artifact['result_id']/'rows.parquet'
        imported_rows=self.success('import',path=str(retained))['version']
        self.assertTrue(imported_rows['edited'])
        self.assertEqual(self.job('schema',version=imported_rows['id'])['status'],'failed')
        lineage=self.success('lineage',version=imported_rows['id'])
        identities={node['id'] for node in lineage['nodes']}
        self.assertTrue({artifact['id'],edited,version}<=identities)
        export = self.home / 'derived.parquet'
        self.success('export', artifact=artifact['id'], output=str(export), format='parquet')
        imported = self.success('import', path=str(export))['version']
        self.assertTrue(imported['edited'])
        self.assertEqual(self.job('schema', version=imported['id'])['status'], 'failed')
        from result_store import release, metadata
        release(self.home, artifact['result_id'])
        metadata(self.home, artifact['result_id'])
        bulk=self.success('propose_edit',version=version,operations=[{'op':'replace','column':'value','find':'bad','replacement':'good'},{'op':'add'}])
        self.approve(bulk['id'])
        bulk_output=self.success('apply_edit',approval=bulk['id'])['version']['id']
        self.assertEqual(self.job('schema',version=bulk_output)['status'],'failed')

    def test_queue_cancel_and_restart_no_replay(self):
        from image_fixture import Images
        from app_server import Jobs
        images = Images()
        original_get = images.server.RequestHandlerClass.do_GET
        def slow(handler):
            time.sleep(1)
            return original_get(handler)
        images.server.RequestHandlerClass.do_GET = slow
        try:
            task = self.ledger.task(self.task)
            self.ledger.put('task', {**task, 'allow_private_images': True}, self.task)
            path = self.home / 'slow.csv'
            path.write_text('id,url\n1,' + images.url + '/ok.png\n')
            version = self.success('import', path=str(path))['version']['id']
            active = self.call('images', version=version, options={'url_columns': ['url'], 'allow_private': True, 'retries': 0})['id']
            queued = self.call('schema', version=version)['id']
            self.assertEqual(self.call('job', job=queued)['status'], 'queued')
            self.call('cancel', job=queued)
            self.assertEqual(self.call('job', job=queued)['status'], 'cancelled')
            deadline = time.time() + 15
            while not self.call('job', job=active).get('finished'):
                self.assertLess(time.time(), deadline)
                time.sleep(.1)
            self.server.jobs.close()
            self.server.jobs = Jobs(self.home)
            self.assertTrue(self.success('schema', version=version)['columns'])
            pending = self.success('propose_edit', version=version, changes=[{'row': 1, 'column': 'id', 'value': '2'}])
            self.ledger.put('approval', {**pending, 'status': 'approved', 'started': True}, pending['id'])
            self.assertEqual(self.job('apply_edit', approval=pending['id'])['status'], 'failed')
            self.assertEqual(path.read_text().splitlines()[1].split(',')[0], '1')
        finally:
            images.close()

    def test_real_inspection_diagnostics_and_sql_repair_gates(self):
        path=self.home/'diagnostics.csv'
        path.write_text('id,price,url,category\n001, 10.0 ,https://example.com/1.jpg,a\n002,bad,ftp://example.com/2.jpg,b\n003,,https://example.com/3.jpg,a\n')
        original=digest(path)
        imported=self.success('import',path=str(path))
        self.assertEqual(imported['operation'],'read_only_snapshot')
        version=imported['version']['id']
        sql="WITH source AS (SELECT * FROM v0) SELECT sum(CASE WHEN price <> trim(price) THEN 1 ELSE 0 END) AS whitespace, count(*) FILTER (WHERE url NOT LIKE 'https://%') AS unsupported, count(*) FILTER (WHERE NULLIF(trim(price),'') IS NOT NULL AND TRY_CAST(price AS DOUBLE) IS NULL) AS invalid FROM source"
        artifact=self.success('query',versions=[version],sql=sql)['artifact']
        self.assertEqual([float(v) for v in self.success('preview',artifact=artifact['id'])['rows'][0]],[1,1,1])
        self.success('query',versions=[version],sql="SELECT CASE WHEN price IS NULL THEN 'missing' ELSE 'ok' END AS diagnostic FROM v0")
        self.success('query',versions=[version],sql='SELECT id FROM v0 UNION ALL SELECT id FROM v0')
        self.success('query',versions=[version],sql="SELECT * FROM v0 PIVOT(count(*) FOR category IN ('a','b'))")
        self.assertEqual(self.job('query',versions=[version],sql='SELECT trim(price) AS price FROM v0')['status'],'failed')
        proposal=self.success('propose_transform',versions=[version],sql="SELECT id, trim(price) AS price, url, category FROM v0 WHERE TRY_CAST(price AS DOUBLE) IS NOT NULL",reason='Create a trimmed numeric-only hypothetical repair copy; excluded invalid records remain reported on the original')
        self.assertEqual(self.job('apply_transform',approval=proposal['id'])['status'],'failed')
        self.approve(proposal['id'])
        edited=self.success('apply_transform',approval=proposal['id'])['version']['id']
        self.assertEqual(self.job('profile',version=edited)['status'],'failed')
        second=self.success('request_analysis',version=edited);self.approve(second['id'])
        fixed=self.success('query',versions=[edited],sql='SELECT count(*) FROM v0')['artifact']
        self.assertTrue(fixed['edited'])
        self.assertEqual(self.success('preview',artifact=fixed['id'])['rows'],[['1']])
        self.assertEqual(digest(path),original)
        self.assertEqual([float(v) for v in self.success('preview',artifact=artifact['id'])['rows'][0]],[1,1,1])
        for sql in ["WITH x AS (SELECT * FROM read_csv('secret.csv')) SELECT * FROM x",'SELECT * FROM preferences','SELECT * FROM main.v0']:
            self.assertEqual(self.job('query',versions=[version],sql=sql)['status'],'failed')
        precise=self.success('query',versions=[version],sql='SELECT SUM(CAST(9007199254740993 AS BIGINT)) AS exact_sum FROM v0')['artifact']
        self.assertEqual(self.success('preview',artifact=precise['id'])['rows'],[['27021597764222979']])

    def test_keyed_edit_cannot_confuse_sorted_preview_rows(self):
        path=self.home/'keys.csv';path.write_text('id,value\nA,keep\nB,bad\n')
        version=self.success('import',path=str(path))['version']['id']
        proposal=self.success('propose_edit',version=version,keys=['id'],changes=[{'key':{'id':'B'},'column':'value','value':'good','expected':'bad'}])
        self.approve(proposal['id']);edited=self.success('apply_edit',approval=proposal['id'])['version']['id']
        grant=self.success('request_analysis',version=edited);self.approve(grant['id'])
        result=self.success('query',versions=[edited],sql='SELECT id,value FROM v0 ORDER BY id')['artifact']
        self.assertEqual(self.success('preview',artifact=result['id'])['rows'],[['A','keep'],['B','good']])
        wrong=self.success('propose_edit',version=version,changes=[{'row':1,'column':'value','value':'good','expected':'bad'}])
        self.approve(wrong['id']);self.assertEqual(self.job('apply_edit',approval=wrong['id'])['status'],'failed')

    def test_original_writeback_separate_overwrite_and_analysis(self):
        path=self.home/'writeback.csv';path.write_text('id,value\n1,bad\n2,keep\n')
        original_hash=digest(path)
        original=self.success('import',path=str(path))['version']['id']
        proposal=self.success('propose_edit',version=original,changes=[{'row':1,'column':'value','value':'good'}]);self.approve(proposal['id'])
        edited=self.success('apply_edit',approval=proposal['id'])['version']['id']
        request=self.success('propose_writeback',version=edited,target_version=original,keys=['id'])
        self.assertTrue(request['scope']['overwrite'])
        self.assertEqual(self.job('apply_writeback',approval=request['id'])['status'],'failed')
        self.assertEqual(digest(path),original_hash)
        self.approve(request['id'])
        written=self.success('apply_writeback',approval=request['id'])
        self.assertNotEqual(digest(path),original_hash)
        self.assertEqual(digest(written['backup']),original_hash)
        self.assertEqual(self.job('schema',version=written['version']['id'])['status'],'failed')
        snapshot=self.ledger.get('version',original)
        self.assertEqual(digest(snapshot['path']),original_hash)
        internal=self.success('import',path=snapshot['path'])['version']['id']
        self.assertEqual(self.job('propose_writeback',version=edited,target_version=internal,keys=['id'])['status'],'failed')

    def test_workspace_snapshot_and_chart_adapter(self):
        # The human task explicitly authorizes stored workspace tables.
        task=self.ledger.task(self.task);self.ledger.put('task',{**task,'allow_workspace_data':True},self.task)
        submitted=self.server.jobs.submit('query',{'sql':"CREATE TABLE example_table AS SELECT 1 AS id,'a' AS category,2.5 AS price"})['id']
        while not self.server.jobs.status(submitted).get('finished'):time.sleep(.05)
        listed=self.success('datasets')['datasets'];self.assertTrue(any(v['name']=='example_table' for v in listed))
        version=self.success('snapshot_dataset',name='example_table')['version']['id']
        artifact=self.success('query',versions=[version],sql='SELECT * FROM v0')['artifact']
        config={'type':'bar','x':'category','ys':['price'],'aggregate':'sum','title':'Category totals','dashboard':'Companion tests'}
        preview=self.success('chart_preview',artifact=artifact['id'],config=config)
        self.assertEqual(preview['matching_rows'],1)
        saved=self.success('chart_save',artifact=artifact['id'],config=config)
        self.assertEqual(saved['inputs'],[version])
        self.assertEqual(len(self.success('charts')['charts']),1)

    def test_dataset_download_limits_and_durable_job_receipt(self):
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                data=b'id,value\n1,ok\n' if self.path=='/csv' else b'x'*2048
                self.send_response(200);self.end_headers();self.wfile.write(data)
        http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        url='http://127.0.0.1:'+str(http.server_port)
        try:
            self.assertEqual(self.job('ingest_url',url=url+'/csv',output=str(self.home/'blocked.csv'),reason='Fixture download')['status'],'failed')
            task=self.ledger.task(self.task);self.ledger.put('task',{**task,'allow_private_downloads':True,'download_bytes':1024},self.task)
            downloaded=self.success('ingest_url',url=url+'/csv',output=str(self.home/'downloaded.csv'),reason='Fixture download')
            self.assertEqual(downloaded['download']['downloaded_bytes'],14)
            destination=self.home/'large.csv'
            self.assertEqual(self.job('ingest_url',url=url+'/large',output=str(destination),reason='Fixture download')['status'],'failed')
            self.assertFalse(destination.exists())
            request=next(v for v in self.ledger.list('approval') if v['purpose']=='dataset_download')
            self.approve(request['id'])
            self.success('ingest_url',url=url+'/large',output=str(destination),reason='Fixture download',max_bytes=request['scope']['max_bytes'])
            self.assertEqual(destination.stat().st_size,2048)
            # Complete a job without polling MCP, then discard the in-memory Jobs map.
            submitted=self.call('schema',version=downloaded['version']['id'])['id']
            while not self.server.jobs.status(submitted).get('finished'):time.sleep(.05)
            self.server.jobs.close()
            from app_server import Jobs
            self.server.jobs=Jobs(self.home)
            restored=self.call('job',job=submitted)
            self.assertEqual(restored['status'],'succeeded')
            self.assertTrue(restored['result']['columns'])
        finally:http.shutdown();http.server_close();thread.join()

    def test_table_writeback_and_rename_preserve_restrictions(self):
        task=self.ledger.task(self.task);self.ledger.put('task',{**task,'allow_workspace_data':True},self.task)
        submitted=self.server.jobs.submit('query',{'sql':"CREATE TABLE v0 AS SELECT '1' AS id,'bad' AS value"})['id']
        while not self.server.jobs.status(submitted).get('finished'):time.sleep(.05)
        original=self.success('snapshot_dataset',name='v0')['version']['id']
        # Query aliases must not replace the user's v0 table/session objects.
        self.success('query',versions=[original],sql='SELECT * FROM v0')
        edit=self.success('propose_edit',version=original,changes=[{'row':1,'column':'value','value':'good'}]);self.approve(edit['id'])
        edited=self.success('apply_edit',approval=edit['id'])['version']['id']
        writeback=self.success('propose_writeback',version=edited,target_version=original,keys=['id']);self.approve(writeback['id'])
        self.success('apply_writeback',approval=writeback['id'])
        renamed=self.server.jobs.submit('rename',{'name':'v0','new_name':'renamed source'})['id']
        while not self.server.jobs.status(renamed).get('finished'):time.sleep(.05)
        self.assertEqual(self.server.jobs.status(renamed)['status'],'succeeded')
        current=self.success('snapshot_dataset',name='renamed source')['version']
        self.assertTrue(current['edited'])
        self.assertEqual(self.job('schema',version=current['id'])['status'],'failed')

    def test_image_review_and_retention_are_locally_approved(self):
        from image_fixture import Images
        images=Images()
        try:
            task=self.ledger.task(self.task);self.ledger.put('task',{**task,'allow_private_images':True},self.task)
            path=self.home/'pairs.csv';path.write_text('id,url\n1,'+images.url+'/scene\n2,'+images.url+'/scene-jpeg\n')
            version=self.success('import',path=str(path))['version']['id']
            artifact=self.success('images',version=version,options={'url_columns':['url'],'allow_private':True,'retries':0})['artifact']
            pairs=self.success('image_pairs',artifact=artifact['id'])['pairs'];self.assertTrue(pairs)
            pair=pairs[0]
            request=self.success('image_decide',artifact=artifact['id'],pair_id=pair['id'],decision='similar',note='Human-reviewed fixture')
            self.assertEqual(request['status'],'pending');self.approve(request['id'])
            self.success('image_decide',artifact=artifact['id'],pair_id=pair['id'],decision='similar',note='Human-reviewed fixture')
            updated=self.success('image_pairs',artifact=artifact['id'])['pairs'][0]
            self.assertEqual(updated['decision'],'similar')
            retention=self.success('image_retention',artifact=artifact['id'],operation='release_input');self.approve(retention['id'])
            self.success('image_retention',artifact=artifact['id'],operation='release_input')
            deletion=self.success('image_retention',artifact=artifact['id'],operation='delete_run');self.approve(deletion['id'])
            self.success('image_retention',artifact=artifact['id'],operation='delete_run')
            self.success('image_retention',artifact=artifact['id'],operation='delete_run')
            self.assertEqual(len(self.success('preview',artifact=artifact['id'])['rows']),2)
        finally:images.close()


if __name__ == '__main__':
    unittest.main()
