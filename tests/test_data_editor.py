import json
from pathlib import Path
import tempfile
import unittest

from engine import ROOT, create_connection, perform, literal


class DataEditorTests(unittest.TestCase):
    def setUp(self):
        root = ROOT / 'workspace' / 'automated-tests'
        root.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.directory.name)
        self.settings = {'memory_mb':128, 'threads':1, 'spill_gb':1}
        self.conn = create_connection(self.root, self.settings, 'editor')
        self.conn.execute("CREATE TABLE products(id INTEGER PRIMARY KEY, name VARCHAR, price DECIMAL(18,4), extra VARCHAR)")
        self.conn.execute("INSERT INTO products VALUES (1,'one',1.2345,'keep'),(2,'two',2.3456,'retain'),(3,'three',3.4567,'untouched')")

    def tearDown(self):
        self.conn.close()
        self.directory.cleanup()

    def call(self, op, **kw):
        return perform(self.conn, 'data_editor', {'op':op, **kw}, 'editor-test')

    def open(self, sql='SELECT * FROM products WHERE id<=2'):
        result = self.call('open', sql=sql)
        self.sid = result['session']['id']
        return result

    def edit(self, column='name', value='changed', row='1'):
        return self.call('cells', id=self.sid, cells=[{'row':row,'column':column,'value':value}])

    def save(self, **kw):
        return self.call('save', id=self.sid, **{'mode':'source','target':'products','keys':['id'],**kw})

    def test_disk_draft_full_result_precision_null_empty_paste_undo_redo(self):
        view=self.open("SELECT i AS id,9007199254740993::BIGINT AS precise,'text' AS name FROM range(1234) t(i)")
        self.assertEqual(view['total'],1234)
        self.assertEqual(view['rows'][0][2],'9007199254740993')
        self.call('cells',id=self.sid,cells=[{'row':'1','column':'name','value':None},{'row':'2','column':'name','value':''}])
        self.conn.close();self.conn=create_connection(self.root,self.settings,'reopen')
        self.assertEqual(self.call('page',id=self.sid)['rows'][0][3],None)
        self.call('undo',id=self.sid)
        self.assertEqual(self.call('page',id=self.sid)['rows'][1][3],'text')
        self.call('redo',id=self.sid)
        self.assertEqual(self.call('page',id=self.sid)['rows'][1][3],'')
        self.save(mode='working',name='Edited copy')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM "Edited copy"').fetchone()[0],1234)

    def test_source_projection_preserves_other_fields_and_unselected_records(self):
        self.open('SELECT id,name FROM products WHERE id=1')
        self.edit();self.save()
        self.assertEqual(self.conn.execute('SELECT name,extra FROM products ORDER BY id').fetchall(), [('changed','keep'),('two','retain'),('three','untouched')])
        self.assertEqual(self.call('page',id=self.sid)['changes']['updated'],0)

    def test_source_add_delete_update_atomic_and_constraints(self):
        self.open();self.edit()
        self.call('delete',id=self.sid,rows=['2'])
        self.call('add',id=self.sid)
        self.call('cells',id=self.sid,cells=[{'row':'3','column':'id','value':'4'},{'row':'3','column':'name','value':'four'}])
        self.save()
        self.assertEqual(self.conn.execute('SELECT id,name FROM products ORDER BY id').fetchall(),[(1,'changed'),(3,'three'),(4,'four')])

    def test_conflict_rolls_back_all_changes(self):
        self.open();self.edit()
        self.call('delete',id=self.sid,rows=['2'])
        self.conn.execute("UPDATE products SET name='external' WHERE id=2")
        with self.assertRaisesRegex(ValueError,'changed'):
            self.save()
        self.assertEqual(self.conn.execute('SELECT name FROM products ORDER BY id').fetchall(),[('one',),('external',),('three',)])

    def test_key_collision_and_invalid_type_do_not_mutate(self):
        self.open();self.edit(column='id',value='3')
        with self.assertRaises(Exception):self.save()
        self.assertEqual(self.conn.execute('SELECT count(*) FROM products').fetchone()[0],3)
        before=self.call('page',id=self.sid)
        with self.assertRaises(Exception):self.edit(column='price',value='oops')
        self.assertEqual(self.call('page',id=self.sid),before)

    def test_replace_search_undo_branch_and_export(self):
        self.open();self.call('replace',id=self.sid,column='name',find='o',replacement='X',search='one')
        self.assertEqual(self.call('page',id=self.sid)['rows'][0][2],'Xne')
        self.call('undo',id=self.sid);self.edit(value='new branch')
        with self.assertRaisesRegex(ValueError,'redo'):self.call('redo',id=self.sid)
        out=self.root/'edited.csv';self.save(mode='export',format='csv',output=str(out))
        self.assertIn('new branch',out.read_text())
        with self.assertRaisesRegex(ValueError,'already exists'):self.save(mode='export',format='csv',output=str(out))

    def test_duplicate_keys_rejected(self):
        self.open('SELECT 1 AS id, name FROM products')
        self.edit()
        with self.assertRaisesRegex(ValueError,'unique'):self.save()

    def test_cast_keys_cannot_alias_source_records(self):
        self.open('SELECT CAST(id AS VARCHAR) AS id,name FROM products WHERE id=1')
        self.edit()
        with self.assertRaisesRegex(ValueError,'types differ'):self.save()
        self.assertEqual(self.conn.execute('SELECT name FROM products WHERE id=1').fetchone()[0],'one')

    def test_file_rewrite_preserves_outside_rows_backup_and_stale_rejected(self):
        source=self.root/"O'Brien.csv"
        source.write_text('id;name;extra\n001;one;keep\n002;two;stay\n003;three;untouched\n',encoding='utf-8')
        original=source.read_bytes()
        perform(self.conn,'open',{'path':str(source),'name':'file source','options':{'delimiter':';'}},'test')
        self.open('SELECT * FROM "file source" WHERE id=\'001\'')
        self.edit(value='quoted;\n"value"')
        result=self.save(mode='original',target='file source')
        self.assertEqual(Path(result['backup']).read_bytes(),original)
        self.assertEqual(self.conn.execute('SELECT id,name,extra FROM "file source" ORDER BY id').fetchall(),[('001','quoted;\n"value"','keep'),('002','two','stay'),('003','three','untouched')])
        self.edit(value='next')
        source.write_text(source.read_text()+'004;external;outside\n')
        with self.assertRaisesRegex(ValueError,'changed'):self.save(mode='original',target='file source')

    def test_parquet_and_json_original_file_saves(self):
        for fmt,options in [('parquet','FORMAT PARQUET'),('json','FORMAT JSON, ARRAY true'),('ndjson','FORMAT JSON, ARRAY false')]:
            source=self.root/('data.'+fmt)
            self.conn.execute(f'COPY products TO {literal(source.as_posix())} ({options})')
            target='file_'+fmt
            perform(self.conn,'open',{'path':str(source),'name':target},'test')
            self.open('SELECT * FROM "'+target+'" WHERE id=1')
            self.edit(value='updated '+fmt)
            self.save(mode='original',target=target)
            self.assertEqual(self.conn.execute('SELECT name FROM "'+target+'" WHERE id=1').fetchone()[0],'updated '+fmt)

    def test_long_value_full_cell_fetch_and_discard(self):
        self.open("SELECT 1 AS id, repeat('x',12000) AS name")
        self.assertEqual(len(self.call('page',id=self.sid)['rows'][0][2]),512)
        self.assertEqual(len(self.call('cell',id=self.sid,row='1',column='name')['value']),12000)
        self.call('discard',id=self.sid)
        self.assertEqual(self.call('list')['drafts'],[])

    def test_quoted_columns_history_names_and_stale_draft(self):
        self.open('SELECT 1 AS "_step", \'a\' AS "_after", \'old\' AS "Owner\'s note"')
        self.edit(column="Owner's note",value='new')
        self.call('undo',id=self.sid)
        self.assertEqual(self.call('page',id=self.sid)['rows'][0][3],'old')
        self.call('redo',id=self.sid)
        with self.assertRaisesRegex(ValueError,'another window'):
            self.call('delete',id=self.sid,rows=['1'],expected_revision=0)

    def test_composite_keys_and_partial_insert_rejected(self):
        self.open('SELECT id,name FROM products WHERE id=1')
        self.call('add',id=self.sid)
        self.call('cells',id=self.sid,cells=[{'row':'2','column':'id','value':'4'},{'row':'2','column':'name','value':'four'}])
        with self.assertRaisesRegex(ValueError,'every source column'):self.save()
        self.assertEqual(self.conn.execute('SELECT count(*) FROM products').fetchone()[0],3)
        self.open('SELECT id,name FROM products WHERE id=1');self.edit()
        self.save(keys=['id','name'])
        self.assertEqual(self.conn.execute('SELECT name FROM products WHERE id=1').fetchone()[0],'changed')

    def test_compressed_headerless_and_empty_null_file_roundtrips(self):
        import gzip
        for suffix,header in [('.tsv',False),('.csv.gz',True),('.json.gz',True)]:
            source=self.root/('source'+suffix)
            if suffix=='.json.gz':
                with gzip.open(source,'wt',encoding='utf-8') as out:json.dump([{'id':'001','name':'one'},{'id':'002','name':'two'}],out)
                options={}
            else:
                text=('id\tname\n' if header else '')+'001\tone\n002\ttwo\n'
                if suffix.endswith('.gz'):
                    with gzip.open(source,'wt',encoding='utf-8') as out:out.write(text)
                else:source.write_text(text)
                options={'delimiter':'tab','header':header}
            target='source_'+str(header)+suffix.replace('.','_')
            perform(self.conn,'open',{'path':str(source),'name':target,'options':options},'test')
            schema=self.conn.execute('SELECT * FROM "'+target+'" LIMIT 0').description
            key,name=schema[0][0],schema[1][0]
            self.open('SELECT * FROM "'+target+'"');self.edit(column=name,value='multiline\tvalue\n"quoted"')
            self.save(mode='original',target=target,keys=[key])
            self.assertEqual(self.conn.execute('SELECT * FROM "'+target+'"').fetchone()[1],'multiline\tvalue\n"quoted"')


if __name__=='__main__':unittest.main()
