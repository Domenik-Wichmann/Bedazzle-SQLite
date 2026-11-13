"""Windows installations must work when the long-running app has an older PATH."""
import contextlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from engine import ROOT
from repository import Repository, git_executable


class GitDetectionTests(unittest.TestCase):
    def test_path_has_priority(self):
        with patch('repository.shutil.which',return_value='chosen-git'):
            with patch('repository.windows_git_roots') as fallback:
                self.assertEqual(git_executable(),'chosen-git')
                fallback.assert_not_called()

    def test_standard_and_user_installations_without_path(self):
        for variable,relative in [('ProgramFiles','Git/cmd/git.exe'),('ProgramW6432','Git/bin/git.exe'),('ProgramFiles(x86)','Git/cmd/git.exe'),('LOCALAPPDATA','Programs/Git/cmd/git.exe')]:
            with self.subTest(variable=variable),tempfile.TemporaryDirectory(dir=ROOT/'workspace') as directory:
                executable=Path(directory)/relative;executable.parent.mkdir(parents=True);executable.touch()
                with patch.dict(os.environ,{variable:directory},clear=True),patch.dict(sys.modules,{'winreg':None}),patch('repository.sys.platform','win32'),patch('repository.shutil.which',return_value=None):
                    self.assertEqual(Path(git_executable()),executable)

    def test_registry_custom_location_and_alternate_views(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'workspace') as directory:
            executable=Path(directory)/'Custom Git/cmd/git.exe';executable.parent.mkdir(parents=True);executable.touch()
            opened=[]
            def open_key(hive,key,reserved,access):
                opened.append((hive,key,access));return contextlib.nullcontext((hive,access))
            def query(key,name):
                self.assertEqual(name,'InstallPath')
                if key==(1,33):return str(executable.parent.parent),1
                raise FileNotFoundError()
            registry=SimpleNamespace(HKEY_CURRENT_USER=1,HKEY_LOCAL_MACHINE=2,KEY_WOW64_64KEY=64,KEY_WOW64_32KEY=32,KEY_READ=1,REG_SZ=1,REG_EXPAND_SZ=2,OpenKey=open_key,QueryValueEx=query,ExpandEnvironmentStrings=lambda value:value)
            with patch.dict(sys.modules,{'winreg':registry}),patch('repository.sys.platform','win32'),patch('repository.shutil.which',return_value=None):
                self.assertEqual(Path(git_executable()),executable)
            self.assertEqual(len(opened),3)
            self.assertTrue(all(item[1]==r'Software\GitForWindows' for item in opened))

    def test_no_negative_cache_after_install(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'workspace') as directory:
            root=Path(directory);repo=Repository(root)
            with patch('repository.sys.platform','win32'),patch('repository.shutil.which',return_value=None),patch('repository.windows_git_roots',side_effect=lambda:iter([root])):
                missing=repo.status();self.assertFalse(missing['available'])
                self.assertNotIn('Git is not installed',missing['message'])
                executable=root/'cmd/git.exe';executable.parent.mkdir();executable.touch()
                self.assertTrue(repo.status()['available'])

    def test_relative_install_locations_are_not_executed(self):
        with patch('repository.sys.platform','win32'),patch('repository.shutil.which',return_value=None),patch('repository.windows_git_roots',return_value=[Path('Git')]):
            self.assertIsNone(git_executable())

    @unittest.skipUnless(sys.platform=='win32' and shutil.which('git'),'Real Git for Windows required')
    def test_actual_git_runs_with_empty_inherited_path(self):
        installed=Path(shutil.which('git')).resolve().parent.parent
        with tempfile.TemporaryDirectory(dir=ROOT/'workspace') as directory:
            with patch.dict(os.environ,{'PATH':''}),patch('repository.shutil.which',return_value=None),patch('repository.windows_git_roots',side_effect=lambda:iter([installed])):
                repo=Repository(directory)
                self.assertIn('git version',repo.git('--version').stdout)
                repo.git('init','-b','main')
                self.assertTrue((Path(directory)/'.git').is_dir())


if __name__=='__main__':unittest.main()
