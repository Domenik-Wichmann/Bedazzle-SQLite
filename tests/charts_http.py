"""Run Chart studio against an isolated workspace and portable engine."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request


def main():
    root=Path(__file__).resolve().parents[1]
    workspace=root/'workspace'/('charts-browser-'+str(time.time_ns()))
    workspace.mkdir(parents=True)
    with (workspace/'server.log').open('w') as log:
        process=subprocess.Popen([str(root/'runtime/python/python.exe'),str(root/'workbench.py'),
                                  '--workspace',str(workspace),'--no-browser'],cwd=root,stdout=log,stderr=log)
        session=None
        try:
            for _ in range(150):
                if (workspace/'server.json').exists():break
                if process.poll() is not None:raise RuntimeError((workspace/'server.log').read_text())
                time.sleep(.1)
            session=json.loads((workspace/'server.json').read_text())
            session['workspace']=str(workspace)
            session_file=workspace/'browser-session.json'
            session_file.write_text(json.dumps(session))
            def request(path,value=None):
                r=urllib.request.Request(session['url']+path,data=json.dumps(value).encode() if value is not None else None,
                                         headers={'X-Workbench-Token':session['token']})
                with urllib.request.urlopen(r,timeout=10) as response:return json.load(response)
            bootstrap=request('/api/bootstrap')
            if bootstrap.get('active_job'):
                for _ in range(200):
                    if request('/api/jobs/'+bootstrap['active_job']).get('finished'):break
                    time.sleep(.05)
            request('/api/workspace',{'id':'primary'})
            request('/api/settings',{'memory_mb':256,'threads':1,'spill_gb':1,'timeout':60,'profile':'balanced'})
            subprocess.run(['node',str(root/'tests/charts_browser.cjs')],cwd=root,
                           env={**os.environ,'BEDAZZLE_TEST_SESSION':str(session_file)},check=True,timeout=180)
        finally:
            if session:
                try:request('/api/shutdown',{})
                except OSError:pass
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=5)


if __name__=='__main__':main()
