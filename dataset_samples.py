"""Explicit, bounded dataset previews and downloads, separate from SQL-tab state."""
import json
import re
import shutil
import time
from pathlib import Path
from engine import catalog,identifier as q,literal as lit
from result_store import metadata,query

MAX_CSV=16*1024**2


def tracked_parent(workspace,item):
    """Recognize app-tracked edits without hashing arbitrary huge source files."""
    import contextlib,sqlite3
    from companion_store import Ledger,digest
    ledger=Ledger(workspace)
    binding=next((v for v in ledger.list('binding',10000) if v.get('table','').casefold()==item['name'].casefold() and v.get('edited')),None)
    if binding:return binding['version']
    if item.get('path'):
        path=Path(item['path']).resolve()
        with contextlib.closing(sqlite3.connect(ledger.provenance_file,timeout=30)) as db:
            row=db.execute('SELECT parent FROM pending WHERE lower(path)=lower(?)',[str(path)]).fetchone()
        if row:return row[0]
        if path.is_file() and path.stat().st_size<=MAX_CSV:return ledger.edited_content(digest(path))
    return None


def dataset(conn,name):
    item=next((v for v in catalog(conn) if v['name']==name),None)
    if not item:raise ValueError('Choose an existing dataset in this workspace.')
    database=conn.execute('SELECT current_database()').fetchone()[0]
    return item,q(database)+'.main.'+q(name)


def preview(conn,payload,job_id,environment):
    name=payload['name'];item,relation=dataset(conn,name)
    result=query(conn,{'sql':'SELECT * FROM '+relation+' LIMIT 10','retain_result':True},job_id,environment)
    parent=tracked_parent(environment['workspace'],item)
    if parent:
        from result_store import tag_lineage
        tag_lineage(environment['workspace'],result['result_id'],{'edited':True,'inputs':[parent],'query_id':parent})
    folder,info=metadata(environment['workspace'],result['result_id'])
    info['dataset_preview']={'name':name,'limit':10,'sampled_at':time.time()}
    temporary=folder/'result.tmp';temporary.write_text(json.dumps(info),encoding='utf-8');temporary.replace(folder/'result.json')
    return {'name':name,'sample':result,'sample_limit':10,'sampled_at':info['dataset_preview']['sampled_at']}


def sample_metadata(workspace,key):
    folder,info=metadata(workspace,key)
    if not info.get('dataset_preview') or info['rows']>10:raise ValueError('Choose a dataset preview with at most ten rows.')
    return folder,info


def csv_file(workspace,key):
    folder,info=sample_metadata(workspace,key);file=folder/'sample.csv'
    if not file.is_file():raise ValueError('Prepare the sample download first.')
    if file.stat().st_size>MAX_CSV:raise ValueError('The browser sample download exceeds 16 MiB.')
    return file


def prepare_csv(conn,payload,environment):
    folder,info=sample_metadata(environment['workspace'],payload['result_id'])
    output=folder/'sample.csv';temporary=folder/'sample.csv.partial'
    if info.get('lineage',{}).get('edited'):
        from companion_store import Ledger
        Ledger(environment['workspace']).note_file(output,info['lineage']['query_id'])
    if not output.exists():
        fields=[r[0] for r in conn.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(folder/'rows.parquet')]).fetchall() if r[0]!=info['order_column']]
        # A conservative CSV bound includes UTF-8, doubled quotes, separators/header.
        measure='+'.join('coalesce(octet_length(encode(CAST('+q(c)+' AS VARCHAR))),0)' for c in fields)
        size=conn.execute('SELECT coalesce(sum('+measure+'),0) FROM read_parquet(?)',[str(folder/'rows.parquet')]).fetchone()[0]
        header=sum(len(c.encode('utf-8'))*2+3 for c in fields)
        if size*2+header+info['rows']*(len(fields)*3+2)>MAX_CSV:
            raise ValueError('These ten rows are too large for the 16 MiB browser sample download. Use the normal result export to save large values locally.')
        if shutil.disk_usage(folder).free<512*1024**2:raise ValueError('Free disk space before preparing a sample download.')
        try:
            sql='SELECT * EXCLUDE ('+q(info['order_column'])+') FROM read_parquet('+lit(folder/'rows.parquet')+') ORDER BY '+q(info['order_column'])
            conn.execute('COPY ('+sql+') TO '+lit(temporary)+' (FORMAT CSV,HEADER true)')
            if temporary.stat().st_size>MAX_CSV:raise ValueError('The browser sample download exceeds 16 MiB.')
            if environment.get('cancelled') and environment['cancelled'].is_set():raise InterruptedError('Cancelled.')
            temporary.replace(output)
        finally:temporary.unlink(missing_ok=True)
    filename=re.sub(r'[^\w.\-]','_',info['dataset_preview']['name']).strip('.')[:100] or 'dataset'
    if info.get('lineage',{}).get('edited'):
        from companion_store import Ledger
        Ledger(environment['workspace']).note_file(output,info['lineage']['query_id'])
    return {'result_id':payload['result_id'],'filename':filename+'-first-10.csv','rows':info['rows'],'bytes':output.stat().st_size}
