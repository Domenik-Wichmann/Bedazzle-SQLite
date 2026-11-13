"""Bounded result value discovery and reproducible SQL over immutable query runs."""
import hashlib
import json
import re
from engine import identifier as q, literal as lit, query_body

TOKEN = re.compile(r'v:[0-9a-f]{64}\Z')


def text_sql(value):
    return lit(value) if '\0' not in value else "decode(from_hex("+lit(value.encode('utf-8').hex())+'))'


def base(folder, info):
    return folder/('base.parquet' if info.get('base_order_column') else 'rows.parquet'), info.get('base_order_column',info['order_column'])


def normalize(value, columns):
    if not isinstance(value,dict) or len(json.dumps(value).encode())>262144:
        raise ValueError('Result filters must fit within 256 KiB. Use a text condition for larger selections.')
    filters=value.get('filters',[])
    if not isinstance(filters,list) or len(filters)>16:raise ValueError('Use at most 16 column filters.')
    out=[];seen=set();selected=0
    for item in filters:
        if not isinstance(item,dict) or item.get('column') not in columns or item['column'] in seen:
            raise ValueError('Choose distinct existing result columns for filters.')
        seen.add(item['column']);kind=item.get('kind');clean={'column':item['column'],'kind':kind}
        if kind=='values':
            mode=item.get('selection','exclude');values=item.get('values',[])
            if mode not in ('include','exclude') or not isinstance(values,list):raise ValueError('Choose include or exclude values.')
            unique={}
            for choice in values:
                if not isinstance(choice,dict):raise ValueError('Invalid selected value.')
                token=choice.get('token');selected_value=choice.get('value')
                if token!='null' and (not isinstance(token,str) or not TOKEN.fullmatch(token)):raise ValueError('Invalid value identity.')
                if selected_value is not None:
                    if not isinstance(selected_value,str) or len(selected_value)>512 or len(selected_value.encode('utf-8'))>2048:raise ValueError('Use the returned identity for a long value.')
                    if token!='v:'+hashlib.sha256(selected_value.encode('utf-8')).hexdigest():raise ValueError('Selected value does not match its identity.')
                if token=='null' and selected_value is not None:raise ValueError('NULL is separate from text values.')
                unique[token]={'token':token,'value':selected_value}
            selected+=len(unique)
            if selected>1000:raise ValueError('Select at most 1,000 individual values across filters, or use a text condition.')
            if mode=='exclude' and not unique:continue
            clean.update(selection=mode,values=list(unique.values()))
        elif kind in ('contains','starts_with','equals','not_contains'):
            text=item.get('text','')
            if not isinstance(text,str) or len(text)>4096:raise ValueError('Text filters accept at most 4,096 characters.')
            if not text:continue
            clean.update(text=text,case_sensitive=item.get('case_sensitive') is True)
        elif kind not in ('null','not_null'):
            raise ValueError('Unknown result filter condition.')
        out.append(clean)
    sort=value.get('sort')
    if sort is not None:
        if not isinstance(sort,dict) or sort.get('column') not in columns or sort.get('direction') not in ('ASC','DESC'):
            raise ValueError('Choose an existing result column and ASC or DESC sorting.')
        sort={'column':sort['column'],'direction':sort['direction']}
    return {'filters':out,'sort':sort}


def condition(item):
    col='result_view.'+q(item['column']);text='CAST('+col+' AS VARCHAR)';kind=item['kind']
    if kind=='null':return col+' IS NULL'
    if kind=='not_null':return col+' IS NOT NULL'
    if kind=='values':
        values=item['values'];parts=[]
        if any(v['token']=='null' for v in values):parts.append(col+' IS NULL')
        literals=[text_sql(v['value']) for v in values if v['token']!='null' and v['value'] is not None]
        hashes=[lit(v['token'][2:]) for v in values if v['token']!='null' and v['value'] is None]
        if literals:parts.append(text+' IN ('+','.join(literals)+')')
        if hashes:parts.append('sha256('+text+') IN ('+','.join(hashes)+')')
        match='coalesce(('+(' OR '.join(parts) or 'false')+'),false)'
        return ('NOT '+match) if item['selection']=='exclude' else match
    expected=text_sql(item['text'])
    if not item['case_sensitive']:text='lower('+text+')';expected='lower('+expected+')'
    if kind=='equals':return text+' = '+expected
    if kind=='starts_with':return 'starts_with('+text+','+expected+')'
    expr='contains('+text+','+expected+')'
    return 'NOT '+expr if kind=='not_contains' else expr


def clauses(plan,exclude=None):
    items=[condition(v) for v in plan['filters'] if v['column']!=exclude]
    where='\nWHERE '+('\n  AND '.join('('+v+')' for v in items)) if items else ''
    sort=plan.get('sort')
    order='\nORDER BY result_view.'+q(sort['column'])+' '+sort['direction'] if sort else ''
    return where,order


def visible_sql(conn, original, plan):
    statements=conn.extract_statements(original)
    if not statements or str(statements[-1].type).split('.')[-1]!='SELECT':raise ValueError('Result filters require a final SELECT query.')
    if not plan['filters'] and not plan['sort']:return original
    prefix='\n'.join(query_body(s.query).rstrip()+';' for s in statements[:-1])
    where,order=clauses(plan)
    sql=(prefix+'\n' if prefix else '')+'SELECT *\nFROM (\n'+query_body(statements[-1].query)+') AS result_view'+where+order+';'
    if len(sql)>100000 or len(sql.encode('utf-8'))>524288:raise ValueError('Generated SQL is too large to save as a draft. Use fewer selected values or a text condition.')
    return sql


def source(conn,folder,info):
    path,order=base(folder,info)
    columns=[row[0] for row in conn.execute('DESCRIBE SELECT * EXCLUDE ('+q(order)+') FROM read_parquet(?)',[str(path)]).fetchall()]
    return path,order,columns


def choices(conn,payload,workspace):
    from result_store import metadata
    folder,info=metadata(workspace,payload['result_id']);path,order,columns=source(conn,folder,info)
    column=payload['column']
    if column not in columns:raise ValueError('Choose an existing result column.')
    search=payload.get('search','')
    if not isinstance(search,str) or len(search)>4096:raise ValueError('Search accepts at most 4,096 characters.')
    offset=max(0,int(payload.get('offset',0)))
    if offset>=10000:raise ValueError('Refine the search after 10,000 values; more values remain local.')
    size=min(100,max(1,int(payload.get('size',100))),10000-offset)
    plan=info.get('result_view',{'filters':[],'sort':None});where,_=clauses(plan,exclude=column)
    search_sql=' WHERE contains(lower(value),lower(?))' if search else ''
    grouped='SELECT CAST(result_view.'+q(column)+' AS VARCHAR) AS value,count(*)::BIGINT AS n FROM read_parquet('+lit(path)+') result_view'+where+' GROUP BY 1'
    sql="SELECT CASE WHEN value IS NULL THEN 'null' ELSE 'v:'||sha256(value) END,left(value,160),CASE WHEN length(value)<=512 AND octet_length(encode(value))<=2048 THEN value ELSE NULL END,length(value),n FROM ("+grouped+') available'+search_sql+' ORDER BY value NULLS FIRST LIMIT ? OFFSET ?'
    cursor=conn.execute(sql,([search] if search else [])+[size+1,offset]);items=[];more=False
    while True:
        row=cursor.fetchone()
        if row is None:break
        item={'token':row[0],'label':row[1],'value':row[2],'characters':row[3],'count':row[4],'truncated':row[3] is not None and row[3]>160}
        if len(items)>=size or len(json.dumps(items+[item]).encode('utf-8'))>60000:
            more=True;break
        items.append(item)
    return {'column':column,'items':items,'offset':offset,'next_offset':offset+len(items),'has_more':more and offset+len(items)<10000,'search_limit_reached':more and offset+len(items)>=10000,'counts':'exact within other active column filters','source_rows':info.get('base_rows',info['rows'])}
