"""Real isolated worker -> loopback image server -> report -> stable merge -> browser."""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'tests'))
from engine import literal
from image_fixture import Images


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    session=json.loads((ROOT/'workspace'/'http-smoke-session.json').read_text())
    images=Images()
    def request(path,payload=None):
        req=urllib.request.Request(session['url']+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'X-Workbench-Token':session['token']})
        with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
    def job(action,payload):
        key=request('/api/jobs',{'action':action,'payload':payload})['id']
        for _ in range(600):
            value=request('/api/jobs/'+key)
            if value.get('finished'):
                assert value['status']=='succeeded',value
                return value['result']
            time.sleep(.05)
        raise AssertionError('Module job timed out')
    try:
        definitions=request('/api/modules');assert definitions['modules'][0]['id']=='image_checker'
        sql=f'SELECT i AS id,{literal(images.url+"/ok.png")} AS url FROM range(1234) t(i)'
        result=job('module_run',{'module':'image_checker','sql':sql,'options':{'url_columns':['url'],'allow_private':True,'retries':0}})
        assert result['run']['summary']['checked_cells']==1234 and result['run']['summary']['unique_urls']==1
        assert images.hits['/ok.png']==1
        merged=job('module_merge',{'run_id':result['run']['id']})
        assert job('query',{'sql':'SELECT count(*) FROM "'+merged['name']+'"'})['rows']==[[1234]]
        print('PASS: native module worker handles all 1,234 rows, requests one repeated URL once, and joins without row multiplication')
        (ROOT/'workspace'/'module-smoke-fixture.json').write_text(json.dumps({'url':images.url}))
        subprocess.run(['node',str(ROOT/'tests'/'modules_browser.cjs')],cwd=ROOT,check=True,timeout=180)
    finally:images.close()


if __name__=='__main__':main()
