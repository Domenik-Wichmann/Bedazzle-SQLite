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
        self.assertEqual(self.conn.execute(f'SELECT min(url_affected_records) FROM {report}').fetchone()[0],121)
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

    def manage(self,**payload):
        return perform(self.conn,'module_manage',payload,uuid.uuid4().hex,module_context=self.env)

    def test_professional_classification_transparency_evidence_and_redaction(self):
        from modules.image_checker.quality import redact_url
        for path,status in [('/denied','access_denied'),('/rate','rate_limited'),('/server','server_error'),('/missing','missing'),('/html','invalid_image')]:
            self.assertEqual(self.check(path)['retrieval_status'],status)
        image=self.check('/transparent');self.assertTrue(image['fully_transparent']);self.assertEqual(image['alpha_fraction'],0)
        self.assertEqual(image['check_status'],'warning');self.assertTrue(self.check('/blank')['uniform_image'])
        self.assertTrue(image['decoder_version']);self.assertIn('PNG',json.loads(image['decoder_capabilities']))
        self.assertEqual(len(json.loads(image['retry_history'])),1)
        self.assertEqual(redact_url('https://user:pass@example.com/x.png?secret=abc#token'),'https://example.com/x.png')

    def test_requirements_profiles_impact_and_known_placeholders(self):
        import hashlib
        values={'url_columns':['url'],'record_id':'sku','allow_private':True,'retries':0,'min_width':40,
                'allowed_formats':'JPEG','max_aspect_percent':100,'transparency':'required',
                'placeholder_hashes':hashlib.sha256(self.images.png).hexdigest(),'shared_threshold':2}
        options=validate_options(self.manifest,values,['url','sku'])
        result=self.job(f'SELECT i AS sku,{literal(self.url("/ok.png"))} AS url FROM range(3) t(i)',options)
        row=self.conn.execute('SELECT record_id,issue,requirements_status,coverage,content_affected_records,shared_image_review FROM '+identifier(result['name'])+' ORDER BY row_id').fetchone()
        self.assertEqual(row[0],'0');self.assertIn('Minimum width: 40',row[1]);self.assertIn('known placeholder',row[1]);self.assertIn('Format must',row[1]);self.assertIn('Aspect ratio',row[1]);self.assertEqual(row[2:],('fail','full',3,True))
        saved=self.manage(operation='save_profile',name='Catalog',options={k:v for k,v in values.items() if k not in ('record_id','url_columns')})
        self.assertEqual(saved['profiles']['Catalog']['min_width'],40)
        self.assertNotIn('allow_private',saved['profiles']['Catalog'])
        self.assertNotIn('record_id',saved['profiles']['Catalog'])
        self.assertEqual(self.manage(operation='delete_profile',name='Catalog')['profiles'],{})
        with self.assertRaisesRegex(ValueError,'SHA-256'):
            self.job("SELECT 'https://example.com/image' AS url",{**self.options,'placeholder_hashes':'invalid'})

    def test_targeted_rechecks_compare_and_preserve_original_report(self):
        result=self.job(f'SELECT * FROM (VALUES ({literal(self.url("/ok.png"))}),({literal(self.url("/missing"))})) t(url)')
        original=result['run'];before=self.images.hits.get('/ok.png',0)
        retry=perform(self.conn,'module_run',{'run_id':original['id'],'recheck':'failures'},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.images.hits.get('/ok.png',0),before)
        self.assertNotEqual(retry['run']['id'],original['id']);self.assertEqual(read_run(self.root,original['id'])['status'],'completed')
        statuses=dict(self.conn.execute('SELECT retrieval_status,change_status FROM '+identifier(retry['name'])).fetchall())
        self.assertEqual(statuses['retrieved'],'reused');self.assertEqual(statuses['missing'],'unchanged')
        record_id=self.conn.execute('SELECT row_id FROM '+identifier(result['name'])+" WHERE retrieval_status='retrieved'").fetchone()[0]
        selected=perform(self.conn,'module_run',{'run_id':original['id'],'recheck':'selected','selected':[{'row_id':record_id,'url_column':'url'}]},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.images.hits.get('/ok.png',0),before+1)
        self.assertEqual(selected['run']['summary']['checked_cells'],2)
        before=self.images.hits.get('/ok.png',0)
        perform(self.conn,'module_run',{'run_id':original['id'],'recheck':'stale','days':7},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.images.hits.get('/ok.png',0),before)

    def test_safe_preview_and_retained_input_release_guards(self):
        result=self.job('SELECT '+literal(self.url('/ok.png'))+' AS url');key=result['run']['id']
        preview=self.manage(operation='preview',run_id=key,row_id=1,url_column='url')
        self.assertTrue(preview['thumbnail'].startswith('data:image/png;base64,'))
        perform(self.conn,'module_merge',{'run_id':key},uuid.uuid4().hex,module_context=self.env)
        with self.assertRaisesRegex(ValueError,'merged dataset'):self.manage(operation='release_input',run_id=key)
        merged=read_run(self.root,key)['merged_dataset']
        perform(self.conn,'remove_dataset',{'name':merged},uuid.uuid4().hex,module_context=self.env)
        self.manage(operation='release_input',run_id=key)
        self.assertTrue(read_run(self.root,key)['input_released'])
        self.assertEqual(self.conn.execute('SELECT count(*) FROM '+identifier(result['name'])).fetchone()[0],1)
        with self.assertRaisesRegex(ValueError,'released'):
            perform(self.conn,'module_run',{'run_id':key,'recheck':'all'},uuid.uuid4().hex,module_context=self.env)

    def test_size_requirement_changed_content_and_delete_guards(self):
        import sqlite3
        from module_runtime import run_path
        large=self.job('SELECT '+literal(self.url('/noise'))+' AS url',{**self.options,'max_image_kb':1})
        row=self.conn.execute('SELECT verdict,coverage,requirements_status,issue FROM '+identifier(large['name'])).fetchone()
        self.assertEqual(row[:3],('fail','full','fail'));self.assertIn('1 KB',row[3])
        original=self.job('SELECT '+literal(self.url('/change'))+' AS url')
        saved_png=self.images.png
        try:
            self.images.png=self.images.blank
            changed=perform(self.conn,'module_run',{'run_id':original['run']['id'],'recheck':'all'},uuid.uuid4().hex,module_context=self.env)
            self.assertEqual(self.conn.execute('SELECT change_status FROM '+identifier(changed['name'])).fetchone()[0],'content_changed')
        finally:self.images.png=saved_png
        with sqlite3.connect(run_path(self.root,original['run']['id'])/'checks.sqlite3') as db:
            db.execute("UPDATE urls SET result=json_set(result,'$.checked_at','2000-01-01T00:00:00+00:00')")
        db.close()
        before=self.images.hits['/change']
        perform(self.conn,'module_run',{'run_id':original['run']['id'],'recheck':'stale','days':7},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.images.hits['/change'],before+1)
        with self.assertRaisesRegex(ValueError,'sidebar'):self.manage(operation='delete_run',run_id=large['run']['id'])
        perform(self.conn,'remove_dataset',{'name':large['name']},uuid.uuid4().hex,module_context=self.env)
        self.manage(operation='delete_run',run_id=large['run']['id'])
        self.assertFalse(run_path(self.root,large['run']['id']).exists())
        malformed=self.job("SELECT 'http://[' AS url")
        self.assertEqual(malformed['run']['summary']['fail'],1)

    def test_interrupted_recheck_preparation_preserves_scope_on_resume(self):
        original=self.job(f'SELECT * FROM (VALUES ({literal(self.url("/ok.png"))}),({literal(self.url("/missing"))})) t(url)')
        cell=self.conn.execute('SELECT row_id,url_column FROM '+identifier(original['name'])+" WHERE retrieval_status='retrieved'").fetchone()
        key=uuid.uuid4().hex
        def interrupt(activity):
            if activity['label']=='Preparing recheck':raise RuntimeError('interrupted copy')
        payload={'run_id':original['run']['id'],'recheck':'selected','selected':[{'row_id':cell[0],'url_column':cell[1]}]}
        with patch.dict(self.env,{'emit':interrupt}):
            with self.assertRaisesRegex(RuntimeError,'interrupted copy'):
                perform(self.conn,'module_run',payload,key,module_context=self.env)
        self.assertEqual(read_run(self.root,key)['status'],'failed')
        with self.assertRaisesRegex(ValueError,'unfinished recheck'):
            self.manage(operation='release_input',run_id=original['run']['id'])
        good=self.images.hits.get('/ok.png',0);missing=self.images.hits.get('/missing',0)
        perform(self.conn,'module_run',{'run_id':key},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.images.hits.get('/ok.png',0),good+1)
        self.assertEqual(self.images.hits.get('/missing',0),missing)
