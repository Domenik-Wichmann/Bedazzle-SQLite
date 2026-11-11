"""Explicit Git actions for this application only; never discard working files."""
import os
import shutil
import subprocess
import threading
from pathlib import Path

UPSTREAM = 'https://github.com/Domenik-Wichmann/Bedazzle-SQLite.git'


class Repository:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.lock = threading.Lock()

    def git(self, *args, check=True):
        command = shutil.which('git')
        if not command:
            raise ValueError('Install Git for Windows from git-scm.com, then restart Bedazzle. Your files stay as they are.')
        result = subprocess.run([command, '-C', str(self.root), *args], capture_output=True,
                                encoding='utf-8', errors='replace', timeout=120,
                                env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'},
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
        if not shutil.which('git'):
            return {'available': False, 'linked': False, 'message': 'Git is not installed. Install Git for Windows, then restart Bedazzle.'}
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
