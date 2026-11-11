from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch

from engine import ROOT, create_connection, perform
from app_server import Jobs
from workspaces import Workspaces
from repository import Repository

TEST_ROOT=ROOT/'workspace'/'automated-tests'
TEST_ROOT.mkdir(parents=True,exist_ok=True)
SETTINGS={'memory_mb':256,'threads':1,'spill_gb':1,'timeout':30,'profile':'quiet'}


class WorkspaceTests(unittest.TestCase):
    def test_workspace_registry_and_databases_survive_selection_and_restart(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as directory:
            registry=Workspaces(directory)
            first=create_connection(registry.path(),SETTINGS,'primary')
            first.execute('CREATE TABLE personal AS SELECT 7 AS x')
            first.close()
            key=registry.create('Catalog research')
            registry.select(key)
            second=create_connection(registry.path(),SETTINGS,'secondary')
            self.assertEqual(second.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name='personal'").fetchone()[0],0)
            second.execute('CREATE TABLE other AS SELECT 9 AS y')
            second.close()
            reopened=Workspaces(directory)
            self.assertEqual(reopened.data['selected'],key)
            reopened.select('primary')
            first=create_connection(reopened.path(),SETTINGS,'again')
            self.assertEqual(first.execute('SELECT * FROM personal').fetchone()[0],7)
            first.close()
            for invalid in ('../../outside','x'*32):
                with self.assertRaises(ValueError):reopened.path(invalid)
            with self.assertRaises(ValueError):reopened.create('catalog RESEARCH')

    def test_large_page_is_bounded_and_exposes_last_window(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as directory:
            conn=create_connection(Path(directory),SETTINGS,'large')
            try:
                sql='SELECT i FROM range(1200123) t(i) ORDER BY i'
                first=perform(conn,'query',{'sql':sql,'size':1000000},'large')
                self.assertEqual(first['total_rows'],1200123)
                self.assertEqual(len(first['rows']),500)
                last=perform(conn,'query',{'sql':sql,'size':1000000,'window':999500},'large')
                self.assertEqual(last['rows'][0],[999500])
                self.assertEqual(last['rows'][-1],[999999])
                self.assertEqual(last['page_start'],0)
                plan=perform(conn,'explain',{'sql':sql},'plan')
                self.assertTrue(plan['tree'][0]['name'])
            finally:conn.close()

    def test_default_page_size_is_saved_and_validated(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as directory:
            jobs=Jobs(directory)
            jobs.set_settings({**SETTINGS,'default_page_size':1000000})
            self.assertEqual(Jobs(directory).settings()['default_page_size'],1000000)
            with self.assertRaises(ValueError):jobs.set_settings({**SETTINGS,'default_page_size':999})
            jobs.close()


@unittest.skipUnless(shutil.which('git'), 'Git is optional; install it to test repository controls.')
class RepositoryTests(unittest.TestCase):
    def test_link_keeps_local_edits_private_files_and_updates_only_clean_tree(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as directory:
            root=Path(directory)
            upstream=root/'upstream';local=root/'local';upstream.mkdir();local.mkdir()
            remote=Repository(upstream)
            remote.git('init','-b','main')
            remote.git('config','user.email','tests@localhost')
            remote.git('config','user.name','Bedazzle test')
            (upstream/'app.py').write_text('version one')
            (upstream/'.gitignore').write_text('workspace/\n')
            remote.git('add','app.py','.gitignore');remote.git('commit','-m','Initial')
            (local/'app.py').write_text('my personal edits')
            (local/'workspace').mkdir();(local/'workspace'/'private.csv').write_text('private data')
            repo=Repository(local)
            with patch('repository.UPSTREAM',str(upstream)):
                linked=repo.action('link')
                self.assertTrue(linked['modified'])
                self.assertEqual((local/'app.py').read_text(),'my personal edits')
                self.assertNotIn('private.csv',repo.git('ls-files').stdout)
                (upstream/'app.py').write_text('version two')
                remote.git('add','app.py');remote.git('commit','-m','Update')
                with self.assertRaisesRegex(ValueError,'Local edits'):repo.action('update')
                self.assertEqual((local/'app.py').read_text(),'my personal edits')
                (local/'app.py').write_text('version one')
                (local/'.gitignore').write_text('workspace/\n')
                repo.action('update')
                self.assertEqual((local/'app.py').read_text(),'version two')
                self.assertEqual((local/'workspace'/'private.csv').read_text(),'private data')
