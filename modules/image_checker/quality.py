"""Stable, explainable report rules. SQL stays in DuckDB for large catalogs."""
import re
from urllib.parse import urlsplit, urlunsplit
from engine import literal


def redact_url(value):
    """Remove credentials, query and fragment, including signed access tokens."""
    if not value:return value
    try:
        p=urlsplit(value)
        host=p.hostname or ''
        if ':' in host:host='['+host+']'
        if p.port:host+=':'+str(p.port)
        return urlunsplit((p.scheme,host,p.path,'',''))
    except ValueError:return '[invalid URL]'


def classify(record):
    status=record.get('http_status')
    if record.get('check_status')=='blocked':return 'policy_blocked'
    if status in (401,403):return 'access_denied'
    if status==429:return 'rate_limited'
    if status in (404,410):return 'missing'
    if status and status>=500:return 'server_error'
    if record.get('check_status')=='limited':return 'limited'
    if not status or not 200<=status<300:return 'request_failed'
    if not record.get('verified'):return 'invalid_image'
    if not record.get('complete_decode'):return 'partial_decode'
    return 'retrieved'


def validate_rules(options):
    hashes=options.get('placeholder_hashes','').split()
    if any(not re.fullmatch('[0-9a-fA-F]{64}',h) for h in hashes):
        raise ValueError('Known placeholder hashes must be space-separated SHA-256 values.')
    formats=[v.strip().upper() for v in options.get('allowed_formats','').split(',') if v.strip()]
    if any(v not in ('JPEG','PNG','WEBP','GIF','TIFF','BMP','ICO','AVIF','JPEG2000','PPM','TGA','PCX','SVG') for v in formats):
        raise ValueError('Allowed formats must be comma-separated image format names, such as JPEG, PNG, WEBP.')
    if options.get('max_aspect_percent',0) and options.get('min_aspect_percent',0)>options['max_aspect_percent']:raise ValueError('Minimum aspect ratio cannot exceed maximum aspect ratio.')
    return hashes,formats


def enrich(sql,options):
    hashes,formats=validate_rules(options)
    rules=[]
    def add(condition,message):rules.append(f'CASE WHEN {condition} THEN {message} END')
    for key,actual,unit in [('width','display_width','px'),('height','display_height','px'),('bytes','image_bytes','bytes'),('mime','detected_mime','')]:
        add(f'expected_{key}_matches=false',f"'Expected {key}: ' || expected_{key} || '; actual: ' || coalesce(CAST({actual} AS VARCHAR),'unknown') || {literal(' '+unit)}")
    for key,actual in [('width','display_width'),('height','display_height')]:
        minimum=options.get('min_'+key,0)
        if minimum:add(f'coalesce({actual},0)<{minimum}',f"'Minimum {key}: {minimum} px; actual: ' || coalesce(CAST({actual} AS VARCHAR),'unknown')")
    maximum=options.get('max_image_kb',0)*1024
    if maximum:add(f'image_bytes>{maximum}',literal(f'Image exceeds the {options["max_image_kb"]} KB size requirement.'))
    for key,op in [('min','<'),('max','>')]:
        ratio=options.get(key+'_aspect_percent',0)
        if ratio:add(f'aspect_ratio {op} {ratio/100}',literal(f'Aspect ratio must be {">=" if key=="min" else "<="} {ratio/100:g}.'))
    if formats:add('coalesce(format,\'\') NOT IN ('+','.join(literal(f) for f in formats)+')',literal('Format must be one of: '+', '.join(formats)+'.'))
    alpha=options.get('transparency','any')
    if alpha!='any':add('has_alpha IS DISTINCT FROM '+('true' if alpha=='required' else 'false'),literal('Transparency channel is '+alpha+'.'))
    if hashes:add('lower(sha256) IN ('+','.join(literal(h.lower()) for h in hashes)+')',literal('Matches a known placeholder image.'))
    reasons='concat_ws(\'; \','+','.join(rules)+')' if rules else "''"
    inner=f"SELECT *,{reasons} AS requirement_reasons FROM ({sql}) base"
    return f"""SELECT * EXCLUDE(verdict,expectations_match),
        expectations_match AND requirement_reasons='' AS expectations_match,
        CASE WHEN verdict IN ('blocked','limited') THEN verdict WHEN requirement_reasons<>'' THEN 'fail' ELSE verdict END AS verdict,
        CASE WHEN NOT complete_decode THEN 'unassessed' WHEN requirement_reasons<>'' THEN 'fail' ELSE 'pass' END AS requirements_status,
        CASE WHEN complete_decode THEN 'full' WHEN verified THEN 'partial' ELSE 'unverified' END AS coverage,
        CASE WHEN error IS NOT NULL THEN error WHEN requirement_reasons<>'' THEN requirement_reasons ELSE coalesce(nullif(warning_text,''),'') END AS issue,
        CASE WHEN retrieval_status IN ('access_denied','rate_limited','server_error','request_failed') THEN 'Retry later or verify server access; do not assume the image is missing.'
        WHEN retrieval_status='missing' THEN 'Replace the missing URL or restore the image.'
        WHEN retrieval_status='policy_blocked' THEN 'Review the URL and network permission.'
        WHEN retrieval_status IN ('limited','partial_decode') THEN 'Review limits or format support and recheck.'
        WHEN retrieval_status='invalid_image' THEN 'Inspect the response and replace or repair the file.'
        WHEN requirement_reasons<>'' THEN 'Update the image or correct the expected requirements.'
        WHEN check_status='pass' THEN 'No action required.' ELSE 'Review warnings and duplicate or placeholder evidence.' END AS suggested_action
        FROM ({inner}) assessed"""
