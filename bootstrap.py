"""Fetch Bedazzle's pinned native dependency into this folder, never system Python."""
from pathlib import Path
import hashlib
import os
import struct
import sys
import urllib.request
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parent
ENGINE=ROOT/'runtime'/'engine'
WHEEL_URL='https://files.pythonhosted.org/packages/09/d3/9e8ca1242b98f04041bef09686ecfe098b41f820aa23240f63f360b64eaf/duckdb-2.0.0-cp312-abi3-win_amd64.whl'
WHEEL_SHA256='f61c96547ed432f54dae42a717fd88563eda55cb47549715fac9f61f770c205a'


def verify(path, expected):
    digest=hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):
            digest.update(block)
    if digest.hexdigest()!=expected:
        raise ValueError('Download checksum did not match. Please retry; the file has not been installed.')


def extract(archive,destination):
    destination=Path(destination).resolve()
    with ZipFile(archive) as zipped:
        for item in zipped.infolist():
            target=(destination/item.filename).resolve()
            if not target.is_relative_to(destination):
                raise ValueError('Archive contains a path outside the installation folder.')
        zipped.extractall(destination)


def ensure_engine():
    if sys.platform!='win32' or struct.calcsize('P')!=8:
        raise RuntimeError('This bundle is for 64-bit Windows. Use Python 3.12+ with the DuckDB package on other platforms; native file dialogs are Windows-specific.')
    if sys.version_info<(3,12):
        raise RuntimeError('Use Start Bedazzle.cmd or Python 3.12 or newer.')
    embedded=ROOT/'runtime'/'python'
    if Path(sys.executable).resolve().parent==embedded.resolve():
        path_file=embedded/'python314._pth'
        expected='python314.zip\n.\n../../\n../engine\n'
        if not path_file.exists() or path_file.read_text()!=expected:
            path_file.write_text(expected,encoding='utf-8')
    if (ENGINE/'_duckdb.pyd').is_file() and (ENGINE/'duckdb-2.0.0.dist-info'/'METADATA').is_file():
        return
    from importlib.metadata import PackageNotFoundError,version
    try:
        if version('duckdb')=='2.0.0':
            return
    except PackageNotFoundError:
        pass
    downloads=ROOT/'runtime'/'downloads'
    downloads.mkdir(parents=True,exist_ok=True)
    target=downloads/'duckdb-2.0.0-cp312-abi3-win_amd64.whl'
    if not target.exists():
        print('First-time setup: downloading DuckDB (about 15 MB)…',flush=True)
        partial=target.with_suffix('.partial')
        try:
            with urllib.request.urlopen(WHEEL_URL,timeout=60) as response,partial.open('wb') as output:
                for block in iter(lambda:response.read(1024*1024),b''):
                    output.write(block)
            verify(partial,WHEEL_SHA256)
            os.replace(partial,target)
        finally:
            partial.unlink(missing_ok=True)
    verify(target,WHEEL_SHA256)
    extract(target,ENGINE)
    print('DuckDB is ready. Future launches work offline.',flush=True)


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        ensure_engine()
    except (OSError,ValueError,RuntimeError) as error:
        print('Bedazzle setup: '+str(error),file=sys.stderr)
        raise SystemExit(1)
