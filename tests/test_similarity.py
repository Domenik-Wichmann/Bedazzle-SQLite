"""Deterministic matching, bounded-search and review workflow tests."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import random
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch

from engine import ROOT,create_connection,perform,literal,identifier
from module_runtime import Context,manifests,validate_options,read_run
from modules.image_checker.similarity import build,open_index
from image_fixture import Images

SETTINGS={'memory_mb':256,'threads':1,'spill_gb':1,'timeout':30,'profile':'quiet'}


class SimilarityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.images=Images()
    @classmethod
    def tearDownClass(cls):cls.images.close()
    def setUp(self):
        parent=ROOT/'workspace'/'automated-tests';parent.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=parent);self.root=Path(self.temp.name)
        self.conn=create_connection(self.root,SETTINGS,'similarity')
        self.env={'workspace':self.root,'cancelled':threading.Event(),'emit':lambda value:None}
    def tearDown(self):self.conn.close();self.temp.cleanup()
    def job(self,paths):
        manifest=next(m for m in manifests() if m['id']=='image_checker')
        options=validate_options(manifest,{'url_columns':['url'],'record_id':'sku','allow_private':True,'retries':0},['url','sku'])
        rows=','.join('('+str(i)+','+literal(self.images.url+path)+')' for i,path in enumerate(paths))
        return perform(self.conn,'module_run',{'module':'image_checker','sql':'SELECT * FROM (VALUES '+rows+') t(sku,url)','options':options},uuid.uuid4().hex,module_context=self.env)
    def manage(self,run,operation,**values):
        return perform(self.conn,'module_manage',{'run_id':run['run']['id'],'operation':operation,**values},uuid.uuid4().hex,module_context=self.env)
    def synthetic(self,hashes):
        self.conn.execute('''CREATE TABLE observed(sha256 VARCHAR,url VARCHAR,safe_url VARCHAR,display_width INTEGER,display_height INTEGER,
            phash VARCHAR,dhash VARCHAR,average_rgb VARCHAR,aspect_ratio DOUBLE,animated BOOLEAN,complete_decode BOOLEAN,uniform_image BOOLEAN,
            fully_transparent BOOLEAN,entropy DOUBLE,luminance_stddev DOUBLE)''')
        self.conn.executemany('INSERT INTO observed VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
            (f'{i:064x}',f'https://example.com/{i}',f'https://example.com/{i}',100,100,f'{h:016x}',f'{d:016x}','[100,100,100]',1,False,True,False,False,4,30)
            for i,(h,d) in enumerate(hashes)])
        return Context(self.conn,self.root,self.root,{'id':'synthetic'},self.env['cancelled'],lambda value:None)

    def test_index_finds_every_threshold_neighbor_without_quadratic_scan(self):
        rng=random.Random(88);hashes=[]
        for _ in range(60):
            base=rng.getrandbits(64);other=base
            for bit in rng.sample(range(64),6):other^=1<<bit
            dhash=rng.getrandbits(64);hashes.extend([(base,dhash),(other,dhash^7)])
        ctx=self.synthetic(hashes);summary=build(ctx,'observed',{})
        expected={(i,j) for i in range(len(hashes)) for j in range(i+1,len(hashes))
                  if (hashes[i][0]^hashes[j][0]).bit_count()<=6 and (hashes[i][1]^hashes[j][1]).bit_count()<=10}
        with closing(open_index(self.root/'similarity.sqlite3')) as db:
            actual={(row[0]-1,row[1]-1) for row in db.execute('SELECT left_id,right_id FROM pairs')}
        self.assertEqual(actual,expected);self.assertEqual(summary['status'],'complete')
        self.assertLess(summary['comparisons'],len(hashes)*(len(hashes)-1)//4)

    def test_real_variants_scores_decisions_rebuild_recheck_and_export(self):
        run=self.job(['/scene?token=hidden','/scene-jpeg','/scene-small','/scene-edit','/noise','/blank','/transparent'])
        output=self.manage(run,'similarity_pairs',decision='all')
        self.assertEqual(output['summary']['eligible_contents'],5)
        self.assertEqual(output['total'],6)
        self.assertTrue(any(p['phash_distance']>0 and p['dhash_distance']>0 for p in output['pairs']))
        self.assertTrue(all(p['score']>=90 for p in output['pairs']))
        self.assertFalse(any('/noise' in (p['left_url'],p['right_url']) for p in output['pairs']))
        self.assertTrue(all(p['left'] and p['right'] for p in output['pairs']))
        pair=output['pairs'][0]
        focused=self.manage(run,'similarity_pairs',decision='all',sha256=pair['left_sha256'])
        self.assertEqual(focused['total'],3)
        self.manage(run,'similarity_decide',pair_id=pair['id'],decision='similar',note='Same product; different encoding')
        self.assertEqual(self.manage(run,'similarity_pairs',decision='similar')['total'],1)
        self.assertEqual(self.manage(run,'similarity_pairs',decision='unreviewed')['total'],5)
        exported=self.manage(run,'similarity_export',decision='all')
        rows=self.conn.execute(exported['sql']).fetchall()
        self.assertEqual(len(rows),6);self.assertNotIn('hidden',str(rows))
        self.assertIn('Same product; different encoding',str(rows))
        before=dict(self.images.hits)
        self.manage(run,'similarity_rebuild',options={'similarity_sensitivity':'strict'})
        self.assertEqual(self.images.hits,before)
        self.assertEqual(self.manage(run,'similarity_pairs',decision='similar')['total'],1)
        rechecked=perform(self.conn,'module_run',{'run_id':run['run']['id'],'recheck':'all'},uuid.uuid4().hex,module_context=self.env)
        self.assertEqual(self.manage(rechecked,'similarity_pairs',decision='similar')['total'],1)
        # Reviews never overwrite image validation verdicts or source rows.
        self.assertEqual(self.conn.execute('SELECT count(*) FROM '+identifier(run['name'])).fetchone()[0],7)
        with patch('module_runtime.Context.write_report',side_effect=RuntimeError('interrupted report rewrite')):
            with self.assertRaisesRegex(RuntimeError,'interrupted report'):
                self.manage(run,'similarity_rebuild',options={'similarity_sensitivity':'balanced'})
        self.assertFalse(self.manage(run,'similarity_pairs',decision='all')['summary']['report_synchronized'])
        self.manage(run,'similarity_rebuild',options={'similarity_sensitivity':'balanced'})
        self.assertTrue(self.manage(run,'similarity_pairs',decision='all')['summary']['report_synchronized'])

    def test_candidate_comparison_and_pair_limits_are_explicit(self):
        ctx=self.synthetic([(0,0)]*20)
        summary=build(ctx,'observed',{},candidate_limit=2)
        self.assertEqual(summary['status'],'limited');self.assertGreater(summary['limited_contents'],0)
        summary=build(ctx,'observed',{},comparison_limit=3)
        self.assertLessEqual(summary['comparisons'],3);self.assertGreater(summary['not_searched'],0)
        summary=build(ctx,'observed',{},pair_limit=2)
        self.assertEqual(summary['pairs'],2);self.assertEqual(summary['status'],'limited')

    def test_disabled_empty_cancelled_and_invalid_options(self):
        ctx=self.synthetic([(1,2)])
        self.assertEqual(build(ctx,'observed',{'similarity_enabled':False})['status'],'disabled')
        with self.assertRaisesRegex(ValueError,'sensitivity'):build(ctx,'observed',{'similarity_sensitivity':'unknown'})
        self.env['cancelled'].set()
        with self.assertRaises(InterruptedError):build(ctx,'observed',{})
        with closing(open_index(self.root/'similarity.sqlite3')) as db:
            self.assertEqual(json.loads(db.execute('SELECT value FROM metadata').fetchone()[0])['status'],'disabled')

    def test_color_variants_are_opt_in(self):
        ctx=self.synthetic([(0x123456,0x654321),(0x123457,0x654320)])
        self.conn.execute("UPDATE observed SET average_rgb='[0,0,255]' WHERE sha256=?",[f'{0:064x}'])
        self.conn.execute("UPDATE observed SET average_rgb='[255,0,0]' WHERE sha256=?",[f'{1:064x}'])
        self.assertEqual(build(ctx,'observed',{})['pairs'],0)
        self.assertEqual(build(ctx,'observed',{'similarity_color_variants':True})['pairs'],1)

    def test_shape_and_decode_coverage_prevent_misleading_matches(self):
        ctx=self.synthetic([(0x123456,0x654321),(0x123457,0x654320)])
        self.conn.execute('UPDATE observed SET aspect_ratio=2 WHERE sha256=?',[f'{1:064x}'])
        self.assertEqual(build(ctx,'observed',{})['pairs'],0)
        self.conn.execute('UPDATE observed SET complete_decode=false WHERE sha256=?',[f'{1:064x}'])
        self.assertEqual(build(ctx,'observed',{})['eligible_contents'],1)

    def test_fingerprints_follow_exif_display_orientation(self):
        run=self.job(['/scene','/scene-oriented'])
        row=self.conn.execute('SELECT min(display_width),max(display_width),min(display_height),max(display_height),count(DISTINCT fingerprint_version) FROM '+identifier(run['name'])).fetchone()
        self.assertEqual(row,(160,160,120,120,1))
        self.assertEqual(self.manage(run,'similarity_pairs',decision='all')['total'],1)
