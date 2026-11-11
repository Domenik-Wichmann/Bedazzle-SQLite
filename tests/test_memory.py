from pathlib import Path
import tempfile,time,unittest
from unittest.mock import patch
from engine import ROOT
from app_server import Jobs

class MemoryTests(unittest.TestCase):
 def test_automatic_low_memory_import_convert_query_export(self):
  folder=ROOT/'workspace'/'automated-tests';folder.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=folder) as directory:
   root=Path(directory);jobs=Jobs(root)
   jobs.store.put('settings',{'memory_mb':0,'threads':8,'profile':'balanced','spill_gb':1,'timeout':30})
   path=root/'ids.csv';path.write_text('id,value\n'+''.join(f'{i:06},hello\n' for i in range(5000)))
   def run(action,payload):
    task=jobs.submit(action,payload)['id']
    for _ in range(1000):
     result=jobs.status(task)
     if result.get('finished'):
      self.assertEqual(result['status'],'succeeded',result);return result['result']
     time.sleep(.01)
    self.fail('Job timed out')
   try:
    with patch('app_server.hardware',return_value={'total_mb':16058,'available_mb':432,'cpus':8}):
     effective=jobs.effective_settings();self.assertEqual(effective['memory_mb'],172);self.assertEqual(effective['threads'],1);self.assertTrue(effective['low_memory'])
     opened=run('open',{'path':str(path),'name':'ids'})
     result=run('query',{'sql':'SELECT * FROM ids ORDER BY id','size':100})
     self.assertEqual(result['total_rows'],5000);self.assertEqual(result['rows'][0][0],'000000')
     converted=run('convert',{'path':str(path),'output':str(root/'ids.parquet')});self.assertEqual(converted['exported_rows'],5000)
     exported=run('export',{'sql':'SELECT * FROM ids','format':'csv','output':str(root/'export.csv')});self.assertEqual(exported['exported_rows'],5000)
    for available in (160,300,432,921):
     with patch('app_server.hardware',return_value={'total_mb':16058,'available_mb':available,'cpus':8}):self.assertGreaterEqual(jobs.effective_settings()['memory_mb'],64)
    with patch('app_server.hardware',return_value={'total_mb':16058,'available_mb':100,'cpus':8}):
     with self.assertRaisesRegex(ValueError,'100 MB'):jobs.effective_settings()
     jobs.set_settings({'memory_mb':64,'threads':4,'spill_gb':1,'timeout':30})
     self.assertEqual(jobs.effective_settings()['threads'],1)
   finally:jobs.close()
