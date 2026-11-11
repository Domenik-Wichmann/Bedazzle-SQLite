"""Build a redistributable bundle without user data, Git metadata or caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from project_files import FILES

root = Path(__file__).resolve().parent
out = root / 'dist' / 'Bedazzle-Windows.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.write(root / name, name)
    for folder in ['runtime/python', 'runtime/engine']:
        for path in (root / folder).rglob('*'):
            if path.is_file() and path.suffix != '.pyc' and not {'.git', '__pycache__'}.intersection(path.relative_to(root).parts):
                archive.write(path, path.relative_to(root))
print(out)
print(f'{out.stat().st_size / 1024**2:.1f} MB')
