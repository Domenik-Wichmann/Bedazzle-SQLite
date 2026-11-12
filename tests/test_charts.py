import threading
import tempfile
import unittest
import uuid
from pathlib import Path
from engine import ROOT, create_connection, perform
from result_store import release


class ChartStudioTests(unittest.TestCase):
    def setUp(self):
        base = ROOT / 'workspace' / 'automated-tests'
        base.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=base)
        self.root = Path(self.tmp.name)
        self.conn = create_connection(self.root, {'memory_mb': 256, 'threads': 1, 'spill_gb': 1}, 'charts')
        self.env = {'workspace': self.root, 'cancelled': threading.Event(), 'settings': {'spill_gb': 1}}

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def action(self, op, **data):
        return perform(self.conn, 'chart_studio', {'op': op, **data}, uuid.uuid4().hex, module_context=self.env)

    def source(self):
        self.conn.execute("CREATE TABLE input AS SELECT i%10 AS category, CASE WHEN i%2=0 THEN 'East' ELSE 'West' END AS region, CASE WHEN i=1 THEN 'bad' ELSE '2.5' END AS amount, i AS second FROM range(2000) t(i)")
        result = perform(self.conn, 'query', {'sql': 'SELECT * FROM input ORDER BY second', 'retain_result': True}, uuid.uuid4().hex, module_context=self.env)
        opened = self.action('open', result_id=result['result_id'])
        release(self.root, result['result_id'])
        self.conn.execute('DROP TABLE input')
        return opened['source']

    def config(self, **extra):
        return {'type': 'line', 'x': 'category', 'ys': ['amount', 'second'], 'aggregate': 'sum', 'title': 'Revenue', 'dashboard': 'Sales', **extra}

    def test_full_snapshot_aggregates_persistence_and_isolation(self):
        source = self.source()
        data = self.action('preview', source=source, config=self.config(split='region'))
        self.assertEqual(data['matching_rows'], 2000)
        self.assertEqual(data['invalid'], [1, 0])
        self.assertEqual(sum(r[2] for r in data['rows']), 4997.5)
        self.assertFalse(data['truncated'])
        saved = self.action('save', source=source, config=self.config())['charts'][0]
        self.assertEqual(self.action('list')['charts'][0]['id'], saved['id'])
        other = dict(self.env, workspace=self.root / 'other');other['workspace'].mkdir()
        isolated = perform(self.conn, 'chart_studio', {'op': 'list'}, uuid.uuid4().hex, module_context=other)
        self.assertEqual(isolated, {'charts': []})
        self.action('clean')
        self.action('preview', source=source, config=saved['config'])
        self.action('delete', id=saved['id']);self.action('clean')
        with self.assertRaisesRegex(ValueError, 'no longer'):self.action('preview', source=source, config=saved['config'])

    def test_limits_filters_raw_and_identifier_validation(self):
        source = self.source()
        data = self.action('preview', source=source, config=self.config(limit=5))
        self.assertTrue(data['truncated']);self.assertEqual(len(data['rows']), 5)
        data = self.action('preview', source=source, config=self.config(filter='3', aggregate='count'))
        self.assertEqual(data['matching_rows'], 200);self.assertEqual(data['rows'][0][2], 200)
        data = self.action('preview', source=source, config=self.config(type='scatter', limit=5))
        self.assertTrue(data['raw']);self.assertTrue(data['truncated']);self.assertEqual(len(data['rows']), 20)
        with self.assertRaises(ValueError):self.action('preview', source='../escape', config=self.config())
        with self.assertRaises(ValueError):self.action('preview', source=source, config=self.config(x='unknown'))
        with self.assertRaises(ValueError):self.action('save', source=source, config=self.config(type='unknown'))
        with self.assertRaisesRegex(ValueError, 'Raw observations'):self.action('preview', source=source, config=self.config(aggregate='raw'))

    def test_numeric_nonfinite_and_nulls_do_not_poison_aggregates(self):
        result = perform(self.conn, 'query', {'sql': "SELECT * FROM (VALUES ('a','Infinity'),('a','NaN'),('a','3'),('a',NULL),('NULL','4'),(NULL,'5')) t(category,amount)", 'retain_result': True}, uuid.uuid4().hex, module_context=self.env)
        source = self.action('open', result_id=result['result_id'])['source']
        data = self.action('preview', source=source, config=self.config(ys=['amount']))
        self.assertEqual(data['invalid'], [2])
        self.assertEqual(sum(r[2] for r in data['rows']), 12)
        self.assertEqual(len(data['rows']), 3)


if __name__ == '__main__': unittest.main()
