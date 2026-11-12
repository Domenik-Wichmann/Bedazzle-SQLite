"""Workspace chart sources, bounded full-result aggregation, and saved dashboards."""
import json
import re
import shutil
import time
import uuid
from pathlib import Path
from engine import identifier, literal
from result_store import metadata

TYPES = ('bar', 'horizontal', 'stacked', 'line', 'smooth', 'area', 'stacked-area',
         'pie', 'donut', 'rose', 'scatter', 'histogram', 'boxplot', 'heatmap', 'radar', 'treemap', 'funnel')


def source_path(root, key):
    if not re.fullmatch('[0-9a-f]{32}', str(key)):
        raise ValueError('Invalid chart source.')
    path = root / 'sources' / key
    if not (path / 'source.json').exists():
        raise ValueError('This chart source is no longer available.')
    return path


def library(root):
    file = root / 'library.json'
    return json.loads(file.read_text('utf-8')) if file.exists() else {'charts': []}


def validate(config, columns):
    c = dict(config)
    names = {col['name'] for col in columns}
    if c.get('type') not in TYPES:
        raise ValueError('Choose a supported chart type.')
    if c.get('x') not in names:
        raise ValueError('Choose a label / X column.')
    if not isinstance(c.get('ys'), list) or not 1 <= len(c['ys']) <= 8 or any(y not in names for y in c['ys']):
        raise ValueError('Choose between one and eight value columns.')
    if c.get('split') and c['split'] not in names:
        raise ValueError('Choose an existing series column.')
    if c.get('aggregate', 'sum') not in ('sum', 'avg', 'min', 'max', 'count', 'raw'):
        raise ValueError('Invalid aggregation.')
    if c.get('aggregate') == 'raw' and c['type'] not in ('scatter', 'histogram', 'boxplot'):
        raise ValueError('Raw observations are available for scatter, histogram and box plot. Choose an aggregation for categorical charts.')
    if c.get('sort', 'label') not in ('label', 'asc', 'desc'):
        raise ValueError('Invalid sort.')
    if c.get('bucket', '') not in ('', 'day', 'week', 'month', 'quarter', 'year'):
        raise ValueError('Invalid date interval.')
    c['limit'] = max(5, min(500, int(c.get('limit', 100))))
    for key, size in [('title', 200), ('subtitle', 500), ('filter', 200), ('dashboard', 100), ('xTitle', 100), ('yTitle', 100)]:
        c[key] = str(c.get(key, ''))[:size]
    c['palette'] = c.get('palette') if c.get('palette') in ('jewel', 'ocean', 'sunset', 'forest') else 'jewel'
    return c


def preview(conn, root, key, config):
    path = source_path(root, key)
    info = json.loads((path / 'source.json').read_text('utf-8'))
    c = validate(config, info['columns'])
    x = identifier(c['x'])
    if c.get('bucket'):
        x = f"date_trunc({literal(c['bucket'])}, TRY_CAST({x} AS TIMESTAMP))"
    split = identifier(c['split']) if c.get('split') else "''"
    ys = [f'CASE WHEN isfinite(TRY_CAST({identifier(y)} AS DOUBLE)) THEN TRY_CAST({identifier(y)} AS DOUBLE) END' for y in c['ys']]
    source = f'read_parquet({literal(path / "rows.parquet")})'
    where = ''
    if c['filter']:
        where = f' WHERE contains(COALESCE(CAST({identifier(c["x"])} AS VARCHAR),\'\'), {literal(c["filter"])})'
    checks = [f'count(*) FILTER (WHERE {identifier(y)} IS NOT NULL AND (TRY_CAST({identifier(y)} AS DOUBLE) IS NULL OR NOT isfinite(TRY_CAST({identifier(y)} AS DOUBLE))))' for y in c['ys']]
    if c['type'] == 'scatter':
        checks.append(f'count(*) FILTER (WHERE TRY_CAST({x} AS DOUBLE) IS NULL OR NOT isfinite(TRY_CAST({x} AS DOUBLE)))')
    stats = conn.execute('SELECT count(*),' + ','.join(checks) + f' FROM {source}{where}').fetchone()
    count, invalid = stats[0], list(stats[1:1+len(c['ys'])])
    invalid_x = stats[-1] if c['type'] == 'scatter' else 0
    raw = c.get('aggregate') == 'raw' or c['type'] in ('scatter', 'histogram', 'boxplot')
    # Aggregates read every matching source row; only the visual output is bounded.
    values = ys if raw else [f'{c.get("aggregate", "sum")}({y})' if c.get('aggregate') != 'count' else 'count(*)' for y in ys]
    select = f'SELECT {x} AS _x, {split} AS _series, ' + ','.join(f'{y} AS _v{i}' for i, y in enumerate(values)) + f' FROM {source}{where}'
    if not raw:
        select += ' GROUP BY 1,2'
        select += ' ORDER BY ' + ('3 DESC NULLS LAST,1,2' if c.get('sort') == 'desc' else '3 ASC NULLS LAST,1,2' if c.get('sort') == 'asc' else '1,2')
    elif info.get('order_column'):
        select += ' ORDER BY ' + identifier(info['order_column'])
    limit = min(2000, c['limit'] * 4) if raw else c['limit']
    rows = conn.execute(select + f' LIMIT {limit + 1}').fetchall()
    def safe(v):
        import math
        if isinstance(v, float) and not math.isfinite(v): return None
        return v if v is None or isinstance(v, (int, float, bool)) else str(v)[:1000]
    return {'source': key, 'info': info, 'config': c, 'rows': [[safe(v) for v in row] for row in rows[:limit]],
            'matching_rows': count, 'truncated': len(rows) > limit, 'limit': limit, 'raw': raw, 'invalid': invalid, 'invalid_x': invalid_x}


def dispatch(conn, payload, env):
    root = Path(env['workspace']) / 'charts'
    root.mkdir(exist_ok=True)
    op = payload.get('op')
    if op == 'list':
        return library(root)
    if op == 'open':
        folder, result = metadata(env['workspace'], payload['result_id'])
        size = (folder / 'rows.parquet').stat().st_size
        used = sum(p.stat().st_size for p in root.glob('sources/*/rows.parquet'))
        if used + size > env.get('settings', {}).get('spill_gb', 10) * 1024**3:
            raise ValueError('Saved chart sources exceed the temporary disk budget. Delete unused chart sources or raise the disk limit.')
        if shutil.disk_usage(root).free < size + 512 * 1024**2:
            raise ValueError('Not enough free disk space to retain this chart source.')
        key = uuid.uuid4().hex
        target = root / 'sources' / key
        target.mkdir(parents=True)
        try:
            shutil.copyfile(folder / 'rows.parquet', target / 'rows.parquet')
            columns = [{'name': r[0], 'type': r[1]} for r in conn.execute(f'DESCRIBE SELECT * EXCLUDE ({identifier(result["order_column"])}) FROM read_parquet({literal(target / "rows.parquet")})').fetchall()]
            info = {**result, 'columns': columns, 'bytes': size}
            (target / 'source.json').write_text(json.dumps(info), 'utf-8')
            return {'source': key, 'info': info}
        except BaseException:
            shutil.rmtree(target)
            raise
    if op == 'preview':
        return preview(conn, root, payload['source'], payload['config'])
    data = library(root)
    if op == 'save':
        source = source_path(root, payload['source'])
        info = json.loads((source / 'source.json').read_text('utf-8'))
        config = validate(payload['config'], info['columns'])
        if not config['title'].strip(): raise ValueError('Give this chart a title before saving.')
        key = payload.get('id')
        if key and not any(c['id'] == key for c in data['charts']): raise ValueError('Saved chart no longer exists.')
        chart = {'id': key or uuid.uuid4().hex, 'source': payload['source'], 'config': config, 'updated': time.time()}
        data['charts'] = [c for c in data['charts'] if c['id'] != chart['id']] + [chart]
    elif op == 'delete':
        data['charts'] = [c for c in data['charts'] if c['id'] != payload['id']]
    elif op == 'clean':
        used = {c['source'] for c in data['charts']}
        for path in (root / 'sources').glob('*'):
            if path.name not in used and re.fullmatch('[0-9a-f]{32}', path.name): shutil.rmtree(path)
        return data
    else:
        raise ValueError('Unknown chart operation.')
    temporary = root / 'library.tmp'
    temporary.write_text(json.dumps(data, ensure_ascii=False), 'utf-8')
    temporary.replace(root / 'library.json')
    return data
