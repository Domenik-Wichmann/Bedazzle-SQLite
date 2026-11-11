import json
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch

from engine import ROOT,create_connection,perform,literal,identifier
from module_runtime import manifests,validate_options,read_run,runs
from modules.image_checker.network import check_url,target,Blocked
from image_fixture import Images

TEST_ROOT=ROOT/'workspace'/'automated-tests';TEST_ROOT.mkdir(parents=True,exist_ok=True)
SETTINGS={'memory_mb':256,'threads':1,'spill_gb':1,'timeout':30,'profile':'quiet'}


class ModuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.images=Images()
    @classmethod
    def tearDownClass(cls):cls.images.close()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=TEST_ROOT);self.root=Path(self.temp.name)
        self.conn=create_connection(self.root,SETTINGS,'modules')
        self.manifest=next(item for item in manifests() if item['id']=='image_checker')
        self.options=validate_options(self.manifest,{'url_columns':['url'],'allow_private':True,'retries':0},['url'])
        self.env={'workspace':self.root,'cancelled':threading.Event(),'emit':lambda value:None}
    def tearDown(self):self.conn.close();self.temp.cleanup()
    def url(self,path):return self.images.url+path
    def check(self,path,**options):return check_url(self.url(path),{**self.options,**options},self.env['cancelled'])
    def job(self,sql,options=None,key=None):
        return perform(self.conn,'module_run',{'module':'image_checker','sql':sql,'options':options or self.options},key or uuid.uuid4().hex,module_context=self.env)

    def test_decode_mime_extension_truncation_redirect_retry_gzip_animation(self):
        ok=self.check('/ok.png');self.assertTrue(ok['verified']);self.assertTrue(ok['complete_decode']);self.assertEqual((ok['width'],ok['height']),(32,24));self.assertEqual(len(ok['dhash']),16)
        wrong=self.check('/wrong.jpg');self.assertFalse(wrong['mime_matches']);self.assertFalse(wrong['extension_matches'])
        self.assertEqual(self.check('/missing')['http_status'],404)
        self.assertEqual(self.check('/html')['check_status'],'fail')
        self.assertEqual(self.check('/truncated')['check_status'],'fail')
        self.assertEqual(self.check('/huge')['check_status'],'limited')
        self.assertEqual(self.check('/redirect')['redirects'],1)
        self.assertEqual(self.check('/retry',retries=1)['attempts'],2)
        self.assertTrue(self.check('/gzip')['complete_decode'])
        animated=self.check('/animated.gif',max_frames=1);self.assertEqual(animated['frames'],2);self.assertFalse(animated['complete_decode'])
        rotated=self.check('/rotated.jpg');self.assertEqual((rotated['display_width'],rotated['display_height']),(24,32))
        self.assertEqual(self.check('/svg')['check_status'],'limited')

    def test_private_network_credentials_non_http_and_cancel_are_explicit(self):
        for url in ['file:///etc/passwd','http://user:password@example.com/a','http://127.0.0.1/a','http://[::1]/a']:
            with self.assertRaises(Blocked):target(url)
        self.assertEqual(self.check('/ok.png',allow_private=False)['check_status'],'blocked')
        self.env['cancelled'].set()
        with self.assertRaises(InterruptedError):self.check('/ok.png')

    def test_full_result_dedup_expectations_merge_preserves_duplicate_rows_and_snapshot(self):
        url=self.url('/merge.png');other=self.url('/other.png');before=self.images.hits.get('/merge.png',0)
        sql=f'SELECT i%3 AS original_key,{literal(url)} AS url,{literal(other)} AS "other image",CASE WHEN i=2 THEN 99 ELSE 32 END AS wanted_width FROM range(121) t(i)'
        options=validate_options(self.manifest,{'url_columns':['url','other image'],'expected_width':'wanted_width','allow_private':True,'retries':0},['original_key','url','other image','wanted_width'])
        result=self.job(sql,options);record=result['run'];report=identifier(result['name'])
        self.assertEqual(record['summary']['checked_cells'],242);self.assertEqual(record['summary']['unique_urls'],2)
        self.assertEqual(self.images.hits['/merge.png']-before,1)
        self.assertEqual(self.conn.execute(f'SELECT count(*) FROM {report} WHERE verdict=\'fail\'').fetchone()[0],2)
        self.assertEqual(self.conn.execute(f'SELECT min(same_content_urls) FROM {report}').fetchone()[0],2)
        merged=perform(self.conn,'module_merge',{'run_id':record['id'],'name':'merged images'},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM '+identifier(merged['name'])).fetchone()[0],121)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM '+identifier(merged['name'])+' WHERE "url__verdict"=\'fail\'').fetchone()[0],1)
        self.conn.close();self.conn=create_connection(self.root,SETTINGS,'reopen')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM "merged images"').fetchone()[0],121)

    def test_resume_reuses_completed_urls_and_keeps_original_input(self):
        first=self.url('/resume1.png');second=self.url('/slow');key=uuid.uuid4().hex
        sql=f'SELECT url FROM (VALUES ({literal(first)}),({literal(second)})) t(url)'
        def stop_after_one(activity):
            if activity.get('completed')==1:raise RuntimeError('simulated interruption')
        options={**self.options,'workers':1}
        with patch.dict(self.env,{'emit':stop_after_one}):
            with self.assertRaisesRegex(RuntimeError,'simulated'):self.job(sql,options,key)
        saved=read_run(self.root,key);self.assertEqual(saved['status'],'failed')
        self.assertEqual(saved['completed'],1)
        before=self.images.hits.get('/resume1.png',0)+self.images.hits.get('/slow',0)
        result=perform(self.conn,'module_run',{'run_id':key},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(result['run']['summary']['unique_urls'],2)
        after=self.images.hits.get('/resume1.png',0)+self.images.hits.get('/slow',0)
        self.assertEqual(after-before,1)

    def test_empty_query_and_option_validation_and_merge_keys(self):
        result=self.job('SELECT NULL::VARCHAR AS url WHERE false')
        self.assertEqual(result['run']['summary']['checked_cells'],0)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM '+identifier(result['name'])).fetchone()[0],0)
        with self.assertRaises(ValueError):validate_options(self.manifest,{'url_columns':['missing']},['url'])
        with self.assertRaises(ValueError):self.job('CREATE TABLE nope AS SELECT 1; SELECT 1 AS url')
        from module_runtime import run_path
        with self.assertRaises(ValueError):run_path(self.root,'../outside')

    def test_drop_in_module_contract_and_duplicate_key_guard(self):
        folder=self.root/'plugins'/'lengths';folder.mkdir(parents=True)
        manifest={'id':'lengths','version':'1.0.0','name':'Text lengths','entrypoint':'runner.py',
                  'fields':[{'key':'value_column','label':'Column','type':'column','required':True}]}
        (folder/'manifest.json').write_text(json.dumps(manifest))
        (folder/'runner.py').write_text('''from engine import identifier
def run(ctx,options):
    key=identifier(ctx.record['row_key']);value=identifier(options['value_column'])
    report=ctx.write_report(f'SELECT {key} AS row_id,length({value}) AS text_length FROM {ctx.input}')
    return {'report':report,'summary':{'rows':ctx.record['total_rows']},'merge':{'kind':'row','fields':['text_length']}}
''')
        with patch('module_runtime.MODULES',folder.parent):
            broken=folder.parent/'broken';broken.mkdir();(broken/'manifest.json').write_text('{bad json')
            from module_runtime import discover
            definitions,errors=discover();self.assertEqual(definitions[0]['id'],'lengths');self.assertEqual(errors[0]['module'],'broken')
            result=perform(self.conn,'module_run',{'module':'lengths','sql':"SELECT 'hello' AS message UNION ALL SELECT 'xy'",'options':{'value_column':'message'}},uuid.uuid4().hex,module_context=self.env)
        merged=perform(self.conn,'module_merge',{'run_id':result['run']['id']},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(sorted(self.conn.execute('SELECT report__text_length FROM '+identifier(merged['name'])).fetchall()),[(2,),(5,)])
        self.conn.execute('CREATE TABLE bad_report AS SELECT 1 AS row_id,3 AS text_length UNION ALL SELECT 1,4')
        path=self.root/'modules'/'runs'/result['run']['id']/'report.parquet'
        self.conn.execute('COPY bad_report TO '+literal(path.with_name('bad.parquet'))+' (FORMAT PARQUET)')
        path.with_name('bad.parquet').replace(path)
        with self.assertRaisesRegex(ValueError,'repeated merge keys'):
            perform(self.conn,'module_merge',{'run_id':result['run']['id']},uuid.uuid4().hex,module_context=self.env)
