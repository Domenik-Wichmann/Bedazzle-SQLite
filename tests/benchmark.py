"""Reproducible synthetic-file benchmark; not a prediction for the user's CSV."""
import json
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import ROOT, create_connection, perform, reader, literal


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    folder = ROOT / 'workspace' / 'benchmark'
    folder.mkdir(parents=True, exist_ok=True)
    source, parquet = folder / 'synthetic.csv', folder / 'synthetic.parquet'
    settings = {'memory_mb':256, 'threads':1, 'spill_gb':2, 'timeout':300}
    conn = create_connection(folder, settings, 'benchmark')
    try:
        if not source.exists():
            conn.execute(f"COPY (SELECT i AS id, 'https://example.com/products/' || (i % 50000)::VARCHAR AS url, "
                         "'Client ' || (i % 40)::VARCHAR AS client, 'Catalog ' || (i % 500)::VARCHAR AS catalog, "
                         "(i % 10000) / 100.0 AS price, repeat('description-', 16) AS description "
                         f"FROM range(1000000) t(i)) TO {literal(source.as_posix())} (HEADER true)")
        started=time.perf_counter()
        conversion = perform(conn,'convert',{'path':str(source),'output':str(parquet)},'benchmark-conversion') if not parquet.exists() else None
        conversion_seconds=time.perf_counter()-started
        measurements={}
        answers={}
        for name,path in [('csv',source),('parquet',parquet)]:
            samples=[]
            sql=f'SELECT client, count(*) AS records, sum(TRY_CAST(price AS DOUBLE)) AS revenue FROM {reader(path)} GROUP BY client ORDER BY client'
            for _ in range(3):
                started=time.perf_counter()
                answers[name]=conn.execute(sql).fetchall()
                samples.append(round(time.perf_counter()-started,4))
            measurements[name]={'seconds':samples,'median_seconds':statistics.median(samples),'bytes':path.stat().st_size}
        assert answers['csv']==answers['parquet']
        count=conn.execute(f'SELECT count(*) FROM {literal(parquet.as_posix())}').fetchone()[0]
        assert count==1000000
        report={'rows':count,'buffer_budget_mb':256,'threads':1,'conversion_seconds':round(conversion_seconds,3) if conversion else None,
                'files':measurements,'group_results_equal':True,
                'note':'Synthetic repetitive catalog data, warm/repeated local queries. Not a 5 GB user-file benchmark.'}
        (folder/'results.json').write_text(json.dumps(report,indent=2))
        print(json.dumps(report,indent=2))
    finally:
        conn.close()


if __name__=='__main__':
    main()
