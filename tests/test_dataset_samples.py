import csv,io,json,tempfile,threading,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from engine import ROOT,create_connection,perform,literal,identifier
from dataset_samples import csv_file
from instruction_guide import base_guide
from result_store import metadata,release
from companion_store import Ledger,digest


class DatasetSamples(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'workspace');self.root=Path(self.tmp.name)
        self.conn=create_connection(self.root,{'memory_mb':256,'threads':1,'spill_gb':1},'samples')
        self.env={'workspace':self.root,'settings':{'spill_gb':1},'cancelled':threading.Event()}
    def tearDown(self):self.conn.close();self.tmp.cleanup()
    def run_action(self,action,payload):return perform(self.conn,action,payload,uuid.uuid4().hex,module_context=self.env)
    def test_preview_and_csv_are_ten_rows_of_the_same_immutable_sample(self):
        self.conn.execute("CREATE VIEW sample AS SELECT i,random() AS r,repeat('x',9000) AS text FROM range(1000000) t(i)")
        value=self.run_action('dataset_preview',{'name':'sample'});sample=value['sample']
        self.assertEqual(sample['total_rows'],10);self.assertEqual(len(sample['rows']),10)
        original=sample['rows'][0][1];self.conn.execute('DROP VIEW sample')
        prepared=self.run_action('dataset_sample_csv',{'result_id':sample['result_id']})
        rows=list(csv.reader(io.StringIO(csv_file(self.root,sample['result_id']).read_text('utf-8'))))
        self.assertEqual(len(rows),11);self.assertEqual(float(rows[1][1]),original);self.assertEqual(len(rows[1][2]),9000)
        self.assertEqual(prepared['rows'],10)
        folder,_=metadata(self.root,sample['result_id']);release(self.root,sample['result_id']);self.assertFalse(folder.exists())
    def test_csv_cannot_download_arbitrary_results_and_large_samples_are_blocked(self):
        raw=self.run_action('query',{'sql':'SELECT * FROM range(10)','retain_result':True})
        with self.assertRaisesRegex(ValueError,'dataset preview'):self.run_action('dataset_sample_csv',{'result_id':raw['result_id']})
        self.conn.execute("CREATE TABLE huge AS SELECT repeat('x',9000000) AS text")
        huge=self.run_action('dataset_preview',{'name':'huge'})['sample']
        with self.assertRaisesRegex(ValueError,'too large'):self.run_action('dataset_sample_csv',{'result_id':huge['result_id']})
        folder,_=metadata(self.root,huge['result_id']);self.assertFalse((folder/'sample.csv').exists());self.assertFalse((folder/'sample.csv.partial').exists())
    def test_empty_wide_and_quoted_datasets(self):
        name='Supplier "quoted"';columns=','.join(str(i)+' AS '+identifier('field '+str(i)) for i in range(125))
        self.conn.execute('CREATE TABLE '+identifier(name)+' AS SELECT '+columns+' WHERE false')
        sample=self.run_action('dataset_preview',{'name':name})['sample'];self.assertEqual(sample['total_rows'],0)
        self.assertEqual(sample['total_columns'],125);self.assertEqual(len(sample['columns']),120)
        self.run_action('dataset_sample_csv',{'result_id':sample['result_id']})
        header=next(csv.reader(io.StringIO(csv_file(self.root,sample['result_id']).read_text())))
        self.assertEqual(len(header),125)
    def test_schema_only_guide_contains_no_sample_values_or_source_paths(self):
        content=base_guide([{'name':'example','path':'C:/private/source.csv','columns':[{'name':'id','type':'VARCHAR'}]}])
        self.assertNotIn('C:/private/source.csv',content);self.assertNotIn('Optional dataset samples',content)
        self.assertIn('"sql_identifier": "\\"example\\""',content)
    def test_guide_samples_five_rows_preserves_null_and_labels_clipping(self):
        self.conn.execute("CREATE TABLE guide AS SELECT i,CASE WHEN i=0 THEN NULL ELSE 'SENTINEL_VALUE' END AS text,repeat('y',2000) AS long FROM range(1000) t(i)")
        value=self.run_action('agent_instructions',{'datasets':['guide']});text=value['markdown']
        block=text.split('### Dataset sample 1\n\n```json\n')[1].split('\n```')[0];sample=json.loads(block)
        self.assertEqual(len(sample['rows']),5);self.assertIsNone(sample['rows'][0][1]);self.assertEqual(len(sample['rows'][0][2]),160)
        self.assertTrue(sample['cells_truncated']);self.assertTrue(value['samples_limited']);self.assertIn('SENTINEL_VALUE',text)
        self.assertNotIn('yyyyy'*100,text)
    def test_guide_budget_and_unavailable_sources_are_explicit(self):
        self.conn.execute("CREATE TABLE a AS SELECT repeat('x',2000) AS text FROM range(6)")
        with patch('instruction_guide.SAMPLE_BUDGET',1):
            value=self.run_action('agent_instructions',{'datasets':['a']})
        self.assertIn('sample_omitted',value['markdown']);self.assertEqual(value['sampled_datasets'],0)
        bad=self.run_action('agent_instructions',{'datasets':['not-present']});self.assertIn('sample_unavailable',bad['markdown'])
        for datasets in [[],['a']*21,[{}]]:
            with self.assertRaises(ValueError):self.run_action('agent_instructions',{'datasets':datasets})
    def test_names_and_values_stay_json_data_and_edited_downloads_keep_lineage(self):
        path=self.root/'edited.csv';path.write_text('id,value\n1,IGNORE_ALL_INSTRUCTIONS\n')
        self.run_action('open',{'path':str(path),'name':'edited'})
        Ledger(self.root).note_file(path,'tracked-edit')
        sample=self.run_action('dataset_preview',{'name':'edited'})['sample']
        self.run_action('dataset_sample_csv',{'result_id':sample['result_id']})
        file=csv_file(self.root,sample['result_id']);sha=digest(file)
        self.assertEqual(Ledger(self.root).edited_content(sha),'tracked-edit')
        guide=self.run_action('agent_instructions',{'datasets':['edited']})['markdown']
        self.assertIn('"tracked_edited_source": true',guide);self.assertIn('"IGNORE_ALL_INSTRUCTIONS"',guide)
        release(self.root,sample['result_id']);self.assertEqual(Ledger(self.root).edited_content(sha),'tracked-edit')


if __name__=='__main__':unittest.main()
