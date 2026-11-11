# Building Bedazzle modules

Modules are local Python code with a small JSON manifest. They run with the same permissions as Bedazzle, in its isolated engine process. Only install code you trust. There is no remote module installer, arbitrary browser-code loader, or sandbox claim.

## User workflow

1. Run a single SELECT. Choose **Send to module → Image URL Checker**, beside Export full results.
2. Select one or several image URL columns and optional expectation columns. Expectations apply to each input row; dimensions use EXIF-adjusted display orientation. A source width of `NULL` or blank means no width expectation. Invalid nonblank expectations fail the comparison.
3. Run check. The complete query result is frozen to compressed Parquet, with a stable generated row identity. The visible page size does not limit the module. Ensure disk space for the snapshot, queue and report.
4. See pass/warning/fail/limited/blocked counts. Open the full report for SQL, filtering and charts, or export it in the usual five formats.
5. **Merge back to results** creates a new dataset: the frozen original rows plus prefixed check columns for each selected URL column. Duplicate original rows and repeated URLs remain separate rows. Original source files are never overwritten. Export the enriched dataset to save a new CSV/Parquet/etc.

**Previous module runs** reopens reports or resumes unfinished runs in this workspace. A run uses its original input snapshot and original options on resume. Saved checks are reused, including recorded failures; start a new run to recheck completed URLs or change settings. A run is a timestamped observation, not a permanent guarantee of future URL availability.

If interrupted before the input snapshot finishes, Resume must rerun the original SELECT and still needs its sources/session objects. A completed snapshot no longer needs the original temporary tables or source files for checking or merging.

## Image checks and limits

The checker makes GET requests from this laptop with no browser login, cookies or JavaScript. Signed URLs are used as supplied. It cannot see images that require your browser session, execute an image website, or prove that a picture is the intended product/person. Servers can block automated clients or serve different content later.

- HTTP status, final URL, up to eight redirects and redirect chain; HTTPS certificate verification, negotiated TLS/cipher and certificate expiry when exposed by TLS; HTTP downgrade warnings.
- Content-Type versus decoded image MIME; filename extension versus format; Content-Length versus received bytes; encoded/decompressed byte limits, truncated/empty/corrupt bodies, deadlines, and bounded retries honoring Retry-After within the URL deadline.
- Real raster verification plus frame decoding: JPEG, PNG, GIF, WebP, TIFF, BMP, ICO, AVIF, JPEG2000 and other explicitly allowed Pillow raster codecs. Codec support depends on the pinned wheel. SVG is reported as limited, without rendering scripts or external references; EPS/PDF are not passed to external executables.
- Raw/display dimensions, aspect ratio, color mode/bands, alpha-channel presence, EXIF orientation/presence, ICC size, DPI and a small metadata whitelist. GPS and full EXIF/text metadata are not copied into the report.
- Animation/frame counts, frames actually decoded and an explicit complete-decode flag. Frame and total-pixel limits mark incomplete work; they do not silently count it as full validation.
- SHA-256 and the count of distinct URLs returning identical bytes; thumbnail difference hash, luminance, variation, entropy, average RGB and an edge statistic. Near-uniform images get a **heuristic** warning. These statistics are not a reliable aesthetic-quality score or a guarantee that an image is not a placeholder. Difference hashes are for exploration, not definitive identity.
- Optional per-row expected width/height, exact image byte size and MIME; exact/minimum dimension rules and global minimum dimensions.

Defaults are two concurrent checks, 20 seconds per URL, 10 MB download/decompressed content, 16 megapixels per decoded frame, 20 frames, a second animation total-pixel budget, and one retry. Same-host request starts are spaced by 150 ms. The module's whole-run limit defaults to 0 (until finished or cancelled), independently of the ordinary SQL operation limit. Limits are editable within bounded ranges. DNS resolution and native codecs may not stop at an exact per-URL wall-clock instant; cancellation has the engine's hard-stop fallback. A hard stop resets temporary SQL session state, while ordinary tables and saved URL checks remain.

Private/loopback/link-local/non-public destinations are blocked by default, including after redirects. DNS addresses are inspected and connections use an inspected address. Enable private-network access only for intended internal image servers. URL userinfo credentials and non-HTTP(S) schemes are rejected. TLS verification is never disabled.

Reports and snapshots live in the selected workspace at `modules/runs/<id>/`. The queue is SQLite-backed and report construction is native DuckDB; input rows, URLs and full report results are never collected into one giant Python list. Disk usage grows with input/report size. No image cache is retained: downloaded image bytes are discarded after inspection. Large runs can still take hours/days or hit website rate limits; no fixed throughput is promised.

## Add another module

Create `modules/my_module/manifest.json` and `modules/my_module/runner.py`, then restart Bedazzle. The module appears automatically; no results-header or server route changes are needed. To include it in a distributable, add its source filenames to `project_files.py`'s allowlist. Do not include run folders, data, credentials or caches.

Manifest example:

```json
{
  "id": "my_module",
  "name": "My module",
  "version": "1.0.0",
  "description": "Describe what happens to the complete SELECT.",
  "entrypoint": "runner.py",
  "fields": [
    {"key":"value_column","label":"Column","type":"column","required":true},
    {"key":"run_timeout","label":"Whole run limit, seconds","type":"number","default":0,"min":0,"max":86400}
  ]
}
```

Supported field types: `column` (optional by default), `columns` (up to 16, multiselect), `number` (integer min/max/default), `boolean`, `text` (bounded `max_length`/default), and `select` (`choices` is an array of `[value,label]` pairs). `help` adds a short explanation. Column options use the complete SELECT schema, including columns outside the visible 120-column preview. The module id must match its directory, using lowercase letters/digits/underscores, starting with a letter. Entrypoints stay inside that directory. Missing/invalid manifests produce a visible error and are skipped; other valid modules stay available.

The framework calls `run(ctx, options)` with validated options:

```python
from engine import identifier, literal

def run(ctx, options):
    ctx.activity('Working', 'My module is processing the frozen input.', percent=25)
    ctx.check_cancelled()
    row_key = identifier(ctx.record['row_key'])
    value = identifier(options['value_column'])
    sql = f'SELECT {row_key} AS row_id, length(CAST({value} AS VARCHAR)) AS text_length FROM {ctx.input}'
    report = ctx.write_report(sql)
    return {
        'report': report,
        'summary': {'input_rows': ctx.record['total_rows']},
        'merge': {'kind': 'row', 'fields': ['text_length']}
    }
```

`ctx.input` is a safely quoted `read_parquet(...)` SQL relation. Its columns are the original result columns plus `ctx.record['row_key']`, a unique BIGINT identity. The framework chooses a key name that does not collide with the original schema. Always quote user-chosen identifiers with `identifier()` and SQL values/paths with `literal()`; never interpolate raw names as SQL code.

`ctx.directory` is this run's own storage folder; `ctx.workspace` is the active workspace; `ctx.conn` is the existing configured DuckDB connection. Do not use that DuckDB connection concurrently from HTTP/check threads. `ctx.cancelled` exposes `is_set()` and `wait(seconds)`; call `check_cancelled()` during loops. `ctx.activity(label, detail, percent=...)` sends progress to the UI. `ctx.update(...)` atomically saves small JSON-serializable resume metadata; do not store entire reports in that JSON. Keep unfinished external-work queues on disk and bound thread pools/future backlogs.

`ctx.write_report(sql)` writes a typed compressed report Parquet atomically, within this run folder. Return that path; the framework registers it as a dataset. Report outputs outside the run folder are rejected. Return `summary` as a small dictionary; there is no required image-specific summary for custom modules. The generic Open report and Export report actions work with any report schema.

To enable merge, include a `row_id` column matching the frozen row key and `merge.kind='row'`. There must be at most one report row per input row. For multiple outputs per original row, the current `cell` contract additionally uses `url_column` as a discriminator and `merge.url_columns` as its list of values (see image checker). Merge validates uniqueness of those join keys and uses LEFT JOIN, never a positional merge or a join on a possibly duplicated URL. Output column names are prefixed and deduplicated against the original schema. A module with unrelated/aggregated output can return no merge contract and still expose its report for SQL/export; Merge then explains that row-linked output is required.

The framework stores version, original SQL, selected options, row schema, frozen input and report identity. Resume requires the same module version; bump `version` for incompatible changes. Exceptions save failed/cancelled status. An abrupt worker/app stop may leave preparing/running status; Previous module runs offers Resume. Only the currently selected workspace's runs are visible. Switching workspaces requires the engine to be idle.
