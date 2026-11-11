"""Native DuckDB jobs. Heavy work runs in a disposable child process."""
from __future__ import annotations

import datetime
import json
import math
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'runtime' / 'engine'))


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def identifier(value):
    return '"' + str(value).replace('"', '""') + '"'


def query_body(sql):
    """Strip terminators using DuckDB's lexer, preserving quoted semicolons."""
    import duckdb
    tokens=[(offset,kind) for offset,kind in duckdb.tokenize(sql) if str(kind).split('.')[-1]!='comment']
    end=len(sql)
    for offset,_ in reversed(tokens):
        if sql[offset:offset+1]==';':
            end=offset
        else:
            break
    # A newline keeps a trailing -- comment from swallowing our closing bracket.
    return sql[:end].rstrip()+'\n'


def local_file(value):
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f'File not found: {path}')
    return path


def reader(path, options=None):
    options = options or {}
    ext = path.suffix.lower()
    location = literal(path.as_posix())
    if ext in ('.parquet', '.pq'):
        return f'read_parquet({location})'
    if ext in ('.json', '.jsonl', '.ndjson'):
        return f'read_json_auto({location})'
    if ext not in ('.csv', '.tsv', '.txt'):
        raise ValueError('Open CSV, TSV, Parquet, JSON, JSONL or NDJSON files.')
    delim = options.get('delimiter', 'auto')
    delim = '\t' if delim == 'tab' else delim
    if delim != 'auto' and len(delim) != 1:
        raise ValueError('Choose a single-character delimiter or auto.')
    header = options.get('header', True)
    if header not in (True, False):
        raise ValueError('Header must be true or false.')
    mode = options.get('types', 'text')
    if mode not in ('text', 'auto'):
        raise ValueError('Choose text or automatic column types.')
    extras = f', delim = {literal(delim)}' if delim != 'auto' else ''
    return (f'read_csv({location}, header = {str(header).lower()}, '
            f'all_varchar = {str(mode == "text").lower()}, sample_size = 20480, '
            f'ignore_errors = false, strict_mode = true, skip = 0{extras})')


def create_connection(workspace, settings, job_id):
    import duckdb
    workspace = Path(workspace)
    temporary = workspace / 'temp' / job_id
    temporary.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(workspace / 'data.duckdb'), config={
        'memory_limit': f'{settings["memory_mb"]}MB',
        'threads': str(settings['threads']),
        'temp_directory': temporary.as_posix(),
        'max_temp_directory_size': f'{settings["spill_gb"]}GB',
        'autoinstall_known_extensions': 'false',
    })
    conn.execute('SET enable_progress_bar = true; SET enable_progress_bar_print = false')
    conn.execute('CREATE TABLE IF NOT EXISTS _wb_sources '
                 '(name VARCHAR PRIMARY KEY, path VARCHAR, bytes BIGINT, kind VARCHAR)')
    conn.execute('CREATE TABLE IF NOT EXISTS _wb_aliases (name VARCHAR PRIMARY KEY, target VARCHAR)')
    return conn


def describe(conn, sql):
    return [{'name': str(row[0]), 'type': str(row[1])}
            for row in conn.execute(f'DESCRIBE {sql}').fetchall()]


def catalog(conn):
    known = {r[0]: r[1:] for r in conn.execute('SELECT * FROM _wb_sources').fetchall()}
    aliases = {r[0] for r in conn.execute('SELECT name FROM _wb_aliases').fetchall()}
    names = conn.execute("SELECT table_name FROM duckdb_tables() WHERE NOT internal "
                         "AND database_name = current_database() AND schema_name = 'main' "
                         "UNION SELECT view_name FROM duckdb_views() WHERE NOT internal "
                         "AND database_name = current_database() AND schema_name = 'main'").fetchall()
    out = []
    for (name,) in sorted(names):
        if name.startswith('_wb_') or name in aliases:
            continue
        record = {'name': name, 'path': '', 'bytes': 0, 'kind': 'table'}
        if name in known:
            record.update(zip(('path', 'bytes', 'kind'), known[name]))
        try:
            record['columns'] = describe(conn, f'SELECT * FROM {identifier(name)}')
        except Exception as error:
            record.update(columns=[], error=str(error))
        out.append(record)
    return out


def validate_name(value):
    name = str(value).strip()
    if not name or len(name) > 100 or any(ord(char) < 32 for char in name) or name.lower().startswith('_wb_'):
        raise ValueError('Choose a dataset name of 1–100 characters, without control characters or the reserved _wb_ prefix.')
    return name


def available_name(conn, stem, exact=False):
    if exact:
        name = validate_name(stem)
        exists = {r[0].casefold() for r in conn.execute('SHOW TABLES').fetchall()}
        if name.casefold() in exists:
            raise ValueError('That dataset name is already in use. Choose another name.')
        return name
    name = re.sub(r'[^a-zA-Z0-9_]', '_', stem).strip('_')[:55] or 'dataset'
    if name[0].isdigit():
        name = 'data_' + name
    if name.startswith('_wb_'):
        name = 'data' + name
    original, suffix = name, 2
    exists = {r[0].casefold() for r in conn.execute('SHOW TABLES').fetchall()}
    while name.casefold() in exists:
        name = f'{original}_{suffix}'
        suffix += 1
    return name


def attach_source(conn, path, options=None, name=None):
    name = available_name(conn, name or path.stem, exact=bool(name))
    expression = reader(path, options)
    # Validate the reader and get its schema before saving any metadata.
    describe(conn, f'SELECT * FROM {expression}')
    conn.execute('BEGIN')
    try:
        conn.execute(f'CREATE VIEW {identifier(name)} AS SELECT * FROM {expression}')
        conn.execute('INSERT INTO _wb_sources VALUES (?, ?, ?, ?)',
                     [name, str(path), path.stat().st_size, path.suffix.lstrip('.').lower()])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return name


def json_cell(value):
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return str(value) if abs(value) > 9007199254740991 else value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, (datetime.date, datetime.time, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return '0x' + value[:2048].hex() + ('…' if len(value) > 2048 else '')
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=str, ensure_ascii=False)
    return str(value)


def page(conn, sql, offset=0, size=100, parameters=None):
    statements = conn.extract_statements(sql)
    if not statements:
        raise ValueError('Write a query first.')
    if len(statements) != 1 and offset:
        raise ValueError('Paging is available for a single SELECT. Select its SQL and run it separately.')
    for statement in statements[:-1]:
        conn.execute(statement.query)
    last = statements[-1]
    selectable = str(last.type).split('.')[-1] == 'SELECT'
    if offset and not selectable:
        raise ValueError('Only SELECT results support paging.')
    executed = (f'SELECT * FROM ({query_body(last.query)}) AS _page '
                f'LIMIT {size + 1} OFFSET {offset}') if selectable else last.query
    cursor = conn.execute(executed, parameters or [])
    columns = [{'name': str(col[0]), 'type': str(col[1])} for col in cursor.description or []]
    column_limit = 120
    rows, byte_count, clipped, more = [], 0, 0, False
    # Fetch one row at a time so very wide rows cannot multiply a batch's memory.
    row_limit = min(size, max(1, 10000 // max(1, min(len(columns), column_limit))))
    for index in range(row_limit + 1):
        row = cursor.fetchone()
        if row is None:
            break
        if index == row_limit:
            more = True
            break
        values = []
        for cell in row[:column_limit]:
            value = json_cell(cell)
            if isinstance(value, str) and len(value) > 4096:
                value = value[:4096] + '…'
                clipped += 1
            values.append(value)
        encoded_size = len(json.dumps(values, ensure_ascii=False).encode('utf-8'))
        if byte_count + encoded_size > 1024 * 1024 and rows:
            more = True
            break
        rows.append(values)
        byte_count += encoded_size
    return {'columns': columns[:column_limit], 'total_columns': len(columns), 'rows': rows,
            'offset': offset, 'next_offset': offset + len(rows), 'has_more': more and selectable,
            'page_size': size, 'clipped_cells': clipped, 'selectable': selectable,
            'sql': sql, 'statement_count': len(statements)}


def new_output(value, extension):
    target = Path(value).expanduser().resolve()
    if target.suffix.lower() != extension:
        raise ValueError(f'Output filename must end with {extension}.')
    if target.exists():
        raise ValueError('That file already exists. Choose a new filename to keep the existing file intact.')
    if not target.parent.is_dir():
        raise ValueError('The output folder does not exist.')
    return target


def publish_file(partial, target):
    # Windows rename refuses an existing destination. Hard-link publication
    # supplies the same no-overwrite guarantee on POSIX.
    if os.name == 'nt':
        os.rename(partial, target)
    else:
        os.link(partial, target)
        partial.unlink()


def export_options(format_name):
    formats = {
        'parquet': ('.parquet', 'FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880'),
        'csv': ('.csv', 'FORMAT CSV, HEADER true'),
        'tsv': ('.tsv', "FORMAT CSV, HEADER true, DELIMITER '\t'"),
        'json': ('.json', 'FORMAT JSON, ARRAY true'),
        'ndjson': ('.ndjson', 'FORMAT JSON, ARRAY false'),
    }
    if format_name not in formats:
        raise ValueError('Choose CSV, TSV, Parquet, JSON or NDJSON.')
    return formats[format_name]


def copy_to(conn, sql, target, options, job_id):
    partial = target.parent / f'.{target.name}.{job_id}.partial'
    try:
        conn.execute('SET preserve_insertion_order = false')
        count = conn.execute(f'COPY ({sql}) TO {literal(partial.as_posix())} ({options})').fetchone()
        publish_file(partial, target)
        return {'path': str(target), 'bytes': target.stat().st_size,
                'exported_rows': count[0] if count else None}
    finally:
        partial.unlink(missing_ok=True)


def perform(conn, action, payload, job_id, on_preview=None):
    if action == 'catalog':
        import duckdb
        return {'catalog': catalog(conn), 'version': duckdb.__version__}
    if action == 'preview':
        path = local_file(payload['path'])
        expression = reader(path, payload.get('options'))
        return {'preview': page(conn, f'SELECT * FROM {expression}', size=20),
                'file': {'path': str(path), 'bytes': path.stat().st_size},
                'schema': describe(conn, f'SELECT * FROM {expression}')}
    if action == 'open':
        path = local_file(payload['path'])
        name = attach_source(conn, path, payload.get('options'), payload.get('name'))
        return {'name': name, 'catalog': catalog(conn)}
    if action == 'convert':
        path = local_file(payload['path'])
        target = new_output(payload['output'], '.parquet')
        _, options = export_options('parquet')
        result = copy_to(conn, f'SELECT * FROM {reader(path, payload.get("options"))}', target, options, job_id)
        result['name'] = attach_source(conn, target, name=payload.get('name'))
        result['catalog'] = catalog(conn)
        return result
    if action == 'query':
        size = max(10, min(500, int(payload.get('size', 100))))
        offset = max(0, min(10**12, int(payload.get('offset', 0))))
        if payload.get('sort'):
            items=conn.extract_statements(payload['sql'])
            if len(items)!=1 or str(items[0].type).split('.')[-1]!='SELECT':
                raise ValueError('Run a single SELECT before sorting its results.')
            column=payload['sort']['column']
            direction=payload['sort'].get('direction','ASC')
            if direction not in ('ASC','DESC'):
                raise ValueError('Invalid sort direction.')
            payload={**payload,'sql':f'SELECT * FROM ({query_body(items[0].query)}) AS sorted_results ORDER BY {identifier(column)} {direction}'}
        result = page(conn, payload['sql'], offset, size)
        statements = conn.extract_statements(payload['sql'])
        if result['selectable'] and payload.get('exact_total', True):
            if payload.get('_known_total') is not None:
                result.update(total_rows=int(payload['_known_total']), total_status='exact')
            elif not result['has_more'] and (result['rows'] or not offset):
                result.update(total_rows=offset + len(result['rows']), total_status='exact')
            else:
                result['total_status'] = 'counting'
                if on_preview:
                    on_preview(dict(result))
                final_sql = query_body(statements[-1].query)
                # Count the final SELECT only: do not execute setup/DML twice.
                # This uses the same connection so script-local temp tables work.
                total = conn.execute(f'SELECT count(*) FROM ({final_sql}) AS _total').fetchone()[0]
                result.update(total_rows=total, total_status='exact')
        if any(str(statement.type).split('.')[-1] not in ('SELECT', 'EXPLAIN', 'PRAGMA') for statement in statements):
            result['catalog'] = catalog(conn)
        return result
    if action == 'rename':
        old, new = str(payload['name']), validate_name(payload['new_name'])
        existing = {item['name'] for item in catalog(conn)}
        if old not in existing:
            raise ValueError('Choose an existing dataset to rename.')
        if old == new:
            return {'name': new, 'catalog': catalog(conn)}
        alias = conn.execute('SELECT target FROM _wb_aliases WHERE lower(name) = lower(?)', [new]).fetchone()
        if alias and alias[0] != old:
            raise ValueError('That name is already used by another dataset or its earlier name.')
        if not alias and old.casefold() != new.casefold():
            available_name(conn, new, exact=True)
        is_view = conn.execute("SELECT count(*) FROM duckdb_views() WHERE view_name=? AND database_name=current_database() AND schema_name='main'", [old]).fetchone()[0]
        conn.execute('BEGIN')
        try:
            if alias:
                conn.execute(f'DROP VIEW {identifier(new)}')
                conn.execute('DELETE FROM _wb_aliases WHERE lower(name)=lower(?)', [new])
            conn.execute(f'ALTER {"VIEW" if is_view else "TABLE"} {identifier(old)} RENAME TO {identifier(new)}')
            conn.execute('UPDATE _wb_sources SET name=? WHERE name=?', [new, old])
            conn.execute('UPDATE _wb_aliases SET target=? WHERE target=?', [new, old])
            if old.casefold() != new.casefold():
                conn.execute(f'CREATE VIEW {identifier(old)} AS SELECT * FROM {identifier(new)}')
                conn.execute('INSERT OR REPLACE INTO _wb_aliases VALUES (?, ?)', [old, new])
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
        return {'name': new, 'previous_name': old, 'catalog': catalog(conn)}
    if action == 'export':
        statements = conn.extract_statements(payload['sql'])
        if len(statements) != 1 or str(statements[0].type).split('.')[-1] != 'SELECT':
            raise ValueError('Export a single SELECT or PIVOT query. Run setup statements separately first.')
        extension, options = export_options(payload['format'])
        target = new_output(payload['output'], extension)
        return copy_to(conn, query_body(statements[0].query), target, options, job_id)
    if action == 'profile':
        name = payload['name']
        if name not in {item['name'] for item in catalog(conn)}:
            raise ValueError('Choose a dataset first.')
        return {'profile': page(conn, f'SUMMARIZE SELECT * FROM {identifier(name)}', size=500)}
    if action == 'count':
        name = payload['name']
        return {'count': conn.execute(f'SELECT count(*) FROM {identifier(name)}').fetchone()[0], 'name': name}
    if action == 'explain':
        statements = conn.extract_statements(payload['sql'])
        if len(statements) != 1 or str(statements[0].type).split('.')[-1] != 'SELECT':
            raise ValueError('Explain one SELECT or PIVOT query at a time.')
        return {'plan': '\n'.join(str(row[-1]) for row in conn.execute('EXPLAIN ' + statements[0].query).fetchall())}
    raise ValueError('Unknown job action.')


def worker(workspace, settings, job, sender, progress):
    conn = None
    started = time.perf_counter()
    try:
        if os.name == 'nt':
            import ctypes
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
        conn = create_connection(workspace, settings, job['id'])
        # DuckDB progress is optional/approximate; absent progress remains indeterminate.
        import threading
        stopped = threading.Event()

        def report():
            while not stopped.wait(.3):
                try:
                    progress.value = conn.query_progress()
                except Exception:
                    pass

        reporter = threading.Thread(target=report, daemon=True)
        reporter.start()
        try:
            result = perform(conn, job['action'], job['payload'], job['id'],
                             on_preview=lambda value: sender.send({'status': 'preview', 'preview': value}))
        finally:
            stopped.set()
            reporter.join(1)
        conn.close()
        conn = None
        result['elapsed_ms'] = round((time.perf_counter() - started) * 1000)
        sender.send({'status': 'succeeded', 'result': result})
    except BaseException as error:
        sender.send({'status': 'failed', 'error': str(error)[:12000]})
    finally:
        if conn is not None:
            conn.close()
        sender.close()
