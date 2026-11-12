"""End-to-end loopback API smoke check using the real portable runtime."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / 'workspace' / ('http-smoke-' + str(time.time_ns()))
RUNTIME = ROOT / 'runtime' / 'python' / 'python.exe'


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    process = subprocess.Popen([str(RUNTIME), str(ROOT / 'workbench.py'), '--workspace', str(WORKSPACE), '--no-browser'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, cwd=ROOT)
    session_file = WORKSPACE / 'server.json'
    deadline = time.time() + 15
    while not session_file.exists() and time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(process.stderr.read().decode())
        time.sleep(.1)
    session = json.loads(session_file.read_text())
    Path(os.environ.get('BEDAZZLE_TEST_SESSION',str(ROOT / 'workspace' / 'http-smoke-session.json'))).write_text(json.dumps({**session, 'workspace':str(WORKSPACE)}))

    def request(path, value=None, token=True):
        headers = {'X-Workbench-Token': session['token']} if token else {}
        data = None if value is None else json.dumps(value).encode()
        response = urllib.request.urlopen(urllib.request.Request(session['url'] + path, data=data, headers=headers), timeout=10)
        return json.load(response)

    def job(action, payload=None):
        job_id = request('/api/jobs', {'action': action, 'payload': payload or {}})['id']
        deadline = time.time() + 30
        while time.time() < deadline:
            result = request('/api/jobs/' + job_id)
            if result.get('finished'):
                assert result['status'] == 'succeeded', result
                return result['result']
            time.sleep(.05)
        raise AssertionError('Job did not complete')

    try:
        bootstrap = request('/api/bootstrap')
        if bootstrap['active_job']:
            while not request('/api/jobs/' + bootstrap['active_job']).get('finished'):
                time.sleep(.05)
        if request('/api/bootstrap')['workspaces']['selected'] != 'primary':
            request('/api/workspace', {'id':'primary'})
        request('/api/settings', {'memory_mb':256,'threads':1,'spill_gb':1,'timeout':30,'profile':'balanced'})
        try:
            request('/api/bootstrap', token=False)
            raise AssertionError('Unauthenticated API access was allowed')
        except urllib.error.HTTPError as error:
            assert error.code == 403
        print('PASS: session authentication and loopback HTTP server')
        source = ROOT / 'examples' / 'catalogs.csv'
        preview = job('preview', {'path':str(source), 'options':{'types':'text'}})
        assert len(preview['preview']['rows']) == 6
        opened = job('open', {'path':str(source),'name':'catalogs'})
        name = opened['name']
        query = job('query', {'sql':f'SELECT client, count(*) AS records FROM "{name}" GROUP BY client ORDER BY client'})
        assert query['rows'] == [['Acme',3],['Contoso',1],['Northwind',2]], query
        print('PASS: preview → import → query → serialized result')
        target = WORKSPACE / f'converted-{time.time_ns()}.parquet'
        converted = job('convert', {'path':str(source),'output':str(target)})
        assert converted['exported_rows'] == 6
        print('PASS: CSV → compressed Parquet → registered dataset')
        for format_name in ['csv','tsv','json','ndjson','parquet']:
            output = WORKSPACE / f'full-{time.time_ns()}.{format_name}'
            exported = job('export', {'sql':'SELECT i FROM range(1234) t(i)','format':format_name,'output':str(output)})
            assert exported['exported_rows'] == 1234 and output.is_file()
        print('PASS: all five full-result export formats through HTTP')
        request('/api/save', {'name':'Useful count','sql':f'SELECT count(*) FROM "{name}"'})
        assert any(item['name'] == 'Useful count' for item in request('/api/bootstrap')['saved'])
        assert job('profile', {'name':name})['profile']['rows']
        print('PASS: saved query persistence and dataset profiling')
        # Keep this server alive for isolated browser tests; shutdown is explicit.
        print(json.dumps({'url':session['url'], 'token':session['token'], 'workspace':str(WORKSPACE)}))
    except BaseException:
        try:
            request('/api/shutdown', {})
        except Exception:
            process.terminate()
        raise


if __name__ == '__main__':
    main()
