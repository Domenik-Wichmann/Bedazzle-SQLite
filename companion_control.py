"""Trusted local GUI controller. This input channel is never exposed over MCP/HTTP."""
import hashlib
import json
import time
from pathlib import Path
from companion_store import Ledger
from workspaces import Workspaces


def service_status(home):
    import urllib.request,urllib.error
    from urllib.parse import urlparse
    file=Path(home)/'server.json'
    if not file.exists():return {'reachable':False,'unknown':False}
    try:
        session=json.loads(file.read_text('utf-8'));parts=urlparse(session['url'])
        if parts.scheme!='http' or parts.hostname!='127.0.0.1' or parts.path or parts.username:return {'reachable':False,'unknown':True}
        request=urllib.request.Request(session['url']+'/api/bootstrap',headers={'X-Workbench-Token':session['token']})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=1) as response:
            return {'reachable':True,'unknown':False,**json.load(response)}
    except urllib.error.URLError as error:
        return {'reachable':False,'unknown':not isinstance(error.reason,ConnectionRefusedError)}
    except (OSError,ValueError,KeyError):return {'reachable':False,'unknown':True}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()


def describe_approval(ledger,value):
    scope=value['scope'];ids=list(scope.get('versions',[]))
    artifact=scope.get('artifact') or scope.get('source_artifact')
    if artifact:
        try:ids.extend(ledger.get('artifact',artifact)['inputs'])
        except ValueError:pass
    ids.extend(scope[k] for k in ('source','version','target_version') if scope.get(k))
    versions=[]
    for identity in dict.fromkeys(ids):
        try:item=ledger.get('version',identity)
        except ValueError:continue
        versions.append({k:item[k] for k in ('id','path','sha256','edited','parents','created','approval','original_path','workspace_table') if k in item})
    result={**value,'fingerprint':fingerprint(value),'version_details':versions}
    if value['purpose'] in ('edit','transform') and not scope.get('overwrite'):
        result['new_copy_folder']=str(ledger.root)
    return result


def execute(request):
    home=Path(request['workspace']).expanduser().resolve()
    registry=Workspaces(home);workspace=registry.path();ledger=Ledger(workspace)
    action=request['action']
    if request.get('expected_workspace') and request['expected_workspace']!=str(workspace):
        raise ValueError('The selected workspace changed. Refresh before deciding.')
    if action=='restart':
        import subprocess,sys,os
        import urllib.request
        import urllib.error,getpass
        from urllib.parse import urlparse
        session_file=home/'server.json'
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        if session_file.exists():
            session=json.loads(session_file.read_text('utf-8'));parsed=urlparse(session['url'])
            if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.path or parsed.username:raise ValueError('Invalid local service address')
            def call(path,body=None):
                payload=json.dumps(body).encode() if body is not None else None
                req=urllib.request.Request(session['url']+path,data=payload,headers={'X-Workbench-Token':session['token'],'Content-Type':'application/json'})
                with opener.open(req,timeout=5) as response:return json.load(response)
            try:
                boot=call('/api/bootstrap')
            except urllib.error.URLError as error:
                if isinstance(error.reason,ConnectionRefusedError):boot=None
                else:raise ValueError('Cannot verify that the service is idle. No restart was performed; inspect its log and retry.') from error
            except OSError as error:
                raise ValueError('Cannot verify that the service is idle. No restart was performed.') from error
            if boot:
                if boot.get('runtime_user') and boot['runtime_user'].casefold()!=getpass.getuser().casefold():raise ValueError('Service belongs to another Windows account. Restart it through that account; this helper will not stop it.')
                if Path(boot['workspace']).resolve()!=workspace:raise ValueError('Server selected workspace changed. Refresh first.')
                if boot.get('active_job'):raise ValueError('Finish or cancel the running job before restarting. Nothing was stopped.')
                call('/api/shutdown',{})
                for _ in range(100):
                    if not session_file.exists():break
                    time.sleep(.1)
                if session_file.exists():raise ValueError('Previous service is still stopping; retry after it exits')
        with (home/'companion-service.log').open('ab') as log:
            subprocess.Popen([sys.executable,str(Path(__file__).resolve().parent/'workbench.py'),'--workspace',str(home),'--no-browser'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        return {'ok':True,'message':'Background engine restart requested. No main window was opened.'}
    if action=='list':
        approvals=[describe_approval(ledger,v) for v in ledger.list('approval',10000) if v['status']=='pending']
        status=service_status(home)
        interrupted=[describe_approval(ledger,v) for v in ledger.list('approval',10000) if v['status']=='approved' and v.get('started') and not v.get('output') and not(status.get('active_job') and (not v.get('job') or status['active_job']==v['job']))]
        return {'workspace':str(workspace),'tasks':ledger.list('task',200),'approvals':approvals+interrupted}
    if action=='task':
        roots=request['folders'];scope=request['scope']
        if not roots or not isinstance(scope,str) or not scope.strip():raise ValueError('Choose at least one folder and describe the task')
        roots=[str(Path(p).resolve(strict=True)) for p in roots]
        if any(not Path(p).is_dir() for p in roots):raise ValueError('Permissions must name folders')
        value=ledger.put('task',{'roots':roots,'scope':scope.strip(),'active':True,'budget':1048576,'transferred':0,'allow_private_images':request.get('private_images') is True,'allow_private_downloads':request.get('private_downloads') is True,'allow_workspace_data':request.get('workspace_data') is True})
        if not registry.file.exists():registry.save()
    elif action=='review':
        if request['decision'] not in ('approved','denied'):raise ValueError('Invalid decision')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT body FROM records WHERE kind='approval' AND id=?",[request['id']]).fetchone()
            if not row:raise ValueError('Unknown approval request')
            current=json.loads(row[0])
            if current['status']!='pending' or fingerprint(current)!=request['fingerprint']:raise ValueError('Request changed or was already decided. Refresh and review again.')
            value={**current,'status':request['decision'],'decided_at':time.time(),'surface':'local_window'}
            db.execute("UPDATE records SET body=? WHERE kind='approval' AND id=?",[json.dumps(value),current['id']])
    elif action=='close':
        current=ledger.task(request['task']);value=ledger.put('task',{**current,'active':False},current['id'])
    elif action=='resolve':
        status=service_status(home)
        if status['unknown']:raise ValueError('Cannot confirm that the operation stopped. Finish/cancel the job or stop the backend, then review again.')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT body FROM records WHERE kind='approval' AND id=?",[request['id']]).fetchone()
            if not row:raise ValueError('Unknown approval')
            current=json.loads(row[0])
            if status.get('active_job') and (not current.get('job') or status['active_job']==current['job']):raise ValueError('This operation is still running. Finish or cancel it before resolving.')
            if current['status']!='approved' or not current.get('started') or current.get('output') or fingerprint(current)!=request['fingerprint']:
                raise ValueError('Only an unchanged interrupted request can be resolved')
            abandoned={**current,'status':'abandoned','resolution':'Reviewed locally; no automatic replay'}
            db.execute("UPDATE records SET body=? WHERE kind='approval' AND id=?",[json.dumps(abandoned),current['id']])
        value=ledger.put('approval',{'task':current['task'],'purpose':current['purpose'],'scope':current['scope'],'status':'pending','retry_of':current['id']})
    elif action=='transfer':
        budget=int(request['bytes']);rows=int(request.get('rows',200));per_call=int(request.get('response_bytes',65536))
        if not 1<=rows<=10000 or not 1024<=per_call<=4194304:raise ValueError('Choose 1–10000 rows and 1 KiB–4 MiB per response')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT body FROM records WHERE kind='task' AND id=?",[request['task']]).fetchone()
            if not row:raise ValueError('Unknown task')
            current=json.loads(row[0])
            if not current['active'] or budget<=current.get('budget',1048576) or not request.get('reason'):raise ValueError('Specify a larger cumulative budget and its reason for an active task')
            value={**current,'budget':budget,'response_rows':rows,'response_bytes':per_call,'transfer_reason':request['reason']}
            db.execute("UPDATE records SET body=? WHERE kind='task' AND id=?",[json.dumps(value),current['id']])
    else:raise ValueError('Unknown local control action')
    ledger.event({'type':'local_authorization','command':action,'id':value['id']})
    return {'ok':True,'id':value['id'],'workspace':str(workspace)}


if __name__=='__main__':
    import sys
    sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
    try:print(json.dumps(execute(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False));raise SystemExit(1)
