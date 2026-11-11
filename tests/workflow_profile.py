"""Profile native workflow latency without user data or external requests."""
import json,statistics,tempfile,time
from pathlib import Path
from engine import ROOT
from app_server import Jobs

def main():
 parent=ROOT/'workspace'/'performance';parent.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(dir=parent) as directory:
  jobs=Jobs(directory);jobs.store.put('settings',{'memory_mb':256,'threads':1,'spill_gb':1,'timeout':120,'profile':'quiet'})
  output={};sequence=0
  def run(action,payload):
   started=time.perf_counter();key=jobs.submit(action,payload)['id']
   while True:
    result=jobs.status(key,include_preview=False)
    if result.get('finished'):
     assert result['status']=='succeeded',result
     return (time.perf_counter()-started)*1000,result['result']
    time.sleep(.002)
  try:
   elapsed,_=run('open',{'path':str(ROOT/'examples'/'catalogs.csv'),'name':'catalogs'});output['cold_open_ms']=round(elapsed,2)
   actions={'catalog':{},'preview':{'path':str(ROOT/'examples'/'catalogs.csv')},'query':{'sql':'SELECT * FROM catalogs','force_count':True},'count':{'name':'catalogs'},'profile':{'name':'catalogs'},'explain':{'sql':'SELECT client,count(*) FROM catalogs GROUP BY client'},'completion_metadata':{},'module_schema':{'sql':'SELECT * FROM catalogs'}}
   for action,payload in actions.items():output[action+'_median_ms']=round(statistics.median(run(action,payload)[0] for _ in range(3)),2)
   for format in ('csv','tsv','json','ndjson','parquet'):
    elapsed,result=run('export',{'sql':'SELECT * FROM range(1234)','format':format,'output':str(Path(directory)/('export.'+format))});assert result['exported_rows']==1234
    output['export_'+format+'_ms']=round(elapsed,2)
   elapsed,_=run('convert',{'path':str(ROOT/'examples'/'catalogs.csv'),'output':str(Path(directory)/'converted.parquet')});output['convert_sample_ms']=round(elapsed,2)
   elapsed,_=run('rename',{'name':'catalogs','new_name':'renamed'});output['rename_ms']=round(elapsed,2)
   (parent/'workflows-1.4.json').write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))
  finally:jobs.close()
if __name__=='__main__':main()
