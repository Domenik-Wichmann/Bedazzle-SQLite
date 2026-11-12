const assert=require('assert/strict'),{spawnSync}=require('child_process'),path=require('path');
const P=require('../ui/pivot_query.js');
const keys=[{left:'Agent ID',right:'Employee Number',clean:'exact'},{left:'company',right:'company',clean:'exact'}];
const schema={name:'employees',columns:[{name:'Employee Number',type:'VARCHAR'},{name:'company',type:'VARCHAR'},{name:'name',type:'VARCHAR'},{name:'pay',type:'INTEGER'}]};
const link={dataset:'employees',keys,mode:'left',fields:P.linkFields(schema,new Set(['Agent ID','company','amount']))};
const base={dataset:'sales',links:[link],rows:['employees · name'],columns:[],values:[{field:'amount',op:'sum'}],filters:[],rowTotals:true,columnTotals:true,subtotals:true};
const queries=[P.relationshipSQL('sales','employees',keys.slice(0,1)),P.relationshipSQL('sales','employees',keys),P.build(base).sql,P.build({...base,links:[{...link,mode:'inner'}]}).sql,P.unmatchedSQL('sales','employees',keys),P.suggestionSQL('sales','employees',[{left:'Agent ID',right:'Employee Number'}]),P.relationshipSQL('spaces','employees',[{left:'id',right:'Employee Number',clean:'exact'}]),P.relationshipSQL('spaces','employees',[{left:'id',right:'Employee Number',clean:'trim'}])];
queries.push(P.build({...base,links:[{...link,keys:keys.slice(0,1)}]}).sql);
const script=String.raw`
import sys,json
sys.path.insert(0,'runtime/engine')
import duckdb
c=duckdb.connect()
c.execute('CREATE TABLE sales("Agent ID" VARCHAR,company VARCHAR,amount INTEGER)')
c.executemany('INSERT INTO sales VALUES (?,?,?)',[('001','A',10),('001','A',20),('002','B',7),('missing','A',8),(None,'A',1)])
c.execute('CREATE TABLE employees("Employee Number" VARCHAR,company VARCHAR,name VARCHAR,pay INTEGER)')
c.executemany('INSERT INTO employees VALUES (?,?,?,?)',[('001','A','Ada',100),('001','B','Ada B',200),('002','B','Bob',300),(None,'A','No ID',500)])
c.execute("CREATE TABLE spaces AS SELECT ' 002 ' AS id")
out=[]
for sql in json.load(sys.stdin):
 try:
  r=c.execute(sql);out.append({'names':[x[0] for x in r.description],'rows':r.fetchall()})
 except duckdb.Error as e:
  out.append({'error':str(e)})
print(json.dumps(out,default=str))
`;
const run=spawnSync(path.resolve('runtime/python/python.exe'),['-X','utf8','-c',script],{input:JSON.stringify(queries),encoding:'utf8'});assert.equal(run.status,0,run.stderr);
const r=JSON.parse(run.stdout),stats=i=>Object.fromEntries(r[i].names.map((n,j)=>[n,r[i].rows[0][j]]));
assert.equal(stats(0).left_duplicate_keys,1);assert.equal(stats(0).right_duplicate_keys,1);
assert.deepEqual(stats(1),{left_rows:5,right_rows:4,left_nulls:1,right_nulls:1,left_duplicate_keys:1,right_duplicate_keys:0,matched_left:3,matched_right:2,left_distinct:3,right_distinct:3});
assert.equal(r[2].rows.find(row=>row[1]==='Grand total').at(-1),46);assert.equal(r[2].rows.find(row=>row[0]==='Ada').at(-1),30);
assert.equal(r[3].rows.find(row=>row[1]==='Grand total').at(-1),37);assert.equal(r[4].rows.length,2);assert.equal(r[5].rows[0][1],2);
assert.equal(stats(6).matched_left,0);assert.equal(stats(7).matched_left,1);
assert.match(r[8].error,/Related keys repeat/);
assert.equal(P.keyEligible('BLOB'),false);assert.equal(P.keyEligible('STRUCT(id INTEGER)'),false);assert.equal(P.keyEligible('VARCHAR'),true);
assert.equal(P.numeric('DECIMAL(18,2)'),true);assert.equal(P.numeric('VARCHAR'),false);
console.log('PASS: mismatched key names, composite keys, duplicates on both sides, NULL/unmatched keys, leading zeros, explicit trimming, sample overlap, left/inner joined pivots and safe totals');
