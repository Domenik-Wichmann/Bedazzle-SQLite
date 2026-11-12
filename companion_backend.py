"""Fail-closed adapters on the existing serialized engine connection."""
import json
import hashlib
import shutil
import time
from pathlib import Path
from engine import identifier as q, literal as lit, reader
from companion_store import Ledger, digest


def permitted(path, roots, exists=True):
    path = Path(path).expanduser().resolve()
    if not any(path.is_relative_to(Path(root).resolve()) for root in roots):
        raise ValueError('Path is outside the configured permitted folders')
    if exists and not path.exists():
        raise ValueError('Path does not exist')
    return path


def destination(path,roots,workspace):
    path=permitted(path,roots,False)
    workspace=Path(workspace).resolve()
    home=workspace.parent.parent if workspace.parent.name=='workspaces' and len(workspace.name)==32 else workspace
    bases=[home]
    registry=home/'workspaces.json'
    if registry.exists():
        data=json.loads(registry.read_text('utf-8'))
        bases.extend(home/'workspaces'/v['id'] for v in data['items'] if v['id']!='primary')
    for base in bases:
        for name in ('companion','results','modules','charts'):
            if path.is_relative_to((base/name).resolve()):raise ValueError('Managed snapshots/results/module/chart storage is immutable to agent-supplied destinations. Choose a separate output folder.')
    return path



def dispatch(conn, payload, job_id, environment):
    ledger = Ledger(environment['workspace'])
    op, args, task_id = payload['operation'], payload.get('arguments', {}), payload['task']
    task = ledger.task(task_id)
    cancelled = environment.get('cancelled')
    emit = environment.get('emit', lambda value: None)
    def check():
        if cancelled and cancelled.is_set():
            raise InterruptedError('Cancelled')
    def source(identity, analyze=True):
        item = ledger.get('version', identity)
        if item['task'] != task_id:
            raise ValueError('Version belongs to a different task')
        if analyze and item['edited']:
            ledger.require(task_id, 'analyze_edited', {'version': identity, 'scope': task['scope']})
        if digest(item['path']) != item['sha256']:
            raise ValueError('Immutable source content changed; refusing operation')
        return item
    def register(path, edited, parents, **extra):
        item = ledger.put('version', {'task': task_id, 'path': str(path), 'sha256': digest(path), 'edited': edited, 'parents': parents, 'created': time.time(), **extra})
        ledger.note_content(item['sha256'],item['id'],edited)
        ledger.event({'type': 'version_created', 'task': task_id, 'version': item['id'], 'edited': edited})
        return item
    def receipt(item):
        value={k:v for k,v in item.items() if k!='path'}
        for field in ('sql','operation_sql'):
            if isinstance(value.get(field),str):
                value[field+'_sha256']=hashlib.sha256(value[field].encode('utf-8')).hexdigest()
                if len(value[field])>2048:
                    value[field+'_preview']=value.pop(field)[:2048];value[field+'_truncated']=True
        return value
    try:
        ledger.event({'type': 'running', 'job': job_id, 'operation': op, 'task': task_id})
        from companion_features import OPERATIONS, run
        if op in OPERATIONS:
            from types import SimpleNamespace
            result=run(SimpleNamespace(conn=conn,ledger=ledger,args=args,task=task,task_id=task_id,op=op,job_id=job_id,env=environment,source=source,register=register,receipt=receipt,check=check))
        elif op == 'capabilities':
            from module_runtime import discover
            modules,errors=discover()
            result={'modules':[{'id':m['id'],'name':m['name'],'version':m['version'],'mcp_supported':m['id']=='image_checker','fields':m.get('fields',[]) if m['id']=='image_checker' else []} for m in modules[:20]],'errors':errors[:20],'editing':['cells','set','replace','delete','add'],'sql_aliases':'v0, v1, ...','default_response_rows':200,'default_response_bytes':65536,'default_task_bytes':1048576}
            from companion_sql import AGGREGATES,SCALARS
            result.update(builtin_adapters=['data_editor','chart_studio','workspace_tables','url_ingestion'],additional_operations=sorted(OPERATIONS),sql={'functions':sorted(AGGREGATES|SCALARS),'supports':['diagnostic TRIM/LIKE/CASE','nonrecursive CTEs','joins','windows','set operations','bounded pivots'],'repair_path':'propose_transform then apply_transform; separate analysis approval after creation'},import_policy='Untouched snapshot is ordinary read-only inspection; text-preserving CSV types are intentional.',permissions={'workspace_tables':task.get('allow_workspace_data',False),'private_image_network':task.get('allow_private_images',False),'private_download_network':task.get('allow_private_downloads',False)})
        elif op == 'browse':
            path = permitted(args['path'], task['roots'])
            rows = []
            for entry in path.iterdir():
                check()
                if len(rows) == 200:
                    break
                if entry.is_symlink():
                    continue
                rows.append({'name': entry.name, 'directory': entry.is_dir(), 'bytes': entry.stat().st_size})
            result = {'entries': rows, 'truncated': len(rows) == 200}
        elif op == 'import':
            path = permitted(args['path'], task['roots'])
            snapshot_target = ledger.root / (job_id + ''.join(path.suffixes))
            partial = snapshot_target.with_name(snapshot_target.name + '.partial')
            emit({'label': 'Preserving original', 'detail': 'Copying and fingerprinting source bytes', 'percent': None})
            try:
                before = digest(path)
                with path.open('rb') as src, partial.open('xb') as dst:
                    while True:
                        check()
                        block = src.read(1024 * 1024)
                        if not block:
                            break
                        if shutil.disk_usage(ledger.root).free < 512 * 1024**2:
                            raise ValueError('Insufficient snapshot disk space')
                        dst.write(block)
                if digest(partial) != before or digest(path) != before:
                    raise ValueError('Source changed during snapshot preparation')
                partial.replace(snapshot_target)
            finally:
                partial.unlink(missing_ok=True)
            # Reimporting a known edited artifact must not clear its restrictions.
            known = [v for v in ledger.list('version', 100000) if v['sha256'] == before]
            tracked=ledger.edited_content(before) or ledger.pending_parent(before)
            if tracked:
                known.append({'id':tracked,'edited':True})
            # A completed write may outlive its receipt after a crash. Its pending
            # snapshot_target remains restricted, including byte-identical renamed copies.
            for pending in ledger.list('pending_output', 100000):
                candidate = Path(pending['path'])
                if pending['edited'] and candidate.is_file() and digest(candidate) == before:
                    known.append({'id': pending['parent'], 'edited': True})
            edited = any(v['edited'] for v in known)
            item = register(snapshot_target, edited, [v['id'] for v in known if v['edited']], original_path=str(path), options=args.get('options', {}))
            ledger.event({'type':'source_selected','version':item['id'],'task':task_id,'edited':item['edited']})
            result = {'version': receipt(item),'operation':'read_only_snapshot','source_unchanged':True,'analysis_authorized':not edited,'interpretation':'Default delimited-file imports preserve values as text. This is not a defect. Numeric min/max/sorting require explicit casts; count conversion failures separately.'}
        elif op in ('versions', 'approvals'):
            result = {op: [receipt(v) for v in ledger.list('version' if op == 'versions' else 'approval') if v['task'] == task_id]}
        elif op=='artifacts':
            result={'artifacts':[receipt(v) for v in ledger.list('artifact',200) if v['task']==task_id]}
        elif op=='lineage':
            item=source(args['version'],False)
            queue=[item['id']];seen=set();nodes=[]
            while queue and len(nodes)<50:
                identity=queue.pop(0)
                if identity in seen:continue
                seen.add(identity);record=None
                for kind in ('version','artifact'):
                    try:record=ledger.get(kind,identity);break
                    except ValueError:continue
                if record is None:
                    nodes.append({'id':identity,'kind':'external_workspace_or_origin_reference'});continue
                parents=record.get('parents',record.get('inputs',[]))
                if record.get('parent_artifact'):parents=list(parents)+[record['parent_artifact']]
                node={'id':identity,'kind':kind,'edited':record['edited'],'parents':parents}
                if record.get('sha256'):node['sha256']=record['sha256']
                if record.get('sql'):node['query_sha256']=hashlib.sha256(record['sql'].encode('utf-8')).hexdigest()
                nodes.append(node);queue.extend(parents)
            result={'version':item['id'],'edited':item['edited'],'nodes':nodes,'truncated':bool(queue),'detail':'Identity/lineage metadata only; no content validation was performed.'}
        elif op == 'request_analysis':
            item = source(args['version'], False)
            if not item['edited']:
                raise ValueError('Original inspection already authorized by this task')
            result = ledger.pending(task_id, 'analyze_edited', {'version': item['id'], 'scope': task['scope']})
        elif op == 'propose_edit':
            item = source(args['version'], False)
            changes = args.get('changes', [])
            operations = args.get('operations', [])
            keys=args.get('keys',[])
            if keys and (not isinstance(keys,list) or not 1<=len(keys)<=16 or not all(isinstance(k,str) for k in keys) or len(set(keys))!=len(keys)):
                raise ValueError('Choose 1 to 16 distinct record key columns')
            if keys and operations:raise ValueError('Record keys apply to cell changes, not bulk operations')
            if bool(changes)==bool(operations):
                raise ValueError('Provide either changes or operations')
            if changes and (not isinstance(changes, list) or not 1 <= len(changes) <= 10000):
                raise ValueError('Propose 1 to 10000 explicit cell changes')
            for change in changes:
                required={'key','column','value'} if keys else {'row','column','value'}
                if not required<=set(change) or set(change)-required-{'expected'}:raise ValueError('Each cell needs a selector, column, value and optional expected value')
                if keys:
                    if not isinstance(change['key'],dict) or set(change['key'])!=set(keys) or any(isinstance(v,(dict,list)) for v in change['key'].values()):raise ValueError('Each change must specify every record key as a scalar')
                elif not isinstance(change['row'],int) or isinstance(change['row'],bool) or change['row']<1:raise ValueError('Use the positive one-based source row identity, not a filtered/sorted preview row')
                if not isinstance(change['column'],str) or isinstance(change['value'],(dict,list)) or isinstance(change.get('expected'),(dict,list)):
                    raise ValueError('Cell changes require a column name and scalar value')
            if operations:
                if not isinstance(operations,list) or len(operations)>100:
                    raise ValueError('Propose up to 100 bounded editor operations')
                allowed={'set':{'op','column','value','search'},'replace':{'op','column','find','replacement','search'},'delete':{'op','rows'},'add':{'op'}}
                for operation in operations:
                    if not isinstance(operation,dict) or operation.get('op') not in allowed or set(operation)-allowed[operation['op']]:
                        raise ValueError('Unsupported editor operation/fields')
            proposal = {'source': item['id'], 'changes': changes,'keys':keys, 'operations':operations, 'destination': 'New immutable Parquet copy in companion storage', 'overwrite': False}
            result = ledger.pending(task_id, 'edit', proposal)
        elif op == 'apply_edit':
            approval = ledger.get('approval', args['approval'])
            if approval['task'] != task_id or approval['purpose'] != 'edit' or approval['status'] != 'approved':
                raise ValueError('A matching approved edit proposal is required')
            if approval.get('output'):
                result = {'version': receipt(ledger.get('version', approval['output'])), 'analysis_authorized': False}
            else:
                if approval.get('started'):
                    raise ValueError('Interrupted edit requires local review; it will not be replayed')
                item = source(approval['scope']['source'], False)
                approval['started'] = True
                approval['job']=job_id
                ledger.put('approval', approval, approval['id'])
                path = ledger.root / (job_id + '.parquet')
                ledger.put('pending_output', {'path':str(path),'edited':True,'parent':item['id']}, job_id)
                from data_editor import dispatch as editor_dispatch, snapshot, edit, init, load,names,identity,validate_keys,column
                init(conn)
                sql = 'SELECT * FROM ' + reader(Path(item['path']), item.get('options'))
                session = snapshot(conn, {'sql': sql}, environment)
                if approval['scope'].get('changes'):
                    cells=[];work,base,_=names(session);rid=identity(session);keys=approval['scope'].get('keys',[])
                    if keys:
                        if not set(keys)<={c['name'] for c in session['columns']}:raise ValueError('Record key column is absent')
                        validate_keys(conn,base,keys)
                    for change in approval['scope']['changes']:
                        col=column(session,change['column'])
                        ctype=next(v['type'] for v in session['columns'] if v['name']==change['column'])
                        if change['value'] is not None and (ctype.startswith('DECIMAL') or ctype in ('TINYINT','SMALLINT','INTEGER','BIGINT','HUGEINT','UTINYINT','USMALLINT','UINTEGER','UBIGINT','UHUGEINT')):
                            from decimal import Decimal
                            requested=Decimal(str(change['value']))
                            actual=conn.execute('SELECT CAST(? AS '+ctype+')',[change['value']]).fetchone()[0]
                            if requested.is_finite() and Decimal(str(actual))!=requested:raise ValueError('The approved value cannot be represented exactly in '+ctype+'; no cells were edited')
                        if keys:
                            predicate=' AND '.join(q(k)+' IS NOT DISTINCT FROM ?' for k in keys)
                            row=conn.execute('SELECT '+rid+' FROM '+base+' WHERE '+predicate,[change['key'][k] for k in keys]).fetchone()
                            if not row:raise ValueError('Approved record key was not found')
                            selected=row[0]
                        else:selected=change['row']
                        if 'expected' in change:
                            actual=conn.execute('SELECT CAST('+col+' AS VARCHAR) FROM '+base+' WHERE '+rid+'=?',[selected]).fetchone()
                            expected=None if change['expected'] is None else str(change['expected'])
                            if not actual or actual[0]!=expected:raise ValueError('Expected original cell does not match; no cells were edited')
                        cells.append({'row':selected,'column':change['column'],'value':change['value']})
                    edit(conn, session, {'op': 'cells', 'cells':cells})
                else:
                    for operation in approval['scope']['operations']:
                        check()
                        edit(conn,load(conn,session['id']),operation)
                editor_dispatch(conn, {'op': 'save', 'id': session['id'], 'mode': 'export', 'format': 'parquet', 'output': str(path)}, environment)
                check()
                output = register(path, True, [item['id']], approval=approval['id'], options={},editor_session=session['id'])
                approval['output'] = output['id']
                ledger.put('approval', approval, approval['id'])
                result = {'version': receipt(output), 'analysis_authorized': False, 'detail': 'Edit completed. No quality checks ran. Request separate analysis approval.'}
        elif op in ('query', 'schema', 'profile', 'images'):
            identities = args.get('versions') or [args['version']]
            if not isinstance(identities,list) or not 1<=len(identities)<=16:raise ValueError('Select 1 to 16 source versions')
            inputs = [source(identity) for identity in identities]
            from companion_sql import bind_query
            sql=args.get('sql','SELECT * FROM v0')
            execution_sql=bind_query(conn,inputs,sql)
            artifact = ledger.put('artifact', {'task': task_id, 'inputs': identities, 'edited': any(v['edited'] for v in inputs), 'sql': sql, 'operation': op, 'job': job_id,'created':time.time(),'result_kind':'diagnostic_analysis','source_status':[{'version':v['id'],'edited':v['edited']} for v in inputs]})
            if artifact['edited'] and op in ('query','profile','images'):
                ledger.note_file(Path(environment['workspace'])/'results'/job_id/'rows.parquet',artifact['id'])
            ledger.event({'type': 'query_submitted', 'artifact': artifact['id'], 'sql': sql, 'task': task_id})
            if op == 'schema':
                offset=max(0,min(100000,int(args.get('offset',0))));cursor=conn.execute('DESCRIBE '+execution_sql)
                for _ in range(offset):
                    if cursor.fetchone() is None:break
                columns=cursor.fetchmany(201)
                result = {'columns': [{'name': r[0], 'type': r[1]} for r in columns[:200]],'offset':offset,'next_offset':offset+min(200,len(columns)),'truncated':len(columns)>200, 'artifact': receipt(artifact)}
            elif op == 'images':
                options = dict(args.get('options', {}))
                if options.get('allow_private') and not task.get('allow_private_images'):
                    raise ValueError('Private image endpoints require local task authorization')
                if int(options.get('max_mb', 10)) > 10:
                    ledger.require(task_id, 'download', {'max_mb': int(options['max_mb']), 'version': identities[0]})
                from module_runtime import dispatch as module
                lineage={'inputs':identities,'edited':artifact['edited'],'task':task_id,'query_id':artifact['id']}
                artifact=ledger.put('artifact',{**artifact,'module_run':job_id,'parameters':args.get('options',{})},artifact['id'])
                result = module(conn, 'module_run', {'module': 'image_checker', 'sql': execution_sql, 'options': options}, job_id, {**environment,'companion_lineage':lineage})
                artifact['module_run'] = result['run']['id']
                from result_store import query
                from module_runtime import read_run, run_path
                record = read_run(environment['workspace'], result['run']['id'])
                report_path = run_path(environment['workspace'], record['id']) / record['report']
                retained = query(conn, {'sql': 'SELECT * FROM read_parquet(' + lit(report_path) + ')', 'retain_result': True, 'size': 10}, job_id, environment)
                artifact['result_id'] = retained['result_id']
                artifact['rows'] = retained['total_rows']
                from result_store import tag_lineage
                tag_lineage(environment['workspace'],retained['result_id'],lineage)
                ledger.put('artifact', artifact, artifact['id'])
                result = {'artifact': receipt(artifact), 'summary': result['run'].get('summary', {}), 'run_id': result['run']['id']}
            else:
                from result_store import query
                actual = 'SUMMARIZE ' + execution_sql if op == 'profile' else execution_sql
                if op == 'profile':
                    actual = 'SELECT * FROM (' + actual + ')'
                retained = query(conn, {'sql': actual, 'retain_result': True, 'size': 10}, job_id, environment)
                artifact['result_id'] = retained['result_id']
                artifact['rows'] = retained['total_rows']
                from result_store import tag_lineage
                tag_lineage(environment['workspace'],retained['result_id'],{'inputs':identities,'edited':artifact['edited'],'task':task_id,'query_id':artifact['id']})
                ledger.put('artifact', artifact, artifact['id'])
                result = {'artifact': receipt(artifact), 'detail': 'Full results retained locally; use preview for bounded values. SQL filters and TRY_CAST may exclude invalid values; this result alone is not a validation certificate.'}
        elif op.startswith('image_'):
            artifact=ledger.get('artifact',args['artifact'])
            if artifact['task']!=task_id or not artifact.get('module_run'):
                raise ValueError('Choose this task\'s image artifact')
            for identity in artifact['inputs']:
                source(identity)
            from module_runtime import dispatch as module, read_run, run_path
            run_id=artifact['module_run']
            if op=='image_pairs':
                result=module(conn,'module_manage',{'operation':'similarity_pairs','run_id':run_id,'offset':max(0,int(args.get('offset',0))),'decision':args.get('decision','all'),**({'sha256':args['sha256']} if args.get('sha256') else {})},job_id,environment)
            elif op=='image_merge':
                scope={'source_artifact':artifact['id'],'operation':'merge image annotations','destination':'New immutable Parquet copy','overwrite':False}
                approval=ledger.pending(task_id,'edit',scope)
                if approval['status']!='approved':
                    result=approval
                elif approval.get('output'):
                    result={'version':receipt(ledger.get('version',approval['output'])),'analysis_authorized':False}
                else:
                    if approval.get('started'):raise ValueError('Interrupted merge needs local review; no replay')
                    approval.update(started=True,job=job_id)
                    ledger.put('approval',approval,approval['id'])
                    path=ledger.root/(job_id+'.parquet')
                    ledger.put('pending_output',{'path':str(path),'edited':True,'parent':artifact['inputs'][0]},job_id)
                    merged=module(conn,'module_merge',{'run_id':run_id},job_id,environment)
                    conn.execute('COPY (SELECT * FROM '+q(merged['name'])+') TO '+lit(path)+' (FORMAT PARQUET,COMPRESSION ZSTD)')
                    output=register(path,True,artifact['inputs'],approval=approval['id'],options={})
                    ledger.put('approval',{**approval,'started':True,'output':output['id']},approval['id'])
                    result={'version':receipt(output),'analysis_authorized':False}
            elif op in ('image_recheck','image_rebuild','image_resume'):
                child=ledger.put('artifact',{**{k:v for k,v in artifact.items() if k not in ('id','result_id','rows')},'parent_artifact':artifact['id'],'job':job_id,'operation':op,'parameters':args,'created':time.time()})
                if op=='image_recheck':child=ledger.put('artifact',{**child,'module_run':job_id},child['id'])
                lineage={'inputs':artifact['inputs'],'edited':artifact['edited'],'task':task_id,'query_id':child['id']}
                module_env={**environment,'companion_lineage':lineage}
                if op=='image_recheck':
                    response=module(conn,'module_run',{'run_id':run_id,'recheck':args['mode'],'selected':args.get('selected',[]),'days':args.get('days',7)},job_id,module_env)
                    run_id=response['run']['id']
                elif op=='image_rebuild':
                    response=module(conn,'module_manage',{'run_id':run_id,'operation':'similarity_rebuild','options':args.get('options',{})},job_id,module_env)
                elif read_run(environment['workspace'],run_id)['status']!='completed':
                    response=module(conn,'module_run',{'run_id':run_id},job_id,module_env)
                record=read_run(environment['workspace'],run_id)
                from result_store import query
                report_path=run_path(environment['workspace'],run_id)/record['report']
                if artifact['edited']:ledger.note_file(Path(environment['workspace'])/'results'/job_id/'rows.parquet',child['id'])
                retained=query(conn,{'sql':'SELECT * FROM read_parquet('+lit(report_path)+')','retain_result':True,'size':10},job_id,environment)
                child=ledger.put('artifact',{**child,'module_run':run_id,'result_id':retained['result_id'],'rows':retained['total_rows']},child['id'])
                from result_store import tag_lineage
                tag_lineage(environment['workspace'],retained['result_id'],{'inputs':artifact['inputs'],'edited':artifact['edited'],'task':task_id,'query_id':child['id']})
                result={'artifact':receipt(child),'summary':record.get('summary',{})}
            else:
                raise ValueError('Unsupported image action')
        elif op in ('preview', 'export','cell'):
            artifact = ledger.get('artifact', args['artifact'])
            if artifact['task'] != task_id:
                raise ValueError('Artifact belongs to another task')
            for identity in artifact['inputs']:
                source(identity)
            if 'result_id' not in artifact:
                raise ValueError('This artifact has no retained query result')
            if op == 'export':
                from result_store import export
                target = destination(args['output'], task['roots'], environment['workspace'])
                ledger.put('pending_output', {'path':str(target),'edited':artifact['edited'],'parent':artifact['inputs'][0]}, job_id)
                result = export(conn, {'result_id': artifact['result_id'], 'format': args['format'], 'output': str(target)}, job_id, environment['workspace'])
                register(target, artifact['edited'], artifact['inputs'], options={}, exported_artifact=artifact['id'])
            elif op=='cell':
                from result_store import metadata
                folder,info=metadata(environment['workspace'],artifact['result_id'])
                columns={r[0] for r in conn.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(folder/'rows.parquet')]).fetchall()}
                column=args['column'];row=int(args['row']);offset=max(0,int(args.get('offset_chars',0)))
                if column not in columns or column==info['order_column'] or row<1:raise ValueError('Choose an existing user column and a positive one-based result row')
                cap=max(1,(task.get('response_bytes',65536)-8192)//12)
                count=min(max(1,int(args.get('chars',512))),cap)
                expression='CAST('+q(column)+' AS VARCHAR)'
                value=conn.execute('SELECT substring('+expression+',?,?),length('+expression+'),octet_length(encode('+expression+')) FROM read_parquet(?) WHERE '+q(info['order_column'])+'=?',[offset+1,count,str(folder/'rows.parquet'),row]).fetchone()
                if value is None:raise ValueError('Result row does not exist')
                result={'artifact':artifact['id'],'inputs':artifact['inputs'],'edited':artifact['edited'],'row':row,'column':column,'value':value[0],'offset_chars':offset,'next_offset_chars':offset+len(value[0] or ''),'total_characters':value[1],'total_utf8_bytes':value[2],'truncated':offset+len(value[0] or '')<(value[1] or 0)}
            else:
                from result_store import metadata
                folder, info = metadata(environment['workspace'], artifact['result_id'])
                # SQL substring bounds large VARCHAR/BLOB values before Python conversion.
                columns = conn.execute('DESCRIBE SELECT * FROM read_parquet(?)', [str(folder / 'rows.parquet')]).fetchall()
                fields = [r[0] for r in columns if r[0] != info['order_column']][:120]
                projection = ','.join('left(CAST(' + q(c) + ' AS VARCHAR),512)' for c in fields)
                clipping=' OR '.join('coalesce(length(CAST('+q(c)+' AS VARCHAR))>512,false)' for c in fields) or 'false'
                row_limit = task.get('response_rows',200)
                byte_limit = int(task.get('response_bytes',65536)*.36)
                cursor = conn.execute('SELECT ' + projection + ',('+clipping+') FROM read_parquet(?) ORDER BY ' + q(info['order_column']) + ' LIMIT ? OFFSET ?', [str(folder / 'rows.parquet'), min(row_limit, max(1, int(args.get('rows', 200)))), max(0, int(args.get('offset', 0)))])
                rows = [];clipped=False
                while len(rows) < row_limit:
                    row = cursor.fetchone()
                    if row is None:
                        break
                    candidate = {'artifact': artifact['id'], 'columns': fields, 'rows': rows + [row[:-1]], 'truncated': True}
                    # Reserve room for textual escaping and response envelope.
                    if len(json.dumps(candidate, ensure_ascii=False).encode()) > byte_limit:
                        break
                    rows.append(row[:-1]);clipped=clipped or bool(row[-1])
                next_offset=max(0,int(args.get('offset',0)))+len(rows);omitted=max(0,len(columns)-1-len(fields));more=next_offset<info['rows']
                result = {'artifact': receipt(artifact), 'columns': fields,'total_columns':len(columns)-1,'omitted_columns':omitted, 'rows': rows, 'next_offset':next_offset, 'truncated':more or clipped or omitted>0,'rows_truncated':more,'cell_values_truncated':clipped, 'cell_preview_characters': 512}
        else:
            raise ValueError('Unsupported companion operation')
        if op in ('images','image_recheck','image_resume','image_merge','image_retention') and 'catalog' not in result:
            from engine import catalog
            result['catalog']=catalog(conn)
        ledger.event({'type': 'completed', 'job': job_id, 'operation': op, 'task': task_id})
        return result
    except BaseException as error:
        ledger.event({'type': 'failed', 'job': job_id, 'task': task_id, 'error': str(error)[:1000]})
        raise
