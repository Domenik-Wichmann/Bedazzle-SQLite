/* Shared by the pivot UI and executable DuckDB checks. No browser dependencies. */
'use strict';
const PivotQuery = (() => {
  const name = v => '"' + String(v).replaceAll('"', '""') + '"';
  const value = v => v === null ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'";
  const aggregates = {count:'Count rows',sum:'Sum',avg:'Average',min:'Minimum',max:'Maximum',distinct:'Count distinct',counted:'Count nonempty'};
  const numeric = type => /^(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|DECIMAL|DOUBLE|FLOAT|REAL|BIGNUM)/i.test(type||'');
  const keyEligible = type => !/(STRUCT|MAP|UNION|\[|\]|BLOB|BIT)/i.test(type||'');
  function keyExpr(alias,field,clean='exact') {
    let expr=`CAST(${name(alias)}.${name(field)} AS VARCHAR)`;
    if(clean==='trim'||clean==='fold')expr=`trim(${expr})`;
    if(clean==='fold')expr=`lower(${expr})`;
    if(!['exact','trim','fold'].includes(clean))throw Error('Choose a valid key comparison.');
    return `nullif(${expr}, '')`;
  }
  function relationKeys(dataset,target,keys) {
    if(!keys?.length)throw Error('Choose at least one matching field on each side.');
    const side=(table,alias,field)=>`SELECT ${keys.map((k,i)=>`${keyExpr(alias,k[field],k.clean)} AS k${i}`).join(', ')} FROM ${name(table)} AS ${name(alias)}`;
    return {left:side(dataset,'l','left'),right:side(target,'r','right'),names:keys.map((_,i)=>'k'+i)};
  }
  function relationshipSQL(dataset,target,keys) {
    const k=relationKeys(dataset,target,keys),cols=k.names.join(', '),valid=k.names.map(n=>n+' IS NOT NULL').join(' AND '),match=k.names.map(n=>`l.${n}=r.${n}`).join(' AND ');
    return `WITH l AS (${k.left}), r AS (${k.right}), lg AS (SELECT ${cols},count(*) AS n FROM l WHERE ${valid} GROUP BY ALL), rg AS (SELECT ${cols},count(*) AS n FROM r WHERE ${valid} GROUP BY ALL)
SELECT (SELECT count(*) FROM l) AS left_rows, (SELECT count(*) FROM r) AS right_rows,
 (SELECT count(*) FROM l WHERE NOT (${valid})) AS left_nulls, (SELECT count(*) FROM r WHERE NOT (${valid})) AS right_nulls,
 (SELECT count(*) FROM lg WHERE n>1) AS left_duplicate_keys, (SELECT count(*) FROM rg WHERE n>1) AS right_duplicate_keys,
 (SELECT count(*) FROM l WHERE EXISTS (SELECT 1 FROM rg r WHERE ${match})) AS matched_left,
 (SELECT count(*) FROM r WHERE EXISTS (SELECT 1 FROM lg l WHERE ${match})) AS matched_right,
 (SELECT count(*) FROM lg) AS left_distinct, (SELECT count(*) FROM rg) AS right_distinct;`;
  }
  function unmatchedSQL(dataset,target,keys,side='left') {
    const k=relationKeys(dataset,target,keys),from=side==='left'?'l':'r',other=side==='left'?'r':'l';
    return `WITH l AS (${k.left}),r AS (${k.right}) SELECT * FROM ${from} WHERE NOT EXISTS (SELECT 1 FROM ${other} WHERE ${k.names.map(n=>`l.${n}=r.${n}`).join(' AND ')})`;
  }
  function linkFields(schema,used) {
    return schema.columns.map(c=>{let alias=`${schema.name} · ${c.name}`,n=2;while(used.has(alias.toLowerCase()))alias=`${schema.name} · ${c.name} (${n++})`;used.add(alias.toLowerCase());return {...c,alias};});
  }
  function joinedSource(config) {
    const links=config.links||[];
    if(!links.length)return `SELECT * FROM ${name(config.dataset)}`;
    const selects=['base.*'],joins=[];
    links.forEach((link,i)=>{
      if(!link.keys?.length||!link.fields?.length)throw Error('Reconnect '+link.dataset+' before running this pivot.');
      const alias='related'+i;
      selects.push(...link.fields.map(f=>`${name(alias)}.${name(f.name)} AS ${name(f.alias)}`));
      const rightKeys=link.keys.map(k=>keyExpr('keycheck',k.right,k.clean));
      const repeated=`SELECT 1 FROM ${name(link.dataset)} AS keycheck WHERE ${rightKeys.map(k=>k+' IS NOT NULL').join(' AND ')} GROUP BY ${rightKeys.join(', ')} HAVING count(*)>1`;
      const guard=`(SELECT CASE WHEN EXISTS (${repeated}) THEN error(${value('Related keys repeat in '+link.dataset+'. Recheck the pivot connection.')}) ELSE true END)`;
      joins.push(`${link.mode==='inner'?'INNER':'LEFT'} JOIN ${name(link.dataset)} AS ${name(alias)} ON `+link.keys.map(k=>`${keyExpr('base',k.left,k.clean)}=${keyExpr(alias,k.right,k.clean)}`).concat(guard).join(' AND '));
    });
    return `SELECT ${selects.join(', ')} FROM ${name(config.dataset)} AS base\n${joins.join('\n')}`;
  }
  function suggestionPairs(left,right) {
    const tokens=n=>String(n).replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).map(t=>['number','num','no','identifier'].includes(t)?'id':t);
    const pairs=[];
    for(const l of left.columns.filter(c=>keyEligible(c.type)))for(const r of right.columns.filter(c=>keyEligible(c.type))){
      const a=tokens(l.name),b=tokens(r.name),shared=a.filter(t=>b.includes(t)).length;
      pairs.push({left:l.name,right:r.name,score:(l.name.toLowerCase()===r.name.toLowerCase()?30:0)+shared*5+(numeric(l.type)===numeric(r.type)?1:0)});
    }
    return pairs.sort((a,b)=>b.score-a.score).slice(0,12);
  }
  function suggestionSQL(left,right,pairs) {
    if(!pairs.length)throw Error('No scalar fields are available to match.');
    return `WITH l AS (SELECT * FROM ${name(left)} LIMIT 200),r AS (SELECT * FROM ${name(right)} LIMIT 200)\n`+pairs.map((p,i)=>`SELECT ${i} AS candidate,count(*) AS matching_values FROM (SELECT DISTINCT CAST(${name(p.left)} AS VARCHAR) AS v FROM l WHERE nullif(CAST(${name(p.left)} AS VARCHAR),'') IS NOT NULL) a WHERE EXISTS (SELECT 1 FROM r WHERE CAST(${name(p.right)} AS VARCHAR)=a.v)`).join('\nUNION ALL\n');
  }
  function source(config) {
    const conditions = config.filters.map(f => {
      const n = name(f.field), text = `CAST(${n} AS VARCHAR)`;
      if (f.op === 'null') return `${n} IS NULL`;
      if (f.op === 'notnull') return `${n} IS NOT NULL`;
      if (f.op === 'contains') return `contains(lower(${text}), lower(${value(f.value)}))`;
      if (f.op === 'equals' || f.op === 'not') return `${text} ${f.op === 'not' ? '<>' : '='} ${value(f.value)}`;
      if (!['gt','gte','lt','lte'].includes(f.op) || !String(f.value).trim() || !Number.isFinite(Number(f.value))) throw Error('Enter a valid number for each numeric filter.');
      return `TRY_CAST(${n} AS DOUBLE) ${{gt:'>',gte:'>=',lt:'<',lte:'<='}[f.op]} ${Number(f.value)}`;
    });
    return `SELECT * FROM (${joinedSource(config)}) AS combined` + (conditions.length ? '\nWHERE ' + conditions.join('\n  AND ') : '');
  }
  function discovery(c) {
    return `SELECT DISTINCT ${c.columns.map(n=>`CAST(${name(n)} AS VARCHAR) AS ${name(n)}`).join(', ')} FROM (${source(c)}) AS source ORDER BY ALL LIMIT 41;`;
  }
  function sortExpression(rule,level,rows) {
    const direction=rule.direction==='desc'?'DESC':'ASC';
    if(rule.kind==='label')return `${rule.numeric?`TRY_CAST(${name(level)} AS DOUBLE)`:name(level)} ${direction} NULLS LAST`;
    const op=rule.op||'max';
    if(!aggregates[op])throw Error('Choose a valid sort calculation.');
    if(op!=='count'&&!rule.field)throw Error('Choose a field to sort by.');
    const expression=(alias,withCategory=true)=>{
      const field=(alias?name(alias)+'.':'')+name(rule.field);
      const n=rule.numeric||['sum','avg'].includes(op)?`TRY_CAST(${field} AS DOUBLE)`:field;
      const aggregate=op==='count'?'count(*)':op==='counted'?`count(${field})`:op==='distinct'?`count(DISTINCT ${field})`:`${op}(${n})`;
      const filters=withCategory&&Array.isArray(rule.category)?(rule.categoryFields||[]).map((f,i)=>`CAST(${alias?name(alias)+'.':''}${name(f)} AS VARCHAR) IS NOT DISTINCT FROM ${value(rule.category[i])}`):[];
      return aggregate+(filters.length?' FILTER (WHERE '+filters.join(' AND ')+')':'');
    };
    const prefix=rows.slice(0,rows.indexOf(level)+1);
    const where=prefix.map(f=>`${name('__pivot_sort')}.${name(f)} IS NOT DISTINCT FROM source.${name(f)}`).join(' AND ');
    let rank=expression('__pivot_sort');
    if(rule.percent)rank=`100.0 * (${rank}) / NULLIF((SELECT ${expression('',false)} FROM source),0)`;
    return `(SELECT ${rank} FROM source AS ${name('__pivot_sort')} WHERE ${where}) ${direction} NULLS LAST`;
  }
  function build(c, categories = []) {
    if (!c.dataset) throw Error('Choose a dataset to begin.');
    if (!c.values.length) throw Error('Add a field to Values to calculate your pivot.');
    for(const rule of c.sorts||[])if(!c.rows.includes(rule.level))throw Error('A sort refers to a removed row group. Edit the Sorts rules.');
    if (c.columns.length && categories.length > 40) throw Error('More than 40 column combinations. Add a filter or move a column field to Rows. No categories were silently dropped.');
    if (c.rows.length + c.values.length * ((c.columns.length ? categories.length : 0) + (c.columnTotals || !c.columns.length ? 1 : 0)) + 1 > 115) throw Error('This pivot would be too wide. Use fewer measures, fewer column categories, or add filters (maximum 115 result columns).');
    const src = source(c), dimensions = c.rows.map(name), groups = [];
    if (dimensions.length) {
      groups.push(dimensions);
      if (c.subtotals) for(let n=dimensions.length-1;n>0;n--) groups.push(dimensions.slice(0,n));
      if (c.rowTotals) groups.push([]);
    }
    const used = new Set(c.rows.map(n=>n.toLowerCase()));
    function alias(label) {let result=label,i=2;while(used.has(result.toLowerCase()))result=label+' ('+i+++')';used.add(result.toLowerCase());return result;}
    const outputs=[], cells=[];
    const rowKind = dimensions.length && (c.rowTotals || (c.subtotals && dimensions.length>1)) ? alias('Row kind') : null;
    if(rowKind) outputs.push(`CASE WHEN GROUPING(${dimensions[0]})=1 THEN 'Grand total' ${dimensions.slice(1).map((n,i)=>`WHEN GROUPING(${n})=1 THEN 'Subtotal · ${i+1}'`).join(' ')} ELSE 'Detail' END AS ${name(rowKind)}`);
    function expression(m) {
      if (!aggregates[m.op]) throw Error('Choose a valid aggregation.');
      const n=name(m.field);
      return m.op==='count'?'count(*)':m.op==='distinct'?`count(DISTINCT ${n})`:m.op==='counted'?`count(${n})`:`${m.op}(${['sum','avg'].includes(m.op)?`TRY_CAST(${n} AS DOUBLE)`:n})`;
    }
    const bands = c.columns.length ? categories.map(v=>({values:v,label:v.map(x=>x===null?'(NULL)':x).join(' / ')})) : [];
    if(c.columnTotals || !c.columns.length) bands.push({values:null,label:c.columns.length?'All columns':''});
    for(const band of bands) for(const m of c.values) {
      const condition=band.values?c.columns.map((col,i)=>`CAST(${name(col)} AS VARCHAR) IS NOT DISTINCT FROM ${value(band.values[i])}`).join(' AND '):null;
      const filter=condition?` FILTER (WHERE ${condition})`:'';
      let expr=expression(m)+filter;
      if(m.percent) {
        if(!['sum','count','counted','distinct'].includes(m.op)) throw Error('Share of grand total is available for sums and counts.');
        expr=`100.0 * (${expr}) / NULLIF((SELECT ${expression(m)} FROM source), 0)`;
      }
      const label=alias([band.label,m.label?.trim()||`${aggregates[m.op]}${m.op==='count'?'':' of '+m.field}`,m.percent?'% of grand total':''].filter(Boolean).join(' · '));
      outputs.push(`${expr} AS ${name(label)}`);cells.push({name:label,band:band.label||'Values',condition,category:band.values,categoryFields:c.columns,measure:m});
    }
    if(!bands.length) throw Error('No column categories match these filters. Clear a filter or enable All columns totals.');
    const group=dimensions.length?`\nGROUP BY GROUPING SETS (${groups.map(g=>'('+g.join(', ')+')').join(', ')})`:'';
    const collapsed=(c.subtotals?c.collapsed||[]:[]).filter(g=>g.fields?.length>0&&g.fields.length<c.rows.length&&g.fields.every((f,i)=>f===c.rows[i]));
    const having=collapsed.length?'\nHAVING '+collapsed.map(g=>`NOT (GROUPING(${dimensions[g.fields.length-1]})=0 AND GROUPING(${dimensions[g.fields.length]})=0 AND ${g.fields.map((f,i)=>`${name(f)} IS NOT DISTINCT FROM ${value(g.values[i])}`).join(' AND ')})`).join('\n   AND '):'';
    const order=dimensions.length?'\nORDER BY '+dimensions.flatMap((n,i)=>[...(rowKind?[`GROUPING(${n}) ${i===0?'ASC':'DESC'}`]:[]),...(c.sorts||[]).filter(r=>r.level===c.rows[i]).map(r=>sortExpression(r,c.rows[i],c.rows)),`${n} ${c.order==='desc'?'DESC':'ASC'} NULLS LAST`]).join(', '):'';
    return {sql:`WITH source AS (${src})\nSELECT ${[...dimensions,...outputs].join(',\n       ')}\nFROM source${group}${having}${order};`,cells,rowKind,source:src,config:JSON.parse(JSON.stringify(c))};
  }
  return {source,discovery,build,aggregates,name,value,numeric,keyEligible,relationshipSQL,unmatchedSQL,linkFields,joinedSource,suggestionPairs,suggestionSQL};
})();
if(typeof module!=='undefined')module.exports=PivotQuery;
if(typeof window!=='undefined')window.bedazzlePivotQuery=PivotQuery;
