"""Immutable, disk-backed query runs. Export never substitutes a new execution."""
import json,os,re,time,shutil
from pathlib import Path
from engine import identifier,literal,query_body,page,export_options,new_output,publish_file,catalog,json_cell


def inspect_row(conn,payload,workspace):
 """Read one complete row from the immutable run, without preview clipping."""
 folder,info=metadata(workspace,payload['result_id'])
 index=int(payload['row_index'])
 if index<0 or index>=info['rows']:raise ValueError('This row is outside the retained result.')
 order=identifier(info['order_column'])
 cursor=conn.execute(f'SELECT * EXCLUDE ({order}) FROM read_parquet({literal(folder/"rows.parquet")}) WHERE {order}=?',[index+1])
 columns=[{'name':str(col[0]),'type':str(col[1])} for col in cursor.description]
 row=cursor.fetchone()
 if row is None:raise ValueError('This retained row is no longer available.')
 return {'columns':columns,'row':[('0x'+value.hex()) if isinstance(value,bytes) else json_cell(value) for value in row],'row_index':index}

def location(workspace,key):
 if not re.fullmatch(r'[0-9a-f]{32}',str(key)):raise ValueError('Invalid result identifier.')
 base=Path(workspace).resolve()/'results';folder=(base/key).resolve()
 if not folder.is_relative_to(base):raise ValueError('Result storage is outside this workspace.')
 return folder

def metadata(workspace,key):
 folder=location(workspace,key)
 if not (folder/'result.json').exists() or not (folder/'rows.parquet').exists():raise ValueError('These retained results are no longer available. Run the query again to create a new result.')
 return folder,json.loads((folder/'result.json').read_text('utf-8'))

def tag_lineage(workspace,key,lineage):
 folder,info=metadata(workspace,key)
 if lineage.get('edited'):
  from companion_store import Ledger
  Ledger(workspace).note_file(folder/'rows.parquet',lineage.get('query_id') or lineage['inputs'][0])
 info['lineage']=lineage
 temporary=folder/'lineage.tmp'
 temporary.write_text(json.dumps(info),encoding='utf-8')
 for attempt in range(10):
  try:temporary.replace(folder/'result.json');break
  except PermissionError:
   if attempt==9:raise
   time.sleep(.025*(attempt+1))

def relation(workspace,key):
 """Shared reader for modules/editors: exclude internal ordering metadata."""
 folder,info=metadata(workspace,key);order=info.get('order_column')
 projection='* EXCLUDE ('+identifier(order)+')' if order else '*'
 return f'SELECT {projection} FROM read_parquet({literal(folder/"rows.parquet")})'+(' ORDER BY '+identifier(order) if order else '')

def release(workspace,key):
 # Agent artifacts are durable; closing a UI tab must not invalidate their references.
 ledger_file=Path(workspace)/'companion'/'ledger.sqlite3'
 if ledger_file.exists():
  from companion_store import Ledger
  if any(a.get('result_id')==key for a in Ledger(workspace).list('artifact',100000)):
   return
 folder=location(workspace,key)
 for name in ('rows.parquet','result.json','rows.partial','result.tmp'):(folder/name).unlink(missing_ok=True)
 try:folder.rmdir()
 except OSError:pass

def query(conn,payload,job_id,environment):
 workspace=environment.get('workspace')
 if workspace is None:raise ValueError('Retaining query results requires a workspace.')
 original=payload['sql'];key=payload.get('result_id');folder=None;created=False
 if key:
  folder,info=metadata(workspace,key);order=identifier(info['order_column']);body=f'SELECT * EXCLUDE ({order}) FROM read_parquet({literal(folder/"rows.parquet")}) ORDER BY {order}'
  original=info['sql']
 else:
  statements=conn.extract_statements(original)
  if not statements or str(statements[-1].type).split('.')[-1]!='SELECT':return None
  for statement in statements[:-1]:conn.execute(statement.query)
  body=query_body(statements[-1].query)
  info={'sql':original,'statement_count':len(statements)}
 if payload.get('sort'):
  sort=payload['sort'];direction=sort.get('direction','ASC')
  if direction not in ('ASC','DESC'):raise ValueError('Invalid sort direction.')
  body=f'SELECT * FROM ({body}) sorted_result ORDER BY {identifier(sort["column"])} {direction}'
 if not key or payload.get('sort'):
  key=job_id;folder=location(workspace,key);folder.mkdir(parents=True,exist_ok=False);created=True
  temporary=folder/'rows.partial'
  if info.get('lineage',{}).get('edited'):
   from companion_store import Ledger
   Ledger(workspace).note_file(folder/'rows.parquet',info['lineage'].get('query_id') or info['lineage']['inputs'][0])
  try:
   emit=environment.get('emit',lambda value:None)
   emit({'label':'Running and retaining results','detail':'Saving this run to compressed local storage. Paging and export will reuse it.','percent':None})
   conn.execute('SET preserve_insertion_order=true')
   columns=[r[0].casefold() for r in conn.execute(f'DESCRIBE SELECT * FROM ({body}) result_source').fetchall()]
   order_column='_wb_result_order'
   while order_column.casefold() in columns:order_column+='_'
   from engine import parquet_query
   body,integer_columns=parquet_query(conn,body)
   if integer_columns:info['storage_notes']={'exact_integer_columns':integer_columns,'representation':'DECIMAL(38,0); values outside its exact range require an explicit VARCHAR query projection'}
   retained=f'SELECT row_number() OVER () AS {identifier(order_column)}, result_source.* FROM ({body}) result_source'
   count=conn.execute(f'COPY ({retained}) TO {literal(temporary)} (FORMAT PARQUET, COMPRESSION ZSTD)').fetchone()[0]
   cancelled=environment.get('cancelled')
   if cancelled and cancelled.is_set():raise InterruptedError('Cancelled.')
   settings=environment.get('settings',{});quota=settings.get('spill_gb',10)*1024**3
   previous=payload.get('replace_result_id');used=0
   for file in (Path(workspace)/'results').glob('*/rows.parquet'):
    if file.parent.name!=previous:used+=file.stat().st_size
   if used+temporary.stat().st_size>quota:raise ValueError('Retained results exceed the temporary disk budget. Close unneeded SQL tabs or increase Temporary disk limit in Settings.')
   if shutil.disk_usage(folder).free<512*1024**2:raise ValueError('Less than 512 MB free disk space remains. Free some space before retaining these results.')
   temporary.replace(folder/'rows.parquet')
   info={**info,'rows':count,'created':time.time(),'order_column':order_column}
   (folder/'result.json').write_text(json.dumps(info),encoding='utf-8')
  except BaseException:
   release(workspace,key);raise
 offset=max(0,int(payload.get('offset',0)));logical=max(10,min(1000000,int(payload.get('size',100))));window=max(0,min(logical-1,int(payload.get('window',0))))
 position=offset+window;size=min(500,logical-window);order=identifier(info['order_column'])
 window_sql=f'SELECT * EXCLUDE ({order}) FROM read_parquet({literal(folder/"rows.parquet")}) WHERE {order}>{position} AND {order}<={position+size+1} ORDER BY {order}'
 result=page(conn,window_sql,0,size)
 result.update(offset=position,next_offset=position+len(result['rows']))
 result.update(sql=original,result_id=key,total_rows=info['rows'],total_status='exact',page_start=offset,logical_size=logical,statement_count=info['statement_count'],retained=True)
 if created and info['statement_count']>1:result['catalog']=catalog(conn)
 previous=payload.get('replace_result_id')
 if created and previous and previous!=key:
  try:release(workspace,previous)
  except OSError:pass
 return result

def export(conn,payload,job_id,workspace):
 folder,info=metadata(workspace,payload['result_id'])
 extension,options=export_options(payload['format']);target=new_output(payload['output'],extension)
 order=identifier(info['order_column'])
 sql=f'SELECT * EXCLUDE ({order}) FROM read_parquet({literal(folder/"rows.parquet")})'
 scope=payload.get('scope','all')
 if scope=='page':
  offset=max(0,int(payload['offset']));size=max(0,min(500,int(payload['rows'])))
  sql+=f' WHERE {order}>{offset} AND {order}<={offset+size}'
 elif scope!='all':raise ValueError('Choose all results or the displayed page.')
 sql+=f' ORDER BY {order}'
 # Reading a retained file is not re-executing the user's SQL. Preserve its order.
 partial=target.parent/f'.{target.name}.{job_id}.partial'
 if info.get('lineage',{}).get('edited'):
  from companion_store import Ledger
  Ledger(workspace).note_file(target,info['lineage'].get('query_id') or info['lineage']['inputs'][0])
 try:
  conn.execute('SET preserve_insertion_order=false')
  count=conn.execute(f'COPY ({sql}) TO {literal(partial)} ({options})').fetchone()[0]
  publish_file(partial,target)
  if info.get('lineage',{}).get('edited'):
   from companion_store import Ledger
   Ledger(workspace).note_file(target,info['lineage'].get('query_id') or info['lineage']['inputs'][0])
  return {'path':str(target),'bytes':target.stat().st_size,'exported_rows':count,'result_id':payload['result_id']}
 finally:partial.unlink(missing_ok=True)
