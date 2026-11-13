"""Explicit Git actions for this application only; never discard working files."""
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

UPSTREAM = 'https://github.com/Domenik-Wichmann/Bedazzle-SQLite.git'
GIT_NOT_FOUND = ('Git could not be found in PATH or its Windows installation locations. '
                 'If you just installed Git for Windows, click Refresh Git status to retry. '
                 'Git is only needed for source updates; your local data tools remain available.')


def windows_git_roots():
    """Read installer locations without changing registry, PATH or machine settings."""
    try:
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for view in (0, winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
                try:
                    with winreg.OpenKey(hive, r'Software\GitForWindows', 0, winreg.KEY_READ | view) as key:
                        value, kind = winreg.QueryValueEx(key, 'InstallPath')
                    if kind in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) and isinstance(value, str) and value.strip():
                        yield Path(winreg.ExpandEnvironmentStrings(value).strip().strip('"'))
                except OSError:
                    continue
    except ImportError:
        pass
    for name in ('ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)'):
        if os.environ.get(name):
            yield Path(os.environ[name]) / 'Git'
    if os.environ.get('LOCALAPPDATA'):
        yield Path(os.environ['LOCALAPPDATA']) / 'Programs' / 'Git'


def git_executable():
    """Resolve afresh on every request, including after an in-session installation."""
    command = shutil.which('git')
    if command:
        return command
    if sys.platform == 'win32':
        seen = set()
        for root in windows_git_roots():
            if not root.is_absolute():
                continue
            for relative in ('cmd/git.exe', 'bin/git.exe'):
                candidate = root / relative
                key = str(candidate).casefold()
                if key not in seen:
                    seen.add(key)
                    if candidate.is_file():
                        return str(candidate)
    return None


class Repository:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.lock = threading.Lock()

    def git(self, *args, check=True):
        command = git_executable()
        if not command:
            raise ValueError(GIT_NOT_FOUND)
        result = subprocess.run([command, '-C', str(self.root), *args], capture_output=True,
                                encoding='utf-8', errors='replace', timeout=120,
                                env={**os.environ, 'PATH':str(Path(command).parent)+os.pathsep+os.environ.get('PATH',''),
                                     'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'},
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if check and result.returncode:
            raise ValueError((result.stderr or result.stdout).strip()[-1500:])
        return result

    def linked(self):
        # Do not accidentally adopt or change a repository in a parent directory.
        return (self.root / '.git').exists()

    def verify_remote(self):
        remote = self.git('remote', 'get-url', 'origin').stdout.strip()
        if remote.removesuffix('.git').rstrip('/') != UPSTREAM.removesuffix('.git'):
            raise ValueError('This folder uses a different Git origin. Manage it with your existing Git tools.')

    def status(self):
        command = git_executable()
        if not command:
            return {'available': False, 'linked': self.linked(), 'message': GIT_NOT_FOUND}
        if not self.linked():
            return {'available': True, 'linked': False, 'message': 'Connect this folder to the Bedazzle repository. Existing files and edits are kept.'}
        remote = self.git('remote', 'get-url', 'origin', check=False)
        if remote.returncode:
            return {'available': True, 'linked': False, 'message': 'Git was initialized but not connected. Click Connect to finish; existing files are kept.'}
        self.verify_remote()
        if self.git('rev-parse', '--verify', 'HEAD', check=False).returncode:
            return {'available': True, 'linked': False, 'message': 'Connection was interrupted. Click Connect to retry the download.'}
        changes = bool(self.git('status', '--porcelain', '--untracked-files=no').stdout.strip())
        remote = self.git('rev-parse', '--verify', 'origin/main', check=False)
        ahead = behind = 0
        if not remote.returncode:
            counts = self.git('rev-list', '--left-right', '--count', 'HEAD...origin/main').stdout.split()
            ahead, behind = map(int, counts)
        return {'available': True, 'linked': True, 'modified': changes, 'ahead': ahead, 'behind': behind,
                'message': 'Local edits are preserved; commit or stash them before updating.' if changes else
                           f'{behind} update commit(s) available.' if behind else 'Connected. No known updates; check to contact GitHub.'}

    def action(self, action):
        if not self.lock.acquire(blocking=False):
            raise ValueError('A repository operation is already running.')
        try:
            if action == 'link':
                if self.linked() and not self.git('rev-parse', '--verify', 'HEAD', check=False).returncode:
                    raise ValueError('This folder is already connected to Git.')
                if not self.linked():
                    self.git('init', '-b', 'main')
                if self.git('remote', 'get-url', 'origin', check=False).returncode:
                    self.git('remote', 'add', 'origin', UPSTREAM)
                self.verify_remote()
                self.git('fetch', 'origin', 'main')
                # Index and branch only. No checkout/reset of the working tree.
                # Different app files remain local modifications; private files are untracked.
                self.git('read-tree', 'origin/main')
                self.git('update-ref', 'refs/heads/main', self.git('rev-parse', 'origin/main').stdout.strip())
                self.git('branch', '--set-upstream-to=origin/main', 'main')
            elif action in ('check', 'update'):
                if not self.linked():
                    raise ValueError('Connect this folder first.')
                self.verify_remote()
                self.git('fetch', 'origin', 'main')
                if action == 'update':
                    if self.git('status', '--porcelain', '--untracked-files=no').stdout.strip():
                        raise ValueError('Local edits found. Commit or stash them before updating. Nothing was overwritten.')
                    # Git also refuses untracked-file collisions and divergent history.
                    self.git('merge', '--ff-only', 'origin/main')
            else:
                raise ValueError('Unknown repository action.')
            result = self.status()
            if action == 'update':
                result['message'] = 'Update applied. Close Bedazzle and run Start Bedazzle.cmd again.'
            return result
        finally:
            self.lock.release()
