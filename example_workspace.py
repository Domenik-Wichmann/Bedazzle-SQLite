"""Install an independent, editable demonstration without touching user data."""
import csv,json,shutil,time
from pathlib import Path
from engine import ROOT

QUERIES=[
 ('Catalog prices and products', '''SELECT p.product_id, p.product_name, p.category, o.client, o.catalog,
       p.list_price, o.offer_price, round(p.list_price-o.offer_price,2) AS saving
FROM products p JOIN offers o ON p.product_id=o.product_id
ORDER BY saving DESC, p.product_id;'''),
 ('Products shared across clients', '''SELECT p.category,p.product_name,count(DISTINCT o.client) AS clients,
       min(o.offer_price) AS best_price,max(o.offer_price) AS highest_price
FROM products p JOIN offers o USING(product_id)
GROUP BY p.category,p.product_name HAVING count(DISTINCT o.client)>1
ORDER BY clients DESC,best_price;'''),
 ('Best offer per category', '''WITH ranked AS (
 SELECT p.category,p.product_name,o.client,o.offer_price,
        row_number() OVER (PARTITION BY p.category ORDER BY o.offer_price,p.product_id) AS position
 FROM products p JOIN offers o USING(product_id)
)
SELECT * FROM ranked WHERE position<=3 ORDER BY category,position;'''),
 ('Products missing from catalogs', '''SELECT p.* FROM products p LEFT JOIN offers o USING(product_id)
WHERE o.product_id IS NULL ORDER BY p.product_id;''')]

def generate(folder):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 with (folder/'products.csv').open('w',newline='',encoding='utf-8') as f:
  writer=csv.writer(f);writer.writerow(['product_id','product_name','category','list_price','image_url'])
  for i in range(1,1001):writer.writerow([f'P{i:05}',f'Example product {i}', ['Lighting','Furniture','Garden','Kitchen','Office'][i%5],round(10+(i%250)*1.37,2),f'https://example.com/images/{i%200}.jpg'])
 with (folder/'offers.csv').open('w',newline='',encoding='utf-8') as f:
  writer=csv.writer(f);writer.writerow(['offer_id','product_id','client','catalog','offer_price','updated_on'])
  for i in range(1,1201):
   product=(i*37)%850+1;price=10+(product%250)*1.37
   writer.writerow([f'O{i:05}',f'P{product:05}', ['Acme','Northwind','Contoso'][i%3],f'Catalog {i%12+1}',round(price*(.75+(i%20)/100),2),f'2026-10-{i%28+1:02}'])

def install(registry):
 from app_server import Store
 name='Example workspace';n=2
 while any(i['name'].casefold()==name.casefold() for i in registry.data['items']):name='Example workspace '+str(n);n+=1
 key=registry.create(name);item=next(i for i in registry.data['items'] if i['id']==key);item['example']=True
 folder=registry.path(key);data=folder/'files';data.mkdir()
 for filename in ('products.csv','offers.csv'):shutil.copyfile(ROOT/'examples'/filename,data/filename)
 (folder/'example_seed.json').write_text(json.dumps({'files':{'products':str(data/'products.csv'),'offers':str(data/'offers.csv')}}),encoding='utf-8')
 store=Store(folder)
 schemas={'products':[('product_id','VARCHAR'),('product_name','VARCHAR'),('category','VARCHAR'),('list_price','DOUBLE'),('image_url','VARCHAR')],
          'offers':[('offer_id','VARCHAR'),('product_id','VARCHAR'),('client','VARCHAR'),('catalog','VARCHAR'),('offer_price','DOUBLE'),('updated_on','DATE')]}
 store.put('catalog',[{'name':name,'path':str(data/(name+'.csv')),'kind':'csv','bytes':(data/(name+'.csv')).stat().st_size,'columns':[{'name':column,'type':kind} for column,kind in columns]} for name,columns in schemas.items()])
 for title,sql in QUERIES:store.save(title,sql)
 store.put('drafts',{'active':'example-join','updated':time.time()*1000,'tabs':[{'id':'example-join','name':QUERIES[0][0],'sql':QUERIES[0][1]},{'id':'example-ranked','name':QUERIES[2][0],'sql':QUERIES[2][1]}]})
 registry.data['example_offered']=True;registry.save();return key

if __name__=='__main__':generate(ROOT/'examples')
