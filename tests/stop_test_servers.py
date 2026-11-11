"""Stop only servers created by tests/http_smoke.py in this workspace."""
import json
from pathlib import Path
import urllib.request
from urllib.parse import urlparse

root=Path(__file__).resolve().parents[1]
for session in (root/'workspace').glob('http-smoke-*/server.json'):
    try:
        data=json.loads(session.read_text())
        parsed=urlparse(data['url'])
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1':
            continue
        request=urllib.request.Request(data['url']+'/api/shutdown', data=b'{}', headers={'X-Workbench-Token':data['token']})
        with urllib.request.urlopen(request,timeout=.5) as response:
            print('Stopped test server on port',parsed.port)
    except (OSError,ValueError,KeyError):
        pass
