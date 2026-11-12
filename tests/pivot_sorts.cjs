const assert=require('assert/strict'),{spawnSync}=require('child_process'),path=require('path');
const P=require('../ui/pivot_query.js');
const sorts=[{level:'kind',kind:'label',direction:'asc'},{level:'product',kind:'field',field:'price',op:'max',direction:'desc'},{level:'product',kind:'label',direction:'desc'}];
const base={dataset:'items',rows:['kind','product'],columns:[],values:[{field:'price',op:'sum'}],filters:[],rowTotals:true,columnTotals:true,subtotals:true,sorts};
const cases=[base,{...base,sorts:[sorts[0],sorts[2],sorts[1]]},{...base,rows:['kind','product','variant']},{...base,rows:['kind','product','variant'],collapsed:[{fields:['kind','product'],values:['A','Zulu']}]},{...base,subtotals:false,rowTotals:false},{...base,sorts:[{level:'kind',kind:'value',field:'price',op:'sum',direction:'desc'},sorts[1],sorts[2]]},{...base,sorts:[sorts[0],{...sorts[1],field:'price_text',numeric:true},sorts[2]]},
 {...base,dataset:'negative',values:[{field:'price',op:'sum',percent:true}],sorts:[sorts[0],{level:'product',kind:'value',field:'price',op:'sum',percent:true,direction:'desc'}]},
 {...base,columns:['variant'],sorts:[sorts[0],{level:'product',kind:'value',field:'price',op:'sum',direction:'desc',categoryFields:['variant'],category:['x']},sorts[2]]}];
const script=String.raw`
import sys,json
sys.path.insert(0,'runtime/engine')
import duckdb
c=duckdb.connect()
c.execute('CREATE TABLE items(kind VARCHAR,product VARCHAR,price INTEGER,variant VARCHAR,price_text VARCHAR)')
c.executemany('INSERT INTO items VALUES (?,?,?,?,?)',[('A','Alpha',10,'x','10'),('A','Beta',20,'x','20'),('A','Zulu',20,'y','20'),('A','Zulu',2,'x','2'),('A','No price',None,'x','invalid'),('A',None,1,'x','1'),('B','Other',200,'x','200')])
c.execute("CREATE TABLE negative AS SELECT * FROM (VALUES ('A','Alpha',-10),('A','Beta',-20)) t(kind,product,price)")
out=[]
for sql in json.load(sys.stdin):out.append(c.execute(sql).fetchall())
print(json.dumps(out,default=str))
`;
const run=spawnSync(path.resolve('runtime/python/python.exe'),['-X','utf8','-c',script],{input:JSON.stringify(cases.map(c=>P.build(c,c.columns.length?[['x'],['y']]:[]).sql)),encoding:'utf8'});assert.equal(run.status,0,run.stderr);
const r=JSON.parse(run.stdout),products=rows=>rows.filter(v=>v[2]==='Detail'&&v[0]==='A').map(v=>v[1]);
assert.deepEqual(products(r[0]),['Zulu','Beta','Alpha',null,'No price']);assert.deepEqual(products(r[1]),['Zulu','No price','Beta','Alpha',null]);
assert.equal(r[0][0][2],'Subtotal · 1');assert.equal(r[0].at(-1)[2],'Grand total');
assert.equal(r[2][0][3],'Subtotal · 1');assert.equal(r[2][1][1],'Zulu');assert.equal(r[2][1][3],'Subtotal · 2');assert.equal(r[2][2][1],'Zulu');
assert(!r[3].some(v=>v[1]==='Zulu'&&v[3]==='Detail'));assert.equal(r[3].find(v=>v[1]==='Zulu')[4],22);
assert.deepEqual(r[4].filter(v=>v[0]==='A').map(v=>v[1]),products(r[0]));assert.equal(r[5][0][0],'B');assert.deepEqual(products(r[6]),products(r[0]));
assert.equal(r[7].find(v=>v[2]==='Detail')[1],'Beta');assert.equal(r[8].find(v=>v[2]==='Detail')[1],'Beta');
assert.throws(()=>P.build({...base,sorts:[{level:'missing',kind:'label'}]}),/removed row group/);
console.log('PASS: ordered multi-level sorts, numeric/text tie breakers, parent-first nested groups, collapsed groups, subtotal-free rows, aggregate/percentage ranks, NULLs, numeric text and pivot-column ranks');
