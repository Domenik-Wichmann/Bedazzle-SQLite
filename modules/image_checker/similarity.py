"""Local perceptual matching with a disk index and explicit search budgets."""
from contextlib import closing
import json
import math
import sqlite3
import statistics
import time

from engine import identifier, literal

# Low-frequency DCT basis; no NumPy, model download or external service required.
_BASIS=tuple(tuple(math.cos(math.pi*(2*x+1)*u/64) for x in range(32)) for u in range(8))
SENSITIVITY={'strict':(4,6,.08,35),'balanced':(6,10,.15,55),'broad':(8,14,.25,75)}
FIELDS=['similarity_matches','similarity_best_score','similarity_search_status']


def phash(image):
    """64-bit perceptual hash of an oriented, white-composited thumbnail."""
    from PIL import Image
    values=list(image.convert('L').resize((32,32),Image.Resampling.LANCZOS).get_flattened_data())
    horizontal=[[sum(values[y*32+x]*_BASIS[u][x] for x in range(32)) for u in range(8)] for y in range(32)]
    coefficients=[sum(horizontal[y][u]*_BASIS[v][y] for y in range(32)) for v in range(8) for u in range(8)]
    median=statistics.median(coefficients[1:])
    return f'{sum((value>median)<<i for i,value in enumerate(coefficients) if i):016x}'


def bands(value,radius):
    # Pigeonhole indexing: <= radius differing bits must leave one band identical.
    count=radius+1
    for band in range(count):
        start=64*band//count;end=64*(band+1)//count
        yield band,(value>>start)&((1<<(end-start))-1)


def open_index(path):
    db=sqlite3.connect(path);db.row_factory=sqlite3.Row
    db.execute('PRAGMA cache_size=-8192')
    return db


def build(ctx,relation,options,url_column='url',*,candidate_limit=2000,comparison_limit=2000000,pair_limit=100000):
    """Each distinct byte content is a node. Only earlier indexed nodes are compared."""
    sensitivity=options.get('similarity_sensitivity','balanced')
    if sensitivity not in SENSITIVITY:raise ValueError('Choose a supported similarity sensitivity.')
    radius,distance_limit,aspect_limit,color_limit=SENSITIVITY[sensitivity]
    seconds=int(options.get('similarity_seconds',30))
    if not 5<=seconds<=300:raise ValueError('Similarity search time must be 5 to 300 seconds.')
    enabled=options.get('similarity_enabled',True)
    path=ctx.directory/'similarity.partial';path.unlink(missing_ok=True);path.with_name('similarity.partial-journal').unlink(missing_ok=True)
    started=time.monotonic();comparisons=0;pair_count=0;limited=0;stopped=False
    summary={'enabled':enabled,'sensitivity':sensitivity,'include_color_variants':options.get('similarity_color_variants',False),
             'algorithm':'phash-dhash-v1','radius':radius,'candidate_limit':candidate_limit,'comparison_limit':comparison_limit,'pair_limit':pair_limit,'seconds_limit':seconds}
    ctx.activity('Finding visually similar images','Indexing unique content; exact byte duplicates stay in the duplicate report.',percent=97)
    with closing(open_index(path)) as db:
        db.executescript('''
            CREATE TABLE nodes(id INTEGER PRIMARY KEY,sha256 TEXT UNIQUE,url TEXT,safe_url TEXT,width INTEGER,height INTEGER,
                phash TEXT,dhash TEXT,rgb TEXT,aspect REAL,animated INTEGER,search_status TEXT DEFAULT 'pending');
            CREATE TABLE bands(band INTEGER,value INTEGER,node_id INTEGER);
            CREATE INDEX band_lookup ON bands(band,value,node_id);
            CREATE TABLE pairs(id INTEGER PRIMARY KEY,left_id INTEGER,right_id INTEGER,score REAL,phash_distance INTEGER,
                dhash_distance INTEGER,color_difference REAL,aspect_difference REAL);
            CREATE INDEX pair_left ON pairs(left_id);CREATE INDEX pair_right ON pairs(right_id);
        ''')
        query=f'''SELECT sha256,min({identifier(url_column)}) AS url,arg_min(safe_url,{identifier(url_column)}),any_value(display_width),any_value(display_height),
            any_value(phash),any_value(dhash),any_value(average_rgb),any_value(aspect_ratio),bool_or(animated)
            FROM {relation} WHERE sha256 IS NOT NULL AND phash IS NOT NULL AND dhash IS NOT NULL AND complete_decode
                AND NOT coalesce(uniform_image,false) AND NOT coalesce(fully_transparent,false)
                AND coalesce(entropy,0)>=1 AND coalesce(luminance_stddev,0)>=4
            GROUP BY sha256 ORDER BY sha256'''
        if enabled:
            cursor=ctx.conn.execute(query)
            while True:
                ctx.check_cancelled();batch=cursor.fetchmany(512)
                if not batch:break
                db.executemany('INSERT INTO nodes(sha256,url,safe_url,width,height,phash,dhash,rgb,aspect,animated) VALUES (?,?,?,?,?,?,?,?,?,?)',batch)
            db.commit()
        total=db.execute('SELECT count(*) FROM nodes').fetchone()[0]
        for node in db.execute('SELECT * FROM nodes ORDER BY id'):
            ctx.check_cancelled()
            if comparisons>=comparison_limit or pair_count>=pair_limit or time.monotonic()-started>=seconds:
                stopped=True;break
            seen=set();truncated=False;hash_value=int(node['phash'],16);rgb=json.loads(node['rgb'])
            for band,value in bands(hash_value,radius):
                candidates=db.execute('SELECT n.* FROM bands b JOIN nodes n ON n.id=b.node_id WHERE b.band=? AND b.value=? LIMIT ?',
                                      [band,value,candidate_limit+1])
                for other in candidates:
                    if other['id'] in seen:continue
                    if len(seen)>=candidate_limit or comparisons>=comparison_limit or pair_count>=pair_limit:
                        truncated=True;break
                    seen.add(other['id']);comparisons+=1
                    if comparisons%128==0:
                        ctx.check_cancelled()
                        if time.monotonic()-started>=seconds:truncated=True;stopped=True;break
                    pd=(hash_value^int(other['phash'],16)).bit_count()
                    if pd>radius:continue
                    dd=(int(node['dhash'],16)^int(other['dhash'],16)).bit_count()
                    if dd>distance_limit:continue
                    aspect=abs(node['aspect']-other['aspect'])/max(node['aspect'],other['aspect'])
                    if aspect>aspect_limit:continue
                    color=sum(abs(a-b) for a,b in zip(rgb,json.loads(other['rgb'])))/3
                    if not options.get('similarity_color_variants',False) and color>color_limit:continue
                    # Fingerprint agreement, deliberately not a probability of identity.
                    score=round(100*(1-(.65*pd+.35*dd)/64),2)
                    db.execute('INSERT INTO pairs(left_id,right_id,score,phash_distance,dhash_distance,color_difference,aspect_difference) VALUES (?,?,?,?,?,?,?)',
                               [other['id'],node['id'],score,pd,dd,round(color,2),round(aspect,4)])
                    pair_count+=1
                if truncated:break
            db.execute('UPDATE nodes SET search_status=? WHERE id=?',['limited' if truncated else 'complete',node['id']])
            if truncated:limited+=1
            db.executemany('INSERT INTO bands VALUES (?,?,?)',[(b,v,node['id']) for b,v in bands(hash_value,radius)])
            if node['id']%256==0:
                db.commit();ctx.activity('Finding visually similar images',f'{node["id"]:,} of {total:,} unique contents searched; {pair_count:,} candidate pairs.',percent=98)
        if stopped:
            db.execute("UPDATE nodes SET search_status='not_searched' WHERE search_status='pending'")
        db.commit()
        pending=db.execute("SELECT count(*) FROM nodes WHERE search_status='not_searched'").fetchone()[0]
        summary.update(eligible_contents=total,pairs=pair_count,comparisons=comparisons,limited_contents=limited,
                       not_searched=pending,status='disabled' if not enabled else 'limited' if limited or pending else 'complete',elapsed_ms=round((time.monotonic()-started)*1000,2))
        db.execute('CREATE TABLE metadata(value TEXT)');db.execute('INSERT INTO metadata VALUES (?)',[json.dumps(summary)]);db.commit()
    ctx.check_cancelled();path.replace(ctx.directory/'similarity.sqlite3')
    return summary


def annotate(ctx,sql):
    """Bounded transfer of narrow index statistics into the native report join."""
    path=ctx.directory/'similarity_nodes.ndjson'
    with closing(open_index(ctx.directory/'similarity.sqlite3')) as db,path.open('w',encoding='utf-8') as output:
        query='''WITH edges AS (SELECT left_id AS node_id,score FROM pairs UNION ALL SELECT right_id,score FROM pairs),
            counts AS (SELECT node_id,count(*) AS matches,max(score) AS best FROM edges GROUP BY node_id)
            SELECT sha256,coalesce(matches,0) AS similarity_matches,best AS similarity_best_score,search_status AS similarity_search_status
            FROM nodes LEFT JOIN counts ON nodes.id=counts.node_id'''
        for row in db.execute(query):ctx.check_cancelled();output.write(json.dumps(dict(row))+'\n')
    schema="{'sha256':'VARCHAR','similarity_matches':'BIGINT','similarity_best_score':'DOUBLE','similarity_search_status':'VARCHAR'}"
    relation=f"read_json({literal(path)},format='newline_delimited',columns={schema})"
    with closing(open_index(ctx.directory/'similarity.sqlite3')) as db:enabled=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0])['enabled']
    excluded="'disabled'" if not enabled else "CASE WHEN NOT coalesce(r.complete_decode,false) THEN 'incomplete_decode' WHEN r.phash IS NULL THEN 'no_fingerprint' WHEN coalesce(r.fully_transparent,false) THEN 'transparent' ELSE 'low_detail' END"
    return f"SELECT r.*,coalesce(s.similarity_matches,0) AS similarity_matches,s.similarity_best_score,coalesce(s.similarity_search_status,{excluded}) AS similarity_search_status FROM ({sql}) r LEFT JOIN {relation} s USING(sha256)"


def review_db(workspace):
    db=sqlite3.connect(workspace/'modules'/'similarity_reviews.sqlite3')
    db.execute('CREATE TABLE IF NOT EXISTS reviews(pair_key TEXT PRIMARY KEY,decision TEXT,note TEXT,updated REAL)')
    return db


def pairs(ctx,payload):
    """Page pairs without loading the full index or report into Python."""
    import hashlib
    offset=max(0,min(100000,int(payload.get('offset',0))))
    decision=payload.get('decision','unreviewed')
    if decision not in ('all','unreviewed','similar','different'):raise ValueError('Choose a review status.')
    with closing(open_index(ctx.directory/'similarity.sqlite3')) as db,closing(review_db(ctx.workspace)) as reviews:
        # Review decisions are content-based and survive rechecks. Attach locally.
        db.execute('ATTACH DATABASE ? AS review',[str(ctx.workspace/'modules'/'similarity_reviews.sqlite3')])
        db.create_function('pair_key',2,lambda a,b:hashlib.sha256(''.join(sorted((a,b))).encode()).hexdigest(),deterministic=True)
        where="1=1" if decision=='all' else "coalesce(r.decision,'unreviewed')=?"
        args=[] if decision=='all' else [decision]
        content=payload.get('sha256')
        if content:
            import re
            if not isinstance(content,str) or not re.fullmatch('[0-9a-f]{64}',content):raise ValueError('Choose a valid content hash.')
            where+=' AND (a.sha256=? OR b.sha256=?)';args.extend([content,content])
        base=f'''FROM pairs p JOIN nodes a ON a.id=p.left_id JOIN nodes b ON b.id=p.right_id
            LEFT JOIN review.reviews r ON r.pair_key=pair_key(a.sha256,b.sha256) WHERE {where}'''
        total=db.execute('SELECT count(*) '+base,args).fetchone()[0]
        rows=[dict(row) for row in db.execute('''SELECT p.*,pair_key(a.sha256,b.sha256) AS pair_key,
            a.sha256 AS left_sha256,b.sha256 AS right_sha256,a.safe_url AS left_url,b.safe_url AS right_url,
            a.width AS left_width,a.height AS left_height,b.width AS right_width,b.height AS right_height,
            a.animated OR b.animated AS first_frame_only,coalesce(r.decision,'unreviewed') AS decision,coalesce(r.note,'') AS note '''+base+
            ' ORDER BY score DESC,p.id LIMIT 20 OFFSET ?',args+[offset])]
        summary=json.loads(db.execute('SELECT value FROM metadata').fetchone()[0])
        summary['report_synchronized']=not ctx.record.get('similarity_rebuilding',False)
    hashes=list({row[side+'_sha256'] for row in rows for side in ('left','right')})
    if hashes:
        placeholders=','.join('?' for _ in hashes)
        representatives=ctx.conn.execute(f'''SELECT sha256,row_id,url_column,record_id,url_affected_records,verdict,issue,image_bytes,detected_mime,coverage,checked_at FROM read_parquet({literal(ctx.directory/ctx.record['report'])})
            WHERE sha256 IN ({placeholders}) QUALIFY row_number() OVER (PARTITION BY sha256 ORDER BY image_url,row_id,url_column)=1''',hashes).fetchall()
        mapping={row[0]:dict(zip(('row_id','url_column','record_id','affected_records','verdict','issue','image_bytes','mime','coverage','checked_at'),row[1:])) for row in representatives}
        for row in rows:
            for side in ('left','right'):row[side]=mapping.get(row[side+'_sha256'])
    return {'pairs':rows,'total':total,'offset':offset,'summary':summary}


def decide(ctx,payload):
    import hashlib
    decision=payload.get('decision');note=payload.get('note','')
    if decision not in ('unreviewed','similar','different') or not isinstance(note,str) or len(note)>500:raise ValueError('Choose a review status and keep notes within 500 characters.')
    with closing(open_index(ctx.directory/'similarity.sqlite3')) as db:
        row=db.execute('SELECT a.sha256,b.sha256 FROM pairs p JOIN nodes a ON a.id=p.left_id JOIN nodes b ON b.id=p.right_id WHERE p.id=?',[int(payload['pair_id'])]).fetchone()
        if not row:raise ValueError('Similarity pair not found.')
    key=hashlib.sha256(''.join(sorted(row)).encode()).hexdigest()
    with closing(review_db(ctx.workspace)) as db:
        db.execute('INSERT OR REPLACE INTO reviews VALUES (?,?,?,?)',[key,decision,note,time.time()]);db.commit()
    return {'message':'Review saved. This does not change source records or image verdicts.'}


def export_pairs(ctx,payload):
    """Stream review evidence to a typed local export; default URLs are redacted."""
    import hashlib
    sensitive=payload.get('include_full_urls',False) is True
    decision=payload.get('decision','all')
    if decision not in ('all','unreviewed','similar','different'):raise ValueError('Choose a review status.')
    path=ctx.directory/'similarity_pairs.ndjson'
    with closing(open_index(ctx.directory/'similarity.sqlite3')) as db,closing(review_db(ctx.workspace)),path.open('w',encoding='utf-8') as output:
        db.execute('ATTACH DATABASE ? AS review',[str(ctx.workspace/'modules'/'similarity_reviews.sqlite3')])
        db.create_function('pair_key',2,lambda a,b:hashlib.sha256(''.join(sorted((a,b))).encode()).hexdigest(),deterministic=True)
        url='url' if sensitive else 'safe_url'
        where='' if decision=='all' else "WHERE coalesce(r.decision,'unreviewed')=?"
        args=[] if decision=='all' else [decision]
        content=payload.get('sha256')
        if content:
            import re
            if not isinstance(content,str) or not re.fullmatch('[0-9a-f]{64}',content):raise ValueError('Choose a valid content hash.')
            where+=(' AND ' if where else 'WHERE ')+ '(a.sha256=? OR b.sha256=?)';args.extend([content,content])
        query=f'''SELECT p.id AS pair_id,p.score AS fingerprint_agreement,p.phash_distance,p.dhash_distance,p.color_difference,p.aspect_difference,
            a.sha256 AS left_sha256,b.sha256 AS right_sha256,a.{url} AS left_url,b.{url} AS right_url,
            a.width AS left_width,a.height AS left_height,b.width AS right_width,b.height AS right_height,
            a.animated OR b.animated AS first_frame_only,coalesce(r.decision,'unreviewed') AS decision,coalesce(r.note,'') AS note
            FROM pairs p JOIN nodes a ON a.id=p.left_id JOIN nodes b ON b.id=p.right_id
            LEFT JOIN review.reviews r ON r.pair_key=pair_key(a.sha256,b.sha256) {where} ORDER BY p.score DESC,p.id'''
        for row in db.execute(query,args):ctx.check_cancelled();output.write(json.dumps(dict(row))+'\n')
    schema={key:'VARCHAR' for key in ('left_sha256','right_sha256','left_url','right_url','decision','note')}
    schema.update({key:'BIGINT' for key in ('pair_id','phash_distance','dhash_distance','left_width','left_height','right_width','right_height')})
    schema.update({key:'DOUBLE' for key in ('fingerprint_agreement','color_difference','aspect_difference')});schema['first_frame_only']='BOOLEAN'
    types='{'+','.join(literal(k)+':'+literal(v) for k,v in schema.items())+'}'
    raw=f"read_json({literal(path)},format='newline_delimited',columns={types})"
    report=f"read_parquet({literal(ctx.directory/ctx.record['report'])})"
    sql=f'''WITH representatives AS (SELECT sha256,row_id,url_column,record_id,url_affected_records FROM {report}
        QUALIFY row_number() OVER (PARTITION BY sha256 ORDER BY image_url,row_id,url_column)=1)
        SELECT p.*,l.row_id AS left_row_id,l.url_column AS left_url_column,l.record_id AS left_record_id,l.url_affected_records AS left_affected_records,
            r.row_id AS right_row_id,r.url_column AS right_url_column,r.record_id AS right_record_id,r.url_affected_records AS right_affected_records
        FROM {raw} p LEFT JOIN representatives l ON p.left_sha256=l.sha256 LEFT JOIN representatives r ON p.right_sha256=r.sha256'''
    partial=ctx.directory/'similarity_pairs.partial';partial.unlink(missing_ok=True)
    ctx.conn.execute(f'COPY ({sql}) TO {literal(partial)} (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 16384)')
    ctx.check_cancelled();path=ctx.directory/'similarity_pairs.parquet';partial.replace(path)
    return {'sql':'SELECT * FROM read_parquet('+literal(path)+')'}


def manage(ctx,payload):
    if ctx.record['module']!='image_checker' or ctx.record['status']!='completed':raise ValueError('Choose a completed image run.')
    if ctx.record['version']!='2.1.0':raise ValueError('Start a new image check to generate the upgraded visual fingerprints.')
    operation=payload['operation']
    if operation=='similarity_rebuild':
        overrides=payload.get('options',{})
        options={**ctx.record['options'],**{k:v for k,v in overrides.items() if k in ('similarity_enabled','similarity_sensitivity','similarity_color_variants','similarity_seconds')}}
        if not isinstance(options.get('similarity_enabled',True),bool) or not isinstance(options.get('similarity_color_variants',False),bool):raise ValueError('Similarity switches must be on or off.')
        relation='read_parquet('+literal(ctx.directory/ctx.record['report'])+')'
        ctx.update(similarity_rebuilding=True)
        summary=build(ctx,relation,options,'image_url')
        sql='SELECT * EXCLUDE('+','.join(FIELDS)+') FROM '+relation
        ctx.write_report(annotate(ctx,sql),row_group_size=16384)
        ctx.update(similarity_rebuilding=False,summary={**ctx.record['summary'],'similarity':summary},similarity_options={k:v for k,v in options.items() if k.startswith('similarity_')})
        return {'summary':summary}
    if not (ctx.directory/'similarity.sqlite3').is_file():raise ValueError('Build visual matches first.')
    if operation=='similarity_pairs':return pairs(ctx,payload)
    if operation=='similarity_decide':return decide(ctx,payload)
    if operation=='similarity_export':return export_pairs(ctx,payload)
    raise ValueError('Unknown similarity operation.')
