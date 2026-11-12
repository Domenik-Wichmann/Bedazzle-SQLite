"""Durable companion identities, approvals and transfer accounting. No MCP approval writer."""
import contextlib
import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path


def key():
    return uuid.uuid4().hex


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


class Ledger:
    def __init__(self, workspace):
        self.root = Path(workspace).resolve() / 'companion'
        self.root.mkdir(parents=True, exist_ok=True)
        home = self.root.parent
        if home.parent.name=='workspaces' and len(home.name)==32:
            home=home.parent.parent
        self.provenance_file=home/'companion-provenance.sqlite3'
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))')
            columns = db.execute('PRAGMA table_info(records)').fetchall()
            if next(c for c in columns if c[1]=='kind')[5] == 0:
                db.execute('ALTER TABLE records RENAME TO records_legacy')
                db.execute('CREATE TABLE records (kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))')
                db.execute('INSERT INTO records SELECT kind,id,body FROM records_legacy')
                db.execute('DROP TABLE records_legacy')
            db.execute('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)')
        with contextlib.closing(sqlite3.connect(self.provenance_file,timeout=30)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS edited (sha TEXT PRIMARY KEY, version TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS pending (path TEXT PRIMARY KEY, parent TEXT)')

    def note_content(self, sha, version, edited):
        if edited:
            with contextlib.closing(sqlite3.connect(self.provenance_file,timeout=30)) as db, db:
                db.execute('INSERT OR IGNORE INTO edited VALUES (?,?)',(sha,version))

    def edited_content(self, sha):
        with contextlib.closing(sqlite3.connect(self.provenance_file,timeout=30)) as db, db:
            row=db.execute('SELECT version FROM edited WHERE sha=?',(sha,)).fetchone()
        return row[0] if row else None

    def note_file(self,path,parent,edited=True):
        if not edited:return
        path=Path(path).resolve()
        with contextlib.closing(sqlite3.connect(self.provenance_file,timeout=30)) as db, db:
            db.execute('INSERT OR REPLACE INTO pending VALUES (?,?)',(str(path),parent))
        if path.is_file():self.note_content(digest(path),parent,True)

    def pending_parent(self, sha):
        with contextlib.closing(sqlite3.connect(self.provenance_file,timeout=30)) as db:
            for path,parent in db.execute('SELECT path,parent FROM pending'):
                if Path(path).is_file() and digest(path)==sha:
                    return parent
        return None

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.root / 'ledger.sqlite3', timeout=30)
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, kind, body, identity=None):
        identity = identity or key()
        body = {**body, 'id': identity}
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?)', (kind, identity, json.dumps(body)))
        if kind=='pending_output' and body.get('edited'):
            with contextlib.closing(sqlite3.connect(self.provenance_file,timeout=30)) as db, db:
                db.execute('INSERT OR REPLACE INTO pending VALUES (?,?)',(body['path'],body['parent']))
        return body

    def get(self, kind, identity):
        with self.db() as db:
            row = db.execute('SELECT body FROM records WHERE kind=? AND id=?', (kind, identity)).fetchone()
        if not row:
            raise ValueError('Unknown ' + kind + ' identity')
        return json.loads(row[0])

    def list(self, kind, limit=100):
        with self.db() as db:
            return [json.loads(r[0]) for r in db.execute('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ?', (kind, limit))]

    def event(self, value):
        with self.db() as db:
            db.execute('INSERT INTO events(body) VALUES (?)', (json.dumps({**value, 'time': time.time()}),))

    def events(self, after=0):
        with self.db() as db:
            return [{'seq': r[0], **json.loads(r[1])} for r in db.execute('SELECT seq,body FROM events WHERE seq>? ORDER BY seq LIMIT 50', (int(after),))]

    def task(self, identity):
        task = self.get('task', identity)
        if not task.get('active'):
            raise ValueError('Task is closed; a human must start a new task locally.')
        return task

    def pending(self, task, purpose, scope):
        for item in self.list('approval', 10000):
            if item['task'] == task and item['purpose'] == purpose and item['scope'] == scope:
                return item
        item = self.put('approval', {'task': task, 'purpose': purpose, 'scope': scope, 'status': 'pending'})
        self.event({'type': 'approval_pending', 'approval_id': item['id'], 'task': task})
        return item

    def require(self, task, purpose, scope):
        item = self.pending(task, purpose, scope)
        if item['status'] != 'approved':
            raise ValueError('Approval ' + item['id'] + ' is ' + item['status'] + '; use the local approval helper.')
        return item

    def response(self, task, value):
        limits = self.task(task)
        # Account the actual MCP result object, including both textual and structured data.
        receipt = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False, default=str)}]}
        if isinstance(value,dict) and value.get('error') and not value.get('id'):receipt['isError']=True
        raw = json.dumps(receipt, ensure_ascii=False).encode('utf-8')
        if len(raw) > limits.get('response_bytes', 65536):
            saved = self.put('response_overflow', {'task':task,'value':value})
            references={}
            if isinstance(value,dict):
                result=value.get('result',value)
                if isinstance(result,dict):
                    for kind in ('artifact','version'):
                        if isinstance(result.get(kind),dict):references[kind]=result[kind].get('id')
                        elif isinstance(result.get(kind),str):references[kind]=result[kind]
                    if result.get('purpose') and result.get('id'):references['approval']=result['id']
                if value.get('id'):references['job_or_record']=value['id']
            value = {'truncated': True, 'local_response_reference': saved['id'],'references':references,'status':value.get('status') if isinstance(value,dict) else None, 'detail': 'Response exceeds the approved per-call limit; request a narrower view.'}
            receipt = {'content': [{'type': 'text', 'text': json.dumps(value)}]}
            raw = json.dumps(receipt).encode()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT body FROM records WHERE kind=? AND id=?', ('task', task)).fetchone()
            if not row:
                raise ValueError('Unknown task')
            item = json.loads(row[0])
            if not item.get('active'):
                return {'content':[{'type':'text','text':'Task was closed. No data was transferred.'}],'isError':True}
            if len(raw)>item.get('response_bytes',65536):
                return {'content':[{'type':'text','text':'Response limit changed. Request a narrower preview.'}],'isError':True}
            used = item.get('transferred', 0)
            if used + len(raw) > item.get('budget', 1048576):
                return {'content': [{'type': 'text', 'text': 'Task transfer budget exhausted. Request a local human budget increase.'}], 'isError': True}
            item['transferred'] = used + len(raw)
            db.execute("UPDATE records SET body=? WHERE kind='task' AND id=?", (json.dumps(item), task))
        self.put('response', {'task': task, 'response': receipt, 'bytes': len(raw), 'created': time.time()})
        return receipt
