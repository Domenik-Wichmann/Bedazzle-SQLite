"""Bounded HTTP image inspection. No browser, cookies, scripts or external executables."""
import datetime as dt
import hashlib
import http.client
import ipaddress
import json
import socket
import ssl
import time
import warnings
import zlib
from urllib.parse import urlsplit, urljoin, unquote

FORMATS=['JPEG','PNG','GIF','WEBP','TIFF','BMP','ICO','AVIF','JPEG2000','PPM','TGA','PCX']
EXTENSIONS={'.jpg':'JPEG','.jpeg':'JPEG','.jpe':'JPEG','.png':'PNG','.gif':'GIF','.webp':'WEBP',
            '.tif':'TIFF','.tiff':'TIFF','.bmp':'BMP','.ico':'ICO','.avif':'AVIF','.jp2':'JPEG2000'}
# Stable fields let an empty/failed report have the same schema as a successful one.
SCHEMA={
 'url':'VARCHAR','check_status':'VARCHAR','error':'VARCHAR','warnings':'VARCHAR','checked_at':'VARCHAR',
 'http_status':'BIGINT','final_url':'VARCHAR','redirects':'BIGINT','redirect_chain':'VARCHAR','https':'BOOLEAN',
 'tls_verified':'BOOLEAN','tls_protocol':'VARCHAR','tls_cipher':'VARCHAR','tls_expires':'VARCHAR',
 'elapsed_ms':'DOUBLE','attempts':'BIGINT','content_type':'VARCHAR','content_encoding':'VARCHAR',
 'declared_bytes':'BIGINT','transfer_bytes':'BIGINT','image_bytes':'BIGINT','length_matches':'BOOLEAN',
 'etag':'VARCHAR','last_modified':'VARCHAR','cache_control':'VARCHAR','retry_after':'VARCHAR','sha256':'VARCHAR',
 'format':'VARCHAR','detected_mime':'VARCHAR','mime_matches':'BOOLEAN','extension_matches':'BOOLEAN',
 'width':'BIGINT','height':'BIGINT','display_width':'BIGINT','display_height':'BIGINT','megapixels':'DOUBLE',
 'mode':'VARCHAR','bands':'VARCHAR','has_alpha':'BOOLEAN','frames':'BIGINT','frames_checked':'BIGINT',
 'animated':'BOOLEAN','complete_decode':'BOOLEAN','verified':'BOOLEAN','orientation':'BIGINT',
 'exif_present':'BOOLEAN','icc_bytes':'BIGINT','dpi':'VARCHAR','metadata':'VARCHAR'
}
SCHEMA.update(aspect_ratio='DOUBLE',average_rgb='VARCHAR',luminance_mean='DOUBLE',luminance_stddev='DOUBLE',
              entropy='DOUBLE',edge_mean='DOUBLE',uniform_image='BOOLEAN',dhash='VARCHAR')


class Limited(Exception):pass
class Blocked(Exception):pass


def target(url,allow_private=False):
    parts=urlsplit(url)
    if parts.scheme.lower() not in ('http','https') or not parts.hostname:
        raise Blocked('Use an absolute HTTP or HTTPS URL.')
    if parts.username is not None or parts.password is not None:
        raise Blocked('URLs containing login credentials are not checked.')
    if len(url)>16384 or any(ord(c)<32 or ord(c)==127 for c in url):
        raise Blocked('URL is too long or contains control characters.')
    host=parts.hostname.encode('idna').decode('ascii')
    port=parts.port or (443 if parts.scheme.lower()=='https' else 80)
    addresses=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
    if not addresses:raise OSError('DNS returned no addresses.')
    if not allow_private and any(not ipaddress.ip_address(item[4][0].split('%')[0]).is_global for item in addresses):
        raise Blocked('Non-public network address blocked. Enable private-network URLs only for intended internal image servers.')
    return parts,host,port,addresses[0][4][0]


def connection(parts,host,port,address,timeout):
    # Connect to the inspected address, not a fresh DNS lookup (including redirects).
    secure=parts.scheme.lower()=='https'
    conn=(http.client.HTTPSConnection(host,port,timeout=timeout,context=ssl.create_default_context()) if secure
          else http.client.HTTPConnection(host,port,timeout=timeout))
    def connect():
        stream=socket.create_connection((address,port),timeout=timeout)
        if secure:
            try:stream=conn._context.wrap_socket(stream,server_hostname=host)
            except BaseException:stream.close();raise
        conn.sock=stream
    conn.connect=connect
    return conn


def inspect_pixels(data,options,record,notes):
    from PIL import Image
    import io
    if b'<svg' in data[:4096].lower():
        record.update(format='SVG',detected_mime='image/svg+xml')
        raise Limited('SVG vector content is not rendered or script-checked. Raster pixel validation is unavailable.')
    if data[4:8]==b'ftyp' and data[8:12] in (b'heic',b'heix',b'hevc',b'hevx',b'mif1',b'msf1'):
        raise Limited('HEIF-family file detected; this build has no HEIF decoder. Format validity is unverified.')
    # Only in-process raster codecs; never open EPS/PDF or invoke Ghostscript.
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data),formats=FORMATS) as image:
            width,height=image.size
            record.update(format=image.format,detected_mime=Image.MIME.get(image.format),width=width,height=height,
                          display_width=width,display_height=height,megapixels=round(width*height/1e6,4),
                          mode=image.mode,bands=','.join(image.getbands()),has_alpha='A' in image.getbands() or 'transparency' in image.info,
                          animated=bool(getattr(image,'is_animated',False)))
            if width*height>options['max_pixels']*1000000:
                raise Limited('Pixel budget exceeded; dimensions identified, full decode skipped.')
            # Frame counts and metadata are bounded by the already limited input file.
            record['frames']=getattr(image,'n_frames',1)
            exif=image.getexif();orientation=exif.get(274)
            if orientation is not None and (not isinstance(orientation,int) or orientation not in range(1,9)):
                notes.append('Invalid EXIF orientation metadata.');orientation=None
            record.update(orientation=orientation,exif_present=bool(exif),icc_bytes=len(image.info.get('icc_profile',b'') or b''),
                          dpi=str(image.info.get('dpi')) if 'dpi' in image.info else None)
            if orientation in (5,6,7,8):record.update(display_width=height,display_height=width)
            # Useful metadata without GPS, embedded comments, or an unbounded EXIF dump.
            safe={key:str(image.info[key])[:500] for key in ('duration','loop','progressive','progression','compression') if key in image.info}
            record['metadata']=json.dumps(safe)
        # Metadata access may load PNG data. Verify on a fresh unopened cursor.
        with Image.open(io.BytesIO(data),formats=FORMATS) as verifier:
            verifier.verify();record['verified']=True
        with Image.open(io.BytesIO(data),formats=FORMATS) as image:
            checked=0;pixels=0
            for frame in range(min(record['frames'],options['max_frames'])):
                image.seek(frame)
                pixels+=image.width*image.height
                if pixels>options['max_pixels']*1000000*2:
                    notes.append('Animation decode stopped at the total-pixel budget.');break
                image.load();checked+=1
                if frame==0:
                    from PIL import ImageStat, ImageFilter
                    thumb=image.convert('RGB');thumb.thumbnail((256,256))
                    gray=thumb.convert('L');stats=ImageStat.Stat(gray)
                    sample=gray.resize((9,8));values=list(sample.get_flattened_data() if hasattr(sample,'get_flattened_data') else sample.getdata())
                    bits=sum((values[y*9+x]>values[y*9+x+1])<<(y*8+x) for y in range(8) for x in range(8))
                    record.update(aspect_ratio=round(record['display_width']/max(1,record['display_height']),6),
                                  average_rgb=json.dumps([round(v,2) for v in ImageStat.Stat(thumb).mean]),
                                  luminance_mean=round(stats.mean[0],3),luminance_stddev=round(stats.stddev[0],3),
                                  entropy=round(gray.entropy(),4),edge_mean=round(ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).mean[0],3),
                                  uniform_image=stats.stddev[0]<1,dhash=f'{bits:016x}')
                    if record['uniform_image']:notes.append('Image is nearly uniform; it may be a blank image or placeholder. This is a heuristic.')
            record.update(frames_checked=checked,complete_decode=checked==record['frames'])
            if not record['complete_decode']:notes.append('Some animation frames were not decoded; raise limits if needed.')
    declared=(record.get('content_type') or '').split(';')[0].strip().lower()
    record['mime_matches']=declared==record['detected_mime'] if declared else None
    if not declared:notes.append('HTTP Content-Type is missing.')
    if record['mime_matches'] is False:notes.append('HTTP Content-Type differs from the decoded image type.')
    from pathlib import PurePosixPath
    extension=PurePosixPath(unquote(urlsplit(record['final_url']).path)).suffix.lower()
    record['extension_matches']=EXTENSIONS[extension]==record['format'] if extension in EXTENSIONS else None
    if record['extension_matches'] is False:notes.append('Filename extension differs from the decoded image type.')


def check_url(url,options,cancelled,throttle=lambda host:None):
    started=time.monotonic();deadline=started+options['timeout']
    record={key:None for key in SCHEMA}
    record.update(url=url,check_status='fail',checked_at=dt.datetime.now(dt.timezone.utc).isoformat(),transfer_bytes=0,attempts=0,frames_checked=0,complete_decode=False,verified=False)
    notes=[]
    if str(url)!=str(url).strip():notes.append('Leading or trailing whitespace was removed for the request.')
    def remaining():
        if cancelled.is_set():raise InterruptedError('Cancelled.')
        left=deadline-time.monotonic()
        if left<=0:raise TimeoutError('URL deadline exceeded.')
        return min(left,5)
    for attempt in range(options['retries']+1):
        chain=[];current=str(url).strip();record['attempts']=attempt+1
        try:
            remaining()
            for hop in range(9):
                parts,host,port,address=target(current,options['allow_private'])
                throttle(host);timeout=remaining()
                conn=connection(parts,host,port,address,timeout)
                try:
                    path=parts.path or '/'
                    if parts.query:path+='?'+parts.query
                    path=path.encode('ascii').decode('ascii')  # URL paths must be percent-encoded.
                    conn.request('GET',path,headers={'User-Agent':'Bedazzle-Image-Checker/1.0','Accept':'image/*,*/*;q=0.5','Accept-Encoding':'identity','Connection':'close'})
                    record.update(tls_verified=None,tls_protocol=None,tls_cipher=None,tls_expires=None)
                    if parts.scheme.lower()=='https' and conn.sock:
                        cert=conn.sock.getpeercert()
                        record.update(tls_verified=True,tls_protocol=conn.sock.version(),tls_cipher=conn.sock.cipher()[0],tls_expires=cert.get('notAfter'))
                    response=conn.getresponse()
                    record.update(http_status=response.status,final_url=current,https=parts.scheme.lower()=='https',redirects=hop,
                                  content_type=response.getheader('Content-Type'),content_encoding=response.getheader('Content-Encoding'),
                                  etag=response.getheader('ETag'),last_modified=response.getheader('Last-Modified'),cache_control=response.getheader('Cache-Control'))
                    record['retry_after']=response.getheader('Retry-After')
                    if response.status in (301,302,303,307,308):
                        location=response.getheader('Location')
                        if not location:raise OSError('Redirect has no Location header.')
                        destination=urljoin(current,location)
                        if parts.scheme.lower()=='https' and urlsplit(destination).scheme.lower()=='http':notes.append('Redirect downgraded HTTPS to HTTP.')
                        chain.append({'status':response.status,'from':current,'to':destination});current=destination
                        if hop==8:raise OSError('More than eight redirects.')
                        continue
                    if not 200<=response.status<300:
                        raise OSError(f'HTTP {response.status} {response.reason}')
                    if response.status==206:notes.append('Server returned partial content.')
                    limit=options['max_mb']*1024*1024
                    raw_length=response.getheader('Content-Length')
                    declared=int(raw_length) if raw_length and raw_length.isdecimal() else None
                    record['declared_bytes']=declared
                    if declared is not None and declared>limit:raise Limited('Declared download exceeds the byte limit.')
                    encoding=(record['content_encoding'] or 'identity').lower().strip()
                    if encoding not in ('identity','gzip','deflate'):raise Limited('Unsupported HTTP content encoding: '+encoding)
                    inflater=zlib.decompressobj(16+zlib.MAX_WBITS if encoding=='gzip' else zlib.MAX_WBITS) if encoding!='identity' else None
                    data=bytearray();transferred=0
                    while True:
                        if conn.sock:conn.sock.settimeout(remaining())
                        else:remaining()
                        block=response.read(65536)
                        if not block:break
                        transferred+=len(block);record['transfer_bytes']=transferred
                        if transferred>limit:raise Limited('Download exceeds the byte limit.')
                        decoded=inflater.decompress(block,limit+1-len(data)) if inflater else block
                        data.extend(decoded)
                        if len(data)>limit or (inflater and inflater.unconsumed_tail):raise Limited('Decompressed image exceeds the byte limit.')
                    record.update(image_bytes=len(data),length_matches=transferred==declared if declared is not None else None,
                                  sha256=hashlib.sha256(data).hexdigest())
                    if inflater and not inflater.eof:raise OSError('Truncated HTTP content encoding.')
                    if record['length_matches'] is False:raise OSError('Body length differs from Content-Length.')
                    if not data:raise OSError('Empty response body.')
                    inspect_pixels(data,options,record,notes)
                    remaining()
                    if not record['https']:notes.append('HTTP connection is not encrypted.')
                    record['check_status']='pass' if not notes and record['complete_decode'] else 'warning'
                    record['error']=None
                    break
                finally:conn.close()
            else:raise OSError('Redirect limit exceeded.')
            break
        except InterruptedError:raise
        except Limited as error:
            record.update(check_status='limited',error=str(error));break
        except Blocked as error:
            record.update(check_status='blocked',error=str(error));break
        except Exception as error:
            record.update(check_status='fail',error=(type(error).__name__+': '+str(error))[:1500])
            retryable=isinstance(error,(TimeoutError,ConnectionError,http.client.IncompleteRead)) or record.get('http_status') in (408,429,500,502,503,504)
            if attempt>=options['retries'] or not retryable:break
            delay=.5*(attempt+1)
            if record.get('retry_after'):
                from email.utils import parsedate_to_datetime
                try:
                    raw=record['retry_after'];delay=max(delay,float(raw) if raw.isdecimal() else (parsedate_to_datetime(raw)-dt.datetime.now(dt.timezone.utc)).total_seconds())
                except (ValueError,TypeError,OverflowError):pass
            if delay>=deadline-time.monotonic():break
            if cancelled.wait(delay):raise InterruptedError('Cancelled.')
        finally:record['redirect_chain']=json.dumps(chain)
    record['warnings']=json.dumps(list(dict.fromkeys(notes)))
    record['elapsed_ms']=round((time.monotonic()-started)*1000,2)
    return record
