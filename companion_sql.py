"""Validate local analytics structurally; classify repairs separately from diagnostics."""
import json

AGGREGATES = set('count count_star count_if sum avg min max approx_count_distinct stddev stddev_pop stddev_samp variance var_pop var_samp median quantile_cont quantile_disc string_agg list histogram bool_and bool_or first last arg_min arg_max'.split())
SCALARS = set('nullif coalesce length char_length octet_length trim ltrim rtrim lower upper replace regexp_matches regexp_full_match regexp_extract regexp_replace contains starts_with ends_with round abs ceil floor sqrt pow power log ln exp sign greatest least concat concat_ws substr substring left right split_part strpos instr reverse lpad rpad repeat typeof isfinite isnan date_part date_trunc strftime strptime try_strptime make_date year month day current_date row_number rank dense_rank lag lead ntile percent_rank cume_dist json_valid json_extract json_extract_string'.split())
OPERATORS = {'~~','!~~','~~*','!~~*','+','-','*','/','//','%','**','||','~','!~','&','|','^','<<','>>','not','!'}
REPAIRS = set('nullif coalesce trim ltrim rtrim lower upper replace regexp_replace lpad rpad'.split())


def validate(conn, sql, aliases, allow_repairs=False, source_columns=None):
    if not isinstance(sql,str) or len(sql.encode('utf-8'))>100000:
        raise ValueError('SQL must be text of at most 100000 bytes')
    ast=json.loads(conn.execute('SELECT json_serialize_sql(?)',[sql]).fetchone()[0])
    if ast.get('error') or len(ast.get('statements',[]))!=1:
        raise ValueError('Submit one SELECT, CTE, set operation or bounded SQL pivot')
    root=ast['statements'][0]['node']
    if root['type'] not in ('SELECT_NODE','SET_OPERATION_NODE'):
        raise ValueError('Only read-only SELECT query trees are permitted')
    functions=set()

    def repaired(expression):
        if not isinstance(expression,dict):return False
        cls=expression.get('class')
        if cls in ('COMPARISON','CONJUNCTION') or expression.get('type') in ('OPERATOR_IS_NULL','OPERATOR_IS_NOT_NULL','OPERATOR_NOT','COMPARE_IN','COMPARE_NOT_IN'):
            return False
        if expression.get('function_name') in AGGREGATES:return False
        if expression.get('function_name') in ('~~','!~~','~~*','!~~*','regexp_matches','regexp_full_match','contains','starts_with','ends_with'):
            return False
        if expression.get('function_name') in REPAIRS:return True
        if expression.get('type') in ('OPERATOR_COALESCE','OPERATOR_NULLIF'):return True
        if cls=='STAR' and expression.get('replace_list'):return True
        if cls=='CASE':
            values=[c['then_expr'] for c in expression['case_checks']]+[expression['else_expr']]
            return not all(v.get('class')=='CONSTANT' for v in values)
        for key,value in expression.items():
            if key in ('filter','order_bys','where_clause'):continue
            if isinstance(value,dict) and repaired(value):return True
            if isinstance(value,list) and any(repaired(v) for v in value):return True
        return False

    columns=set(source_columns or [])
    if not allow_repairs and source_columns is None:
        from engine import identifier
        for alias in aliases:
            columns.update(r[0].lower() for r in conn.execute('DESCRIBE SELECT * FROM '+identifier(alias)).fetchall())
    def replaces_source(expression):
        if not isinstance(expression,dict) or expression.get('alias','').lower() not in columns:return False
        if expression.get('class') in ('COLUMN_REF','CAST'):return False
        return expression.get('function_name') not in AGGREGATES

    def walk(value, scope):
        if isinstance(value,list):
            for item in value:walk(item,scope)
            return
        if not isinstance(value,dict):return
        scope=set(scope)
        ctes=value.get('cte_map',{}).get('map',[])
        scope.update(c['key'] for c in ctes)
        kind=value.get('type')
        if kind=='BASE_TABLE':
            if value.get('table_name') not in scope or value.get('schema_name') or value.get('catalog_name') or value.get('at_clause'):
                raise ValueError('Only declared source aliases and local CTEs may be queried')
        if kind in ('TABLE_FUNCTION','SHOW_REF','RECURSIVE_CTE_NODE','CTE_NODE'):
            raise ValueError('External/table functions, catalog inspection and recursive CTEs are not exposed')
        if kind=='PIVOT':
            pivots=value.get('pivots',[])
            if not pivots or any(p.get('pivot_enum') or not p.get('entries') for p in pivots):raise ValueError('Use an explicit bounded pivot IN list')
            if any(len(p['entries'])>100 for p in pivots):raise ValueError('Use at most 100 explicit entries per pivot axis')
        if 'function_name' in value:
            name=value['function_name'].lower()
            if name not in AGGREGATES|SCALARS|OPERATORS or value.get('schema') or value.get('catalog'):
                raise ValueError('Function is outside the local analytics allowlist: '+name)
            functions.add(name)
        if not allow_repairs and any(repaired(e) or replaces_source(e) for e in value.get('select_list',[])):
            raise ValueError('This query projects corrected values. Use propose_transform for a repair copy; diagnostic TRIM/LIKE/CASE in predicates, flags and aggregates is allowed.')
        for child in value.values():walk(child,scope)
    walk(root,set(aliases))
    for name in functions:
        if conn.execute("SELECT count(*) FROM duckdb_functions() WHERE lower(function_name)=? AND NOT internal",[name]).fetchone()[0]:
            raise ValueError('User macros cannot be executed through companion SQL: '+name)
    return sql


def bind_query(conn, items, sql, allow_repairs=False):
    """Query-local CTEs preserve UI temporary tables/views and session state."""
    from pathlib import Path
    from engine import reader,identifier,query_body
    aliases=['v'+str(i) for i in range(len(items))]
    columns=set();ctes=[]
    for alias,item in zip(aliases,items):
        relation=reader(Path(item['path']),item.get('options'))
        columns.update(r[0].lower() for r in conn.execute('DESCRIBE SELECT * FROM '+relation).fetchall())
        ctes.append(identifier(alias)+' AS (SELECT * FROM '+relation+')')
    validate(conn,sql,aliases,allow_repairs=allow_repairs,source_columns=columns)
    return 'WITH '+', '.join(ctes)+' SELECT * FROM ('+query_body(sql)+') AS _wb_authorized_query'
