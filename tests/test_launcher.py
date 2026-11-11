from pathlib import Path
import hashlib
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

import bootstrap
import launcher


class LauncherTests(unittest.TestCase):
    def setUp(self):
        base=launcher.ROOT/'workspace'/'bootstrap-tests'
        base.mkdir(parents=True,exist_ok=True)
        self.directory=tempfile.TemporaryDirectory(dir=base)
        self.root=Path(self.directory.name).resolve()
        assert self.root.is_relative_to(base.resolve())

    def tearDown(self):
        self.directory.cleanup()

    def test_checksum_validation_rejects_corruption(self):
        file=self.root/'download.zip';file.write_bytes(b'expected')
        bootstrap.verify(file,hashlib.sha256(b'expected').hexdigest())
        with self.assertRaises(ValueError):bootstrap.verify(file,'0'*64)

    def test_archive_cannot_write_outside_runtime(self):
        file=self.root/'bad.zip'
        with ZipFile(file,'w') as zipped:zipped.writestr('../outside.txt','bad')
        with self.assertRaises(ValueError):bootstrap.extract(file,self.root/'target')
        self.assertFalse((self.root/'outside.txt').exists())

    def test_existing_workspace_is_preserved(self):
        with patch.object(launcher,'ROOT',self.root):
            self.assertEqual(launcher.default_workspace(),self.root/'workspace'/'bedazzle')
            old=self.root/'workspace'/'fieldwork';old.mkdir(parents=True)
            (old/'preferences.sqlite3').touch()
            self.assertEqual(launcher.default_workspace(),old)


if __name__=='__main__':unittest.main()
