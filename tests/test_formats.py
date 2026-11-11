import gzip,json,tempfile,unittest
from pathlib import Path
from engine import ROOT,create_connection,perform,literal

class Formats(unittest.TestCase):
 def test_compressed_and_delimited_formats_preserve_text_and_reopen(self):
  folder=ROOT/'workspace'/'automated-tests';folder.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=folder) as d:
   root=Path(d);settings={'memory_mb':256,'threads':1,'spill_gb':1}
   conn=create_connection(root,settings,'formats')
   try:
    for index,(name,content) in enumerate([('ids.csv.gz','id,value\n001,hello\n002,world\n'),('ids.psv','id|value\n001|hello\n002|world\n'),('ids.tab','id\tvalue\n001\thello\n002\tworld\n'),('ids.dat','id;value\n001;hello\n002;world\n')]):
     path=root/name
     if name.endswith('.gz'):
      with gzip.open(path,'wt',encoding='utf-8') as f:f.write(content)
     else:path.write_text(content)
     result=perform(conn,'open',{'path':str(path),'name':'data'+str(index)},'format')
     self.assertEqual(conn.execute('SELECT id FROM "'+result['name']+'" ORDER BY id').fetchall(),[('001',),('002',)])
    path=root/'data.jsonl.gz'
    with gzip.open(path,'wt',encoding='utf-8') as f:f.write('{"id":"001"}\n{"id":"002"}\n')
    perform(conn,'open',{'path':str(path),'name':'json_gzip'},'format')
    zstd=root/'data.csv.zst';conn.execute("COPY (SELECT '001' AS id) TO "+literal(zstd)+" (FORMAT CSV, HEADER, COMPRESSION ZSTD)")
    perform(conn,'open',{'path':str(zstd),'name':'zstd'},'format')
    self.assertEqual(conn.execute('SELECT id FROM zstd').fetchone()[0],'001')
    conn.close();conn=create_connection(root,settings,'reopen')
    self.assertEqual(conn.execute('SELECT count(*) FROM data0').fetchone()[0],2)
    self.assertEqual(conn.execute('SELECT count(*) FROM json_gzip').fetchone()[0],2)
    self.assertTrue(any(f['name']=='regexp_matches' for f in perform(conn,'completion_metadata',{},'complete')['functions']))
   finally:conn.close()
