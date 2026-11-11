"""Measure real job latency on the included sample and synthetic catalog files."""
from pathlib import Path
import json
import statistics
import sys
import tempfile
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app_server import Jobs
from engine import ROOT


def measure(label):
    parent=ROOT/'workspace'/'performance'
    parent.mkdir(parents=True,exist_ok=True)
    directory=tempfile.TemporaryDirectory(dir=parent)
    workspace=Path(directory.name).resolve()
    assert workspace.is_relative_to(parent.resolve())
    jobs=Jobs(workspace)
    jobs.store.put('settings',{'profile':'balanced','memory_mb':256,'threads':1,'spill_gb':2,'timeout':120})
    def run(action,payload):
        start=time.perf_counter()
        task=jobs.submit(action,payload)['id']
        preview=None
        while True:
            result=jobs.status(task)
            if preview is None and result.get('preview'):preview=time.perf_counter()-start
            if result.get('finished'):
                assert result['status']=='succeeded',result
                return {'wall_ms':round((time.perf_counter()-start)*1000,2),
                        'engine_ms':result['result']['elapsed_ms'],
                        'preview_ms':None if preview is None else round(preview*1000,2)}
            time.sleep(.002)
    try:
        run('open',{'path':str(ROOT/'examples'/'catalogs.csv'),'name':'catalogs'})
        small=[run('query',{'sql':'SELECT * FROM catalogs','force_count':True}) for _ in range(8)]
        report={'label':label,'buffer_mb':256,'threads':1,'small_query_ms':[row['wall_ms'] for row in small],
                'small_median_ms':statistics.median(row['wall_ms'] for row in small)}
        for kind in ('csv','parquet'):
            path=ROOT/'workspace'/'benchmark'/('synthetic.'+kind)
            if not path.exists():continue
            name=run('open',{'path':str(path),'name':'big_'+kind})
            samples=[run('query',{'sql':f'SELECT client,count(*) AS records FROM big_{kind} GROUP BY client ORDER BY client','force_count':True}) for _ in range(3)]
            report[kind]={'bytes':path.stat().st_size,'runs':samples,'median_ms':statistics.median(s['wall_ms'] for s in samples)}
        (parent/(label+'.json')).write_text(json.dumps(report,indent=2))
        print(json.dumps(report,indent=2),flush=True)
        return report
    finally:
        jobs.close()
        deadline=time.time()+5
        while jobs.active_id and time.time()<deadline:time.sleep(.02)
        directory.cleanup()


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    measure(sys.argv[1] if len(sys.argv)>1 else 'current')
