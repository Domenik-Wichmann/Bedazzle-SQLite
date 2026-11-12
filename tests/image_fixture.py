"""Deterministic loopback HTTP fixtures, never external image requests."""
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import threading
import time
from PIL import Image


class Images:
    def __init__(self):
        stream=io.BytesIO();image=Image.new('RGB',(32,24),'red');image.putpixel((2,3),(0,250,0));image.save(stream,format='PNG');self.png=stream.getvalue()
        stream=io.BytesIO();exif=Image.Exif();exif[274]=6;image.save(stream,format='JPEG',exif=exif);self.jpeg=stream.getvalue()
        stream=io.BytesIO();image.save(stream,format='GIF',save_all=True,append_images=[Image.new('RGB',(32,24),'blue')],duration=100,loop=0);self.gif=stream.getvalue()
        stream=io.BytesIO();Image.new('RGBA',(32,24),(100,50,20,0)).save(stream,format='PNG');self.transparent=stream.getvalue()
        stream=io.BytesIO();Image.new('RGB',(32,24),'white').save(stream,format='PNG');self.blank=stream.getvalue()
        import random
        stream=io.BytesIO();Image.frombytes('RGB',(128,128),random.Random(1).randbytes(128*128*3)).save(stream,format='PNG');self.noise=stream.getvalue()
        from PIL import ImageDraw,ImageEnhance
        scene=Image.new('RGB',(160,120));scene.putdata([(25+x,30+y,40+(x+y)//2) for y in range(120) for x in range(160)])
        draw=ImageDraw.Draw(scene);draw.rectangle((12,18,65,100),fill='#f1c056',outline='black',width=3);draw.ellipse((75,25,145,96),fill='#3c898f',outline='white',width=4);draw.polygon([(40,12),(80,45),(15,45)],fill='#933456')
        self.scenes={}
        for name,picture,fmt,extra in [('/scene',scene,'PNG',{}),('/scene-jpeg',scene,'JPEG',{'quality':65}),
                ('/scene-small',scene.resize((80,60),Image.Resampling.LANCZOS),'PNG',{}),
                ('/scene-edit',ImageEnhance.Brightness(scene).enhance(.9),'PNG',{})]:
            stream=io.BytesIO();picture.save(stream,format=fmt,**extra);self.scenes[name]=(stream.getvalue(),'image/jpeg' if fmt=='JPEG' else 'image/png')
        stream=io.BytesIO();oriented=scene.transpose(Image.Transpose.ROTATE_90);orientation=Image.Exif();orientation[274]=6
        oriented.save(stream,format='JPEG',quality=65,exif=orientation);self.scenes['/scene-oriented']=(stream.getvalue(),'image/jpeg')
        self.hits={};owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                owner.hits[self.path]=owner.hits.get(self.path,0)+1
                if self.path=='/slow':time.sleep(2)
                if self.path=='/redirect':
                    self.send_response(302);self.send_header('Location','/ok.png');self.end_headers();return
                if self.path=='/missing':self.send_response(404);self.end_headers();return
                if self.path in ('/denied','/rate','/server'):
                    self.send_response({'/denied':403,'/rate':429,'/server':503}[self.path]);self.end_headers();return
                if self.path=='/retry' and owner.hits[self.path]==1:self.send_response(503);self.end_headers();return
                data=owner.png;mime='image/png';declared=None
                if self.path=='/transparent':data=owner.transparent
                if self.path=='/blank':data=owner.blank
                if self.path=='/noise':data=owner.noise
                if self.path.split('?')[0] in owner.scenes:data,mime=owner.scenes[self.path.split('?')[0]]
                if self.path=='/html':data=b'<html>not an image</html>';mime='text/html'
                if self.path=='/wrong.jpg':mime='image/jpeg'
                if self.path=='/rotated.jpg':data=owner.jpeg;mime='image/jpeg'
                if self.path=='/animated.gif':data=owner.gif;mime='image/gif'
                if self.path=='/svg':data=b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';mime='image/svg+xml'
                if self.path=='/truncated':data=owner.png[:30];declared=len(owner.png)
                if self.path=='/huge':declared=999999999
                if self.path=='/gzip':data=gzip.compress(data)
                self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(declared or len(data)))
                if self.path=='/gzip':self.send_header('Content-Encoding','gzip')
                self.end_headers()
                try:self.wfile.write(data)
                except OSError:pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join()
