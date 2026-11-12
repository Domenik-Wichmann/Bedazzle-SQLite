"""One command to open Bedazzle. No cloud service or frontend build step."""
import argparse
import json
import getpass
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent


def default_workspace():
    previous=ROOT/'workspace'/'fieldwork'
    # Preserve existing users' datasets and saved queries without moving files.
    return previous if (previous/'preferences.sqlite3').exists() else ROOT/'workspace'/'bedazzle'


def main():
    if sys.version_info < (3, 12):
        embedded = ROOT / 'runtime' / 'python' / 'python.exe'
        if embedded.exists():
            return subprocess.call([str(embedded), str(ROOT / 'workbench.py'), *sys.argv[1:]])
        raise SystemExit('Use the bundled Start Workbench.cmd or Python 3.12 or newer.')
    parser = argparse.ArgumentParser(description='Bedazzle: my local data tools')
    parser.add_argument('paths', nargs='*', help='Data files to open in the UI')
    parser.add_argument('--demo', action='store_true', help='Open the example dataset')
    parser.add_argument('--convert', type=Path, help='Open Import as Parquet with this source file selected')
    parser.add_argument('--workspace', type=Path, default=default_workspace())
    parser.add_argument('--port', type=int, default=0, help='Local port; 0 chooses a free port')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    from bootstrap import ensure_engine
    ensure_engine()
    workspace = args.workspace.expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    paths = [str(Path(path).expanduser().resolve()) for path in args.paths]
    if args.demo:
        paths.append(str(ROOT / 'examples' / 'catalogs.csv'))
    convert = str(args.convert.expanduser().resolve()) if args.convert else None
    for path in paths + ([convert] if convert else []):
        if not Path(path).is_file():
            parser.error(f'File not found: {path}')
    startup = {'paths': paths, 'convert': convert}
    session_file = workspace / 'server.json'
    if session_file.exists():
        try:
            previous = json.loads(session_file.read_text())
            if previous.get('runtime_user') and previous['runtime_user'].casefold()!=getpass.getuser().casefold():
                print('Bedazzle is already running under another Windows account ('+previous['runtime_user']+'). Quit that instance, then start Bedazzle from your own Windows account so native file dialogs can work.',flush=True)
                return 1
            url = previous['url']
            # A stale or edited session file must not send a token to another host.
            from urllib.parse import urlparse
            parsed = urlparse(url)
            if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1':
                raise ValueError('Invalid local session')
            request = urllib.request.Request(url + '/api/launch', data=json.dumps(startup).encode(),
                       headers={'Content-Type':'application/json', 'X-Workbench-Token':previous['token']})
            with urllib.request.urlopen(request, timeout=2) as response:
                if response.status == 200:
                    full_url = url + '/#' + previous['token']
                    print('Bedazzle is already running: ' + full_url, flush=True)
                    if not args.no_browser:
                        webbrowser.open(full_url)
                    return 0
        except (OSError, ValueError, KeyError):
            pass
    from companion_ownership import acquire
    if not acquire(workspace):
        import time
        for _ in range(50):
            time.sleep(.1)
            if session_file.exists():
                return main()
        raise SystemExit('Another Bedazzle service owns this workspace. Retry after it finishes starting.')
    from app_server import Server
    server = Server(('127.0.0.1', args.port), workspace)
    server.startup = startup
    base_url = f'http://127.0.0.1:{server.server_port}'
    full_url = base_url + '/#' + server.token
    session_file.write_text(json.dumps({'url':base_url, 'token':server.token, 'pid':os.getpid(),'runtime_user':getpass.getuser()}))
    try:
        server.jobs.submit('catalog', {})
    except ValueError as error:
        # The interface must still open so the user can see RAM and adjust
        # settings, even when there is too little free RAM for an engine job.
        print('Resource notice: ' + str(error), flush=True)
    from app_server import APP_VERSION
    print('\nBedazzle '+APP_VERSION+' · '+str(ROOT), flush=True)
    print('Open: ' + full_url, flush=True)
    print('Workspace: ' + str(workspace), flush=True)
    print('Use Quit in the UI or Ctrl+C here to stop.\n', flush=True)
    if not args.no_browser:
        webbrowser.open(full_url)
    try:
        server.serve_forever(poll_interval=.3)
    except KeyboardInterrupt:
        print('\nStopping Bedazzle…', flush=True)
    finally:
        server.jobs.close()
        server.server_close()
        try:
            if json.loads(session_file.read_text()).get('pid') == os.getpid():
                session_file.unlink()
        except (OSError, ValueError):
            pass
    return 0
