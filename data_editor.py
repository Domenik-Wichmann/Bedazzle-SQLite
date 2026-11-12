"""Persistent, disk-backed editable result sets and explicit keyed write-back."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import time
import uuid

from engine import (identifier as q, literal as lit, query_body, describe, catalog,
                    available_name, export_options, new_output, copy_to, file_kind)


def init(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS _wb_edit_sessions '
                 '(id VARCHAR PRIMARY KEY, title VARCHAR, sql VARCHAR, created DOUBLE, '
                 'revision BIGINT, tip BIGINT, next_id BIGINT, schema_json VARCHAR, stamps VARCHAR)')


def stamp(path):
    s = Path(path).stat()
    return [s.st_size, s.st_mtime_ns]


def names(session):
    sid = session['id']
    if not re.fullmatch('[a-f0-9]{32}', sid):
        raise ValueError('Invalid editor session.')
    return [q('_wb_edit_' + sid + suffix) for suffix in ('_work', '_base', '_history')]


def load(conn, sid):
    row = conn.execute('SELECT * FROM _wb_edit_sessions WHERE id=?', [sid]).fetchone()
    if not row:
        raise ValueError('This editor draft does not exist in this workspace.')
    keys = ['id', 'title', 'sql', 'created', 'revision', 'tip', 'next_id', 'schema_json', 'stamps']
    result = dict(zip(keys, row))
    result['columns'] = json.loads(result.pop('schema_json'))
    result['stamps'] = json.loads(result['stamps'])
    names(result)
    return result


def column(session, value):
    if value not in {c['name'] for c in session['columns']}:
        raise ValueError('Choose an editor column.')
    return q(value)


def snapshot(conn, payload, environment):
    sql = str(payload['sql'])
    body = sql
    if payload.get('result_id'):
        from result_store import metadata, relation
        folder, info = metadata(environment['workspace'], payload['result_id'])
        body = relation(environment['workspace'], payload['result_id'])
        sql = info['sql']
    else:
        statements = conn.extract_statements(sql)
        if len(statements) != 1 or str(statements[0].type).split('.')[-1] != 'SELECT':
            raise ValueError('Open one SELECT result in the editor. Run setup statements separately.')
    sid = uuid.uuid4().hex
    session = {'id': sid}
    work, base, history = names(session)
    # A per-session name avoids clashing with any user-projected column.
    identity = '_editor_row_' + sid
    schema = describe(conn, f'SELECT * FROM ({query_body(body)}) e')
    if not schema or len({c['name'].casefold() for c in schema}) != len(schema):
        raise ValueError('Give each result column a distinct name before opening the editor.')
    stamps = {i['name']: {'path': i['path'], 'stamp': stamp(i['path'])}
              for i in catalog(conn) if i.get('path') and Path(i['path']).is_file()}
    conn.execute('BEGIN')
    try:
        conn.execute(f'CREATE TABLE {work} AS SELECT row_number() OVER ()::BIGINT AS {q(identity)}, e.* '
                     f'FROM ({query_body(body)}) e')
        # Record DuckDB's actual output schema (including deduplicated names).
        schema = describe(conn, f'SELECT * EXCLUDE ({q(identity)}) FROM {work}')
        conn.execute(f'CREATE TABLE {base} AS SELECT * FROM {work}')
        step, after = history_columns(session)
        conn.execute(f'CREATE TABLE {history} AS SELECT 0::BIGINT AS {step}, false AS {after}, * FROM {work} WHERE false')
        count = conn.execute(f'SELECT count(*) FROM {work}').fetchone()[0]
        conn.execute('INSERT INTO _wb_edit_sessions VALUES (?,?,?,?,0,0,?,?,?)',
                     [sid, str(payload.get('title') or 'Edited results')[:100], sql,
                      time.time(), count + 1, json.dumps(schema), json.dumps(stamps)])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return load(conn, sid)


def identity(session):
    return q('_editor_row_' + session['id'])


def history_columns(session):
    return q('_editor_step_' + session['id']), q('_editor_after_' + session['id'])


def where_search(session, payload):
    text = str(payload.get('search', ''))
    if not text:
        return 'true', []
    return '(' + ' OR '.join(f'contains(coalesce(CAST({q(c["name"])} AS VARCHAR),\'\'), ?)'
                              for c in session['columns']) + ')', [text] * len(session['columns'])


def view(conn, session, payload):
    work, base, _ = names(session)
    rid = identity(session)
    offset = max(0, int(payload.get('offset', 0)))
    # Bound the number of DOM cells as well as text transferred to the browser.
    size = max(1, min(100, 8000 // max(1, len(session['columns']))))
    predicate, params = where_search(session, payload)
    fields = ', '.join(f'left(CAST({q(c["name"])} AS VARCHAR), 512)' for c in session['columns'])
    cursor = conn.execute(f'SELECT {rid}, {fields} FROM {work} WHERE {predicate} ORDER BY {rid} LIMIT ? OFFSET ?',
                          params + [size, offset])
    rows, used = [], 0
    for _ in range(size):
        row = cursor.fetchone()
        if row is None:
            break
        byte_count = len(json.dumps(row, ensure_ascii=False).encode('utf-8'))
        if used + byte_count > 1000000:
            if not rows:
                raise ValueError('This result is too wide for the editor preview. Select fewer columns.')
            break
        rows.append(row)
        used += byte_count
    count = conn.execute(f'SELECT count(*) FROM {work} WHERE {predicate}', params).fetchone()[0]
    changed = difference(session, 'b', 'w')
    stats = conn.execute(f'SELECT '
                         f'count(*) FILTER (WHERE b.{rid} IS NULL), '
                         f'count(*) FILTER (WHERE w.{rid} IS NULL), '
                         f'count(*) FILTER (WHERE b.{rid} IS NOT NULL AND w.{rid} IS NOT NULL AND ({changed})) '
                         f'FROM {base} b FULL JOIN {work} w ON b.{rid}=w.{rid}').fetchone()
    dirty = {}
    if rows:
        ids = ','.join(str(r[0]) for r in rows)
        flags = ','.join(f'b.{rid} IS NULL OR w.{q(c["name"])} IS DISTINCT FROM b.{q(c["name"])}' for c in session['columns'])
        dirty = {str(r[0]): list(r[1:]) for r in conn.execute(
            f'SELECT w.{rid}, {flags} FROM {work} w LEFT JOIN {base} b ON w.{rid}=b.{rid} WHERE w.{rid} IN ({ids})').fetchall()}
    return {'session': {k: session[k] for k in ('id', 'title', 'sql', 'columns', 'revision', 'tip')},
            'rows': [[str(row[0]), *row[1:]] for row in rows], 'offset': offset,
            'next_offset': offset + len(rows), 'total': count, 'page_size': size,
            'changes': dict(zip(('added', 'deleted', 'updated'), stats)), 'dirty': dirty}


def difference(session, left, right):
    return ' OR '.join(f'{left}.{q(c["name"])} IS DISTINCT FROM {right}.{q(c["name"])}'
                       for c in session['columns'])


def edit(conn, session, payload):
    work, _, history = names(session)
    rid = identity(session)
    op = payload['op']
    revision = session['revision'] + 1
    step_col, after_col = history_columns(session)
    conn.execute('BEGIN')
    try:
        conn.execute(f'DELETE FROM {history} WHERE {step_col} > ?', [session['revision']])
        ids = []
        if op in ('cells', 'delete'):
            changes = payload.get('cells', [])
            ids = list({int(c['row']) for c in changes} if op == 'cells' else {int(i) for i in payload.get('rows', [])})
            if not ids or len(ids) > 10000 or len(changes) > 10000:
                raise ValueError('Select 1–10,000 rows/cells for this operation.')
            predicate = f'{rid} IN (' + ','.join(str(i) for i in ids) + ')'
            if conn.execute(f'SELECT count(*) FROM {work} WHERE {predicate}').fetchone()[0] != len(ids):
                raise ValueError('Some selected rows no longer exist. Refresh the editor.')
        elif op == 'replace':
            col = column(session, payload['column'])
            kind = next(c['type'] for c in session['columns'] if c['name'] == payload['column'])
            if kind != 'VARCHAR':
                raise ValueError('Find/replace works on text columns. Use Set value for typed columns.')
            if not str(payload.get('find', '')):
                raise ValueError('Enter text to find.')
            predicate, params = where_search(session, payload)
            predicate = f'({predicate}) AND contains({col}, ?)'
            params += [str(payload['find'])]
        elif op == 'set':
            col = column(session, payload['column'])
            predicate, params = where_search(session, payload)
        elif op == 'add':
            predicate = 'false'
        else:
            raise ValueError('Unknown edit operation.')
        params = params if op in ('replace', 'set') else []
        conn.execute(f'INSERT INTO {history} SELECT ?, false, * FROM {work} WHERE {predicate}', [revision] + params)
        if op == 'delete':
            conn.execute(f'DELETE FROM {work} WHERE {predicate}')
        elif op == 'cells':
            for cell in changes:
                col = column(session, cell['column'])
                conn.execute(f'UPDATE {work} SET {col}=? WHERE {rid}=?', [cell['value'], int(cell['row'])])
        elif op == 'replace':
            conn.execute(f'UPDATE {work} SET {col}=replace({col}, ?, ?) WHERE {predicate}',
                         [str(payload['find']), str(payload.get('replacement', ''))] + params)
        elif op == 'set':
            conn.execute(f'UPDATE {work} SET {col}=? WHERE {predicate}', [payload.get('value')] + params)
        elif op == 'add':
            conn.execute(f'INSERT INTO {work} ({rid}) VALUES (?)', [session['next_id']])
            conn.execute('UPDATE _wb_edit_sessions SET next_id=next_id+1 WHERE id=?', [session['id']])
            predicate = f'{rid}={int(session["next_id"])}'
        # Capture exactly the same row identities even if replacement changed the search predicate.
        after_predicate = (predicate if op == 'add' else
                           f'{rid} IN (SELECT {rid} FROM {history} WHERE {step_col}={revision} AND NOT {after_col})')
        conn.execute(f'INSERT INTO {history} SELECT ?, true, * FROM {work} WHERE {after_predicate}', [revision])
        conn.execute('UPDATE _wb_edit_sessions SET revision=?, tip=? WHERE id=?', [revision, revision, session['id']])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise


def travel(conn, session, redo):
    revision = session['revision']
    if (redo and revision >= session['tip']) or (not redo and revision <= 0):
        raise ValueError('Nothing to redo.' if redo else 'Nothing to undo.')
    step = revision + 1 if redo else revision
    work, _, history = names(session)
    rid = identity(session)
    step_col, after_col = history_columns(session)
    conn.execute('BEGIN')
    try:
        conn.execute(f'DELETE FROM {work} WHERE {rid} IN (SELECT {rid} FROM {history} WHERE {step_col}=?)', [step])
        conn.execute(f'INSERT INTO {work} SELECT * EXCLUDE ({step_col},{after_col}) FROM {history} WHERE {step_col}=? AND {after_col}=?', [step, redo])
        conn.execute('UPDATE _wb_edit_sessions SET revision=? WHERE id=?', [revision + (1 if redo else -1), session['id']])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise


def mapping(conn, session, payload):
    target = next((i for i in catalog(conn) if i['name'] == payload.get('target')), None)
    if not target:
        raise ValueError('Choose an existing destination dataset.')
    keys = payload.get('keys', [])
    columns = {c['name'] for c in session['columns']}
    target_columns = {c['name'] for c in target['columns']}
    if not keys or len(set(keys)) != len(keys) or not set(keys) <= columns & target_columns:
        raise ValueError('Choose one or more record key columns present in both the result and destination.')
    mapped = [c['name'] for c in target['columns'] if c['name'] in columns]
    result_types = {c['name']: c['type'] for c in session['columns']}
    incompatible = [c['name'] for c in target['columns'] if c['name'] in columns and c['type'] != result_types[c['name']]]
    if incompatible:
        raise ValueError('Source column types differ from the original result: ' + ', '.join(incompatible) +
                         '. Select the original source columns without casts, or save a working copy.')
    return target, keys, mapped


def join_keys(keys, left, right):
    return ' AND '.join(f'{left}.{q(k)} IS NOT DISTINCT FROM {right}.{q(k)}' for k in keys)


def validate_keys(conn, table, keys):
    fields = ','.join(q(k) for k in keys)
    if conn.execute(f'SELECT count(*) FROM (SELECT {fields} FROM {table} GROUP BY {fields} HAVING count(*)>1) x').fetchone()[0]:
        raise ValueError('Record keys are not unique. Choose a unique key, or a combination of columns.')
    if conn.execute(f'SELECT count(*) FROM {table} WHERE ' + ' OR '.join(f'{q(k)} IS NULL' for k in keys)).fetchone()[0]:
        raise ValueError('Record keys contain NULL. Choose complete, unique key columns.')


def patch_target(conn, session, table, keys, mapped, all_columns):
    work, base, _ = names(session)
    rid = identity(session)
    for source in (table, base, work):
        validate_keys(conn, source, keys)
    changed = difference(session, 'b', 'w')
    affected = f'(SELECT b.* FROM {base} b LEFT JOIN {work} w ON b.{rid}=w.{rid} WHERE w.{rid} IS NULL OR ({changed}))'
    matches = join_keys(keys, 'b', 't')
    # Compare original values for every mapped field before touching a source record.
    same = ' AND '.join(f't.{q(c)} IS NOT DISTINCT FROM b.{q(c)}' for c in mapped)
    conflict = conn.execute(f'SELECT count(*) FROM {affected} b WHERE NOT EXISTS '
                            f'(SELECT 1 FROM {table} t WHERE {matches} AND {same})').fetchone()[0]
    if conflict:
        raise ValueError(f'{conflict} source records changed, disappeared, or do not match the original result. No changes were saved.')
    added = conn.execute(f'SELECT count(*) FROM {work} w WHERE NOT EXISTS (SELECT 1 FROM {base} b WHERE b.{rid}=w.{rid})').fetchone()[0]
    if added and set(mapped) != set(all_columns):
        raise ValueError('Adding source records requires every source column in the editor result.')
    # Change only selected source records. Omitted projection fields remain intact.
    conn.execute(f'DELETE FROM {table} t USING {base} b WHERE {matches} AND '
                 f'NOT EXISTS (SELECT 1 FROM {work} w WHERE w.{rid}=b.{rid})')
    fields = ','.join(q(c) for c in mapped)
    changed_existing = f'EXISTS (SELECT 1 FROM {base} b WHERE b.{rid}=w.{rid} AND ({changed}))'
    new = f'NOT EXISTS (SELECT 1 FROM {base} b WHERE b.{rid}=w.{rid})'
    assignments = ','.join(f'{q(c)}=w.{q(c)}' for c in mapped)
    conn.execute(f'UPDATE {table} t SET {assignments} FROM {base} b JOIN {work} w ON b.{rid}=w.{rid} '
                 f'WHERE {matches} AND ({changed})')
    if added:
        conn.execute(f'INSERT INTO {table} ({fields}) SELECT ' + ','.join(f'w.{q(c)}' for c in mapped) +
                     f' FROM {work} w WHERE {new}')


def write_source(conn, session, payload):
    target, keys, mapped = mapping(conn, session, payload)
    mode = payload['mode']
    is_file = bool(target.get('path'))
    if mode == 'original' and not is_file:
        raise ValueError('This destination is a database table. Choose Save source records.')
    if mode == 'source' and is_file:
        raise ValueError('This destination reads a file. Choose Save original file.')
    if not is_file:
        tables = {r[0] for r in conn.execute("SELECT table_name FROM duckdb_tables() WHERE database_name=current_database() AND schema_name='main'").fetchall()}
        if target['name'] not in tables:
            raise ValueError('This destination is a view. Choose its underlying table or save a working copy.')
    else:
        original = Path(target['path'])
        old_stamp = session['stamps'].get(target['name'])
        if not old_stamp or old_stamp['path'] != str(original) or old_stamp['stamp'] != stamp(original):
            raise ValueError('The original file changed or was opened after this draft. Open a fresh editor before saving back.')
    all_columns = [c['name'] for c in target['columns']]
    token = uuid.uuid4().hex
    staging = q('_wb_edit_staging_' + token)
    work, base, history = names(session)
    rid = identity(session)
    destination = staging if is_file else q(target['name'])
    partial = backup = None
    replaced = committed = False
    replacement_stamp = None
    sources = catalog(conn)
    readers = []
    if is_file and file_kind(original) in ('.csv', '.tsv', '.txt', '.psv', '.tab', '.dat'):
        for source in sources:
            if source.get('path') == str(original):
                _, source_reader = file_options(conn, original, source)
                readers.append((source['name'], source_reader(lit(original.as_posix()))))
    conn.execute('BEGIN')
    try:
        if is_file:
            conn.execute(f'CREATE TEMP TABLE {staging} AS SELECT * FROM {q(target["name"])}')
        patch_target(conn, session, destination, keys, mapped, all_columns)
        validate_keys(conn, destination, keys)
        result = {'saved_to': target['name']}
        if is_file:
            partial = original.parent / ('.' + original.name + '.' + token + '.partial')
            options, readback = file_options(conn, original, target)
            conn.execute(f'COPY {destination} TO {lit(partial.as_posix())} ({options})')
            rewritten = readback(lit(partial.as_posix()))
            mismatch = conn.execute(f'SELECT count(*) FROM ((SELECT * FROM {destination} EXCEPT ALL SELECT * FROM {rewritten}) '
                                    f'UNION ALL (SELECT * FROM {rewritten} EXCEPT ALL SELECT * FROM {destination})) delta').fetchone()[0]
            if mismatch:
                raise ValueError('This file format cannot round-trip these edited values with its reader settings. Save a Parquet export instead. The original is unchanged.')
            if stamp(original) != old_stamp['stamp']:
                raise ValueError('The source file changed while saving. No replacement was made.')
            backup = original.with_name(original.name + '.' + token + '.bak')
            # Exclusive backup publication; never overwrite a previous backup.
            with original.open('rb') as source, backup.open('xb') as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if stamp(original) != old_stamp['stamp']:
                raise ValueError('The source file changed during backup. No replacement was made.')
            with partial.open('rb+') as written:
                os.fsync(written.fileno())
            os.replace(partial, original)
            replaced = True
            replacement_stamp = stamp(original)
            # An originally unquoted CSV may now need quotes for edited tabs/newlines.
            # Refresh every registered reader for this path, retaining its typed schema.
            for source_name, source_reader_sql in readers:
                conn.execute(f'CREATE OR REPLACE VIEW {q(source_name)} AS SELECT * FROM {source_reader_sql}')
            session['stamps'][target['name']] = {'path': str(original), 'stamp': stamp(original)}
            conn.execute('UPDATE _wb_sources SET bytes=? WHERE name=?', [original.stat().st_size, target['name']])
            result.update(path=str(original), backup=str(backup))
        conn.execute(f'DELETE FROM {base}')
        conn.execute(f'INSERT INTO {base} SELECT * FROM {work}')
        conn.execute(f'DELETE FROM {history}')
        conn.execute('UPDATE _wb_edit_sessions SET revision=0,tip=0,stamps=? WHERE id=?',
                     [json.dumps(session['stamps']), session['id']])
        if is_file:
            conn.execute(f'DROP TABLE {staging}')
        conn.execute('COMMIT')
        committed = True
        if is_file:
            for source in sources:
                if source.get('path') == str(original):
                    source['bytes'] = original.stat().st_size
        result['catalog'] = sources
        return result
    except Exception:
        if not committed:
            conn.execute('ROLLBACK')
            if replaced and backup and stamp(original) == replacement_stamp:
                # Restore the file as well if the database transaction fails after replacement.
                shutil.copyfile(backup, partial)
                os.replace(partial, original)
        raise
    finally:
        if partial:
            partial.unlink(missing_ok=True)


def file_options(conn, path, target):
    kind = file_kind(path)
    compression = ''
    if path.suffix.lower() in ('.gz', '.zst', '.zstd'):
        compression = ', COMPRESSION ' + ('GZIP' if path.suffix.lower() == '.gz' else 'ZSTD')
    if kind in ('.parquet', '.pq'):
        return export_options('parquet')[1], lambda location: f'read_parquet({location})'
    schema = '{' + ','.join(lit(c['name']) + ':' + lit(c['type']) for c in target['columns']) + '}'
    if kind in ('.json', '.jsonl', '.ndjson', '.ndjsonl'):
        # Detect array versus record-per-line from the original bytes, including compression.
        import gzip
        opener = gzip.open if path.suffix.lower() == '.gz' else open
        array = kind == '.json'
        if path.suffix.lower() not in ('.zst', '.zstd'):
            with opener(path, 'rb') as stream:
                array = stream.read(4096).lstrip().startswith(b'[')
        opts = f'FORMAT JSON, ARRAY {str(array).lower()}' + compression
        read_compression = ', compression=' + lit('gzip' if path.suffix.lower() == '.gz' else 'zstd') if compression else ''
        return opts, lambda location: f'read_json_auto({location}, columns={schema}{read_compression})'
    cursor = conn.execute(f'SELECT * FROM sniff_csv({lit(path.as_posix())})')
    meta = dict(zip([c[0] for c in cursor.description], cursor.fetchone()))
    # COPY does not preserve arbitrary preambles; never drop skipped source lines.
    if meta.get('SkipRows', 0):
        raise ValueError('This file has a preamble. Save a new export to preserve the original.')
    if meta.get('Comment') not in (None, '', '(empty)'):
        raise ValueError('This file has comment lines. Save a new export to preserve the original.')
    stored = conn.execute("SELECT sql FROM duckdb_views() WHERE database_name=current_database() AND schema_name='main' AND view_name=?", [target['name']]).fetchone()
    header = re.search(r'\bheader\s*=\s*(true|false)', stored[0], re.I) if stored else None
    header = header.group(1).lower() if header else str(bool(meta['HasHeader'])).lower()
    quote = meta['Quote'] if meta['Quote'] != '(empty)' else '"'
    escape = meta['Escape'] if meta['Escape'] != '(empty)' else quote
    newline = meta['NewLineDelimiter'].replace('\\r','\r').replace('\\n','\n')
    opts = ('FORMAT CSV, HEADER ' + header + ', DELIMITER ' + lit(meta['Delimiter']) +
            ', QUOTE ' + lit(quote) + ', ESCAPE ' + lit(escape) + ', NEW_LINE ' + lit(newline) + compression)
    args = ('header=' + header + ', delim=' + lit(meta['Delimiter']) + ', quote=' + lit(quote) +
            ', escape=' + lit(escape) + ', columns=' + schema + ', auto_detect=false')
    if compression:
        args += ', compression=' + lit('gzip' if path.suffix.lower() == '.gz' else 'zstd')
    # Preserve explicit source date/timestamp dialects as well as scalar types.
    for key, option in [('DateFormat', 'dateformat'), ('TimestampFormat', 'timestampformat')]:
        if meta.get(key):
            opts += ', ' + option + ' ' + lit(meta[key])
            args += ', ' + option + '=' + lit(meta[key])
    return opts, lambda location: f'read_csv({location}, {args})'


def dispatch(conn, payload, environment=None):
    init(conn)
    op = payload.get('op', 'list')
    if op == 'list':
        return {'drafts': [dict(zip(('id', 'title', 'created'), row)) for row in
                           conn.execute('SELECT id,title,created FROM _wb_edit_sessions ORDER BY created DESC').fetchall()]}
    session = snapshot(conn, payload, environment or {}) if op == 'open' else load(conn, payload['id'])
    if op in ('cells', 'delete', 'replace', 'set', 'add', 'undo', 'redo', 'save', 'discard'):
        if 'expected_revision' in payload and int(payload['expected_revision']) != session['revision']:
            raise ValueError('This draft changed in another window. Refresh it before editing or saving.')
    work, _, _ = names(session)
    if op == 'discard':
        conn.execute('BEGIN')
        try:
            for table in names(session):
                conn.execute('DROP TABLE ' + table)
            conn.execute('DELETE FROM _wb_edit_sessions WHERE id=?', [session['id']])
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
        return {'discarded': session['id']}
    if op == 'cell':
        col = column(session, payload['column'])
        value = conn.execute(f'SELECT CAST({col} AS VARCHAR) FROM {work} WHERE {identity(session)}=?', [int(payload['row'])]).fetchone()
        if not value:
            raise ValueError('Row no longer exists.')
        if value[0] is not None and len(value[0].encode('utf-8')) > 700000:
            raise ValueError('This value is too large for the cell editor (700 KB). Use SQL to transform it.')
        return {'value': value[0]}
    if op in ('cells', 'delete', 'replace', 'set', 'add'):
        edit(conn, session, payload)
    elif op in ('undo', 'redo'):
        travel(conn, session, op == 'redo')
    elif op == 'save':
        mode = payload.get('mode')
        if mode in ('source', 'original'):
            return write_source(conn, session, payload)
        fields = ','.join(q(c['name']) for c in session['columns'])
        sql = f'SELECT {fields} FROM {work} ORDER BY {identity(session)}'
        if mode == 'working':
            name = available_name(conn, payload.get('name') or session['title'], exact=True)
            conn.execute(f'CREATE TABLE {q(name)} AS {sql}')
            return {'saved_to': name, 'catalog': catalog(conn)}
        if mode == 'export':
            ext, options = export_options(payload['format'])
            return copy_to(conn, sql, new_output(payload['output'], ext), options, uuid.uuid4().hex)
        raise ValueError('Choose how to save your edits.')
    elif op not in ('open', 'page'):
        raise ValueError('Unknown editor operation.')
    return view(conn, load(conn, session['id']), payload)
