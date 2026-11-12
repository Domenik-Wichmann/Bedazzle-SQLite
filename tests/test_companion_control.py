import json
from pathlib import Path
import sys
import tempfile
import subprocess
import os
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from companion_control import execute
from companion_store import Ledger


class LocalControlTests(unittest.TestCase):
    @unittest.skipUnless(os.name=='nt','Windows Forms controller')
    def test_windows_controller_utf8_pipe(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'workspace',prefix='controller ') as directory:
            result=subprocess.run(['powershell.exe','-NoProfile','-STA','-File',str(ROOT/'companion_control.ps1'),'-Workspace',directory,'-VerifyController'],capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            value=json.loads(result.stdout)
            self.assertEqual(value['workspace'],str(Path(directory).resolve()))
            self.assertEqual(value['tasks'],[])

    def test_task_scope_stale_decision_transfer_and_close(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'workspace') as directory:
            home=Path(directory);request={'workspace':directory}
            task=execute({**request,'action':'task','folders':[directory],'scope':'Inspect examples','workspace_data':True})
            ledger=Ledger(home)
            self.assertTrue(ledger.task(task['id'])['allow_workspace_data'])
            self.assertFalse(ledger.task(task['id'])['allow_private_images'])
            approval=ledger.pending(task['id'],'edit',{'source':'source-one','changes':[{'row':1,'column':'price','value':'10'}]})
            listed=execute({**request,'action':'list'})['approvals'][0]
            denied=execute({**request,'action':'review','id':listed['id'],'fingerprint':listed['fingerprint'],'decision':'denied'})
            self.assertEqual(ledger.get('approval',denied['id'])['status'],'denied')
            with self.assertRaises(ValueError):execute({**request,'action':'review','id':listed['id'],'fingerprint':listed['fingerprint'],'decision':'approved'})
            interrupted=ledger.put('approval',{'task':task['id'],'purpose':'transform','scope':{'versions':['original']},'status':'approved','started':True})
            review=next(v for v in execute({**request,'action':'list'})['approvals'] if v['id']==interrupted['id'])
            resolved=execute({**request,'action':'resolve','id':review['id'],'fingerprint':review['fingerprint']})
            self.assertEqual(ledger.get('approval',resolved['id'])['status'],'pending')
            self.assertEqual(ledger.get('approval',interrupted['id'])['status'],'abandoned')
            ledger.response(task['id'],{'preview':'data'})
            used=ledger.task(task['id'])['transferred']
            execute({**request,'action':'transfer','task':task['id'],'bytes':2097152,'reason':'Review more exceptions'})
            self.assertEqual(ledger.task(task['id'])['transferred'],used)
            execute({**request,'action':'close','task':task['id']})
            with self.assertRaises(ValueError):ledger.task(task['id'])
            self.assertEqual(ledger.get('approval',approval['id'])['status'],'denied')


if __name__=='__main__':unittest.main()
