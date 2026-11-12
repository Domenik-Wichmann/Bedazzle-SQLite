import tempfile,threading,unittest,uuid
from pathlib import Path
from engine import ROOT,create_connection,perform,literal
from result_store import release

class RetainedResults(unittest.TestCase):
 def setUp(self):
  root=ROOT/'workspace'/'automated-tests';root.mkdir(parents=True,exist_ok=True)
  self.tmp=tempfile.TemporaryDirectory(dir=root);self.root=Path(self.tmp.name)
  self.conn=create_connection(self.root,{'memory_mb':256,'threads':1,'spill_gb':1},'results')
  self.env={'workspace':self.root,'cancelled':threading.Event(),'settings':{'spill_gb':1}}
 def tearDown(self):self.conn.close();self.tmp.cleanup()
 def run_action(self,action,payload):return perform(self.conn,action,payload,uuid.uuid4().hex,module_context=self.env)
 def test_exports_and_paging_never_rerun_source_and_preserve_full_values(self):
  self.conn.execute("CREATE TABLE source AS SELECT i,random() AS r,repeat('x',9000) AS text FROM range(1234) t(i)")
  result=self.run_action('query',{'sql':'SELECT * FROM source ORDER BY i','retain_result':True})
  self.assertEqual(result['total_rows'],1234);self.assertLess(len(result['rows'][0][2]),5000)
  first_random=result['rows'][0][1];self.conn.execute('DROP TABLE source')
  for format in ('csv','tsv','json','ndjson','parquet'):
   target=self.root/('export.'+format)
   exported=self.run_action('export_result',{'result_id':result['result_id'],'format':format,'output':str(target)})
   self.assertEqual(exported['exported_rows'],1234)
  data=self.conn.execute('SELECT * FROM read_parquet('+literal(self.root/'export.parquet')+') ORDER BY i').fetchall()
  self.assertEqual(data[0][1],first_random);self.assertEqual(len(data[0][2]),9000)
  page=self.run_action('query',{'sql':'SELECT * FROM source','result_id':result['result_id'],'offset':100,'size':100})
  self.assertEqual(page['rows'][0][0],100)
  target=self.root/'page.parquet';self.run_action('export_result',{'result_id':result['result_id'],'scope':'page','offset':page['offset'],'rows':len(page['rows']),'format':'parquet','output':str(target)})
  self.assertEqual(self.conn.execute('SELECT min(i),max(i),count(*) FROM read_parquet('+literal(target)+')').fetchone(),(100,199,100))
 def test_scripts_execute_once_and_sort_uses_retained_rows(self):
  self.conn.execute('CREATE SEQUENCE counter')
  result=self.run_action('query',{'sql':"CREATE TEMP TABLE original AS SELECT nextval('counter') AS n; SELECT i,n FROM original,range(150) t(i) ORDER BY i",'retain_result':True})
  sorted_result=self.run_action('query',{'sql':result['sql'],'result_id':result['result_id'],'sort':{'column':'i','direction':'DESC'}})
  self.assertEqual(sorted_result['rows'][0],[149,1]);self.assertEqual(self.conn.execute("SELECT currval('counter')").fetchone()[0],1)
  release(self.root,result['result_id'])
  with self.assertRaisesRegex(ValueError,'no longer available'):self.run_action('export_result',{'result_id':result['result_id'],'format':'csv','output':str(self.root/'gone.csv')})
  with self.assertRaises(ValueError):release(self.root,'../../outside')
