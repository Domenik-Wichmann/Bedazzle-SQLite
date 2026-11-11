"""Small, local workspace registry. Each workspace owns its own databases."""
import json
import uuid
import time
import sqlite3
from contextlib import closing
import json as _json
from pathlib import Path


class Workspaces:
    def __init__(self, home):
        self.home = Path(home).resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.file = self.home / 'workspaces.json'
        self.data = json.loads(self.file.read_text('utf-8')) if self.file.exists() else {
            'selected': 'primary', 'items': [{'id': 'primary', 'name': 'My workspace'}]}

    def path(self, key=None):
        key = key or self.data['selected']
        if not any(item['id'] == key for item in self.data['items']):
            raise ValueError('Choose an existing workspace.')
        if key != 'primary' and (len(key) != 32 or any(c not in '0123456789abcdef' for c in key)):
            raise ValueError('Invalid workspace identifier.')
        return self.home if key == 'primary' else self.home / 'workspaces' / key

    def save(self):
        temporary = self.file.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.data, indent=2), encoding='utf-8')
        temporary.replace(self.file)

    def create(self, name):
        name = str(name).strip()
        if not name or len(name) > 80 or any(ord(c) < 32 for c in name):
            raise ValueError('Give the workspace a name between 1 and 80 characters.')
        if any(item['name'].casefold() == name.casefold() for item in self.data['items']):
            raise ValueError('A workspace already has that name.')
        key = uuid.uuid4().hex
        self.data['items'].append({'id': key, 'name': name,'created':time.time()})
        self.path(key).mkdir(parents=True, exist_ok=True)
        self.save()
        return key

    def select(self, key):
        self.path(key)
        self.data['selected'] = key
        self.save()

    def rename(self,key,name):
        self.path(key);name=str(name).strip()
        if not name or len(name)>80 or any(ord(c)<32 for c in name):raise ValueError('Choose a workspace name of 1–80 characters.')
        if any(i['id']!=key and i['name'].casefold()==name.casefold() for i in self.data['items']):raise ValueError('That workspace name is already used.')
        next(i for i in self.data['items'] if i['id']==key)['name']=name;self.save()

    def overview(self):
        result=[]
        for item in self.data['items']:
            file=self.path(item['id'])/'preferences.sqlite3';stats={'datasets':0,'queries':0,'recent_queries':0,'source_bytes':0}
            modified=item.get('created',self.home.stat().st_ctime)
            if file.exists():
                modified=file.stat().st_mtime
                try:
                    with closing(sqlite3.connect(file.as_uri()+'?mode=ro',uri=True)) as db:
                        row=db.execute("SELECT value FROM kv WHERE key='catalog'").fetchone();catalog=_json.loads(row[0]) if row else []
                        stats.update(datasets=len(catalog),queries=db.execute('SELECT count(*) FROM saved').fetchone()[0],recent_queries=db.execute('SELECT count(*) FROM history').fetchone()[0],source_bytes=sum(i.get('bytes',0) for i in catalog))
                except (sqlite3.Error,ValueError):stats['unavailable']=True
            result.append({**item,**stats,'last_activity':modified,'created':item.get('created',file.stat().st_ctime if file.exists() else modified)})
        return {'selected':self.data['selected'],'items':result,'archived':[{k:v for k,v in i.items() if k!='archive_path'} for i in self.data.get('archived',[])]}

    def archive(self,key):
        original=json.loads(json.dumps(self.data));moved=False
        source=self.path(key).resolve();item=next(i for i in self.data['items'] if i['id']==key)
        if len(self.data['items'])==1:self.create('New workspace' if item['name']!='New workspace' else 'New workspace 2')
        if key!='primary':
            parent=(self.home/'workspaces').resolve();archive=(self.home/'archive').resolve();archive.mkdir(exist_ok=True)
            target=archive/key
            if not source.is_relative_to(self.home) or not archive.is_relative_to(self.home) or source.parent!=parent or source.name!=key or target.resolve().parent!=archive:raise ValueError('Workspace path is outside managed storage.')
            if source.exists():source.rename(target);moved=True
        self.data['items'].remove(item)
        self.data.setdefault('archived',[]).append({**item,'archived_at':time.time()})
        if self.data['selected']==key:self.data['selected']=self.data['items'][0]['id']
        try:self.save()
        except Exception:
            if moved:target.rename(source)
            self.data=original
            raise

    def restore(self,key):
        item=next((i for i in self.data.get('archived',[]) if i['id']==key),None)
        if not item:raise ValueError('Choose an archived workspace.')
        if key!='primary':
            if len(key)!=32 or any(c not in '0123456789abcdef' for c in key):raise ValueError('Invalid workspace identifier.')
            source=(self.home/'archive'/key).resolve();target=(self.home/'workspaces'/key).resolve()
            if not source.is_relative_to(self.home) or not target.is_relative_to(self.home) or source.parent!=(self.home/'archive').resolve() or target.parent!=(self.home/'workspaces').resolve():raise ValueError('Invalid workspace storage path.')
            source.rename(target)
        self.data['archived'].remove(item)
        name=item['name'];counter=2
        while any(i['name'].casefold()==name.casefold() for i in self.data['items']):name=item['name']+' '+str(counter);counter+=1
        self.data['items'].append({**item,'name':name});self.save()
