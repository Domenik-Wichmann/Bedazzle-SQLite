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

## Image checker 2.0 review workflow

Choose URL columns and, optionally, a product/record ID. Requirement profiles are
saved per workspace and include image rules, never URL-column mappings or private
network permission. Expand **Image requirements** for allowed formats, maximum
image KB, minimum dimensions, aspect-ratio bounds, transparency-channel rules,
known placeholder SHA-256 hashes and the shared-content review threshold. Aspect
ratios in the UI are width divided by height: 1 is square and 1.78 is approximately
16:9. Zero disables numeric requirements. Download limits remain separate safety
limits; an image can be within download limits and still exceed its size requirement.

The report separates `retrieval_status`, `coverage` and `requirements_status`.
Access denial (401/403), rate limiting (429), server errors, missing images
(404/410), invalid images, policy blocks and incomplete decoding remain distinct.
Requirements are unassessed when decoding is incomplete. `issue` explains a
finding and `suggested_action` gives a next step. Coverage counts refer to input
URL cells, not unique URLs. A successful run can contain incomplete checks.

Click verdict totals or use the review filter to inspect the full report in
20-cell pages. **Rank affected URLs** counts distinct frozen source rows and URL
cells, rather than assuming each URL affects one product. Source-row identities
are distinct even when business IDs repeat. Shared-image counts and difference-hash
groups are review signals, not automatic proof of a placeholder or identity.
Version 2.1 adds indexed near-hash matching across different file hashes, described
below. Version 2.0 saved reports retain their earlier identical-difference-hash
filter. Uniform images are excluded from visual matching to reduce false matches.
Confirmed placeholder SHA-256 matches fail requirements. Fully transparent images
receive an explicit warning; visible-pixel statistics composite transparency onto white.

Thumbnails are fetched only when requested, through the same bounded checker and
network policy, without browser cookies or browser navigation to the remote URL.
They are returned as a small PNG and are not saved as an image cache. A thumbnail
is a new observation and may differ from the saved report.

**Export remediation** exports the current filter across all matching rows,
including IDs, findings, actual/expected values, affected-record counts, next
steps, timestamps and decoder details. Its default URL removes userinfo, query
parameters and fragments. Paths are retained and can themselves contain sensitive
data. Including full URLs is opt-in. **Export report** includes every field and
can contain signed URLs, redirect chains and tokens. Original-data exports retain
their original values. This is export redaction, not encryption of stored reports.

Rechecks create a separate run from the frozen input. Choose failed/blocked/limited
findings, selected cells (up to 100), observations older than an age in days, or
all URLs. Selecting a cell rechecks its exact URL for every linked row. Saved
results outside the selected scope are reused. Changes distinguish reused checks,
recovered/newly unavailable images, different content, different retrieval results
and changed verdicts. Resume still continues interrupted work with its original
settings. Older reports remain viewable; interrupted runs from older module
versions require a new run after this upgrade.

Each observation records Pillow version, available allowed decoders, retry history
and timestamp; the run records the checker version and options. Requests are
bounded globally and serialized per host using a fixed-size scheduling structure.
Rate-limited/unavailable hosts get a cooldown in addition to bounded retries.
Remaining-time estimates are approximate and change with server behavior.
Impact calculations aggregate narrow keys in DuckDB before joining the wide
report; smaller report row groups reduce memory pressure on constrained laptops.

Retention is explicit and manual: files remain in the workspace until released or
deleted. **Coverage, evidence and retained data → Release retained input** removes
the original snapshot, URL queue and intermediate check files. The report remains;
merge and recheck become unavailable. Release is blocked while merged views use
the input, including renamed views. To delete an entire saved run, first remove
its report and merged datasets from the sidebar, then use **Previous module runs →
Delete saved files**. Deletion checks direct view dependencies and only removes
known files in the selected run folder; it does not recursively delete directories.

## Visual similarity in Image Checker 2.1

New checks calculate an orientation-corrected perceptual DCT hash and difference
hash from the first frame, composited on white. Matching compares Hamming distances,
aspect ratios and average colors. It can find resized, recompressed and modestly
adjusted copies even when fingerprints differ. It does not recognize product identity,
and heavy crops, arbitrary rotations, alternate camera angles or large edits can
be missed. Blank, fully transparent, low-detail and incompletely decoded images
are excluded; the per-cell `similarity_search_status` explains skipped work.

Expand **Visual similarity** before checking to disable matching, choose Strict,
Balanced or Broad sensitivity, include color variants or change the search-time
budget (30 seconds by default). Balanced accepts at most 6 perceptual-hash and
10 difference-hash bit differences, a 15% aspect-ratio difference and an average
RGB channel difference of 55/255. Strict uses 4/6 bits, 8% and 35/255; Broad uses
8/14 bits, 25% and 75/255. Including color variants disables the average-color gate.
These are practical candidate thresholds, not guarantees of identity or quality.

**Review similar pairs** shows distinct-content pairs, their scores, dimensions,
formats, file sizes, original validation findings, record IDs and affected-record
counts. A row's **Compare matches** focuses on that image's pairs. Fingerprint
agreement is a weighted bit-agreement score (65% perceptual, 35% difference hash),
not a probability. Use **Load both previews** for side-by-side images. Previews
follow the same explicit, bounded server-fetch policy as normal report thumbnails.
They are fetched now and may differ from the original observation.

Mark a pair **Likely duplicate** or **Different images**, optionally add a note,
and save it. Decisions are stored locally by the pair of exact content hashes and
survive rebuilt indexes, URL changes and new runs in the same workspace. They do
not change source records, delete images or alter validation verdicts. Pair lists
can be filtered by review status. **Export pairs** includes both record identities,
URLs, similarity evidence and review decisions, following the current status and
focused-image filter. URLs are redacted unless the full-URL export switch is on.

**Adjust matching → Rebuild matches** uses saved fingerprints without downloading
images. It also works after retained input has been released. **Recheck these
images** creates a targeted URL recheck when the original snapshot is retained.
Older reports need a new full check to generate the additional fingerprints.

The matcher indexes distinct byte contents in a disk-backed SQLite band index;
it does not collect all URLs/images into one Python list or scan every pair.
Default hard bounds are 2,000 candidate comparisons per content, 2,000,000 total
comparisons and 100,000 retained pairs, plus the chosen search-time limit.
Cancellation is checked during indexing and matching. A limited search reports
limited/unsearched contents prominently. Missing candidates never prove uniqueness.
Completeness means coverage within the configured fingerprint/shape/color rules,
not completeness of human visual similarity. The first eligible node has no earlier
neighbors; per-node status describes its indexed search, while global status also
accounts for later truncated searches. An interrupted rebuild is explicitly marked
until another rebuild synchronizes the report counts.

The index and pair-export intermediates live in the run folder. The index retains
original URLs and fingerprints, with the same sensitivity as the full report. Review decisions
and notes live in `modules/similarity_reviews.sqlite3` in the workspace; they contain
content hashes and user notes, not downloaded images. Deleting a run removes its
index but retains these reusable decisions. File retention remains manual.

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
