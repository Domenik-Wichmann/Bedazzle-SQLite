"""Synthetic disk-index benchmark; no downloads or image decoding."""
import json
from pathlib import Path
import random
import sys
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import create_connection
from module_runtime import Context
from modules.image_checker.similarity import build


def main():
    parent=ROOT/'workspace'/'performance';parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=parent) as directory:
        root=Path(directory);conn=create_connection(root,{'memory_mb':256,'threads':1,'spill_gb':1},'similarity-bench')
        try:
            conn.execute('''CREATE TABLE observed(sha256 VARCHAR,url VARCHAR,safe_url VARCHAR,display_width INTEGER,display_height INTEGER,
                phash VARCHAR,dhash VARCHAR,average_rgb VARCHAR,aspect_ratio DOUBLE,animated BOOLEAN,complete_decode BOOLEAN,uniform_image BOOLEAN,
                fully_transparent BOOLEAN,entropy DOUBLE,luminance_stddev DOUBLE)''')
            rng=random.Random(1234);batch=[]
            for i in range(5000):
                if i%5==1:h=previous_h^0b10101;d=previous_d^0b11
                else:h=rng.getrandbits(64);d=rng.getrandbits(64)
                previous_h=h;previous_d=d
                batch.append((f'{i:064x}',f'https://example.com/{i}',f'https://example.com/{i}',100,100,f'{h:016x}',f'{d:016x}','[100,100,100]',1,False,True,False,False,5,30))
                if len(batch)==500:conn.executemany('INSERT INTO observed VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',batch);batch=[]
            ctx=Context(conn,root,root,{'id':'benchmark'},threading.Event(),lambda value:None)
            started=time.perf_counter();summary=build(ctx,'observed',{})
            summary.update(wall_ms=round((time.perf_counter()-started)*1000,2),index_mb=round((root/'similarity.sqlite3').stat().st_size/1024**2,3),all_pairs=5000*4999//2)
            assert summary['status']=='complete' and summary['pairs']==1000,summary
            assert summary['comparisons']<summary['all_pairs']//20,summary
            (parent/'image-similarity-performance.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
            print(json.dumps(summary,indent=2))
        finally:conn.close()


if __name__=='__main__':main()
