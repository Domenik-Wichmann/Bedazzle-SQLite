"""Local stdio MCP adapter. All DuckDB work goes through Bedazzle's owner service."""
import argparse
import json
import os
import getpass
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error
from urllib.parse import urlparse
from companion_store import Ledger
SERVER_VERSION='0.2.0'

PROPERTIES = {
    'capabilities': {},
    'ingest_url': {'url':'string','output':'string','max_bytes':'integer','timeout':'integer','reason':'string'},
    'datasets': {}, 'snapshot_dataset': {'name':'string'},
    'propose_transform': {'versions':'array','sql':'string','reason':'string'},
    'apply_transform': {'approval':'string'},
    'propose_writeback': {'version':'string','target_version':'string','keys':'array'},
    'apply_writeback': {'approval':'string'},
    'image_decide': {'artifact':'string','pair_id':'integer','decision':'string','note':'string'},
    'image_retention': {'artifact':'string','operation':'string'},
    'charts': {}, 'chart_save': {'artifact':'string','config':'object'},
    'chart_preview': {'artifact':'string','config':'object'},
    'browse': {'path': 'string'}, 'import': {'path': 'string', 'options': 'object'},
    'versions': {}, 'approvals': {}, 'request_analysis': {'version': 'string'},
    'artifacts': {},
    'lineage': {'version':'string'},
    'propose_edit': {'version': 'string', 'changes': 'array', 'operations': 'array','keys':'array'}, 'apply_edit': {'approval': 'string'},
    'query': {'versions': 'array', 'sql': 'string'}, 'schema': {'version': 'string','offset':'integer'},
    'profile': {'version': 'string'}, 'images': {'version': 'string', 'options': 'object'},
    'preview': {'artifact': 'string', 'offset': 'integer', 'rows': 'integer'},
    'cell': {'artifact':'string','row':'integer','column':'string','offset_chars':'integer','chars':'integer'},
    'export': {'artifact': 'string', 'output': 'string', 'format': 'string'},
    'image_recheck': {'artifact':'string','mode':'string','selected':'array','days':'integer'},
    'image_resume': {'artifact':'string'},
    'image_pairs': {'artifact':'string','offset':'integer','decision':'string','sha256':'string'},
    'image_rebuild': {'artifact':'string','options':'object'},
    'image_merge': {'artifact':'string'},
}
OPTIONAL = {'options', 'offset', 'rows', 'changes', 'operations', 'selected', 'days','note','max_bytes','timeout','offset_chars','chars'}
OP_OPTIONAL={'image_pairs':{'decision','sha256'},'propose_edit':{'keys'}}


def tools_list():
    result = []
    for name, properties in PROPERTIES.items():
        props = {'task': {'type': 'string'}, **{k: {'type': t} for k, t in properties.items()}}
        for prop in props.values():
            if prop['type'] == 'array':
                prop['items'] = {'type': 'object'} if name in ('propose_edit','image_recheck') else {'type': 'string'}
        if name == 'propose_edit':
            props['keys'].update({'items':{'type':'string'},'description':'Prefer explicit unique, non-NULL record key columns for cell changes. Row selectors otherwise refer to immutable source order, never sorted preview positions.'})
            value_type={'type':['string','number','boolean','null']}
            props['changes']['items']={'oneOf':[{'type':'object','properties':{'row':{'type':'integer','minimum':1},'column':{'type':'string'},'value':value_type,'expected':value_type},'required':['row','column','value'],'additionalProperties':False},{'type':'object','properties':{'key':{'type':'object','additionalProperties':value_type},'column':{'type':'string'},'value':value_type,'expected':value_type},'required':['key','column','value'],'additionalProperties':False}]}
            props['operations']['description']='Alternative to changes: approved batch of existing editor operations. op is set/replace/delete/add; fields are column/value/search/find/replacement/rows as appropriate.'
        if name == 'images':
            props['options'].update({'properties':{'url_columns':{'type':'array','items':{'type':'string'}},'allow_private':{'type':'boolean'},'max_mb':{'type':'integer','minimum':1,'maximum':50}},'description':'Existing image checker options. url_columns selects source URL fields; other options follow the installed checker manifest.'})
        descriptions={
            'import':'Read-only import: preserve an untouched immutable snapshot. This is ordinary inspection, not a data edit; no edit approval is needed. Default CSV text types preserve source values.',
            'query':'Run whole-dataset read-only SQL locally. TRIM/LIKE/CASE diagnostics, nonrecursive CTEs, windows, joins and bounded pivots are supported. Input aliases are v0, v1, etc. Corrected row projections use propose_transform.',
            'profile':'Profile all authorized rows. Text min/max are lexical and numeric estimates are not data-quality verdicts. Text-preserved CSV prices are not automatically defects.',
            'propose_edit':'Propose a bounded repair copy. Prefer keys plus keyed cell changes and expected original values; one-based row identities refer to source order, never a sorted or filtered preview. Local edit approval and later separate analysis approval are required.',
            'propose_transform':'Propose a SQL repair copy with explicit inputs and SQL; local edit approval is required before apply_transform. New output remains blocked until a separate post-creation analysis approval.',
            'propose_writeback':'Propose overwriting a selected original file with an edited version. Explicit unique keys, unchanged original fingerprint, recoverable backup and local overwrite approval are mandatory.',
            'image_retention':'Propose releasing retained input or deleting a module run. Requires separate local confirmation; never silently removes original source snapshots or retained companion results.',
            'image_decide':'Propose a similarity-review annotation and note. Local approval required; changes metadata, not source rows or image validity verdicts.'}
        result.append({'name': 'bedazzle_' + name, 'description': descriptions.get(name,'Bedazzle '+name)+'. Returns a local job ID; poll bedazzle_job. Edited inputs require separate analysis approval.', 'inputSchema': {'type': 'object', 'properties': props, 'required': ['task'] + [k for k in properties if k not in OPTIONAL|OP_OPTIONAL.get(name,set())], 'additionalProperties': False}})
    for name, props in {'tasks': {}, 'job': {'task': {'type': 'string'}, 'job': {'type': 'string'}}, 'cancel': {'task': {'type': 'string'}, 'job': {'type': 'string'}}, 'open': {'artifact': {'type': 'string'}, 'task': {'type': 'string'}}}.items():
        result.append({'name': 'bedazzle_' + name, 'description': 'Bedazzle ' + name + ('; explicitly opens the browser, optionally showing an artifact' if name == 'open' else ''), 'inputSchema': {'type': 'object', 'properties': props, 'required': ['task'] if name=='open' else list(props), 'additionalProperties': False}})
    return result


class Client:
    def __init__(self, workspace):
        self.home=Path(workspace).resolve()
        self.workspace = self.home
        self.session = None
        self.selected = None

    def connect(self):
        file = self.home / 'server.json'
        def read():
            session = json.loads(file.read_text())
            parsed = urlparse(session['url'])
            if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path or parsed.username:
                raise ValueError('Invalid local service address')
            self.session = session
            boot = self.api('/api/bootstrap',ignore_workspace=True)
            if boot.get('runtime_user') and boot['runtime_user'].casefold()!=getpass.getuser().casefold():
                self.session=None
                raise RuntimeError('Bedazzle is running under another Windows account. Start it under your own account; no data work was submitted.')
            if boot.get('companion_version')!=SERVER_VERSION:
                self.session=None
                raise RuntimeError('Bedazzle background engine needs a restart after this update. Open Start Bedazzle approvals.cmd, then Tasks and transfer > Restart background engine. Finish or cancel running jobs first. No application reinstall is needed.')
            if self.selected and boot['workspaces']['selected']!=self.selected:
                self.session=None
                raise RuntimeError('The selected workspace changed. Reconnect the extension to select a different workspace; existing task permissions were not transferred.')
            self.workspace = Path(boot['workspace']).resolve()
            self.selected = boot['workspaces']['selected']
        try:
            read()
            return
        except (OSError, ValueError, KeyError):
            pass
        root = Path(__file__).resolve().parent
        log = self.home / 'companion-service.log'
        self.home.mkdir(parents=True, exist_ok=True)
        with log.open('ab') as stream:
            subprocess.Popen([sys.executable, str(root / 'workbench.py'), '--workspace', str(self.home), '--no-browser'], stdout=stream, stderr=stream, stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        for _ in range(100):
            time.sleep(.1)
            try:
                read()
                return
            except (OSError, ValueError, KeyError):
                pass
        self.session=None
        raise ValueError('Headless service failed to start; inspect companion-service.log')

    def api(self, path, body=None,ignore_workspace=False):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.session['url'] + path, data=data, headers={'X-Workbench-Token': self.session['token'], 'Content-Type': 'application/json'})
        if self.selected and not ignore_workspace:
            request.add_header('X-Workbench-Workspace', self.selected)
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:error.msg=json.loads(error.read(4096)).get('error',error.reason)
            except (ValueError,OSError):pass
            finally:error.close()
            raise

    def call(self, name, args):
        if self.session is not None:
            try:current=json.loads((self.home/'server.json').read_text('utf-8'))
            except (OSError,ValueError):current={}
            if any(current.get(k)!=self.session.get(k) for k in ('url','token')):self.session=None
        if self.session is None:
            self.connect()
        schemas = {item['name']: item['inputSchema'] for item in tools_list()}
        if name not in schemas:
            raise ValueError('Unknown tool')
        schema = schemas[name]
        if set(args) - set(schema['properties']) or set(schema['required']) - set(args):
            raise ValueError('Unexpected or missing arguments')
        types = {'string':str,'integer':int,'object':dict,'array':list}
        for name_arg, value in args.items():
            expected = schema['properties'][name_arg]['type']
            if not isinstance(value, types[expected]) or (expected=='integer' and isinstance(value,bool)):
                raise ValueError('Invalid argument type: ' + name_arg)
        op = name.removeprefix('bedazzle_')
        ledger = Ledger(self.workspace)
        if op == 'tasks':
            value = {'tasks': [{'id': t['id'], 'scope': t['scope'], 'active': t['active'],'permitted_folders':t['roots'],'inspection_allowed':True,'remaining_transfer_bytes':max(0,t.get('budget',1048576)-t.get('transferred',0)),'edit_approval':'separate local action','edited_analysis_approval':'new local action after creation'} for t in ledger.list('task', 20) if t['active']]}
            if value['tasks']:
                return ledger.response(value['tasks'][0]['id'], value)
            return {'content': [{'type': 'text', 'text': 'No locally authorized tasks. Use companion_local.py to create one.'}]}
        task = args['task']
        ledger.task(task)
        try:
            if op in ('job', 'cancel'):
                owner = ledger.get('job', args['job'])
                if owner['task'] != task:
                    raise ValueError('Job belongs to a different task')
                if op == 'cancel':
                    value = self.api('/api/companion-cancel', {'id': args['job']})
                else:
                    try:
                        value = self.api('/api/jobs/' + args['job'])
                        # Never return payloads, memory settings or unbounded worker output.
                        value = {k: value[k] for k in ('id', 'status', 'finished', 'error', 'activity', 'result','durability_warning','cancellation_note') if k in value}
                        if isinstance(value.get('result'),dict):
                            value['result']={k:v for k,v in value['result'].items() if k!='catalog'}
                        ledger.put('job', {**owner, 'last_status': value}, owner['id'])
                    except urllib.error.HTTPError as error:
                        if error.code not in (400,404):raise
                        previous = owner.get('last_status', {})
                        value = previous if previous.get('finished') else {'status': 'interrupted', 'finished': True, 'detail': 'Service restarted or job expired. No operation was replayed. Inspect saved artifacts.'}
                        ledger.put('job',{**owner,'last_status':value},owner['id'])
            elif op == 'open':
                import webbrowser
                artifact = ledger.get('artifact', args['artifact']) if args.get('artifact') else None
                if artifact:
                    if artifact['task'] != task:
                        raise ValueError('Artifact belongs to another task')
                    if not artifact.get('result_id'):raise ValueError('This artifact has no retained rows to show. Inspect its job metadata, or open Bedazzle without an artifact.')
                    ledger.event({'type': 'show', 'artifact': artifact['id'], 'task': task})
                show='?companion_show='+artifact['id'] if artifact else ''
                webbrowser.open(self.session['url'] + '/'+show+'#' + self.session['token'])
                value = {'opened': True, 'artifact': artifact['id'] if artifact else None}
            else:
                value = self.api('/api/jobs', {'action': 'companion', 'payload': {'operation': op, 'task': task, 'arguments': {k: v for k, v in args.items() if k != 'task'}}})
                try:ledger.get('job',value['id'])
                except ValueError:ledger.put('job', {'task': task, 'operation': op}, value['id'])
        except Exception as error:
            value = {'error': str(error)[:1000]}
        if isinstance(value,dict) and isinstance(value.get('result'),dict):
            value['result']={k:v for k,v in value['result'].items() if k!='catalog'}
        return ledger.response(task, value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True)
    args = parser.parse_args()
    client = Client(args.workspace)
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        identity = None
        try:
            if len(line.encode()) > 1024 * 1024:
                raise ValueError('Request too large')
            message = json.loads(line)
            identity = message.get('id')
            method = message.get('method')
            if identity is None:
                continue
            if method == 'initialize':
                result = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'bedazzle-local', 'version': SERVER_VERSION}}
            elif method == 'ping':
                result = {}
            elif method == 'tools/list':
                result = {'tools': tools_list()}
            elif method == 'tools/call':
                params = message['params']
                try:result = client.call(params['name'], params.get('arguments', {}))
                except (RuntimeError,OSError) as error:
                    result={'content':[{'type':'text','text':json.dumps({'error':str(error)[:1000]})}],'isError':True}
            else:
                print(json.dumps({'jsonrpc':'2.0','id':identity,'error':{'code':-32601,'message':'Method not found'}}),flush=True)
                continue
            output = {'jsonrpc': '2.0', 'id': identity, 'result': result}
        except Exception as error:
            output = {'jsonrpc': '2.0', 'id': identity, 'error': {'code': -32602, 'message': str(error)[:1000]}}
        print(json.dumps(output, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
