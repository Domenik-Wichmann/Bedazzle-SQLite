"""Regression for a Node host exposing protocol streams through wrappers."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BridgeTests(unittest.TestCase):
    def test_virtual_stdio_discovery_without_backend_or_ascii_assumptions(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'workspace') as directory:
            workspace=Path(directory)/'must-not-start'
            requests=[{'jsonrpc':'2.0','id':0,'method':'server/discover'},
                      {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'clientInfo':{'name':'Клод','version':'1'}}},
                      {'jsonrpc':'2.0','method':'notifications/initialized'},
                      {'jsonrpc':'2.0','id':2,'method':'tools/list'}]
            script=r'''
const {PassThrough, Writable} = require('node:stream');
const originalOut=process.stdout;
const input=new PassThrough();
const output=new Writable({write(chunk,encoding,done){originalOut.write(chunk,encoding,done)}});
Object.defineProperty(process,'stdin',{value:input});
Object.defineProperty(process,'stdout',{value:output});
const [bridge,app,workspace,requests]=process.argv.slice(1);
process.argv=[process.execPath,bridge,app,workspace];
require(bridge);
input.end(requests);
'''
            process=subprocess.run(['node','-e',script,str(ROOT/'companion_bridge.js'),str(ROOT),str(workspace),''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in requests)],stdin=subprocess.DEVNULL,capture_output=True,text=True,encoding='utf-8',timeout=15)
            self.assertEqual(process.returncode,0,process.stderr)
            messages=[json.loads(line) for line in process.stdout.splitlines()]
            self.assertEqual(messages[0]['error']['code'],-32601)
            self.assertEqual(messages[1]['result']['serverInfo']['version'],'0.2.0')
            self.assertIn('bedazzle_tasks',{t['name'] for t in messages[2]['result']['tools']})
            edit_tool=next(t for t in messages[2]['result']['tools'] if t['name']=='bedazzle_propose_edit')
            self.assertEqual(edit_tool['inputSchema']['properties']['keys']['items'],{'type':'string'})
            self.assertFalse(workspace.exists(),'Protocol discovery must not launch the backend')


if __name__=='__main__':
    unittest.main()
