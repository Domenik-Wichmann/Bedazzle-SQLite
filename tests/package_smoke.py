"""Extract and run the distributable, including a workspace restart."""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    extracted=(ROOT/'workspace'/f"Bedazzle clean O'Brien test {time.time_ns()}").resolve()
    assert extracted.is_relative_to((ROOT/'workspace').resolve())
    with ZipFile(ROOT/'dist'/'Bedazzle-Windows.zip') as archive:
        assert archive.testzip() is None
        names=archive.namelist()
        assert all(not name.startswith(('workspace/','.test-tools/','runtime/downloads/')) for name in names)
        assert not any('/.git/' in name for name in names)
        archive.extractall(extracted)
    print('PASS: ZIP integrity; no user workspaces, browser tools, or Git metadata')
    executable=extracted/'runtime'/'python'/'python.exe'
    version=subprocess.check_output([str(executable),'-c','import duckdb; print(duckdb.__version__)'],cwd=extracted,text=True).strip()
    assert version=='2.0.0'
    pillow=subprocess.check_output([str(executable),'-c','import PIL; print(PIL.__version__)'],cwd=extracted,text=True).strip()
    assert pillow=='13.0.0'
    print('PASS: bundled Python and native engine run from a path containing spaces and an apostrophe')
    workspace=extracted/'workspace'/'bedazzle'

    def launch():
        process=subprocess.Popen([str(executable),str(extracted/'workbench.py'),'--no-browser'],cwd=extracted,
                                 stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        deadline=time.time()+15
        session_file=workspace/'server.json'
        while time.time()<deadline:
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read().decode('utf-8',errors='replace'))
            if session_file.exists():
                data=json.loads(session_file.read_text())
                if data['pid']==process.pid:
                    return process,data
            time.sleep(.05)
        process.terminate()
        raise AssertionError('Extracted application did not start')

    process,session=launch()

    def request(path,value=None):
        data=None if value is None else json.dumps(value).encode()
        req=urllib.request.Request(session['url']+path,data=data,headers={'X-Workbench-Token':session['token']})
        with urllib.request.urlopen(req,timeout=10) as response:
            return json.load(response)

    def job(action,payload):
        job_id=request('/api/jobs',{'action':action,'payload':payload})['id']
        deadline=time.time()+30
        while time.time()<deadline:
            result=request('/api/jobs/'+job_id)
            if result.get('finished'):
                assert result['status']=='succeeded',result
                return result['result']
            time.sleep(.05)
        raise AssertionError('Extracted-app operation timed out')

    try:
        info=request('/api/bootstrap')
        assert any(item.get('example') for item in info['workspaces']['items'])
        assert len(info['saved'])==4 and info['drafts'] is not None
        if info['active_job']:
            while not request('/api/jobs/'+info['active_job']).get('finished'):
                time.sleep(.05)
        assert job('query',{'sql':'SELECT count(*) FROM products'})['rows']==[[1000]]
        assert job('query',{'sql':'SELECT count(*) FROM offers'})['rows']==[[1200]]
        request('/api/workspace',{'id':'primary'})
        request('/api/settings',{'memory_mb':256,'threads':1,'spill_gb':1,'timeout':30,'profile':'quiet'})
        opened=job('open',{'path':str(extracted/'examples'/'catalogs.csv')})
        result=job('query',{'sql':f'SELECT count(*) FROM "{opened["name"]}"'})
        assert result['rows']==[[6]]
        print('PASS: clean extracted app imports and queries its example')
        draft={'active':'draft-one','updated':time.time()*1000,'tabs':[{'id':'draft-one','name':'Persistent draft','sql':'SELECT 123 AS draft;'}]}
        request('/api/drafts',draft)
        request('/api/save',{'name':'Saved from extracted ZIP','sql':'SELECT 123'})
        from tests.image_fixture import Images
        images=Images()
        try:
            url=images.url+'/ok.png'
            module=job('module_run',{'module':'image_checker','sql':f"SELECT i AS id,'{url}' AS url FROM range(3) t(i)",'options':{'url_columns':['url'],'allow_private':True,'retries':0}})
            assert module['run']['summary']['checked_cells']==3 and images.hits['/ok.png']==1
            enriched=job('module_merge',{'run_id':module['run']['id']})
            assert job('query',{'sql':'SELECT count(*) FROM "'+enriched['name']+'"'})['rows']==[[3]]
            print('PASS: packaged image decoder, manifest discovery, full result check and stable merge')
        finally:images.close()
        request('/api/shutdown',{})
        process.wait(timeout=10)
        old_port=session['url']
        process,session=launch()
        info=request('/api/bootstrap')
        assert info['drafts']==draft
        assert info['saved'][0]['name']=='Saved from extracted ZIP'
        assert info['catalog'][0]['name']==opened['name']
        assert info['settings']['profile']=='quiet'
        assert any(run['id']==module['run']['id'] and run['status']=='completed' for run in request('/api/modules')['runs'])
        print('PASS: drafts, named queries, datasets, and settings survive a complete application restart')
        if info['active_job']:
            while not request('/api/jobs/'+info['active_job']).get('finished'):
                time.sleep(.05)
        request('/api/workspace',{'name':'Separate packaged workspace'})
        secondary=request('/api/bootstrap')
        key=secondary['workspaces']['selected']
        assert key!='primary' and secondary['catalog']==[] and secondary['saved']==[]
        request('/api/settings',{'memory_mb':256,'threads':1,'spill_gb':1,'timeout':30,'profile':'quiet','default_page_size':1000000})
        job('query',{'sql':'CREATE TABLE separate AS SELECT 987 AS x;'})
        request('/api/shutdown',{})
        process.wait(timeout=10)
        process,session=launch()
        info=request('/api/bootstrap')
        assert info['workspaces']['selected']==key and info['settings']['default_page_size']==1000000
        if info['active_job']:
            while not request('/api/jobs/'+info['active_job']).get('finished'):
                time.sleep(.05)
        assert job('query',{'sql':'SELECT * FROM separate'})['rows']==[[987]]
        request('/api/workspace',{'id':'primary'})
        restored=request('/api/bootstrap')
        assert restored['drafts']==draft and restored['saved'][0]['name']=='Saved from extracted ZIP'
        assert restored['catalog'][0]['name']==opened['name']
        print('PASS: selected workspace, separate tables and million-row default survive restart; original workspace remains intact')
    finally:
        try:
            request('/api/shutdown',{})
            process.wait(timeout=10)
        except Exception:
            process.terminate()
        process.stderr.close()


if __name__=='__main__':
    main()
