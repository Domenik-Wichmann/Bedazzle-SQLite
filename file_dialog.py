"""Windows native file dialogs without an additional GUI dependency."""
import ctypes
from ctypes import wintypes
import json
import sys


class OpenFileName(ctypes.Structure):
    _fields_ = [('lStructSize', wintypes.DWORD), ('hwndOwner', wintypes.HWND),
                ('hInstance', wintypes.HINSTANCE), ('lpstrFilter', wintypes.LPCWSTR),
                ('lpstrCustomFilter', wintypes.LPWSTR), ('nMaxCustFilter', wintypes.DWORD),
                ('nFilterIndex', wintypes.DWORD), ('lpstrFile', wintypes.LPWSTR),
                ('nMaxFile', wintypes.DWORD), ('lpstrFileTitle', wintypes.LPWSTR),
                ('nMaxFileTitle', wintypes.DWORD), ('lpstrInitialDir', wintypes.LPCWSTR),
                ('lpstrTitle', wintypes.LPCWSTR), ('Flags', wintypes.DWORD),
                ('nFileOffset', wintypes.WORD), ('nFileExtension', wintypes.WORD),
                ('lpstrDefExt', wintypes.LPCWSTR), ('lCustData', ctypes.c_void_p),
                ('lpfnHook', ctypes.c_void_p), ('lpTemplateName', wintypes.LPCWSTR),
                ('pvReserved', ctypes.c_void_p), ('dwReserved', wintypes.DWORD),
                ('FlagsEx', wintypes.DWORD)]


def choose(mode, extension='csv', filename=''):
    buffer = ctypes.create_unicode_buffer(32768)
    buffer.value = filename[:32000]
    data = OpenFileName()
    data.lStructSize = ctypes.sizeof(data)
    # The chooser runs in a console-free child, so it has no owner by default.
    # Associate it with the foreground Bedazzle browser window, not an unrelated
    # app the user may have switched to while the request was starting.
    user32=ctypes.windll.user32
    user32.GetForegroundWindow.restype=wintypes.HWND
    user32.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
    user32.GetWindowTextW.restype=ctypes.c_int
    foreground=user32.GetForegroundWindow()
    title=ctypes.create_unicode_buffer(1024)
    if foreground:
        user32.GetWindowTextW(foreground,title,len(title))
        if 'bedazzle' in title.value.casefold():data.hwndOwner=foreground
    data.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    data.nMaxFile = len(buffer)
    data.nFilterIndex = 1
    data.Flags = 0x00080000 | 0x00000800 | 0x00000008  # EXPLORER, PATHMUSTEXIST, NOCHANGEDIR
    data.lpstrTitle = 'Open a local data file' if mode == 'open' else 'Save full results'
    if mode == 'open':
        data.Flags |= 0x00001000
        data.lpstrFilter = 'Data files\0*.csv;*.tsv;*.txt;*.parquet;*.pq;*.json;*.jsonl;*.ndjson;*.ndjsonl;*.psv;*.tab;*.dat;*.gz;*.zst;*.zstd\0All files\0*.*\0\0'
        function = ctypes.windll.comdlg32.GetOpenFileNameW
    else:
        if extension not in ('csv', 'tsv', 'parquet', 'json', 'ndjson'):
            raise ValueError('Unsupported export format')
        data.lpstrFilter = f'{extension.upper()} file\0*.{extension}\0\0'
        data.lpstrDefExt = extension
        function = ctypes.windll.comdlg32.GetSaveFileNameW
    function.argtypes=[ctypes.POINTER(OpenFileName)]
    function.restype=wintypes.BOOL
    if function(ctypes.byref(data)):
        return {'path': buffer.value}
    error = ctypes.windll.comdlg32.CommDlgExtendedError()
    if error:
        raise RuntimeError(f'Native file dialog error {error}. Paste a file path instead.')
    return {'path': None}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(choose(*sys.argv[1:]), ensure_ascii=False))
