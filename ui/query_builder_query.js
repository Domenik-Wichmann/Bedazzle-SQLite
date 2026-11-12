/* Pure query compiler, shared by the canvas and native DuckDB checks. */
'use strict';
const QueryBuilderSQL = (() => {
  const quote = x => '"'+String(x).replaceAll('"','""')+'"';
  const literal = x => "'"+String(x).replaceAll("'","''")+"'";
  const aggregates = {count:'Count nonempty',distinct:'Count distinct',sum:'Sum',avg:'Average',min:'Minimum',max:'Maximum',records:'Count rows'};
  const mathOperators = {'+':'+','-':'−','*':'×','/':'÷'};
  const calculationModes = {row:'Each row',sum:'Sum of result',avg:'Average of result',min:'Minimum result',max:'Maximum result',totals:'Calculate from totals'};
  const number = value => {
    const text=String(value??'').trim();
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)||!Number.isFinite(Number(text)))throw Error('Enter a valid finite number.');
    return `CAST(${literal(text)} AS DOUBLE)`;
  };
  const operators = {eq:'Equals',ne:'Does not equal',contains:'Contains',starts:'Starts with',gt:'Greater than',gte:'At least',lt:'Less than',lte:'At most',null:'Is NULL',notnull:'Is not NULL'};
  function condition(expr,f) {
    if(f.op==='null')return expr+' IS NULL';
    if(f.op==='notnull')return expr+' IS NOT NULL';
    if(!Object.hasOwn(operators,f.op))throw Error('Choose a filter operator.');
    if(['contains','starts'].includes(f.op))return `${f.op==='contains'?'contains':'starts_with'}(CAST(${expr} AS VARCHAR), ${literal(f.value??'')})`;
    let value=literal(f.value??'');
    if(f.kind==='number'){
      if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(f.value).trim()))throw Error('Enter a valid number for the filter.');
      expr=`TRY_CAST(${expr} AS DOUBLE)`;value=String(f.value).trim();
    } else if(f.kind==='date') {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(f.value))throw Error('Enter a date as YYYY-MM-DD.');
      expr=`TRY_CAST(${expr} AS DATE)`;value=`CAST(${value} AS DATE)`;
    } else expr=`CAST(${expr} AS VARCHAR)`;
    return `${expr} ${{eq:'=',ne:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[f.op]} ${value}`;
  }
  function build(c,catalog) {
    if(!c.tables.length)throw Error('Add a dataset to start building.');
    const table = id => {const t=c.tables.find(t=>t.id===id);if(!t)throw Error('A dataset is missing from this query.');return t;};
    const field = f => {
      const t=table(f.table),source=catalog.find(s=>s.name===t.name);
      if(!source?.columns.some(col=>col.name===f.column))throw Error('A dataset or column has changed: '+t.name+'.'+f.column);
      return quote(t.id)+'.'+quote(f.column);
    };
    const measure = v => {
      if(!Object.hasOwn(aggregates,v.op))throw Error('Choose an aggregate.');
      if(v.op==='records')return 'COUNT(*)';
      const expr=field(v);
      return v.op==='distinct'?`COUNT(DISTINCT ${expr})`:`${v.op.toUpperCase()}(${['sum','avg'].includes(v.op)?`TRY_CAST(${expr} AS DOUBLE)`:expr})`;
    };
    const same=(a,b)=>a.table===b.table&&a.column===b.column;
    const calculations=c.calculations||[];
    const operand=(f,aggregate)=>{
      if(!f)throw Error('Choose both fields or numbers for the calculated column.');
      if(Object.hasOwn(f,'number'))return number(f.number);
      const expr=`TRY_CAST(${field(f)} AS DOUBLE)`;
      if(!aggregate)return expr;
      if(!['sum','avg','min','max','count','distinct'].includes(aggregate))throw Error('Choose a valid calculation aggregate.');
      return aggregate==='distinct'?`COUNT(DISTINCT ${expr})`:`${aggregate.toUpperCase()}(${expr})`;
    };
    const calculation=v=>{
      if(!Object.hasOwn(mathOperators,v.operator))throw Error('Choose an arithmetic operation.');
      if(!Object.hasOwn(calculationModes,v.mode))throw Error('Choose how to calculate the result.');
      if(v.mode==='totals'&&v.left&&v.right&&Object.hasOwn(v.left,'number')&&Object.hasOwn(v.right,'number'))throw Error('Calculate from totals needs at least one column. Use Each row or Sum of result for two numbers.');
      const a=operand(v.left,v.mode==='totals'?(v.leftAggregate||'sum'):null),b=operand(v.right,v.mode==='totals'?(v.rightAggregate||'sum'):null);
      const expr=`(${a} ${v.operator} ${v.operator==='/'?`NULLIF(${b}, 0)`:b})`;
      return ['sum','avg','min','max'].includes(v.mode)?`${v.mode.toUpperCase()}(${expr})`:expr;
    };
    const grouped=c.groups.length>0||c.values.length>0||calculations.some(v=>v.mode!=='row');
    if(grouped&&c.output.some(f=>!c.groups.some(g=>same(f,g))))throw Error('Move each output field into Group by, or remove it from Output, when using aggregates.');
    if(grouped&&calculations.some(v=>v.mode==='row'&&[v.left,v.right].some(f=>f&&!Object.hasOwn(f,'number')&&!c.groups.some(g=>same(f,g)))))throw Error('For grouped results, choose Sum of result or Calculate from totals for the calculated column, or group its fields.');
    const columns=grouped?[...c.groups]:[...c.output];
    const used=new Set(),alias=(wanted)=>{let name=wanted,i=2;while(used.has(name.toLowerCase()))name=wanted+'_'+i++;used.add(name.toLowerCase());return name;};
    const selects=columns.map(f=>`${field(f)} AS ${quote(alias(f.alias?.trim()||table(f.table).name+'.'+f.column))}`);
    c.values.forEach(v=>selects.push(`${measure(v)} AS ${quote(alias(v.alias?.trim()||(aggregates[v.op]+' '+(v.op==='records'?'':v.column)).trim()))}`));
    if(!selects.length&&!grouped)selects.push(...c.tables.map(t=>quote(t.id)+'.*'));
    calculations.forEach((v,i)=>selects.push(`${calculation(v)} AS ${quote(alias(v.alias?.trim()||'Calculation '+(i+1)))}`));
    const first=c.tables[0];
    let from=`${quote(first.name)} AS ${quote(first.id)}`;
    if(!catalog.some(s=>s.name===first.name))throw Error('Dataset is no longer available: '+first.name);
    for(let i=1;i<c.tables.length;i++){
      const t=c.tables[i],prior=new Set(c.tables.slice(0,i).map(t=>t.id));
      const edges=c.joins.filter(j=>j.right.table===t.id);
      if(!edges.length)throw Error('Connect '+t.name+' to an earlier dataset by dragging between matching fields.');
      if(edges.some(j=>!prior.has(j.left.table)))throw Error('Join connections must start from an earlier dataset.');
      if(edges.some(j=>!['INNER','LEFT','FULL'].includes(j.type)||j.type!==edges[0].type))throw Error('Use the same join type for all matching fields of '+t.name+'.');
      if(!catalog.some(s=>s.name===t.name))throw Error('Dataset is no longer available: '+t.name);
      from+=`\n${edges[0].type} JOIN ${quote(t.name)} AS ${quote(t.id)} ON `+edges.map(j=>`${field(j.left)} = ${field(j.right)}`).join(' AND ');
    }
    let sql='SELECT '+(c.distinct?'DISTINCT ':'')+selects.join(',\n       ')+'\nFROM '+from;
    const where=[...c.filters.map(f=>condition(field(f),f)),...calculations.filter(v=>v.mode==='row'&&v.filter?.op).map(v=>condition(calculation(v),{...v.filter,kind:'number'}))];
    if(where.length)sql+='\nWHERE '+where.join(c.match==='any'?' OR ':' AND ');
    if(c.groups.length)sql+='\nGROUP BY '+c.groups.map(field).join(', ');
    const having=[...c.values.filter(v=>v.having?.op).map(v=>condition(measure(v),{...v.having,kind:'number'})),...calculations.filter(v=>v.mode!=='row'&&v.filter?.op).map(v=>condition(calculation(v),{...v.filter,kind:'number'}))];
    if(having.length)sql+='\nHAVING '+having.join(' AND ');
    const order=c.sort.map(s=>{
      if(grouped&&!c.groups.some(g=>same(g,s)))throw Error('Sort by a grouped field, or use an aggregate’s sort option.');
      return field(s)+(s.direction==='desc'?' DESC':' ASC')+' NULLS LAST';
    }).concat(c.values.flatMap(v=>v.sort?[measure(v)+(v.sort==='desc'?' DESC':' ASC')+' NULLS LAST']:[]),calculations.flatMap(v=>v.sort?[calculation(v)+(v.sort==='desc'?' DESC':' ASC')+' NULLS LAST']:[]));
    if(order.length)sql+='\nORDER BY '+order.join(', ');
    if(c.limit&&Number(c.limit)!==0){if(!/^\d+$/.test(String(c.limit))||Number(c.limit)<1||Number(c.limit)>1e9)throw Error('Row limit must be between 1 and 1,000,000,000.');sql+='\nLIMIT '+c.limit;}
    return sql+';';
  }
  return {build,quote,aggregates,operators,mathOperators,calculationModes};
})();
if(typeof module!=='undefined')module.exports=QueryBuilderSQL;
