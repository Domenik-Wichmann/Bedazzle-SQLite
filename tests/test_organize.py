import tempfile,unittest
from pathlib import Path
from app_server import Store
from engine import ROOT,create_connection,perform
from workspaces import Workspaces
from example_workspace import install,QUERIES

class OrganizeTests(unittest.TestCase):
 def test_example_join_queries_and_dataset_removal(self):
  parent=ROOT/'workspace'/'automated-tests';parent.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=parent) as folder:
   registry=Workspaces(folder);key=install(registry);path=registry.path(key)
   conn=create_connection(path,{'memory_mb':128,'threads':1,'spill_gb':1},'example')
   try:
    self.assertEqual(conn.execute('SELECT count(*) FROM products').fetchone()[0],1000)
    self.assertEqual(conn.execute('SELECT count(*) FROM offers').fetchone()[0],1200)
    for title,sql in QUERIES:
     result=perform(conn,'query',{'sql':sql},'query');self.assertGreater(len(result['rows']),0,title)
     self.assertTrue(perform(conn,'explain',{'sql':sql},'plan')['tree'])
    source=path/'files'/'offers.csv';perform(conn,'remove_dataset',{'name':'offers'},'delete')
    self.assertTrue(source.exists());self.assertNotIn('offers',[r[0] for r in conn.execute('SHOW TABLES').fetchall()])
    store=Store(path);saved=store.queries('saved')[0];store.rename_saved(saved['id'],'Renamed query')
    self.assertTrue(any(i['name']=='Renamed query' for i in store.queries('saved')))
    store.remove_saved(saved['id']);self.assertEqual(len(store.queries('saved')),3)
   finally:conn.close()
 def test_workspace_rename_archive_restore_and_primary_safety(self):
  parent=ROOT/'workspace'/'automated-tests';parent.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=parent) as folder:
   registry=Workspaces(folder);Store(registry.path()).put('sentinel','original')
   key=registry.create('Research');registry.rename(key,'Catalog research');registry.select(key)
   Store(registry.path()).save('Example','SELECT 1')
   registry.archive(key);self.assertEqual(registry.data['selected'],'primary');self.assertTrue((Path(folder)/'archive'/key/'preferences.sqlite3').exists())
   registry.restore(key);self.assertEqual(Store(registry.path(key)).queries('saved')[0]['name'],'Example')
   registry.archive('primary');self.assertTrue(Path(folder).is_dir());self.assertTrue((Path(folder)/'workspaces'/key).exists())
   registry.restore('primary');self.assertEqual(Store(registry.path('primary')).get('sentinel'),'original')
   self.assertEqual(registry.overview()['items'][0]['queries'],1)
   with self.assertRaises(ValueError):registry.archive('../outside')
