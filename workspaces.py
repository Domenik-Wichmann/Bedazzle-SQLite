"""Small, local workspace registry. Each workspace owns its own databases."""
import json
import uuid
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
        self.data['items'].append({'id': key, 'name': name})
        self.path(key).mkdir(parents=True, exist_ok=True)
        self.save()
        return key

    def select(self, key):
        self.path(key)
        self.data['selected'] = key
        self.save()
