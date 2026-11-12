"""Compare report processing with saved, deterministic URL checks (no network)."""
import importlib.util,json,sqlite3,statistics,tempfile,threading,time,sys
from pathlib import Path
from engine import ROOT,create_connection,literal
from module_runtime import Context,manifests,validate_options
from modules.image_checker.network import SCHEMA

def measure(path,label,row_count=20000,unique_urls=5000,repetitions=3):
 spec=importlib.util.spec_from_file_location('report_benchmark_'+label,path);runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
 samples=[]
 parent=ROOT/'workspace'/'performance';parent.mkdir(parents=True,exist_ok=True)
 for sample in range(repetitions):
  with tempfile.TemporaryDirectory(dir=parent) as directory:
   folder=Path(directory);conn=create_connection(folder,{'memory_mb':256,'threads':1,'spill_gb':1},'bench')
   try:
    conn.execute(f"COPY (SELECT i+1 AS _bedazzle_row_id,'https://example.com/'||(i%{unique_urls})::VARCHAR AS url FROM range({row_count}) t(i)) TO "+literal(folder/'input.parquet')+" (FORMAT PARQUET)")
    db=sqlite3.connect(folder/'checks.sqlite3');db.execute('CREATE TABLE urls(url TEXT PRIMARY KEY,result TEXT,status TEXT)')
    for i in range(unique_urls):
     row={key:None for key in SCHEMA};row.update(url='https://example.com/'+str(i),check_status='pass',width=50,height=50,display_width=50,display_height=50,sha256=str(i),warnings='[]',complete_decode=True,metadata='x'*500)
     db.execute('INSERT INTO urls VALUES (?,?,?)',[row['url'],json.dumps(row),'pass'])
    db.commit();db.close()
    ctx=Context(conn,folder,folder,{'id':'benchmark','row_key':'_bedazzle_row_id','total_rows':row_count,'queue_ready':True},threading.Event(),lambda value:None)
    options=validate_options(next(m for m in manifests() if m['id']=='image_checker'),{'url_columns':['url']},['url'])
    started=time.perf_counter();output=runner.run(ctx,options);samples.append(round((time.perf_counter()-started)*1000,2))
    assert output['summary']['checked_cells']==row_count and output['summary']['pass']==row_count
   finally:conn.close()
 return {'label':label,'runs_ms':samples,'median_ms':statistics.median(samples),'rows':row_count,'unique_urls':unique_urls}

if __name__=='__main__':
 baseline=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'workspace'/'performance'/'baseline-1.3-runner.py'
 if not baseline.is_file():raise SystemExit('Pass a saved v1.3 runner.py path as the first argument for a meaningful baseline.')
 report=[measure(baseline,'before'),measure(ROOT/'modules'/'image_checker'/'runner.py','after')]
 (ROOT/'workspace'/'performance'/'image-checker-performance.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
