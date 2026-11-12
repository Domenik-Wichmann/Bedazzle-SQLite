"""Streaming dataset downloads using the checker's pinned-address network policy."""
import os
import shutil
import time
from pathlib import Path
from urllib.parse import urljoin
from engine import file_kind, publish_file
from modules.image_checker.network import target, connection

DEFAULT_BYTES=100*1024*1024


def download(url, output, limit, timeout, allow_private, check, emit, oversize):
    output=Path(output)
    if output.exists():raise ValueError('Destination exists; choose a new file')
    if not output.parent.is_dir():raise ValueError('Destination folder does not exist')
    if file_kind(output) not in ('.csv','.tsv','.txt','.psv','.tab','.dat','.parquet','.pq','.json','.jsonl','.ndjson','.ndjsonl'):
        raise ValueError('Choose a supported dataset filename/format')
    if not 1<=limit<=1024**4 or not 1<=timeout<=300:raise ValueError('Invalid download limits')
    deadline=time.monotonic()+timeout;current=url
    partial=output.parent/('.'+output.name+'.download.partial')
    if partial.exists():raise ValueError('A partial download already exists; review it before retrying')
    try:
        for hop in range(9):
            check();remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('Download deadline exceeded')
            parts,host,port,address=target(current,allow_private)
            client=connection(parts,host,port,address,min(remaining,10))
            try:
                path=parts.path or '/'
                if parts.query:path+='?'+parts.query
                client.request('GET',path,headers={'Accept-Encoding':'identity','User-Agent':'Bedazzle-Local-Ingest/0.2'})
                response=client.getresponse()
                if response.status in (301,302,303,307,308):
                    location=response.getheader('Location')
                    if not location or hop==8:raise ValueError('Invalid or excessive redirects')
                    next_url=urljoin(current,location)
                    if parts.scheme=='https' and not next_url.lower().startswith('https://'):raise ValueError('HTTPS downgrade blocked')
                    current=next_url;continue
                if response.status!=200:raise ValueError('Dataset server returned HTTP '+str(response.status))
                if response.getheader('Content-Encoding','identity').lower()!='identity':raise ValueError('Unexpected HTTP content encoding; use an explicit .gz/.zst dataset URL')
                declared=response.getheader('Content-Length');declared=int(declared) if declared and declared.isdecimal() else None
                if declared is not None and declared>limit:oversize(declared,0)
                received=0
                with partial.open('xb') as stream:
                    while True:
                        check();remaining=deadline-time.monotonic()
                        if remaining<=0:raise TimeoutError('Download deadline exceeded')
                        if client.sock:client.sock.settimeout(min(remaining,10))
                        block=response.read(min(65536,limit-received+1))
                        if not block:break
                        received+=len(block)
                        if received>limit:oversize(None,received)
                        if received%(1024*1024)<65536 and shutil.disk_usage(output.parent).free<512*1024**2:
                            raise ValueError('Download stopped: keep at least 512 MiB free disk space')
                        stream.write(block)
                        if received%(1024*1024)<65536:emit({'label':'Downloading dataset','detail':str(received)+' bytes received','percent':None})
                    stream.flush();os.fsync(stream.fileno())
                if declared is not None and declared!=received:raise ValueError('Body size differs from Content-Length')
                publish_file(partial,output)
                return {'path':str(output),'downloaded_bytes':received,'final_url':current,'declared_bytes':declared}
            finally:client.close()
    finally:partial.unlink(missing_ok=True)
