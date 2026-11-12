"""Local module contract: frozen input -> report dataset -> optional non-destructive join."""
from dataclasses import dataclass
import importlib.util
import json
from pathlib import Path
import re
import time
import threading
import shutil
import sqlite3
from contextlib import closing

from engine import ROOT, identifier, literal, query_body, attach_source, available_name, catalog

MODULES=ROOT/'modules'


def discover():
    found=[];errors=[]
    for path in sorted(MODULES.glob('*/manifest.json')):
        try:
            item=json.loads(path.read_text('utf-8'))
            if item.get('id')!=path.parent.name or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',item['id']):
                raise ValueError('Module id must match its folder name.')
            if not all(isinstance(item.get(key),str) and item[key] for key in ('name','version')):
                raise ValueError('Module name and version are required.')
            fields=item.get('fields',[])
            if not isinstance(fields,list) or len(fields)>100 or any(not isinstance(field,dict) or not isinstance(field.get('key'),str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',field['key']) or field.get('type') not in ('column','columns','number','boolean','select','text') or not isinstance(field.get('label'),str) for field in fields):
                raise ValueError('Module fields must use unique keys, supported types and text labels.')
            if len({field['key'] for field in fields})!=len(fields):raise ValueError('Module field keys must be unique.')
            entry=(path.parent/item.get('entrypoint','runner.py')).resolve()
            if not entry.is_relative_to(path.parent.resolve()) or not entry.is_file() or entry.suffix!='.py':
                raise ValueError('Module entrypoint must be a Python file inside its own folder.')
            found.append(item)
        except (OSError,ValueError,KeyError,TypeError) as error:
            errors.append({'module':path.parent.name,'error':str(error)[:500]})
    return found,errors


def manifests():return discover()[0]


def run_path(workspace,key):
    if not re.fullmatch(r'[0-9a-f]{32}',str(key)):
        raise ValueError('Invalid module run identifier.')
    return Path(workspace)/'modules'/'runs'/key


def read_run(workspace,key):
    return json.loads((run_path(workspace,key)/'run.json').read_text('utf-8'))


def runs(workspace):
    result=[]
    for file in sorted((Path(workspace)/'modules'/'runs').glob('*/run.json'),key=lambda p:p.stat().st_mtime,reverse=True)[:50]:
        try:
            item=json.loads(file.read_text('utf-8'))
            result.append({**{key:value for key,value in item.items() if key not in ('sql','columns','merge','row_key')},'can_merge':bool(item.get('merge'))})
        except (OSError,ValueError):continue
    return result


def validate_options(manifest,value,columns):
    clean={}
    for field in manifest.get('fields',[]):
        key=field['key'];kind=field['type'];item=value.get(key,field.get('default'))
        if kind in ('column','columns'):
            if kind=='columns':
                if not isinstance(item,list) or len(item)>16 or any(not isinstance(c,str) or c not in columns for c in item):
                    raise ValueError('Choose up to 16 existing columns for '+field['label']+'.')
                item=list(dict.fromkeys(item))
            else:
                item=item or None
                if item is not None and item not in columns:raise ValueError('Unknown column for '+field['label']+'.')
        elif kind=='number':
            try:item=int(item)
            except (ValueError,TypeError):raise ValueError(field['label']+' must be a whole number.')
            if not field.get('min',0)<=item<=field.get('max',1000000):raise ValueError('Value outside the allowed range: '+field['label'])
        elif kind=='boolean':
            if not isinstance(item,bool):raise ValueError(field['label']+' must be on or off.')
        elif kind=='select':
            if item not in [pair[0] for pair in field['choices']]:raise ValueError('Choose an option for '+field['label']+'.')
        elif kind=='text':
            if item is None:item=''
            if not isinstance(item,str) or len(item)>min(10000,field.get('max_length',2000)):
                raise ValueError('Text is too long or invalid: '+field['label'])
        else:raise ValueError('Unknown module option type: '+str(kind))
        if field.get('required') and not item:raise ValueError('Choose '+field['label']+'.')
        clean[key]=item
    return clean


@dataclass
class Context:
    conn:object
    workspace:Path
    directory:Path
    record:dict
    cancelled:object
    emit:object

    @property
    def input(self):return 'read_parquet('+literal(self.directory/'input.parquet')+')'

    def check_cancelled(self):
        if self.cancelled.is_set():raise InterruptedError('Cancelled. Completed URLs are saved; Resume continues this run.')

    def update(self,**values):
        self.record.update(values,updated=time.time())
        temporary=self.directory/'run.tmp'
        temporary.write_text(json.dumps(self.record,ensure_ascii=False),encoding='utf-8')
        temporary.replace(self.directory/'run.json')

    def activity(self,label,detail='',**values):
        self.check_cancelled()
        self.emit({'run_id':self.record['id'],'label':label,'detail':detail,**values})

    def write_report(self,sql,row_group_size=None):
        path=self.directory/'report.parquet';temporary=self.directory/'report.partial'
        temporary.unlink(missing_ok=True)
        if row_group_size is not None and row_group_size not in (16384,32768,65536,122880):raise ValueError('Unsupported report row-group size.')
        grouping=f', ROW_GROUP_SIZE {row_group_size}' if row_group_size else ''
        self.conn.execute(f'COPY ({sql}) TO {literal(temporary)} (FORMAT PARQUET, COMPRESSION ZSTD{grouping})')
        self.check_cancelled();temporary.replace(path)
        return path

    def register(self,path,stem):
        existing=self.conn.execute('SELECT name FROM _wb_sources WHERE path=?',[str(path)]).fetchone()
        return existing[0] if existing else attach_source(self.conn,path,name=available_name(self.conn,stem))


def dispatch(conn,action,payload,job_id,environment):
    if action=='module_schema':
        statements=conn.extract_statements(payload.get('sql',''))
        if len(statements)!=1 or str(statements[0].type).split('.')[-1]!='SELECT':raise ValueError('Run a single SELECT before sending results to a module.')
        sql=query_body(statements[0].query)
        return {'columns':[{'name':row[0],'type':row[1]} for row in conn.execute('DESCRIBE SELECT * FROM ('+sql+') module_input').fetchall()]}
    if 'workspace' not in environment:raise ValueError('Module jobs require a workspace context.')
    workspace=Path(environment['workspace'])
    if action=='module_merge':return merge(conn,workspace,payload)
    if action=='module_manage':return manage(conn,workspace,payload,environment)
    available={item['id']:item for item in manifests()}
    if payload.get('run_id'):
        record=read_run(workspace,payload['run_id'])
        if record.get('input_released'):raise ValueError('The retained input was released. Start a new run from your source query.')
        if record['status']=='completed' and not payload.get('recheck'):raise ValueError('This run is complete. Open its report or start a new check.')
        manifest=available.get(record['module'])
        if not manifest or manifest['version']!=record['version']:raise ValueError('The module changed. Start a new run with the current version.')
        directory=run_path(workspace,record['id'])
        if payload.get('recheck'):
            if record['status']!='completed' or record['module']!='image_checker':raise ValueError('Recheck requires a completed image run.')
            mode=payload['recheck']
            if mode not in ('failures','selected','stale','all'):raise ValueError('Choose a recheck mode.')
            selected=payload.get('selected',[])
            if mode=='selected' and (not isinstance(selected,list) or not selected or len(selected)>100):raise ValueError('Select between 1 and 100 report cells.')
            if mode=='stale' and not 1<=int(payload.get('days',7))<=3650:raise ValueError('Age must be between 1 and 3650 days.')
            original=record;source_directory=directory
            directory=run_path(workspace,job_id);directory.mkdir(parents=True,exist_ok=False)
            record={**original,'id':job_id,'created':time.time(),'status':'preparing','previous_run':original['id'],'recheck_mode':mode,'queue_ready':False}
            for field in ('dataset','report','summary','merged_dataset','completed','error'):record.pop(field,None)
            record['recheck_scope']={'selected':selected if mode=='selected' else [],'days':int(payload.get('days',7))}
    else:
        manifest=available.get(payload.get('module'))
        if not manifest:raise ValueError('Choose an installed module.')
        statements=conn.extract_statements(payload.get('sql',''))
        if len(statements)!=1 or str(statements[0].type).split('.')[-1]!='SELECT':raise ValueError('Send a single SELECT to a module. Run setup statements separately first.')
        sql=query_body(statements[0].query)
        columns=[row[0] for row in conn.execute('DESCRIBE SELECT * FROM ('+sql+') AS module_input').fetchall()]
        if len(columns)>2000:raise ValueError('Select fewer than 2,000 input columns for a module snapshot.')
        options=validate_options(manifest,payload.get('options',{}),columns)
        key=job_id;directory=run_path(workspace,key);directory.mkdir(parents=True,exist_ok=False)
        row_key='_bedazzle_row_id'
        while row_key.casefold() in {c.casefold() for c in columns}:row_key+='_'
        record={'id':key,'module':manifest['id'],'version':manifest['version'],'name':manifest['name'],
                'status':'preparing','created':time.time(),'sql':sql,'columns':columns,'row_key':row_key,'options':options}
    ctx=Context(conn,workspace,directory,record,environment.get('cancelled') or threading.Event(),environment.get('emit') or (lambda value:None))
    try:
        ctx.update(status='preparing',error=None)
        if not (directory/'input.parquet').exists():
            ctx.activity('Freezing module input','Saving the complete SELECT to a compressed, stable working copy.',percent=None)
            partial=directory/'input.partial';partial.unlink(missing_ok=True)
            if record.get('previous_run'):
                previous=run_path(workspace,record['previous_run'])/'input.parquet'
                shutil.copyfile(previous,partial)
            else:conn.execute(f'COPY (SELECT row_number() OVER () AS {identifier(record["row_key"])}, source.* FROM ({record["sql"]}) source) TO {literal(partial)} (FORMAT PARQUET, COMPRESSION ZSTD)')
            ctx.check_cancelled();partial.replace(directory/'input.parquet')
        if record.get('previous_run') and not record.get('queue_ready'):prepare_recheck_queue(ctx)
        ctx.update(total_rows=conn.execute(f'SELECT count(*) FROM {ctx.input}').fetchone()[0],status='running')
        entry=MODULES/manifest['id']/manifest.get('entrypoint','runner.py')
        spec=importlib.util.spec_from_file_location('bedazzle_module_'+manifest['id'],entry)
        plugin=importlib.util.module_from_spec(spec);spec.loader.exec_module(plugin)
        output=plugin.run(ctx,record['options'])
        report=Path(output['report']).resolve()
        if not report.is_relative_to(directory.resolve()) or not report.is_file():raise ValueError('Module output must be a report file inside its run folder.')
        ctx.check_cancelled()
        dataset=ctx.register(report,manifest['id']+'_report')
        ctx.update(status='completed',dataset=dataset,report=str(report.relative_to(directory.resolve())),summary=output.get('summary',{}),merge=output.get('merge'))
        return {'run':{k:v for k,v in record.items() if k not in ('sql','columns')},'name':dataset,'catalog':catalog(conn)}
    except BaseException as error:
        ctx.update(status='cancelled' if ctx.cancelled.is_set() else 'failed',error=str(error)[:2000])
        for filename in ('input.partial','report.partial'):
            (directory/filename).unlink(missing_ok=True)
        raise


def merge(conn,workspace,payload):
    record=read_run(workspace,payload['run_id']);directory=run_path(workspace,record['id'])
    if record.get('input_released'):raise ValueError('The input snapshot was released; merge is unavailable.')
    if record['status']!='completed' or not record.get('merge'):raise ValueError('Complete a module run with row-linked output before merging.')
    spec=record['merge'];report=directory/record['report'];source=directory/'input.parquet'
    relation='read_parquet('+literal(report)+')'
    fields=spec['fields'];columns=record['columns'];seen={c.casefold() for c in columns}
    selections=['s.'+identifier(c) for c in columns];joins=[]
    if spec['kind'] not in ('cell','row'):raise ValueError('Unsupported module merge contract.')
    group='row_id, url_column' if spec['kind']=='cell' else 'row_id'
    if conn.execute(f'SELECT 1 FROM {relation} GROUP BY {group} HAVING count(*)>1 LIMIT 1').fetchone():
        raise ValueError('Module output contains repeated merge keys. No merge was made.')
    for index,column in enumerate(spec.get('url_columns',[]) if spec['kind']=='cell' else ['report']):
        alias='r'+str(index)
        condition=f'{alias}.row_id=s.{identifier(record["row_key"])}'
        if spec['kind']=='cell':condition+=f' AND {alias}.url_column={literal(column)}'
        joins.append(f'LEFT JOIN {relation} {alias} ON {condition}')
        for field in fields:
            candidate=column+'__'+field;suffix=2;original=candidate
            while candidate.casefold() in seen:candidate=original+'_'+str(suffix);suffix+=1
            seen.add(candidate.casefold());selections.append(f'{alias}.{identifier(field)} AS {identifier(candidate)}')
    name=available_name(conn,payload.get('name') or record['module']+'_merged',exact=bool(payload.get('name')))
    sql='SELECT '+', '.join(selections)+' FROM read_parquet('+literal(source)+') s '+' '.join(joins)
    conn.execute(f'CREATE VIEW {identifier(name)} AS {sql}')
    ctx=Context(conn,workspace,directory,record,threading.Event(),lambda value:None)
    ctx.update(merged_dataset=name)
    return {'name':name,'catalog':catalog(conn),'message':'Enriched dataset created from the frozen input. Original files and row counts are preserved.'}


def profiles(workspace):
    path=Path(workspace)/'modules'/'profiles.json'
    try:return json.loads(path.read_text('utf-8'))
    except (OSError,ValueError):return {}


def manage(conn,workspace,payload,environment):
    operation=payload.get('operation')
    if operation in ('save_profile','delete_profile'):
        name=str(payload.get('name','')).strip()
        if not name or len(name)>80:raise ValueError('Profile names must be 1 to 80 characters.')
        saved=profiles(workspace)
        if operation=='delete_profile':saved.pop(name,None)
        else:
            manifest=next(m for m in manifests() if m['id']=='image_checker')
            # Profiles contain requirements, not source mappings or network permissions.
            keys={'allowed_formats','max_image_kb','min_aspect_percent','max_aspect_percent','transparency','min_width','min_height','dimension_rule','placeholder_hashes','shared_threshold'}
            values=payload.get('options',{})
            clean=validate_options(manifest,{**{key:value for key,value in values.items() if key in keys},'url_columns':['url']},['url'])
            from modules.image_checker.quality import validate_rules
            validate_rules(clean)
            saved[name]={key:clean[key] for key in keys}
            if len(saved)>100:raise ValueError('Keep at most 100 requirement profiles.')
        directory=Path(workspace)/'modules';directory.mkdir(exist_ok=True)
        partial=directory/'profiles.tmp';partial.write_text(json.dumps(saved),encoding='utf-8');partial.replace(directory/'profiles.json')
        return {'profiles':saved}
    record=read_run(workspace,payload['run_id']);directory=run_path(workspace,record['id'])
    if str(operation or '').startswith('similarity_'):
        from modules.image_checker.similarity import manage as manage_similarity
        ctx=Context(conn,workspace,directory,record,environment.get('cancelled') or threading.Event(),environment.get('emit') or (lambda value:None))
        return manage_similarity(ctx,payload)
    if operation=='preview':
        if record['module']!='image_checker' or record['status']!='completed':raise ValueError('Choose a completed image report.')
        row=conn.execute('SELECT image_url FROM read_parquet('+literal(directory/record['report'])+') WHERE row_id=? AND url_column=?',[int(payload['row_id']),str(payload['url_column'])]).fetchone()
        if not row:raise ValueError('Image cell not found.')
        from modules.image_checker.network import check_url
        result=check_url(row[0],record['options'],environment.get('cancelled') or threading.Event(),preview=True)
        return {'thumbnail':result.get('thumbnail'),'error':result.get('error'),'message':'Fetched again now; the remote image may have changed since the saved check.'}
    if operation in ('delete_run','release_input'):
        for file in (workspace/'modules'/'runs').glob('*/run.json'):
            child=json.loads(file.read_text('utf-8'))
            if child.get('previous_run')==record['id'] and child['status']!='completed':
                raise ValueError('An unfinished recheck still needs this run. Complete or delete that recheck first.')
    if operation=='delete_run':
        if conn.execute("SELECT count(*) FROM duckdb_views() WHERE contains(replace(lower(sql),chr(92),'/'),?)",[directory.as_posix().lower().replace("'","''")]).fetchone()[0]:
            raise ValueError('Remove the report for this run and merged datasets from the sidebar before deleting its files.')
        allowed={'run.json','run.tmp','input.parquet','input.partial','checks.sqlite3','checks.sqlite3-wal','checks.sqlite3-shm','checks.sqlite3-journal','url_checks.ndjson','url_checks.parquet','url_checks.partial','report.parquet','report.partial','similarity.sqlite3','similarity.partial','similarity.partial-journal','similarity_nodes.ndjson','similarity_pairs.ndjson','similarity_pairs.parquet','similarity_pairs.partial'}
        files=list(directory.iterdir())
        if any(not file.is_file() or file.name not in allowed for file in files):raise ValueError('Unexpected files in run folder; no files were deleted.')
        for file in files:
            if file.name!='run.json':file.unlink()
        (directory/'run.json').unlink(missing_ok=True);directory.rmdir()
        return {'message':'Saved run files deleted.'}
    if operation=='release_input':
        if record['status']!='completed':raise ValueError('Only completed runs can release retained input.')
        # Merged views read the frozen input. Keep it while a merged dataset exists.
        if conn.execute("SELECT count(*) FROM duckdb_views() WHERE contains(replace(lower(sql),chr(92),'/'),?)",[(directory/'input.parquet').as_posix().lower().replace("'","''")]).fetchone()[0]:raise ValueError('Remove the merged dataset first; it still uses this snapshot.')
        for filename in ('input.parquet','checks.sqlite3','checks.sqlite3-wal','checks.sqlite3-shm','checks.sqlite3-journal','url_checks.ndjson','url_checks.parquet'):
            (directory/filename).unlink(missing_ok=True)
        ctx=Context(conn,workspace,directory,record,threading.Event(),lambda value:None)
        ctx.update(input_released=True,sql='',columns=[],can_merge=False,merge=None)
        return {'message':'Input and URL queue released. The report remains available; merge and recheck are disabled.'}
    raise ValueError('Unknown module management action.')


def prepare_recheck_queue(ctx):
    """Atomic preparation metadata lets interrupted copies resume from saved input."""
    source_directory=run_path(ctx.workspace,ctx.record['previous_run'])
    mode=ctx.record['recheck_mode'];scope=ctx.record['recheck_scope']
    ctx.activity('Preparing recheck','Copying saved checks and applying the selected recheck scope.',percent=0)
    for filename in ('checks.sqlite3','checks.sqlite3-wal','checks.sqlite3-shm','checks.sqlite3-journal'):
        (ctx.directory/filename).unlink(missing_ok=True)
    with closing(sqlite3.connect(source_directory/'checks.sqlite3')) as source,closing(sqlite3.connect(ctx.directory/'checks.sqlite3')) as dest:
        source.backup(dest,pages=256,progress=lambda *args:ctx.check_cancelled())
        if mode=='all':dest.execute('UPDATE urls SET result=NULL,status=NULL')
        elif mode=='failures':
            cursor=ctx.conn.execute("SELECT DISTINCT coalesce(image_url,'') FROM read_parquet("+literal(source_directory/'report.parquet')+") WHERE verdict IN ('fail','blocked','limited')")
            while True:
                ctx.check_cancelled();batch=cursor.fetchmany(1000)
                if not batch:break
                dest.executemany('UPDATE urls SET result=NULL,status=NULL WHERE url=?',batch)
        elif mode=='selected':
            for cell in scope['selected']:
                ctx.check_cancelled()
                url=ctx.conn.execute('SELECT image_url FROM read_parquet('+literal(source_directory/'report.parquet')+') WHERE row_id=? AND url_column=?',[int(cell['row_id']),str(cell['url_column'])]).fetchone()
                if not url:raise ValueError('A selected report cell does not exist.')
                dest.execute('UPDATE urls SET result=NULL,status=NULL WHERE url=?',[url[0] or ''])
        else:
            import datetime
            cutoff=datetime.datetime.fromtimestamp(time.time()-scope['days']*86400,datetime.timezone.utc).isoformat()
            dest.execute("UPDATE urls SET result=NULL,status=NULL WHERE json_extract(result,'$.checked_at')<?",[cutoff])
        dest.commit()
    ctx.check_cancelled();ctx.update(queue_ready=True)
