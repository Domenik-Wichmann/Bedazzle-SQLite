"""Adapters for existing workspace, editor, image-review and chart facilities."""
import json
import shutil
from pathlib import Path
from engine import identifier as q, literal as lit, reader, catalog, attach_source
from companion_sql import validate
from companion_store import digest

OPERATIONS={'ingest_url','datasets','snapshot_dataset','propose_transform','apply_transform','propose_writeback','apply_writeback','image_decide','image_retention','chart_save','chart_preview','charts'}


def run(c):
    conn,ledger,args,task=c.conn,c.ledger,c.args,c.task
    def bind(versions,analyze=True):
        if not isinstance(versions,list) or not 1<=len(versions)<=16:
            raise ValueError('Select 1 to 16 explicit source versions')
        items=[c.source(v,analyze) for v in versions]
        return items
    def artifact():
        item=ledger.get('artifact',args['artifact'])
        if item['task']!=c.task_id:raise ValueError('Artifact belongs to another task')
        for version in item['inputs']:c.source(version)
        return item
    def approval(purpose,scope):
        return ledger.pending(c.task_id,purpose,scope)
    def begin(request,purpose):
        if request['task']!=c.task_id or request['purpose']!=purpose or request['status']!='approved':
            raise ValueError('Matching local approval is required')
        if request.get('started') and not request.get('output'):
            raise ValueError('Interrupted operation needs local review; it will not be replayed')
        request.update(started=True,job=c.job_id)
        ledger.put('approval',request,request['id'])
    def complete(request,value):
        ledger.put('approval',{**request,'started':True,'output':value['id']},request['id'])
        return {'version':c.receipt(value),'analysis_authorized':False,'detail':'Write completed; no post-edit quality checks were run.'}
    def pending_path(request,suffix='.parquet'):
        path=ledger.root/(c.job_id+suffix)
        ledger.put('pending_output',{'path':str(path),'edited':True,'parent':request['scope'].get('versions',[request['scope'].get('version')])[0]},c.job_id)
        return path
    def persistent_table(name):
        if not task.get('allow_workspace_data'):raise ValueError('This task does not authorize stored workspace tables')
        if name.startswith('_wb_') or not conn.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name=? AND database_name=current_database() AND schema_name='main' AND NOT internal",[name]).fetchone()[0]:
            raise ValueError('Choose an ordinary stored table in this workspace')
        return q(conn.execute('SELECT current_database()').fetchone()[0])+'.main.'+q(name)
    def current_table_hash(name):
        temporary=ledger.root/(c.job_id+'.table-check.parquet')
        try:
            conn.execute('COPY (SELECT * FROM '+persistent_table(name)+') TO '+lit(temporary)+' (FORMAT PARQUET,COMPRESSION ZSTD)')
            return digest(temporary)
        finally:temporary.unlink(missing_ok=True)

    if c.op=='ingest_url':
        from companion_backend import destination,dispatch
        from companion_ingest import download,DEFAULT_BYTES
        output=destination(args['output'],task['roots'],c.env['workspace'])
        default_limit=int(task.get('download_bytes',DEFAULT_BYTES))
        limit=int(args.get('max_bytes',default_limit))
        scope={'url':args['url'],'destination':str(output),'max_bytes':limit,'reason':args.get('reason','Download a local dataset for the authorized inspection task')}
        if limit>default_limit:ledger.require(c.task_id,'dataset_download',scope)
        def oversize(estimated,received):
            requested=estimated or max(limit*2,received)
            request=approval('dataset_download',{**scope,'max_bytes':requested})
            raise ValueError('Download stopped before publishing: configured byte limit exceeded. Approval '+request['id']+' is '+request['status']+'. Estimated total bytes: '+str(estimated)+'; observed bytes: '+str(received)+'. After local approval retry with max_bytes='+str(requested))
        receipt=download(args['url'],output,limit,int(args.get('timeout',60)),task.get('allow_private_downloads',False),c.check,c.env.get('emit',lambda v:None),oversize)
        imported=dispatch(conn,{'operation':'import','task':c.task_id,'arguments':{'path':str(output)}},c.job_id,c.env)
        return {**imported,'download':receipt}

    if c.op in ('datasets','snapshot_dataset'):
        from companion_backend import permitted
        items=[]
        tables={r[0] for r in conn.execute("SELECT table_name FROM duckdb_tables() WHERE database_name=current_database() AND schema_name='main' AND NOT internal").fetchall()}
        known={r[0]:{'name':r[0],'path':r[1],'bytes':r[2],'kind':r[3]} for r in conn.execute('SELECT * FROM _wb_sources').fetchall()}
        candidates=set(known)|tables
        for name in sorted(candidates):
            if name.startswith('_'):continue
            item=known.get(name,{'name':name,'path':'','kind':'table'})
            if item.get('path'):
                try:
                    path=permitted(item['path'],task['roots'])
                    relation=reader(path)
                except ValueError:continue
            elif task.get('allow_workspace_data') and name in tables:relation=q(name)
            else:continue
            item['columns']=[{'name':r[0],'type':r[1]} for r in conn.execute('DESCRIBE SELECT * FROM '+relation).fetchmany(200)]
            items.append(item)
        if c.op=='datasets':return {'datasets':items[:200],'truncated':len(items)>200}
        item=next((v for v in items if v['name']==args['name']),None)
        if not item:raise ValueError('Dataset is outside this task. Authorize workspace tables in the local task window, or import its permitted source file.')
        if item.get('path'):
            from companion_backend import dispatch
            return dispatch(conn,{'operation':'import','task':c.task_id,'arguments':{'path':item['path']}},c.job_id,c.env)
        path=ledger.root/(c.job_id+'.parquet')
        if any('HUGEINT' in col['type'] for col in item['columns']):raise ValueError('This stored table has 128-bit integer columns that standard Parquet cannot preserve as the original type. Export an explicit VARCHAR/DECIMAL representation first; the original table was not changed.')
        count=conn.execute('COPY (SELECT * FROM '+persistent_table(item['name'])+') TO '+lit(path)+' (FORMAT PARQUET,COMPRESSION ZSTD)').fetchone()[0]
        binding=next((v for v in ledger.list('binding',100000) if v.get('table')==item['name']),None)
        output=c.register(path,bool(binding and binding['edited']),[binding['version']] if binding else [],options={},workspace_table=item['name'],snapshot_rows=count)
        return {'version':c.receipt(output)}

    if c.op=='propose_transform':
        versions=args['versions']
        bind(versions,False)
        sql=validate(conn,args['sql'],['v'+str(i) for i in range(len(versions))],allow_repairs=True)
        return approval('transform',{'versions':versions,'sql':sql,'destination':'New immutable repaired Parquet version','overwrite':False,'scope':args.get('reason','SQL repair copy')})
    if c.op=='apply_transform':
        request=ledger.get('approval',args['approval'])
        if request['task']!=c.task_id or request['purpose']!='transform':raise ValueError('Select this task\'s SQL transform approval')
        if request.get('output'):
            if request['task']!=c.task_id:raise ValueError('Wrong task')
            return complete(request,ledger.get('version',request['output']))
        begin(request,'transform')
        versions=request['scope']['versions'];items=bind(versions,False)
        from companion_sql import bind_query
        sql=bind_query(conn,items,request['scope']['sql'],allow_repairs=True)
        from engine import parquet_query
        sql,converted=parquet_query(conn,sql)
        path=pending_path(request);partial=path.with_suffix('.partial')
        try:
            rows=conn.execute('COPY ('+sql+') TO '+lit(partial)+' (FORMAT PARQUET,COMPRESSION ZSTD)').fetchone()[0]
            c.check();partial.replace(path)
        finally:partial.unlink(missing_ok=True)
        output=c.register(path,True,versions,options={},approval=request['id'],written_rows=rows,operation_sql=request['scope']['sql'],storage_notes={'exact_integer_columns':converted,'representation':'DECIMAL(38,0) when required by Parquet; original source values remain unchanged'})
        return complete(request,output)

    if c.op=='propose_writeback':
        edited=c.source(args['version'],False);original=c.source(args['target_version'],False)
        if not edited['edited']:raise ValueError('Select a tracked edited version')
        from companion_backend import destination
        if original.get('original_path'):
            target=destination(original['original_path'],task['roots'],c.env['workspace']);kind='file';current=digest(target)
        elif original.get('workspace_table'):
            target=original['workspace_table'];kind='table';current=current_table_hash(target)
        else:raise ValueError('Target must be a preserved original file or stored table version')
        if current!=original['sha256']:raise ValueError('Original changed since its preserved version. Snapshot the current original before proposing a write-back.')
        keys=args['keys']
        if not isinstance(keys,list) or not keys or not all(isinstance(k,str) for k in keys):raise ValueError('Explicit unique non-NULL record key columns are required')
        return approval('writeback',{'version':edited['id'],'target_version':original['id'],'target_kind':kind,'destination':str(target),'expected_sha256':original['sha256'],'keys':keys,'overwrite':True,'backup':'Recoverable immutable original version; file writes also preserve a unique .bak beside the original'})
    if c.op=='apply_writeback':
        request=ledger.get('approval',args['approval'])
        if request['task']!=c.task_id or request['purpose']!='writeback':raise ValueError('Select this task\'s explicit overwrite approval')
        if request.get('output'):
            if request['task']!=c.task_id:raise ValueError('Wrong task')
            return complete(request,ledger.get('version',request['output']))
        begin(request,'writeback');scope=request['scope']
        edited=c.source(scope['version'],False);original=c.source(scope['target_version'],False)
        from companion_backend import permitted,destination
        is_table=scope.get('target_kind')=='table'
        if is_table:target=scope['destination'];reference=persistent_table(target);current=current_table_hash(target)
        else:target=destination(scope['destination'],task['roots'],c.env['workspace']);reference=None;current=digest(target)
        if current!=scope['expected_sha256']:raise ValueError('Original changed; overwrite approval is no longer applicable')
        from data_editor import init,snapshot,names,identity,write_source,validate_keys
        init(conn)
        session=snapshot(conn,{'sql':'SELECT * FROM '+reader(Path(original['path']),original.get('options'))},c.env)
        work,base,_=names(session);rid=identity(session)
        relation=reader(Path(edited['path']),edited.get('options'))
        fields=[col['name'] for col in session['columns']]
        actual=[r[0] for r in conn.execute('DESCRIBE SELECT * FROM '+relation).fetchall()]
        if set(fields)!=set(actual):raise ValueError('Write-back requires the complete unchanged column schema; keep the repaired copy instead')
        keys=scope['keys']
        if not set(keys)<=set(fields):raise ValueError('Record keys must exist in both versions')
        validate_keys(conn,base,keys)
        conn.execute('CREATE OR REPLACE TEMP VIEW companion_writeback_input AS SELECT * FROM '+relation)
        validate_keys(conn,'companion_writeback_input',keys)
        join=' AND '.join('e.'+q(k)+' IS NOT DISTINCT FROM b.'+q(k) for k in keys)
        projection=','.join('e.'+q(field) for field in fields)
        conn.execute('DELETE FROM '+work)
        conn.execute('INSERT INTO '+work+' SELECT COALESCE(b.'+rid+', (SELECT COALESCE(max('+rid+'),0) FROM '+base+')+row_number() OVER()),'+projection+' FROM companion_writeback_input e LEFT JOIN '+base+' b ON '+join)
        name=target if is_table else attach_source(conn,target,original.get('options'),name='Companion write-back '+c.job_id[:12])
        from data_editor import stamp
        if not is_table:session['stamps'][name]={'path':str(target),'stamp':stamp(target)}
        path=pending_path(request,'.parquet' if is_table else ''.join(target.suffixes))
        if not is_table:ledger.put('pending_output',{'path':str(target),'edited':True,'parent':edited['id']},c.job_id+'-target')
        try:
            if is_table:
                ledger.put('binding',{'table':name,'version':edited['id'],'edited':True,'pending_approval':request['id']},name)
            receipt=write_source(conn,session,{'target':name,'keys':keys,'mode':'source' if is_table else 'original',**({'expected_content_sha256':scope['expected_sha256']} if not is_table else {})},target_reference=reference)
            if is_table:
                conn.execute('COPY (SELECT * FROM '+reference+') TO '+lit(path)+' (FORMAT PARQUET,COMPRESSION ZSTD)')
                receipt['backup']=original['path']
                output=c.register(path,True,[edited['id'],original['id']],options={},workspace_table=name,approval=request['id'],backup=receipt['backup'])
                ledger.put('binding',{'table':name,'version':output['id'],'edited':True},name)
            else:
                shutil.copyfile(target,path)
                if digest(path)!=receipt['content_sha256'] or digest(target)!=receipt['content_sha256']:
                    raise ValueError('Source changed after overwrite; the retained original/backup is recoverable. Review the interrupted operation locally.')
                output=c.register(path,True,[edited['id'],original['id']],options=original.get('options',{}),original_path=str(target),approval=request['id'],backup=receipt['backup'])
        finally:
            if not is_table:
                conn.execute('DROP VIEW IF EXISTS '+q(name))
                conn.execute('DELETE FROM _wb_sources WHERE name=?',[name])
        result=complete(request,output);result['backup']=receipt['backup'];result['catalog']=catalog(conn)
        return result

    if c.op in ('image_decide','image_retention'):
        item=artifact()
        if not item.get('module_run'):raise ValueError('Select an image-check artifact')
        from module_runtime import dispatch,read_run
        if c.op=='image_decide':
            if args['decision'] not in ('similar','different','unreviewed') or len(args.get('note',''))>500:raise ValueError('Choose a supported review status and a note of at most 500 characters')
            if int(args['pair_id'])<1:raise ValueError('Choose a positive pair id returned by image_pairs')
            from module_runtime import run_path
            import sqlite3
            from contextlib import closing
            index=run_path(c.env['workspace'],item['module_run'])/'similarity.sqlite3'
            if not index.is_file():raise ValueError('Build image similarity pairs first')
            with closing(sqlite3.connect(index.as_uri()+'?mode=ro',uri=True)) as db:
                pair=db.execute('SELECT a.sha256,b.sha256,a.safe_url,b.safe_url,p.score FROM pairs p JOIN nodes a ON a.id=p.left_id JOIN nodes b ON b.id=p.right_id WHERE p.id=?',[int(args['pair_id'])]).fetchone()
            if not pair:raise ValueError('Pair no longer exists; refresh image_pairs')
            scope={'artifact':item['id'],'run_id':item['module_run'],'pair_id':int(args['pair_id']),'left_sha256':pair[0],'right_sha256':pair[1],'left_url':pair[2],'right_url':pair[3],'fingerprint_agreement':pair[4],'decision':args['decision'],'note':args.get('note',''),'effect':'Review annotation only; source records and image verdicts unchanged'}
            request=approval('image_review',scope)
            if request['status']!='approved':return request
            if request.get('output'):return {'review':request['output']}
            begin(request,'image_review')
            result=dispatch(conn,'module_manage',{'operation':'similarity_decide',**{k:v for k,v in scope.items() if k not in ('artifact','effect')}},c.job_id,c.env)
        else:
            operation=args['operation']
            if operation not in ('release_input','delete_run'):raise ValueError('Choose release_input or delete_run')
            scope={'artifact':item['id'],'run_id':item['module_run'],'operation':operation,'effect':'Release retained module files; cannot be undone. Saved companion query results and original source snapshots remain.'}
            request=approval('retention',scope)
            if request['status']!='approved':return request
            if request.get('output'):return {'receipt':request['output']}
            begin(request,'retention')
            if operation=='delete_run':
                record=read_run(c.env['workspace'],item['module_run'])
                from engine import perform
                for name in (record.get('merged_dataset'),record.get('dataset')):
                    if name and name in {v['name'] for v in catalog(conn)}:perform(conn,'remove_dataset',{'name':name},c.job_id)
            result=dispatch(conn,'module_manage',{'operation':operation,'run_id':item['module_run']},c.job_id,c.env)
        saved=ledger.put('receipt',{'task':c.task_id,'approval':request['id'],'result':result})
        ledger.put('approval',{**request,'started':True,'output':saved['id']},request['id'])
        return {'receipt':saved['id'],**result}

    if c.op=='charts':return {'charts':[v for v in ledger.list('chart',200) if v['task']==c.task_id]}
    if c.op in ('chart_save','chart_preview'):
        item=artifact()
        if not item.get('result_id'):raise ValueError('Choose a retained query result')
        from chart_studio import dispatch
        existing=next((v for v in ledger.list('chart_source',100000) if v['artifact']==item['id']),None)
        if not existing:
            opened=dispatch(conn,{'op':'open','result_id':item['result_id']},c.env)
            existing=ledger.put('chart_source',{'task':c.task_id,'artifact':item['id'],'source':opened['source']})
        config=dict(args['config']);config['limit']=min(200,int(config.get('limit',100)))
        if c.op=='chart_preview':
            result=dispatch(conn,{'op':'preview','source':existing['source'],'config':config},c.env)
            row_limit=min(200,task.get('response_rows',200))
            if len(result['rows'])>row_limit:
                result['truncated']=True;result['model_preview_truncated']=True
            result['local_chart_limit']=result['limit'];result['limit']=min(result['limit'],row_limit)
            result['rows']=result['rows'][:row_limit];result.pop('info',None)
            return {'artifact':item['id'],'inputs':item['inputs'],'edited':item['edited'],**result}
        saved=dispatch(conn,{'op':'save','source':existing['source'],'config':config},c.env)
        chart=saved['charts'][-1]
        output=ledger.put('chart',{'task':c.task_id,'artifact':item['id'],'inputs':item['inputs'],'edited':item['edited'],'chart':chart})
        return output
    raise ValueError('Unsupported companion adapter')
