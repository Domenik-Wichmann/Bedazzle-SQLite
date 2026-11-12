"""Lifetime service-owner lock; OS releases it on abnormal termination."""
import atexit
import os
from pathlib import Path


def acquire(workspace):
    stream = (Path(workspace) / 'service-owner.lock').open('a+b')
    stream.seek(0)
    if stream.read(1) == b'':
        stream.write(b'0')
        stream.flush()
    stream.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        stream.close()
        return False
    atexit.register(stream.close)
    return True
