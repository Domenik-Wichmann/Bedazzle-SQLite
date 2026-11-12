/* Execute the generated SQL against real DuckDB, including hostile names and NULLs. */
const assert=require('assert/strict'),{spawnSync}=require('child_process'),path=require('path');
const P=require('../ui/pivot_query.js');
const base={dataset:'sales',rows:['region','team'],columns:['month'],values:[{field:'amount',op:'sum',label:'Revenue'}],filters:[],rowTotals:true,columnTotals:true,subtotals:true,order:'asc'};
const cases=[];
function add(config,categories){const built=P.build(config,categories);cases.push({sql:built.sql,columns:built.cells.map(c=>c.name)});return built;}
add(base,[['Jan'],['Feb'],[null]]);
add({...base,rows:[],values:[{field:'*',op:'count',percent:true}]},[['Jan'],['Feb'],[null]]);
add({...base,filters:[{field:'team',op:'equals',value:"O'Brien"}],columns:[],values:[{field:'amount',op:'avg'}]},[]);
add({...base,rows:['Row kind'],columns:[],values:[{field:'amount',op:'sum',label:'Row kind'}]},[]);
add({...base,rows:[],columns:[],values:Object.keys(P.aggregates).map(op=>({field:'amount',op}))});
cases.push({sql:P.discovery({...base,columns:['month','team']})});
assert.throws(()=>P.build(base,Array.from({length:41},(_,i)=>[String(i)])),/40 column/);
assert.throws(()=>P.source({...base,filters:[{field:'amount',op:'gt',value:'0 OR true'}]}),/valid number/);
const hostile={...base,dataset:'strange" table',rows:['group"'],columns:['month'],values:[{field:'value"',op:'sum'}],filters:[{field:'group"',op:'equals',value:"O'Brien"}]};
add(hostile,[["x'); DROP TABLE sales; --"]]);
add({...base,columns:['month','team'],rowTotals:false,subtotals:false,columnTotals:false},[['Jan',"O'Brien"],['Feb',"O'Brien"]]);
add({...base,filters:[{field:'amount',op:'gt',value:'999'}],values:[{field:'*',op:'count'}]},[]);
add({...base,rows:['region','team','month'],columns:[]});
const script=String.raw`
import sys,json
sys.path.insert(0,'runtime/engine')
import duckdb
c=duckdb.connect()
c.execute('CREATE TABLE sales(region VARCHAR,team VARCHAR,month VARCHAR,amount VARCHAR,"Row kind" VARCHAR)')
c.executemany('INSERT INTO sales VALUES (?,?,?,?,?)',[('East',"O'Brien",'Jan','10','x'),('East',"O'Brien",'Feb','20','x'),('East','B','Jan','bad','x'),('West',None,None,'5','y'),(None,'C','Jan',None,'y')])
c.execute('CREATE TABLE "strange"" table" ("group""" VARCHAR,month VARCHAR,"value""" INTEGER)')
c.execute('INSERT INTO "strange"" table" VALUES (?,?,?)',["O'Brien","x'); DROP TABLE sales; --",7])
results=[]
for case in json.load(sys.stdin):
 r=c.execute(case['sql']);results.append({'names':[x[0] for x in r.description],'rows':r.fetchall()})
print(json.dumps(results,default=str))
`;
const result=spawnSync(path.resolve('runtime/python/python.exe'),['-X','utf8','-c',script],{input:JSON.stringify(cases),encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
const results=JSON.parse(result.stdout),first=results[0];
const grand=first.rows.find(r=>r[2]==='Grand total');assert.deepEqual(grand.slice(3),[10,20,5,35]);
assert.equal(first.rows.filter(r=>r[2]==='Detail').length,4);
assert.equal(first.rows.filter(r=>r[2]==='Subtotal · 1').length,3);
assert.deepEqual(first.rows.find(r=>r[0]==='East'&&r[2]==='Subtotal · 1').slice(3),[10,20,null,30]);
assert.deepEqual(results[1].rows[0],[60,20,20,100]);
assert.equal(results[2].rows.at(-1).at(-1),15);
assert.equal(new Set(results[3].names.map(n=>n.toLowerCase())).size,results[3].names.length);
assert.deepEqual(results[4].rows[0],[5,35,35/3,'10','bad',4,4]);
assert.equal(results[6].rows.at(-1).at(-1),7);
assert.equal(results[7].rows.length,4);assert.equal(results[7].names.length,4);
assert.deepEqual(results[8].rows,[[null,null,'Grand total',0]]);
assert.equal(results[9].rows[0][3],'Subtotal · 1');
assert.equal(results[9].rows[1][3],'Subtotal · 2');
assert.equal(results[9].rows[2][3],'Detail');
assert.equal(results[9].rows.at(-1)[3],'Grand total');
console.log('PASS: real DuckDB sums, averages, counts, NULL categories, hierarchy subtotals, grand totals, percentage denominators, filters, distinct discovery, alias collisions, quoted names and injection-safe values');
