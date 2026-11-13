import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch

from engine import ROOT,create_connection,perform,literal
from result_store import metadata,release,stored_bytes,tag_lineage
from companion_store import Ledger,digest


def choice(text):
    return {'token':'null' if text is None else 'v:'+hashlib.sha256(text.encode()).hexdigest(),'value':text}


class ResultFilterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'workspace');self.root=Path(self.tmp.name)
        self.conn=create_connection(self.root,{'memory_mb':256,'threads':1,'spill_gb':1},'filters')
        self.env={'workspace':self.root,'settings':{'spill_gb':1},'cancelled':threading.Event()}
    def tearDown(self):self.conn.close();self.tmp.cleanup()
    def run_action(self,action,payload):return perform(self.conn,action,payload,uuid.uuid4().hex,module_context=self.env)
    def run_query(self,sql):return self.run_action('query',{'sql':sql,'retain_result':True})
    def view(self,result,filters=(),sort=None,replace=True):
        return self.run_action('query',{'sql':result['sql'],'result_id':result['result_id'],'view':{'filters':list(filters),'sort':sort},**({'replace_result_id':result['result_id']} if replace else {})})
    def options(self,result,column,**kw):return self.run_action('result_values',{'result_id':result['result_id'],'column':column,**kw})
    def sample(self):return self.run_query("SELECT * FROM (VALUES (1,'Alpha','A'),(2,'alpha','B'),(3,'Beta','A'),(4,NULL,'A'),(5,'','B'),(6,'100%_literal','A')) t(id,name,category) ORDER BY id")

    def test_sort_sql_and_script_side_effects_execute_once(self):
        self.conn.execute('CREATE SEQUENCE once')
        result=self.run_query("CREATE TEMP TABLE source AS SELECT nextval('once') AS n; WITH data AS (SELECT i,n FROM source,range(200) t(i)) SELECT * FROM data ORDER BY i LIMIT 150; -- trailing comment")
        sorted_result=self.view(result,sort={'column':'i','direction':'DESC'})
        self.assertIn('ORDER BY result_view."i" DESC',sorted_result['sql'])
        self.assertEqual(sorted_result['rows'][0],[149,1]);self.assertEqual(sorted_result['total_rows'],150)
        self.assertEqual(self.conn.execute("SELECT currval('once')").fetchone()[0],1)
        second=self.view(sorted_result,sort={'column':'i','direction':'ASC'})
        self.assertEqual(second['sql'].count('AS result_view'),1)
        self.assertEqual(second['rows'][0],[0,1])

    def test_text_filters_literals_case_null_and_matching_sql(self):
        result=self.sample()
        for kind,text,case,ids in [('contains','ALP',False,[1,2]),('contains','Alp',True,[1]),('starts_with','be',False,[3]),('equals','alpha',True,[2]),('contains','%_',False,[6]),('null','',False,[4]),('not_null','',False,[1,2,3,5,6])]:
            with self.subTest(kind=kind,text=text,case=case):
                filtered=self.view(result,[{'column':'name','kind':kind,'text':text,'case_sensitive':case}],replace=False)
                self.assertEqual([r[0] for r in filtered['rows']],ids)
                actual=self.conn.execute(filtered['sql']).fetchall()
                self.assertEqual([r[0] for r in actual],ids)
        malicious=self.view(result,[{'column':'name','kind':'contains','text':"x') OR TRUE --"}],replace=False)
        self.assertEqual(malicious['total_rows'],0)

    def test_checkbox_include_exclude_and_null_are_distinct(self):
        result=self.sample();options=self.options(result,'name')
        self.assertEqual(len(options['items']),6)
        self.assertTrue(any(v['token']=='null' for v in options['items']))
        self.assertTrue(any(v['value']=='' and v['token']!='null' for v in options['items']))
        excluded=self.view(result,[{'column':'name','kind':'values','selection':'exclude','values':[choice('Alpha')]}],replace=False)
        self.assertEqual([r[0] for r in excluded['rows']],[2,3,4,5,6])
        included=self.view(result,[{'column':'name','kind':'values','selection':'include','values':[choice(None),choice('')]}],replace=False)
        self.assertEqual([r[0] for r in included['rows']],[4,5])
        self.assertIn("IN ('')",included['sql'])
        none=self.view(result,[{'column':'name','kind':'values','selection':'include','values':[]}],replace=False)
        self.assertEqual(none['total_rows'],0)

    def test_other_filters_constrain_choices_own_filter_does_not(self):
        result=self.sample()
        filtered=self.view(result,[{'column':'name','kind':'equals','text':'Alpha','case_sensitive':True},{'column':'category','kind':'equals','text':'A'}])
        options=self.options(filtered,'name')
        self.assertEqual(sum(v['count'] for v in options['items']),4)
        self.assertEqual({v['value'] for v in options['items']},{'Alpha','Beta','100%_literal',None})
        self.assertEqual(self.view(filtered)['total_rows'],6)

    def test_retained_base_survives_original_release_source_drop_and_exports(self):
        self.conn.execute('CREATE TABLE src AS SELECT i,random() AS r FROM range(300) t(i)')
        result=self.run_query('SELECT * FROM src ORDER BY i');original=result['rows'][0][1]
        filtered=self.view(result,[{'column':'i','kind':'starts_with','text':'2'}],sort={'column':'i','direction':'DESC'})
        with self.assertRaises(ValueError):metadata(self.root,result['result_id'])
        self.conn.execute('DROP TABLE src')
        self.assertEqual(filtered['rows'][0][0],299)
        target=self.root/'filtered.parquet'
        self.run_action('export_result',{'result_id':filtered['result_id'],'format':'parquet','output':str(target)})
        self.assertEqual(self.conn.execute('SELECT count(*),max(i) FROM read_parquet(?)',[str(target)]).fetchone(),(111,299))
        restored=self.view(filtered)
        self.assertEqual(restored['total_rows'],300);self.assertEqual(restored['rows'][0][1],original)
        full=self.run_action('inspect_result',{'result_id':restored['result_id'],'row_index':0});self.assertEqual(full['row'][1],original)
        folder,_=metadata(self.root,restored['result_id']);self.assertTrue((folder/'base.parquet').exists())
        size=stored_bytes(self.root);self.assertLessEqual(size,(folder/'base.parquet').stat().st_size+(folder/'rows.parquet').stat().st_size)
        release(self.root,restored['result_id']);self.assertFalse(folder.exists())

    def test_value_search_is_bounded_on_a_million_rows_and_high_cardinality(self):
        result=self.run_query("SELECT i, 'Supplier_'||lpad(i::VARCHAR,7,'0') AS supplier FROM range(1000000) t(i)")
        page=self.options(result,'supplier');self.assertEqual(len(page['items']),100);self.assertTrue(page['has_more'])
        self.assertLess(len(json.dumps(page).encode()),65536)
        found=self.options(result,'supplier',search='0999999');self.assertEqual(len(found['items']),1)
        self.assertEqual(found['items'][0]['count'],1)
        filtered=self.view(result,[{'column':'supplier','kind':'values','selection':'include','values':[{'token':found['items'][0]['token'],'value':found['items'][0]['value']}]}])
        self.assertEqual(filtered['rows'],[[999999,'Supplier_0999999']])

    def test_large_values_and_nul_do_not_expand_preview_or_change_identity(self):
        result=self.run_query("SELECT repeat('x',1000000) AS value UNION ALL SELECT 'a'||chr(0)||'b' UNION ALL SELECT NULL")
        options=self.options(result,'value');self.assertLess(len(json.dumps(options).encode()),3000)
        large=next(v for v in options['items'] if v['characters']==1000000)
        self.assertEqual(len(large['label']),160);self.assertIsNone(large['value'])
        filtered=self.view(result,[{'column':'value','kind':'values','selection':'include','values':[{'token':large['token'],'value':None}]}],replace=False)
        self.assertEqual(filtered['total_rows'],1);self.assertIn('sha256(',filtered['sql'])
        nul=self.view(result,[{'column':'value','kind':'values','selection':'include','values':[choice('a\0b')]}],replace=False)
        self.assertEqual(nul['total_rows'],1);self.assertIn('decode(from_hex(',nul['sql'])
        unicode_result=self.run_query("SELECT repeat('😀',400)||i AS value FROM range(200) t(i)")
        unicode_choices=self.options(unicode_result,'value')
        self.assertLess(len(json.dumps(unicode_choices).encode()),65536)
        self.assertTrue(unicode_choices['has_more']);self.assertLess(len(unicode_choices['items']),100)

    def test_copy_fallback_and_edited_lineage(self):
        result=self.sample();tag_lineage(self.root,result['result_id'],{'edited':True,'inputs':['edited-version'],'query_id':'edited-artifact','task':'task'})
        with patch('result_store.os.link',side_effect=OSError('No hard links here')):
            filtered=self.view(result,[{'column':'name','kind':'equals','text':'Beta'}])
        folder,info=metadata(self.root,filtered['result_id']);self.assertTrue(info['lineage']['edited'])
        self.assertEqual(Ledger(self.root).pending_parent(digest(folder/'rows.parquet')),'edited-artifact')
        self.assertEqual(filtered['rows'][0][1],'Beta')

    def test_invalid_fields_tokens_and_sort_are_rejected(self):
        result=self.sample()
        for plan in [{'filters':[{'column':'not a column','kind':'null'}]}, {'sort':{'column':'name','direction':'ASC; DROP TABLE x'}}, {'filters':[{'column':'name','kind':'values','values':[{'token':'v:'+'0'*64,'value':'wrong'}]}]}]:
            with self.subTest(plan=plan),self.assertRaises(ValueError):
                self.run_action('query',{'sql':result['sql'],'result_id':result['result_id'],'view':plan})
        with self.assertRaises(ValueError):self.options(result,'name',offset=10000)

    def test_cancelled_and_over_budget_views_keep_the_original(self):
        result=self.sample();original=metadata(self.root,result['result_id'])[0]
        self.env['cancelled'].set()
        with self.assertRaises(InterruptedError):self.view(result,sort={'column':'id','direction':'DESC'})
        self.env['cancelled'].clear();self.env['settings']['spill_gb']=0
        with self.assertRaisesRegex(ValueError,'disk budget'):self.view(result,sort={'column':'id','direction':'DESC'})
        self.assertTrue((original/'rows.parquet').exists())
        self.assertEqual(len(list((self.root/'results').iterdir())),1)


if __name__=='__main__':unittest.main()
