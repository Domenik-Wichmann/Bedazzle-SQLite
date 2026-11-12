"""Verify connected pivots in an isolated server; never reuse a live user session."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request


def main():
    root = Path(__file__).resolve().parents[1]
    workspace = root / 'workspace' / ('pivot-links-verification-' + str(time.time_ns()))
    workspace.mkdir(parents=True)
    session = None
    with (workspace / 'server.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen(
            [str(root / 'runtime/python/python.exe'), str(root / 'workbench.py'),
             '--workspace', str(workspace), '--no-browser'], cwd=root, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            for _ in range(200):
                if (workspace / 'server.json').exists():
                    break
                if process.poll() is not None:
                    raise RuntimeError((workspace / 'server.log').read_text(encoding='utf-8'))
                time.sleep(.1)
            session = json.loads((workspace / 'server.json').read_text())
            session['workspace'] = str(workspace)
            session_file = workspace / 'test-session.json'
            session_file.write_text(json.dumps(session))
            env = {**os.environ, 'BEDAZZLE_TEST_SESSION': str(session_file)}
            for test in ['pivot_query.cjs', 'pivot_sorts.cjs', 'pivot_relationships.cjs', 'pivot_sort_browser.cjs', 'pivot_links_browser.cjs',
                         'pivot_browser.cjs', 'pivot_loading.cjs']:
                subprocess.run(['node', str(root / 'tests' / test)], cwd=root, env=env, check=True)
        finally:
            if session:
                request = urllib.request.Request(session['url'] + '/api/shutdown', data=b'{}',
                                                 headers={'X-Workbench-Token': session['token']})
                try:
                    urllib.request.urlopen(request, timeout=5).close()
                except OSError:
                    process.terminate()
            else:
                process.terminate()
            process.wait(timeout=15)


if __name__ == '__main__':
    main()
