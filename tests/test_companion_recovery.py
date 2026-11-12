"""Durability and fail-closed unit cases independent of Claude."""
import concurrent.futures
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from companion_store import Ledger


class LedgerRecoveryTests(unittest.TestCase):
    def test_restart_denial_scopes_and_atomic_budget(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'workspace') as directory:
            ledger = Ledger(directory)
            task = ledger.put('task', {'scope': 'Check originals', 'active': True, 'roots': [directory], 'budget': 1500})
            ledger.put('job', {'task':task['id']}, 'shared-id')
            ledger.put('pending_output', {'path':'test'}, 'shared-id')
            self.assertEqual(ledger.get('job','shared-id')['task'],task['id'])
            sibling=Path(directory)/'workspaces'/('a'*32)
            ledger.note_content('example-hash','edited-parent',True)
            self.assertEqual(Ledger(sibling).edited_content('example-hash'),'edited-parent')
            scope = {'version': 'edited-one', 'scope': task['scope']}
            request = ledger.pending(task['id'], 'analyze_edited', scope)
            ledger.put('approval', {**request, 'status': 'denied'}, request['id'])
            restarted = Ledger(directory)
            with self.assertRaises(ValueError):
                restarted.require(task['id'], 'analyze_edited', scope)
            self.assertEqual(restarted.pending(task['id'], 'analyze_edited', scope)['id'], request['id'])
            next_request = restarted.pending(task['id'], 'analyze_edited', {**scope, 'version': 'edited-two'})
            self.assertNotEqual(next_request['id'], request['id'])
            def transfer(_):
                return Ledger(directory).response(task['id'], {'rows': [['x' * 300]]})
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                receipts = list(pool.map(transfer, range(16)))
            self.assertTrue(any(r.get('isError') for r in receipts))
            self.assertLessEqual(restarted.task(task['id'])['transferred'], 1500)
            self.assertLessEqual(len(json.dumps(restarted.response(task['id'], {'huge': 'x' * 100000})).encode()), 65536)
            authorized=restarted.task(task['id'])
            restarted.put('task',{**authorized,'budget':1048576,'response_bytes':131072,'response_rows':400},task['id'])
            expanded=Ledger(directory).response(task['id'],{'approved_large_preview':'x'*70000})
            size=len(json.dumps(expanded).encode())
            self.assertGreater(size,65536)
            self.assertLessEqual(size,131072)


if __name__ == '__main__':
    unittest.main()
