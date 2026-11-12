const assert=require('assert/strict'),{spawnSync}=require('child_process'),path=require('path');
const Q=require('../ui/query_builder_query.js');
const tables=[{id:'t1',name:'products'},{id:'t2',name:'offers'}];
const f=(table,column)=>({table,column});
const catalog=[{name:'products',columns:['id','region'].map(name=>({name,type:'VARCHAR'}))},{name:'offers',columns:['product','amount'].map(name=>({name,type:'VARCHAR'}))},{name:'odd" table',columns:[{name:'col"name',type:'VARCHAR'}]}];
const base={tables,joins:[{left:f('t1','id'),right:f('t2','product'),type:'LEFT'}],output:[],groups:[],values:[],filters:[],sort:[],match:'all',distinct:false,limit:''};
const cases=[];const add=c=>{const sql=Q.build(c,catalog);cases.push(sql);return sql;};
add({...base,output:[f('t1','id'),f('t2','amount')],sort:[{...f('t1','id'),direction:'asc'}]});
add({...base,groups:[f('t1','region')],values:[{...f('t2','amount'),op:'sum',sort:'desc',having:{op:'gt',value:'20'}}]});
add({...base,values:Object.keys(Q.aggregates).map(op=>({...f('t2','amount'),op}))});
add({...base,filters:[{...f('t2','amount'),op:'gt',kind:'number',value:'10'}]});
add({...base,joins:[{...base.joins[0],type:'INNER'}],groups:[f('t1','region')],values:[{op:'records'}]});
add({...base,tables:[{id:'t1',name:'odd" table'}],joins:[],output:[{...f('t1','col"name'),alias:'odd" heading'}],filters:[{...f('t1','col"name'),op:'eq',kind:'text',value:"O'Brien"}]});
add({...base,distinct:true,output:[f('t1','region')],filters:[{...f('t1','region'),op:'eq',kind:'text',value:'East'},{...f('t1','region'),op:'null'}],match:'any',sort:[{...f('t1','region'),direction:'asc'}],limit:'1'});
add({...base,filters:[{...f('t1','region'),op:'contains',value:"'); DROP TABLE products; --"}]});
add({...base,filters:[{...f('t2','amount'),op:'notnull'}]});
assert.throws(()=>Q.build({...base,joins:[]},catalog),/Connect offers/);
assert.throws(()=>Q.build({...base,groups:[f('t1','region')],output:[f('t1','id')]},catalog),/Group by/);
assert.throws(()=>Q.build({...base,limit:'1; DROP TABLE products'},catalog),/Row limit/);
assert.throws(()=>Q.build({...base,filters:[{...f('t2','amount'),op:'gt',kind:'number',value:'1 OR true'}]},catalog),/valid number/);
assert.throws(()=>Q.build({...base,output:[f('t1','missing')]},catalog),/changed/);
for(const limit of [0,'0',''])assert(!/\bLIMIT\b/.test(Q.build({...base,limit},catalog)));
assert.throws(()=>Q.build({...base,limit:-1},catalog),/Row limit/);
const script=String.raw`
import sys,json
sys.path.insert(0,'runtime/engine')
import duckdb
c=duckdb.connect()
c.execute("CREATE TABLE products AS SELECT * FROM (VALUES ('a','East'),('b','West'),('c','East')) t(id,region)")
c.execute("CREATE TABLE offers AS SELECT * FROM (VALUES ('a','10'),('a','20'),('b','bad')) t(product,amount)")
c.execute('CREATE TABLE "odd"" table" ("col""name" VARCHAR)')
c.execute('INSERT INTO "odd"" table" VALUES (?)',["O'Brien"])
out=[]
for sql in json.load(sys.stdin):
 r=c.execute(sql);out.append({'columns':[d[0] for d in r.description],'rows':r.fetchall()})
assert c.execute('SELECT count(*) FROM products').fetchone()[0]==3
print(json.dumps(out))
`;
const r=spawnSync(path.resolve('runtime/python/python.exe'),['-X','utf8','-c',script],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);
assert.deepEqual(out[0].rows,[['a','10'],['a','20'],['b','bad'],['c',null]]);
assert.deepEqual(out[1].rows,[['East',30]]);
assert.deepEqual(out[2].rows[0].slice(0,4),[3,3,30,15]);
assert.equal(out[2].rows[0].at(-1),4);
assert.deepEqual(out[3].rows,[['a','East','a','20']]);
assert.deepEqual(out[4].rows,[['East',2],['West',1]]);
assert.deepEqual(out[5],{columns:['odd" heading'],rows:[["O'Brien"]]});
assert.deepEqual(out[6].rows,[['East']]);assert.equal(out[7].rows.length,0);assert.equal(out[8].rows.length,3);
console.log('Query builder: 9 real DuckDB queries and invalid configuration checks passed.');
