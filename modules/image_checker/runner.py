"""Disk-backed URL deduplication and bounded concurrent checks; no full-result fetch."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from collections import OrderedDict
import json
import sqlite3
import threading
import time

from engine import identifier as ident, literal
from modules.image_checker.network import check_url, SCHEMA


def cells_sql(ctx,options):
    pairs=','.join('('+literal(name)+',CAST(s.'+ident(name)+' AS VARCHAR))' for name in options['url_columns'])
    expected=[]
    for key in ('expected_width','expected_height','expected_bytes','expected_mime'):
        expected.append(('CAST(s.'+ident(options[key])+' AS VARCHAR)' if options[key] else 'NULL::VARCHAR')+' AS '+key)
    return f'SELECT s.{ident(ctx.record["row_key"])} AS row_id,v.url_column,v.image_url,'+', '.join(expected)+f' FROM {ctx.input} s, LATERAL (VALUES {pairs}) v(url_column,image_url)'


def run(ctx,options):
    database=sqlite3.connect(ctx.directory/'checks.sqlite3')
    database.execute('PRAGMA journal_mode=WAL');database.execute('PRAGMA synchronous=NORMAL');database.execute('PRAGMA cache_size=-8192')
    database.execute('CREATE TABLE IF NOT EXISTS urls (url TEXT PRIMARY KEY, result TEXT, status TEXT)')
    try:
        ctx.activity('Finding unique image URLs','Building a disk-backed queue from all rows and selected URL columns.',percent=None)
        cells=cells_sql(ctx,options)
        if not ctx.record.get('queue_ready'):
            cursor=ctx.conn.execute('SELECT DISTINCT coalesce(image_url,\'\') FROM ('+cells+') cells')
            while True:
                ctx.check_cancelled();batch=cursor.fetchmany(2000)
                if not batch:break
                database.executemany('INSERT OR IGNORE INTO urls(url) VALUES (?)',batch);database.commit()
            ctx.update(queue_ready=True)
        total=database.execute('SELECT count(*) FROM urls').fetchone()[0]
        completed=database.execute('SELECT count(*) FROM urls WHERE result IS NOT NULL').fetchone()[0]
        ctx.update(total=total,completed=completed)
        # At most 1,024 host scheduling records, even for millions of different hosts.
        host_times=OrderedDict();host_lock=threading.Lock()
        def throttle(host):
            with host_lock:
                now=time.monotonic();scheduled=max(now,host_times.get(host,now))
                host_times[host]=scheduled+.15;host_times.move_to_end(host)
                if len(host_times)>1024:host_times.popitem(last=False)
            if ctx.cancelled.wait(max(0,scheduled-now)):ctx.check_cancelled()
        def queued():
            last=0
            while True:
                rows=database.execute('SELECT rowid,url FROM urls WHERE result IS NULL AND rowid>? ORDER BY rowid LIMIT 128',[last]).fetchall()
                if not rows:return
                for row_id,url in rows:last=row_id;yield url
        queue=iter(queued());pending={};last_update=0
        with ThreadPoolExecutor(max_workers=options['workers'],thread_name_prefix='image-check') as pool:
            def fill():
                while len(pending)<options['workers']*2:
                    try:url=next(queue)
                    except StopIteration:break
                    pending[pool.submit(check_url,url,options,ctx.cancelled,throttle)]=url
            fill()
            while pending:
                ctx.check_cancelled()
                finished,_=wait(pending,timeout=.1,return_when=FIRST_COMPLETED)
                for future in finished:
                    url=pending.pop(future);record=future.result()
                    database.execute('UPDATE urls SET result=?,status=? WHERE url=?',[json.dumps(record,ensure_ascii=False),record['check_status'],url])
                    completed+=1
                if finished:database.commit()
                if time.monotonic()-last_update>.4 or completed==total:
                    ctx.update(completed=completed)
                    ctx.activity('Checking image URLs',f'{completed:,} of {total:,} unique URLs checked. Repeated URLs reuse the saved check.',completed=completed,total=total,percent=round(completed/max(1,total)*95,1))
                    last_update=time.monotonic()
                fill()
        ctx.check_cancelled();ctx.activity('Building the image report','Joining URL checks to frozen row identities and comparing expectations.',percent=97)
        json_path=ctx.directory/'url_checks.ndjson'
        with json_path.open('w',encoding='utf-8') as output:
            for (value,) in database.execute('SELECT result FROM urls ORDER BY rowid'):
                ctx.check_cancelled();output.write(value+'\n')
        schema='{'+','.join(literal(key)+':'+literal(value) for key,value in SCHEMA.items())+'}'
        # Empty inputs still get a valid, fully typed report.
        raw=f'read_json({literal(json_path)}, format=\'newline_delimited\', columns={schema})' if total else '(SELECT '+','.join('NULL::'+value+' AS '+ident(key) for key,value in SCHEMA.items())+' WHERE false)'
        # Parse JSON once. Both the per-cell join and duplicate-hash aggregation
        # scan a typed columnar file, rather than parsing every JSON report twice.
        typed=ctx.directory/'url_checks.parquet';partial=ctx.directory/'url_checks.partial'
        partial.unlink(missing_ok=True)
        ctx.conn.execute(f'COPY (SELECT * FROM {raw}) TO {literal(partial)} (FORMAT PARQUET, COMPRESSION ZSTD)')
        partial.replace(typed);raw=f'read_parquet({literal(typed)})'
        compare=[]
        for expected,actual in [('expected_width','display_width'),('expected_height','display_height'),('expected_bytes','image_bytes')]:
            operator='>=' if expected!='expected_bytes' and options['dimension_rule']=='minimum' else '='
            compare.append(f"CASE WHEN nullif(trim(c.{expected}),'') IS NULL THEN NULL ELSE coalesce(r.{actual} {operator} try_cast(c.{expected} AS BIGINT),false) END AS {expected}_matches")
        compare.append("CASE WHEN nullif(trim(c.expected_mime),'') IS NULL THEN NULL ELSE coalesce(lower(trim(c.expected_mime))=lower(r.detected_mime),false) END AS expected_mime_matches")
        joined=f"SELECT c.*,r.* EXCLUDE(url),{','.join(compare)},({options['min_width']}=0 OR coalesce(r.display_width>={options['min_width']},false)) AND ({options['min_height']}=0 OR coalesce(r.display_height>={options['min_height']},false)) AS minimum_dimensions_match FROM ({cells}) c LEFT JOIN {raw} r ON coalesce(c.image_url,'')=r.url"
        # Hash counts describe unique URL responses, not repeated source rows.
        hashes=f"SELECT sha256,count(*) AS same_content_urls FROM {raw} WHERE sha256 IS NOT NULL GROUP BY sha256"
        comparisons=' AND '.join('coalesce('+key+'_matches,true)' for key in ('expected_width','expected_height','expected_bytes','expected_mime'))+' AND minimum_dimensions_match'
        final=f"SELECT j.*,coalesce(h.same_content_urls,0) AS same_content_urls,({comparisons}) AS expectations_match,CASE WHEN j.check_status IN ('fail','blocked','limited') THEN j.check_status WHEN NOT ({comparisons}) THEN 'fail' ELSE j.check_status END AS verdict FROM ({joined}) j LEFT JOIN ({hashes}) h USING(sha256)"
        report=ctx.write_report(final)
        summary=dict(ctx.conn.execute('SELECT verdict,count(*) FROM read_parquet('+literal(report)+') GROUP BY verdict').fetchall())
        summary.update(unique_urls=total,input_rows=ctx.record['total_rows'],checked_cells=sum(value for key,value in summary.items() if key in ('pass','warning','fail','limited','blocked')))
        return {'report':report,'summary':summary,'merge':{'kind':'cell','url_columns':options['url_columns'],
                'fields':['verdict','check_status','expectations_match','http_status','final_url','format','detected_mime','width','height','display_width','display_height','image_bytes','complete_decode','frames','frames_checked','mime_matches','same_content_urls','sha256','warnings','error']}}
    finally:database.close()
