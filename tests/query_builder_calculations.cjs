const assert=require('assert/strict'),{spawnSync}=require('child_process'),path=require('path');
const Q=require('../ui/query_builder_query.js'),f=(table,column)=>({table,column});
const catalog=[{name:'products',columns:['id','category','price'].map(name=>({name}))},{name:'discounts',columns:['id','price'].map(name=>({name}))}];
const base={tables:[{id:'t1',name:'products'},{id:'t2',name:'discounts'}],joins:[{left:f('t1','id'),right:f('t2','id'),type:'LEFT'}],output:[],groups:[],values:[],filters:[],sort:[],calculations:[],match:'all'};
const calc={alias:'Discount amount',left:f('t1','price'),right:f('t2','price'),operator:'-',mode:'row'};
const cases=[];function add(c){cases.push(Q.build(c,catalog));}
add({...base,output:[f('t1','id'),f('t1','price'),f('t2','price')],sort:[f('t1','id')],calculations:[calc]});
for(const mode of ['sum','totals'])add({...base,groups:[f('t1','category')],sort:[f('t1','category')],calculations:[{...calc,mode}]});
for(const operator of ['+','*','/'])add({...base,output:[f('t1','id')],sort:[f('t1','id')],calculations:[{...calc,operator}]});
add({...base,output:[f('t1','id')],calculations:[{...calc,right:{number:'0.2'},operator:'*',filter:{op:'gt',value:'20'},sort:'desc'}]});
add({...base,groups:[f('t1','category')],calculations:[{...calc,mode:'totals',filter:{op:'gt',value:'130'},sort:'desc'}]});
add({...base,calculations:[{...calc,mode:'totals',leftAggregate:'avg',rightAggregate:'sum'}]});
add({...base,calculations:[{...calc,mode:'avg'}]});
add({...base,calculations:[{...calc,mode:'sum',alias:'value"; DROP TABLE products;--'},{...calc,mode:'sum',alias:'value"; DROP TABLE products;--'}]});
add({...base,calculations:[{...calc,mode:'totals',right:{number:'2'},operator:'/'}]});
assert.throws(()=>Q.build({...base,groups:[f('t1','category')],calculations:[calc]},catalog),/grouped results/);
for(const patch of [{operator:';DROP'},{mode:'oops'},{left:null},{left:{number:'1); DROP TABLE products;--'}},{left:{number:'1e999'}},{mode:'totals',leftAggregate:'SQL'}])assert.throws(()=>Q.build({...base,calculations:[{...calc,...patch}]},catalog));
assert.throws(()=>Q.build({...base,calculations:[{...calc,right:f('t2','missing')}]},catalog),/changed/);
assert.throws(()=>Q.build({...base,calculations:[{...calc,mode:'totals',left:{number:'2'},right:{number:'3'}}]},catalog),/at least one column/);
const script=String.raw`
import sys,json
sys.path.insert(0,'runtime/engine')
import duckdb
c=duckdb.connect()
c.execute("CREATE TABLE products AS SELECT * FROM (VALUES ('a','Hardware','100'),('b','Hardware','200'),('c','Hardware','50'),('d','Software','80'),('e','Software','40'),('f','Software','10'),('z','Invalid','bad')) t(id,category,price)")
c.execute("CREATE TABLE discounts AS SELECT * FROM (VALUES ('a','60'),('b','150'),('d','0'),('e','bad'),('f','2.5'),('z','1')) t(id,price)")
out=[]
for sql in json.load(sys.stdin):
 r=c.execute(sql);out.append({'names':[d[0] for d in r.description],'rows':r.fetchall()})
assert c.execute('SELECT count(*) FROM products').fetchone()[0]==7
print(json.dumps(out))
`;
const r=spawnSync(path.resolve('runtime/python/python.exe'),['-X','utf8','-c',script],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);
assert.deepEqual(out[0].rows.map(r=>r.at(-1)),[40,50,null,80,null,7.5,null]);
assert.deepEqual(out[1].rows,[['Hardware',90],['Invalid',null],['Software',87.5]]);
assert.deepEqual(out[2].rows,[['Hardware',140],['Invalid',null],['Software',127.5]]);
assert.equal(out[3].rows[0][1],160);assert.equal(out[4].rows[0][1],6000);assert.equal(out[5].rows[3][1],null);assert.equal(out[5].rows[5][1],4);
assert.deepEqual(out[6].rows,[['b',40]]);assert.deepEqual(out[7].rows,[['Hardware',140]]);
assert(Math.abs(out[8].rows[0][0]-(80-213.5))<1e-9);assert.equal(out[9].rows[0][0],44.375);
assert.equal(new Set(out[10].names).size,2);assert.deepEqual(out[10].rows,[[177.5,177.5]]);assert.equal(out[11].rows[0][0],240);
console.log('PASS: 12 real DuckDB calculation queries: row math, category totals, SUM(a-b) vs SUM(a)-SUM(b), constants, all four operations, NULL/invalid/zero inputs, filters/sorts, aliases, validation.');
