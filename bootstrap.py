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


def _ensure_duckdb():
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


PILLOW_WHEELS={
 '312':('ff/cd/73a79ecdc822076002eb24b5e1e4a530b0bb5310fcb6d239abbec877110b','ff3fe9eb621fbb9db4c4be33ab946f6bac5f98ab50ca8d3260503653656c961b'),
 '313':('d7/ed/1b16fb66a37e1b9e41370b93b2c614c7da761a5b2a41dc333f7af4639962','9dda0788a9932776a75d8bcc020076edc308ce2508b51f6739a45e3158b3fc42'),
 '314':('50/e2/7ad17747517e4c813dca78257d6bb593466f8231baf1384bc98d92745edb','f7cbb7a64e7ec664775195e4f81923bc8a93d9451b963f844e59118f63147a7a'),
 '315':('44/05/fdb6a79aee10861165526b41b7b440e36ee1ff58613b2fbefe3acbf06d4f','d4737f50d23ddd11d6685faacbb9252887dde0bc7997127757247983d74399d6')}


def ensure_images():
    import importlib
    if str(ENGINE) not in sys.path:sys.path.insert(0,str(ENGINE))
    try:
        from PIL import Image, __version__
        if __version__=='13.0.0':return
    except ImportError:pass
    tag=str(sys.version_info.major)+str(sys.version_info.minor)
    if tag not in PILLOW_WHEELS:
        raise RuntimeError('Install Pillow 13.0.0 for this Python, or use the bundled Windows launcher.')
    location,checksum=PILLOW_WHEELS[tag]
    filename=f'pillow-13.0.0-cp{tag}-cp{tag}-win_amd64.whl'
    target=ROOT/'runtime'/'downloads'/filename;target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():
        print('First-time setup: downloading the image decoder (about 7 MB)…',flush=True)
        partial=target.with_suffix('.partial')
        try:
            with urllib.request.urlopen('https://files.pythonhosted.org/packages/'+location+'/'+filename,timeout=60) as response,partial.open('wb') as output:
                for block in iter(lambda:response.read(1024*1024),b''):output.write(block)
            verify(partial,checksum);os.replace(partial,target)
        finally:partial.unlink(missing_ok=True)
    verify(target,checksum);extract(target,ENGINE);importlib.invalidate_caches()
    print('Image decoder ready. No runtime downloads needed on future launches.',flush=True)


def ensure_engine():
    _ensure_duckdb()
    ensure_images()


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        ensure_engine()
    except (OSError,ValueError,RuntimeError) as error:
        print('Bedazzle setup: '+str(error),file=sys.stderr)
        raise SystemExit(1)
