"""Launch the shipped MCPB bridge against a clean portable application extraction."""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def main():
    base = ROOT / 'workspace'
    with tempfile.TemporaryDirectory(prefix="Companion clean O'Brien ", dir=base) as directory:
        home = Path(directory).resolve()
        assert home.is_relative_to(base.resolve())
        app, bundle = home / 'application', home / 'extension'
        for name, target in [('Bedazzle-Windows.zip', app), ('Bedazzle-Claude-Desktop.mcpb', bundle)]:
            with ZipFile(ROOT / 'dist' / name) as archive:
                for member in archive.namelist():
                    assert (target / member).resolve().is_relative_to(target.resolve())
                archive.extractall(target)
        workspace = app / 'workspace' / 'bedazzle'
        process = subprocess.Popen(['node', str(bundle / 'bridge.js'), str(app), str(workspace)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        try:
            for identity, method in [(1, 'initialize'), (2, 'tools/list')]:
                process.stdin.write(json.dumps({'jsonrpc':'2.0','id':identity,'method':method,'params':{}}) + '\n')
                process.stdin.flush()
                result = json.loads(process.stdout.readline())
                assert 'result' in result, result
            names = {t['name'] for t in result['result']['tools']}
            assert {'bedazzle_import','bedazzle_query','bedazzle_apply_edit','bedazzle_request_analysis','bedazzle_images'}.issubset(names)
            fixture = home / 'portable.csv'
            fixture.write_text('id,value\n1,bad\n')
            authorized = subprocess.run([str(app/'runtime/python/python.exe'),str(app/'companion_local.py'),'--workspace',str(workspace),'task','--folder',str(home),'--scope','Portable smoke inspection'],input='APPROVE\n',capture_output=True,text=True,check=True)
            task = authorized.stdout.strip().split()[-1]
            def call(identity,name,arguments):
                process.stdin.write(json.dumps({'jsonrpc':'2.0','id':identity,'method':'tools/call','params':{'name':name,'arguments':arguments}})+'\n')
                process.stdin.flush()
                answer=json.loads(process.stdout.readline())
                assert 'result' in answer,answer
                return json.loads(answer['result']['content'][0]['text'])
            submitted=call(3,'bedazzle_import',{'task':task,'path':str(fixture)})
            deadline=time.time()+20
            while True:
                answer=call(4,'bedazzle_job',{'task':task,'job':submitted['id']})
                if answer.get('finished'):
                    assert answer['status']=='succeeded',answer
                    break
                assert time.time()<deadline
                time.sleep(.1)
            print('PASS: shipped MCPB bridge initializes, discovers tools and snapshots a file using clean bundled Python')
        finally:
            process.stdin.close()
            process.wait(timeout=15)
            session_file = workspace / 'server.json'
            if session_file.exists():
                session = json.loads(session_file.read_text())
                request = urllib.request.Request(session['url'] + '/api/shutdown', data=b'{}', headers={'X-Workbench-Token':session['token']})
                with urllib.request.urlopen(request,timeout=5):
                    pass
                for _ in range(100):
                    if not session_file.exists():
                        break
                    time.sleep(.1)
            process.stdout.close()
            process.stderr.close()


if __name__ == '__main__':
    main()
