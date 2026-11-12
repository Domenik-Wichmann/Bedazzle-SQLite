/* Local SQL completion: no network per keystroke, no evaluation of edited SQL. */
(function(root){
'use strict';
const keywords='SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL CROSS ON AS AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ILIKE GROUP BY ORDER HAVING QUALIFY LIMIT OFFSET DISTINCT UNION ALL EXCEPT INTERSECT WITH RECURSIVE CASE WHEN THEN ELSE END CAST TRY_CAST OVER PARTITION ASC DESC NULLS FIRST LAST FILTER USING WINDOW PIVOT UNPIVOT CREATE TABLE VIEW REPLACE INSERT INTO VALUES UPDATE SET DELETE RETURNING COUNT SUM AVG MIN MAX COALESCE TRUE FALSE BOOLEAN VARCHAR INTEGER BIGINT DOUBLE DECIMAL DATE TIMESTAMP INTERVAL STRUCT LIST MAP ARRAY JSON EXCLUDE RENAME REPLACE COLUMNS SAMPLE TABLESAMPLE LATERAL POSITIONAL ASOF SEMI ANTI NATURAL BY NAME MATERIALIZED UNBOUNDED PRECEDING FOLLOWING CURRENT ROW ROWS RANGE GROUPS ROLLUP CUBE GROUPING SETS FETCH NEXT ONLY WITHIN REPLACE TEMP TEMPORARY IF DROP ALTER ADD COLUMN PRIMARY KEY REFERENCES CHECK DEFAULT CONSTRAINT UNIQUE COPY TO FORMAT HEADER DELIMITER COMPRESSION DESCRIBE SHOW EXPLAIN ANALYZE SUMMARIZE ATTACH DETACH DATABASE USE BEGIN COMMIT ROLLBACK TRANSACTION PRAGMA INSTALL LOAD EXPORT IMPORT DATABASE MACRO SEQUENCE ENUM TYPE'.split(' ');
const reserved=new Set(keywords);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function lex(sql){
 const tokens=[];let i=0,depth=0;
 while(i<sql.length){let start=i,c=sql[i];
  if(/\s/.test(c)){i++;continue;}
  if(sql.startsWith('--',i)){i=sql.indexOf('\n',i);if(i<0)i=sql.length;tokens.push({kind:'comment',start,end:i,depth});continue;}
  if(sql.startsWith('/*',i)){i+=2;let n=1;while(i<sql.length&&n){if(sql.startsWith('/*',i)){n++;i+=2;}else if(sql.startsWith('*/',i)){n--;i+=2;}else i++;}tokens.push({kind:'comment',start,end:i,depth,closed:!n});continue;}
  if(c==='$'){
   const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
   if(tag){const stop=sql.indexOf(tag,i+tag.length);i=stop<0?sql.length:stop+tag.length;tokens.push({kind:'string',start,end:i,depth,closed:stop>=0});continue;}
  }
  if(c==='"'||c==="'"){const escaped=c==="'"&&/[eE]/.test(sql[start-1]||'')&&(start<2||!/[\p{L}\p{N}_$]/u.test(sql[start-2]));i++;let value='',closed=false;while(i<sql.length){if(escaped&&sql[i]==='\\'){value+=sql.slice(i,i+2);i=Math.min(sql.length,i+2);}else if(sql[i]===c){if(sql[i+1]===c){value+=c;i+=2;}else{i++;closed=true;break;}}else value+=sql[i++];}tokens.push({kind:c==='"'?'id':'string',value,start,end:i,depth,closed});continue;}
  if(/\d/.test(c)||c==='.'&&/\d/.test(sql[i+1]||'')){
   const number=sql.slice(i).match(/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)/)[0];
   i+=number.length;tokens.push({kind:'number',value:number,start,end:i,depth});continue;
  }
  if(/[\p{L}\p{N}_$]/u.test(c)){i++;while(i<sql.length&&/[\p{L}\p{N}_$]/u.test(sql[i]))i++;tokens.push({kind:'word',value:sql.slice(start,i),start,end:i,depth});continue;}
  if(c===')')depth=Math.max(0,depth-1);
  tokens.push({kind:'punct',value:c,start,end:++i,depth});if(c==='(')depth++;
 }return tokens;
}
function complete(sql,caret,catalog,functions=[],manual=false){
 const all=lex(sql),at=all.find(t=>t.start<caret&&t.end>=caret);
 if(at&&(at.kind==='comment'||at.kind==='string')&&(caret<at.end||at.kind==='comment'||!at.closed))return [];
 const before=all.filter(t=>t.end<=caret&&t.value===';').at(-1)?.end||0;
 const after=all.find(t=>t.start>=caret&&t.value===';')?.start??sql.length;
 const tokens=all.filter(t=>t.start>=before&&t.end<=after&&t.kind!=='comment');
 let fragment=at&&['word','id'].includes(at.kind)?at:null;
 if(fragment?.end<caret)fragment=null;
 const start=fragment?.start??caret,end=fragment?.end??caret;
 const prefix=fragment?(fragment.kind==='id'?sql.slice(start+1,caret).replaceAll('""','"'):sql.slice(start,caret)):'';
 const previous=tokens.filter(t=>t.end<=start),last=previous.at(-1);
 if(!manual&&!prefix&&last?.value!=='.')return [];
 const relations=new Map(catalog.map(table=>[table.name.toLowerCase(),table]));
 const refsAt=depth=>{
  const refs=[];
  for(let i=0;i<tokens.length;i++){
   if(tokens[i].depth!==depth||!['FROM','JOIN'].includes(tokens[i].value?.toUpperCase()))continue;
   let name=tokens[++i];if(!name||!['word','id'].includes(name.kind))continue;
   while(tokens[i+1]?.value==='.'&&tokens[i+2]){i+=2;name=tokens[i];}
   let alias=tokens[i+1];if(alias?.value?.toUpperCase()==='AS')alias=tokens[i+2];
   if(!alias||!['word','id'].includes(alias.kind)||(alias.kind==='word'&&reserved.has(alias.value.toUpperCase())))alias=name;
   const table=relations.get(name.value.toLowerCase());if(table)refs.push({table,alias:alias.value});
  }return refs;
 };
 // CTE explicit column lists and common SELECT projections (including AS aliases).
 for(let i=0;i<tokens.length-3;i++){
  if(!['WITH',','].includes(tokens[i].value?.toUpperCase()))continue;
  const name=tokens[i+1];if(!name||!['word','id'].includes(name.kind))continue;
  let j=i+2,columns=[];
  if(tokens[j]?.value==='('){j++;while(j<tokens.length&&tokens[j].value!==')'){if(['word','id'].includes(tokens[j].kind))columns.push({name:tokens[j].value,type:'CTE'});j++;}j++;}
  if(tokens[j]?.value?.toUpperCase()!=='AS'||tokens[j+1]?.value!=='(')continue;
  const d=tokens[j+1].depth+1;let k=j+2,expression=[];
  const add=()=>{const as=expression.findIndex(t=>t.depth===d&&t.value?.toUpperCase()==='AS');const t=as>=0?expression[as+1]:expression.at(-1);if(t&&['word','id'].includes(t.kind))columns.push({name:t.value,type:'CTE'});expression=[];};
  if(!columns.length){while(k<tokens.length&&tokens[k].depth>=d&&tokens[k].value?.toUpperCase()!=='SELECT')k++;k++;
   while(k<tokens.length&&tokens[k].depth>=d&&!(tokens[k].depth===d&&tokens[k].value?.toUpperCase()==='FROM')){if(tokens[k].value===','&&tokens[k].depth===d)add();else expression.push(tokens[k]);k++;}add();
   if(tokens.slice(j+2,k).some(t=>t.value==='*'))columns=refsAt(d).flatMap(r=>r.table.columns);
  }
  relations.set(name.value.toLowerCase(),{name:name.value,columns});
 }
 const depth=fragment?.depth??last?.depth??0;
 let refs=refsAt(depth);if(!refs.length&&depth)refs=refsAt(0);
 const qualified=last?.value==='.'?previous.at(-2)?.value:null;
 const tableContext=['FROM','JOIN','INTO','UPDATE','TABLE'].includes(last?.value?.toUpperCase());
 const suggestions=[],seen=new Set();
 const add=(label,insert,kind,detail='',boost=0)=>{
  const p=prefix.toLowerCase(),name=label.toLowerCase();let score=name===p?1000:name.startsWith(p)?800:name.includes(p)?400:0;
  if(!score)return;score+=boost;
  const key=kind+':'+insert;if(seen.has(key))return;seen.add(key);suggestions.push({label,insert,kind,detail,score,start,end});
 };
 if(qualified){
  if(qualified.toLowerCase()==='main'&&['FROM','JOIN','INTO','UPDATE'].includes(previous.at(-3)?.value?.toUpperCase()))for(const table of relations.values())add(table.name,quote(table.name),'table',`${table.columns.length} columns`,200);
  const table=refs.find(r=>r.alias.toLowerCase()===qualified.toLowerCase())?.table||relations.get(qualified.toLowerCase());
  for(const col of table?.columns||[])add(col.name,quote(col.name),'column',col.type,100);
  if(!prefix)add('*','*','all columns','Expand the referenced relation');
 }else{
  for(const table of relations.values())add(table.name,quote(table.name),'table',`${table.columns.length} columns`,tableContext?200:0);
  if(!tableContext){
   const sources=refs.length?refs:catalog.map(table=>({table,alias:table.name}));
   for(const {table,alias} of sources)for(const col of table.columns){
    const ambiguous=refs.filter(r=>r.table.columns.some(c=>c.name.toLowerCase()===col.name.toLowerCase())).length>1;
    add(col.name,ambiguous?quote(alias)+'.'+quote(col.name):quote(col.name),'column',`${alias} · ${col.type}`,refs.length?150:0);
   }
   for(const fn of functions)add(fn.name,fn.name+'()','function',`${fn.name}(${(fn.parameters||[]).join(', ')}) → ${fn.returns||''} · ${fn.description||''}`,20);
   for(const word of keywords)add(word,word,'keyword','DuckDB SQL');
  }
 }
 return suggestions.sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label)).slice(0,60);
}
const api={lex,complete,keywords};if(typeof module!=='undefined')module.exports=api;else root.SQLAssist=api;
})(globalThis);
