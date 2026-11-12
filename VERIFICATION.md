# Bedazzle verification

Claude Desktop integration and Follow controls (2026-11-12): see
[COMPANION_VERIFICATION.md](COMPANION_VERIFICATION.md) for the real stdio/HTTP/worker
tests, source integrity, separate edit/analysis gates, bounded transfers, module
adapters, recovery and clean-package checks. The browser regression also verifies
play/pause immediately left of night mode, fully minimized activity, drag/keyboard
movement, persisted position/visibility, resize bounds, and jobs continuing without
reopening the panel. Setup, upgrade and capability boundaries are in
[COMPANION.md](COMPANION.md); README and the downloadable agent guide include the
same controls and approval model. No autonomous-model correctness claim is made.

Query builder compact layout (2026-11-12): options and join controls now share one top toolbar; its narrow-screen overflow scrolls horizontally. The canvas no longer reserves rows for join controls, routine status text, generated-SQL expansion or the repeated instruction footer. The existing isolated browser suite passes with added assertions that Distinct, filter matching, row limit and joins belong to the toolbar, the routine status/footer are hidden, zero clears the row limit, ArrowDown from empty and minus entry cannot make it negative, and arithmetic options contain only +, −, × and ÷. Native compiler checks verify numeric/string zero omit LIMIT and negative limits remain rejected for malformed saved configurations. All Query builder calculation, route-compatibility and Pivot browser regressions pass; screenshot: `workspace/query-builder-browser-1794441270775861400/query-builder-sample.png`. The nine original query and twelve arithmetic DuckDB checks, JavaScript syntax and bundle consistency checks pass. Pivot totals and grouping semantics are unchanged.

Calculated columns (2026-11-12): `node tests/query_builder_calculations.cjs` executes 12 generated queries against native DuckDB, covering joined per-row arithmetic, all four arithmetic operators, grouped SUM(a-b) versus SUM(a)-SUM(b) with unmatched/NULL/invalid prices, numeric constants, division by zero, independently aggregated operands, average results, numeric filters/sorting, escaped/colliding headings and invalid formula validation. `runtime\python\python.exe tests/query_builder_http.py` now includes calculation browser coverage: dragging fields from different dataset cards into operands, named row differences, collapsing the card to under 85 pixels, category totals in both modes, result filters/sorting, SQL saving/handoff, reload persistence, removal/undo and numeric-constant division. Existing Query builder, missing-feature-route compatibility and Pivot browser regressions pass. Screenshots: `workspace/query-builder-browser-1794440463980441600/calculated-column-compact.png`, `calculated-category-totals.png` and `calculated-column-narrow.png`. The rebuilt bundles pass JavaScript syntax and bundle consistency checks; compatibility also passes against the already-running original server. Arithmetic uses DOUBLE conversions and does not establish exact decimal currency accounting or large-data performance.

Query builder loading recovery (2026-11-12): the existing server at runtime returned 200 for `/app.js` and 404 for all three `/query_builder*` assets. The feature now ships through the existing `/editor.js` and `/workbench.css` bundles, and the HTML no longer requests feature-specific routes. `node tests/query_builder_loading.cjs` passes against that already-running server with draft writes and queued-startup consumption intercepted: the canvas and styles load, fields generate SQL, Explore still opens, and a refresh preserves loading without requiring a backend restart. The same check is included in the isolated Query builder/Pivot browser suite. `tools/build_ui.py --check` and the bundled JavaScript syntax check pass.

The visual Query builder was checked on 2026-11-12 with `node tests/query_builder_query.cjs` (nine generated queries executed against native DuckDB plus invalid configuration checks) and `runtime\python\python.exe tests/query_builder_http.py` (isolated server, real browser and engine, followed by the existing Pivot browser regression). Compiler coverage includes LEFT/INNER joins, grouping, all seven aggregate operations, numeric/text/NULL filters, HAVING, sorting, DISTINCT, limits, hostile quoted identifiers/literals, disconnected datasets, missing fields and invalid grouped output. Browser coverage includes native field drag/drop into joins and query areas, real query results, WHERE/HAVING, headings, aggregate sorting, Explain, saving generated SQL without changing the handwritten draft, undo after removing a dataset, card positioning, reload persistence, independent per-tab drafts, SQL handoff and narrow layout. A geometry assertion verifies at least three full data rows in the default compact results area. Screenshots from the passing run are `workspace/query-builder-browser-1794438126294958900/query-builder-sample.png`, `query-builder-desktop.png` and `query-builder-narrow.png`. JavaScript syntax checks, Python compilation, UI bundle consistency and the existing real-DuckDB Pivot compiler suite also pass. Visual drafts are browser-local; arbitrary handwritten SQL is not parsed back into the canvas. These checks do not establish large-dataset join performance.

Validated on Windows on 2026-11-11 using the bundled Python 3.14.10 and native DuckDB 2.0.0. This machine reports approximately 16 GB installed RAM and eight logical CPUs; available RAM varies with other applications.

## Automated checks

Pivot contrast and ordered sorting (2026-11-12): `tests/pivot_sorts.cjs` executes generated queries in real DuckDB and checks multi-level label/aggregate sorting, equal-price name tie breakers, priority reordering, nested parent-first groups, collapsed groups, subtotal-free results, percentage ranks with negative totals, numeric text, NULLs and category-specific value sorting. `tests/pivot_sort_browser.cjs` checks dark/light connection-panel text contrast (at least 4.5:1), dark warning panels, explicit left/inner join labels and coverage, tiered rule editing, reorder/undo, numeric text, layout reload, hierarchy-safe header sorting and a narrow viewport. The full isolated suite runs through `runtime/python/python.exe tests/pivot_links_http.py`, including existing connected-pivot, ordinary-pivot and missing-script regressions. Reviewed screenshots: `workspace/pivot-links-verification-1794439775809763100/pivot-dark-connection.png`, `pivot-dark-sorts.png` and `pivot-sorts-narrow.png`. Sorting by source aggregates may require additional grouping work; no large-file performance claim is made.

Connected pivots and guided editing (2026-11-12): `runtime/python/python.exe tests/pivot_links_http.py` runs the real-DuckDB pivot and relationship checks, connected-pivot browser checks, existing pivot browser regression and missing-script regression in an isolated workspace. Evidence covers differently named and composite keys; duplicate blocking on both sides; NULL/unmatched keys; preserved leading zeros; explicit trimming; sample suggestions; left/inner joins; values from both sources; lookup-repeat warnings; zero-overlap acknowledgement; guided main-table reversal; saved connections; changes to source keys; SQL-level duplicate guards; valid/invalid drop highlighting; unchanged invalid placements; drag-back removal; undo/redo; click-based area selection; text-number conversion and invalid-value acknowledgement. Desktop and narrow screenshots are stored with each test workspace. Relationship scans check all records and can be expensive on large datasets; no multi-GB join benchmark is claimed. Linked datasets require unique related keys; many-to-many relationships must be resolved before use.

Pivot layout refinement: browser checks verify automatic navigation collapse, a navigation-width field rail spanning the entire editor/results area, both cards positioned beside the rail, navigation restoration on exit, and SQL access through the SQL editor tab. The builder sizes to its controls and reflows to two columns on narrower screens. Screenshots reviewed at 1440×1000 and 760×850: `workspace/pivot-layout-verification-1794433311207045700/pivot-desktop.png` and `pivot-narrow.png`. Parent summary rows now precede children, including nested groups; collapse/expand still preserves totals. The real-DuckDB check verifies three-level parent-first order and the final grand total. Missing-script regression checks continue to pass. All browser flows use an isolated workspace.

Pivot asset recovery: reproduced a running 1.5.0 server serving the updated HTML while returning 404 for `pivot.js` and `pivot_query.js`. Core rendering now treats Pivot as optional; a failed Pivot load leaves the current mode intact and reports a restart instruction. `node tests/pivot_loading.cjs` blocks each script separately and confirms SQL works before and after clicking Pivot, Visual explorer remains accessible, and no browser exceptions occur. The live server was restarted idle on the same address/session under the same Windows account; both assets returned HTTP 200, SQL ran, Pivot opened, and SQL ran again. The real-DuckDB pivot checks and complete isolated pivot browser flow also pass after the recovery change.

The Pivot tab is checked with `node tests/pivot_query.cjs` against real DuckDB and `node tests/pivot_browser.cjs` against an isolated server (override the shared smoke-session file with `BEDAZZLE_TEST_SESSION` when other tests are running). Checks cover sums, averages, counts, distinct/nonempty counts, NULL categories, multiple column fields, hierarchy subtotals, grand totals, percentage denominators, empty results, filters, quoted names, safe literal handling and duplicate headings. Browser checks cover click-to-add, HTML drag/drop, collapse/expand without changing totals, source-record inspection, automatic updates, multiple measures, saved-layout reload, CSV export, SQL handoff and a narrow viewport without page errors. Screenshots from this run are `workspace/pivot-verification-1794429985427587400/pivot-desktop.png` and `pivot-narrow.png`. All 20 existing engine/worker checks pass, including a strengthened Unicode/quoted-semicolon regression covering paging, exact counts, sorting and export. The rebuilt Windows ZIP passes clean-extraction, runtime, import/query, module and restart-persistence checks. Pivot layouts currently persist in browser local storage per workspace; wide column-category sets are bounded explicitly. These checks do not establish multi-GB pivot performance.

The data editor adds 14 focused engine tests (`runtime\python\python.exe -m unittest discover -s tests -p test_data_editor.py -v`) and an isolated browser/server test (`runtime\python\python.exe tests/data_editor_http.py`). They cover persistent drafts, exact BIGINT/DECIMAL values, NULL/empty values, typed atomic edits, undo/redo branches, quoted column names, stale draft revisions, composite/duplicate keys, source conflicts and rollback, source updates/inserts/deletes with untouched records/columns preserved, full working-copy/export saves, long-cell retrieval, CSV/TSV/headerless/gzip/Parquet/JSON/NDJSON original-file rewrites and byte-exact backups. Browser evidence covers the real retained-result API without rerunning a sequence-producing query, 230-row editor paging, cell edits, rectangular paste, undo/redo, reopening after reload, all four save destinations, retained outside rows and no page errors. Screenshot: `workspace/verification/data-editor.png`. These tests do not claim a multi-GB interactive performance benchmark or atomic transactions spanning a file replacement and the workspace database across an abrupt operating-system/process failure; original-file backups remain available for recovery.

v1.5 adds workspace home/switcher, metadata statistics, rename and recoverable deletion; dataset removal; saved-query rename/delete; and a self-contained example with 1,000 products and 1,200 offers. Unit checks run every saved example query and Explain, verify file-preserving dataset removal, archive/restore both managed and primary workspaces without removing the registry/other workspaces, and check saved-query edits. Browser checks exercise the new menu/cards/stats, example joins, query rename/delete, dataset removal, workspace rename/delete/restore and fresh example restoration. Fresh packaged app checks verify automatic example selection and row counts before continuing existing persistence/module tests. **39 unit tests** pass. Workspace statistics are metadata-based; source-file byte totals are not database size or a full disk-usage estimate. Last-worked times reflect local preference updates, including autosaved drafts.

v1.4.2 corrects native desktop-session handling and error visibility. The assistant-started instance was verified through Windows process ownership to be running as CodexSandboxOffline; it was stopped while idle and relaunched as the normal Windows user. The user confirmed that Browse then opened the chooser, and reported that it opened behind the app. The chooser now uses the foreground Bedazzle window as its owner, with explicit 64-bit-safe Win32 signatures, while unrelated foreground apps are left alone. Mocked Win32 tests check both ownership cases. Foreground placement awaits interactive confirmation; headless tests do not claim to verify it. The launcher records the runtime user and refuses reuse across different accounts. API diagnostics report build, app folder and runtime user, with the last backend error stored locally. The footer shows the build; the CMD prints its source folder. A browser test injects a failed file-picker response and verifies that its message appears inside the open modal, the Browse button is reenabled and the error is not hidden in a background toast. General modal errors use the same readable path.

v1.4.1 fixes the overly restrictive memory gate and stale RAM display. A real isolated worker with a simulated 432 MB available-RAM reading successfully opened, queried, converted and exported a 5,000-row CSV using a 172 MB buffer budget and one thread, preserving leading-zero IDs and all rows. Automatic-budget tests cover 160, 300, 432 and 921 MB available; genuinely low automatic budgets are rejected with a live reading. Manual 64 MB budgets are accepted. The UI refreshes lightweight resource readings every ten seconds while visible, on focus and after operations. These checks do not claim that every 5 GB query will fit in 64–172 MB of managed memory.

### v1.4 performance and editor audit

Measured locally with a 256 MB engine budget and one thread; no real user files were used. The targeted image-report benchmark uses 20,000 input rows, 5,000 saved URL checks, three samples and no network. Median report processing fell from **268.01 ms to 223.97 ms** (about **16%**). Queue construction is skipped only after a fully committed queue-ready marker; report JSON is parsed once into typed Parquet for the join and hash aggregation. Existing deduplication, per-row expectations, resume and stable merges remain tested. Baseline source is the v1.3 runner; `tests/module_performance.py` accepts a saved baseline path rather than assuming the current checkout is an older version.

Native workflow measurements: cold worker/file open 625 ms; warm catalog 21 ms, preview 20 ms, small SELECT 16 ms, count 9 ms, profile 21 ms, Explain 9 ms, completion metadata 49 ms, module schema 8 ms. Exports of 1,234 rows took 12–14 ms across the five formats; sample conversion and rename each took about 47 ms. These are small/synthetic jobs, not large-file throughput claims. Run `tests/workflow_profile.py` for a fresh audit.

General query runs varied from 17.4 to 14.1 ms (small query), 731 to 441 ms (million-row CSV aggregation), and 35.5 to 24.1 ms (Parquet aggregation). These query paths were not materially rewritten in v1.4: caching and machine-load variation prevent attributing these differences to this update. No universal speedup is claimed.

Editor changes remove redundant line-number DOM reconstruction while line count is unchanged and debounce synchronous draft serialization/storage. A 1,500-line browser check preserved the existing gutter node; measured update cost was about 1.7 ms including textarea edits. Pure completion lookups on the sample schema averaged about 0.012 ms over 1,000 runs. Completion work is debounced, local and capped at 60 rendered suggestions; full function metadata is loaded once on demand. Tests cover prefix replacement, aliases, CTEs, quoted identifiers, ambiguous joins, function signatures, keyboard acceptance and draft restoration.

**34 unit tests** pass, plus completion tests, full browser regressions and clean packaged-runtime checks. New import fixtures cover gzip CSV/JSONL, zstd CSV, PSV/TAB/DAT, leading-zero preservation and database reopening. Existing exact totals, full exports, cancellation, workspace isolation, million-row logical paging and module checks remain covered. Native CSV/Parquet scanning, SQL sorting/grouping, image decoding and external-server delays still scale with the work requested; no actual 5 GB user file or million-URL crawl was supplied.

The v1.3 module update adds a manifest-driven local extension contract, full-result snapshots, resumable disk-backed checks, typed Parquet reports, and stable-key non-destructive merges. Module tests cover actual PNG/JPEG/GIF decoding, EXIF orientation, MIME/extension mismatch, truncated/oversized bodies, redirects, gzip, retry, animation limits, blocked addresses/schemes/URL credentials, cancellation, resume and empty results. A second temporary text-length module verifies drop-in discovery and row-merge behavior; a broken manifest is isolated, and duplicate output keys block merge.

A real isolated worker processed 1,234 input rows with the same URL, making one image request and producing 1,234 enriched rows. Browser checks selected two URL columns and per-row expectations, verified all 242 URL cells from 121 rows, exported the complete report, joined correct fields without row multiplication, reopened history, cancelled and resumed a run. Tests use deterministic loopback fixtures with explicit private-network permission. One public Python.org PNG was also checked successfully over certificate-verified TLS 1.3 (211×71, full decode); no user data was sent. This is not a large external-site throughput benchmark.

The module update has **33 unit tests**, plus native API, browser and packaged-runtime checks. A clean Windows ZIP extracted into a path with spaces and an apostrophe loaded its bundled Pillow, discovered the module, checked/merged a sample, and preserved its report/run history over restart. Pillow 13.0.0 is checksum-pinned and bundled. Byte/pixel/frame/concurrency limits bound routine work, but native codecs, DNS and remote servers can still stall; the existing hard-cancel fallback can reset temporary SQL session state. No actual user 5 GB input or million-URL external crawl was benchmarked.

The v1.2 workspace/layout update adds:

- A 1,500-line SQL editor checked at a 1366×768 viewport: bounded card height, draggable divider, expand/switch/restore, and a collapsible sidebar.
- A 1,200,123-row ordered query browsed with a million-row logical page: exact total, at most 500 rendered records plus spacers, continuous row anchoring across batch changes, middle/end navigation, and next/previous logical pages.
- Separate workspaces with independent persistent tables, datasets, SQL drafts and default page sizes; registry selection survives reopening. Invalid workspace identifiers and duplicate names are rejected.
- Structured JSON query-plan cards and an expanded details dialog; complete instructions copied to the browser clipboard and downloaded with the current schema.
- Conservative Git linking tested against a local upstream: existing edited source and private files survive adoption; updates refuse local edits; a clean fast-forward updates source and leaves workspace data intact. Tests do not push to any repository.
- **27 unit tests** pass. Browser regression checks cover imports/conversion, joins/group expansion, sorting/paging, charts/profiling, saved-query persistence, full exports, cancellation, optional help, and reduced motion.

The packaged ZIP was extracted to a path containing spaces and an apostrophe. Its bundled runtime imported the sample; a complete app restart preserved the chosen secondary workspace, its table and million-row default. Switching back recovered the original datasets, named queries and SQL drafts.

Large-page browsing bounds the rendered window and response size, not total engine memory. Deep OFFSET queries still depend on SQL shape and source format. There is no claim that a million-row page makes every query fast.

Engine/unit checks cover:

- Text-preserved CSV import: leading-zero identifiers and apostrophes in paths.
- Persistent file-backed views after reopening the database.
- Complete Parquet conversion and refusal to overwrite an existing output.
- Full-result CSV, TSV, JSON, NDJSON, and Parquet exports, round-tripped to check 1,234 rows despite a 100-row preview.
- Ordered paging without skipped or repeated rows.
- Wide-result cell limits without skipping the first row of the next page.
- Long text preview clipping and lossless representation of 64-bit integer values in JSON responses.
- Malformed CSV conversion failing visibly and cleaning partial output.
- Data profiling and query plans.
- Cancellation and automatic timeout, followed by successful querying of the same workspace.
- Pinned-download checksums, archive-path validation, and preservation of an older workspace.
- Exact totals for paged, grouped, limited and empty query results; a count does not repeat script setup statements.
- A preview arriving before a long count, and cancellation of that count.
- Dataset names with spaces/quotes; repeated renaming and renaming back; old SQL and dependent views keep working.
- Trailing SQL comments, nested comments and quoted semicolons survive paging, exact counting, server-side sorting and full export.

HTTP checks exercise the actual loopback server, session authentication, import preview, file registration, SQL results, conversion, all export formats, saved queries, and profiling.

Isolated headless Chromium checks exercise:

- Dataset selection, visible query results, next/previous paging, and row ranges.
- SQL tabs retaining separate editor text and bounded results.
- Saving, finding, and restoring a named query.
- Visual grouping, expansion/collapse, and expansion preserving the visual filter.
- Chart rendering and on-demand profiling.
- Import as Parquet: source path entry, preview, conversion, and automatic opening.
- UI export of all 1,234 rows from a 100-row preview, and refusal to overwrite.
- Performance settings, cancellation, and a successful subsequent query.
- A 1,024-pixel laptop layout without document-level horizontal overflow.
- Editor restoration on reload without automatically executing SQL.
- No uncaught JavaScript exceptions or browser console errors during those flows.
- Server-backed draft restoration in a fresh browser context, without executing the restored SQL.
- Sample loading after saving performance settings, and a new conversion destination when reopening the import dialog.
- Vertical line numbers, compact filename header, exact 156-result totals, optional help badges (off by default), a complete agent-guide download, dataset renaming, and reduced-motion celebrations.

The distributable ZIP was extracted into a clean directory containing spaces and an apostrophe. Its bundled interpreter and DuckDB engine ran without the system Python, imported/queried the included sample, and retained drafts, saved queries, datasets, and settings across a full application restart. ZIP integrity and exclusion of user workspaces/test tools were checked.

A clean source checkout containing no runtime binaries was launched using `Start Bedazzle.cmd`. It downloaded checksum-verified Python and DuckDB into its own folder, started successfully, imported the sample, and returned an exact 156-row query total. The source repository uses an explicit source allowlist; user datasets, history, session tokens, runtimes and earlier upstream checkouts are excluded.

The browser test uses path entry for repeatability. Native Windows Browse/Choose dialogs use the common-dialog API; interactive dialog selection has not been visually automated in this environment. Direct control of the user's browser was unavailable, so UI tests run in their own headless Chromium profile instead.

## Synthetic benchmark

### Version 1.1 job-latency comparison

Measured before and after this change on the same local machine, using a 256 MB DuckDB buffer budget and one thread. Times include job submission, native execution, and completion; they are not browser paint times. First engine startup/import is excluded from repeated-query samples.

| Repeated workload | Before | After | Samples |
| --- | ---: | ---: | --- |
| Small imported CSV query | 585.87 ms | 18.72 ms | median of 8 |
| Group one million CSV rows, 250 MiB source | 1,266.99 ms | 598.69 ms | median of 3 |
| Same grouping from Parquet | 638.18 ms | 30.08 ms | median of 3 |

Changes: a reusable engine process/connection, interrupt-first cancellation with hard-restart fallback, CSV dialect/type recipes retained after import (and validated upgrades of older app-created CSV views), adaptive UI polling, no full workspace reload after every read, and no result-table remount just to update its total. Full exports and exact counts are retained. A small transparent animation replaces the completion card.

The corpus is synthetic and repetitive; it is not the user's actual 5 GB file. Files were on the same local drive with normal OS caching. Unrelated machine load affects individual samples. This demonstrates reduced overhead, not a fixed speedup for all queries.

Additional checks cover process reuse, temporary tables across Run clicks, changed CSV contents, quoted/multiline CSV fields and typed dates, cancellation retaining a healthy worker, and recovery after forcibly terminating a test worker. The UI test verifies the effect has no background, shadow or buttons, is under 120×80 pixels, and is click-through.

### Original conversion benchmark

One million generated catalog rows, a **256 MB DuckDB buffer budget**, and **one query thread**:

| Measurement | Observed |
| --- | --- |
| CSV size | 261,996,730 bytes, about 250 MiB |
| Parquet size | 1,079,473 bytes, about 1 MiB |
| CSV-to-Parquet conversion | 1.758 seconds |
| Repeated CSV aggregation, median of three | 0.5997 seconds |
| Same Parquet aggregation, median of three | 0.0200 seconds |
| Record count | 1,000,000, verified |
| Grouped results | Equal between CSV and Parquet |

The data intentionally repeats URLs, client/catalog labels, and description text, so its compression ratio is unusually favorable. These are local repeated-query measurements with OS caching, not a general speed or compression promise. They do not measure peak process RAM. A 256 MB buffer setting is not a 256 MB total application limit.

No real user-provided 5 GB file has been supplied or benchmarked. Its schema, row width, cardinality, encoding, query shapes, available RAM, and disk will determine actual performance.

## Remaining limits

- A warm worker keeps its connection/cache across queries. Temporary/session state survives normal operations but resets on app restart or hard worker recovery. Cancellation and failed operations roll back open transactions.
- Pages rerun their SELECT. Deep OFFSET pages can be expensive; stable order requires ORDER BY, and changed source data can change later pages or exports.
- The UI caps the size of previews; full exports include complete selected values and columns.
- Single-statement SELECT/PIVOT exports are supported. Run setup statements separately before exporting.
- Hardware budgets, worker isolation, and cancellation reduce pressure but cannot guarantee every query avoids high memory use or OS slowdown.
- Ordinary local-file work is offline. SQL explicitly accessing remote data or installing an extension can use the network.

Generated data, test workspaces, tokens, screenshots, the isolated Chromium binary, and test-tool packages are excluded from the distributable ZIP.

## Retained export changes (integration work)

New native tests retain a 1,234-row result containing random values and 9,000-character strings, drop its original source table, then export all five formats successfully. Random values match the shown run; complete text survives clipping. Paging and a 100-row displayed-window export work after source removal. A sequence-backed script verifies setup executes once, and sorting uses retained values. Browser checks verify the absent SQL field, all-run/displayed-window exports, exact random values, pagination after source deletion, and existing editor/import/export/workspace regressions. Storage is disk-backed and quota-limited; materialization is cancellable. Full result production replaces the former preview-before-count UX. The other concurrent data-editor and pivot work is not owned or published by the export task.


## Image checker 2.0 - 2026-11-11

Validated the local-source upgrade using deterministic loopback image fixtures;
no user catalog or external image servers were checked.

- `runtime/python/python.exe -m unittest discover -s tests -p test_modules.py -v`:
  12 tests passed. Coverage includes HTTP categories, corrupt/truncated/encoded
  bodies, EXIF rotation, animation limits, transparent and uniform images,
  placeholder hashes, requirement profiles, row-linked impact counts, unchanged
  and changed content, failed/selected/stale rechecks, interrupted preparation,
  merge integrity, thumbnail safety and retention dependency guards.
- `runtime/python/python.exe tests/http_smoke.py`: API authentication, imports,
  query results, conversion and all five export formats passed.
- `runtime/python/python.exe tests/modules_http.py`: real engine worker checked
  all 1,234 input rows with one request for a repeated URL. Browser tests passed
  profile save, clickable verdict totals, filters, thumbnails, impact ranking,
  token-redacted remediation export, full export, stable merge, saved history,
  cancel/resume and targeted rechecks. Desktop and 390-pixel layouts were captured
  and inspected. No browser page errors were reported.
- Python compilation and `node --check ui/modules.js` passed.
- Synthetic report-only benchmark: 200,000 input rows, 5,000 saved URL checks,
  one DuckDB thread and a 256 MB engine budget completed in 1.64 seconds in the
  final measured run. This excludes downloads and is not a throughput guarantee.
  Narrow-key aggregates and 16,384-row report groups avoided the wide-window and
  large-row-group spilling found during development. The 20,000-row comparison
  measured medians of 0.29 seconds for the published runner and 0.42 seconds with
  the additional report analysis (three repetitions).

Evidence is under `workspace/verification/image-module-*.png` and
`workspace/performance/image-checker-*.json`. Runtime files and test datasets stay
outside the distributable source allowlist. Restart Bedazzle after updating source.

Visual duplicate candidates require equal difference hashes, and shared-content
or blank-image warnings require review. Retention is manual; stored full reports
can contain signed URL secrets even when remediation exports are redacted.
# Theme and SQL editor (2026-11-11)

`runtime/python/python.exe tests/http_smoke.py`, followed by `node tests/theme_editor.cjs`, `node tests/editor_browser.cjs` and `node tests/completion.cjs`, passed against an isolated workspace. The HTTP checks covered the real DuckDB query/export flow. Browser checks covered the corner toggle, theme persistence across reloads and loopback ports, syntax token colors, literal/comment preservation, selection formatting, Ctrl+Z, draft restoration, real execution of formatted SQL, safe rendering, scrolling and a compact viewport. No browser errors occurred. Python compilation passed for the changed server and packaging files.

Both palettes, settings and pivot controls were visually inspected. Screenshots are in `workspace/verification/dark-sql-editor.png`, `light-sql-editor.png`, `dark-settings.png` and `dark-pivot.png`. SQL Formatter 15.9.0 is bundled locally with its license and DuckDB dialect; formatting requires no network connection. The distributable allowlist includes all new assets; release ZIPs were not rebuilt for this UI change.



## Advanced visual similarity / Image Checker 2.1 - 2026-11-12

Implemented local DCT perceptual hashes plus oriented difference hashes, bounded
SQLite band indexing, shape/color gates, per-content report annotations and a
side-by-side pair-review workflow. Matching uses different file contents, leaving
exact-byte duplicates in their existing report category. Decisions and notes are
keyed by content pairs and persist across rebuilt indexes and URL rechecks.

Validation:

- All 12 existing module tests passed, including merge identity, cancellation,
  interrupted preparation, privacy and retention guards.
- All 7 new `tests/test_similarity.py` tests passed: exhaustive threshold-neighbor
  comparison on controlled hashes, resized/recompressed/brightness-adjusted image
  fixtures, EXIF display orientation, color variants, shape/decode exclusions,
  candidate/global-comparison/pair caps, disabled searches, cancellation, focused
  pair queries, review persistence, redacted pair exports and interrupted rebuild
  recovery. The real fixtures include differing perceptual hashes, not only exact
  hash matches. Unrelated noise and blank/transparent inputs are not candidate pairs.
- The isolated HTTP worker and existing browser module suite passed.
  `tests/similarity_browser.cjs` passed record-focused matching, both safe previews,
  review status/note persistence, strict rebuild from saved fingerprints, redacted
  pair export with record IDs, mobile layout and targeted recheck with decisions
  retained. No browser page errors were reported. Screenshots were inspected at
  `workspace/verification/image-similarity-desktop.png` and
  `workspace/verification/image-similarity-mobile.png`.
- `tests/similarity_performance.py`: 5,000 synthetic distinct contents, 1,000 planted
  matches, 158,759 comparisons rather than all 12,497,500 pairs. All 1,000 matches
  were found with complete search status in 2.93 seconds; SQLite index was 2.414 MB.
  The engine used a 256 MB configured DuckDB budget and one thread. This benchmark
  excludes downloads, image decoding and fingerprint generation; it is not a full
  catalog throughput guarantee. Evidence: `workspace/performance/image-similarity-performance.json`.
- Python compilation and JavaScript syntax checks passed. The new source and tests
  are included in the distributable allowlist; generated data and image previews
  are not. Test servers used separate temporary workspaces.

Completeness is bounded by the configured fingerprint, aspect and color rules,
plus explicit search budgets. Scores measure fingerprint agreement, not semantic
identity. Large crops, different camera views and large edits can be missed.
Excluded or truncated searches are explained in the UI and report. No cloud model,
new Python dependency or full-catalog image cache was introduced. Source rows and
validation verdicts are unchanged by review decisions.
# Startup compatibility correction (2026-11-12)

The already-running server returned 404 for the new standalone theme, presentation and formatter asset routes, while serving the updated HTML and editor. `setupEditor()` consequently threw before `setupOrganization()` could bind workspace navigation. The UI now bundles these dependencies into existing routes (`sql_completion.js`, `editor.js`, `workbench.css`). Authored files for these bundles are listed in `tools/build_ui.py`; run `runtime/python/python.exe tools/build_ui.py` after editing them, or add `--check` to verify the committed outputs. No build is needed to launch the app.

Workspace navigation initializes before optional editor setup, whose failures are contained. The textarea stays readable until highlighting is initialized. `tests/startup_compatibility.cjs` passed with the new routes deliberately unavailable, including opening/switching workspaces and formatting SQL, and with an injected editor setup failure. The theme/editor, existing editor, completion and HTTP smoke checks passed. A read-only browser check against the actual older running server confirmed workspace home and both formatter functions load with no 404s or browser errors; all POST requests in that check were intercepted to preserve user data. Refreshing the existing page loads the fix without restarting that server.

# Night palette and formatting styles (2026-11-12)

Dark mode now uses near-black/charcoal surfaces, neutral borders and a blue accent. The pivot field rail's theme rule explicitly overrides its later-loaded base stylesheet. The Add to dropdown was removed; fields still drag to any zone, while clicks put text fields in Rows and numeric fields in Values.

Beautify's split menu offers Vertical, Compact and Aligned styles and remembers the selected style/width. Compact uses the editor's measured character capacity, capped by optional 80/100/120-character limits. Complete SQL atoms are packed without changing their contents. The editor visually wraps long indivisible values and synchronizes the syntax mirror and line-number heights. Autocomplete uses the rendered caret position and cancels pending suggestions after formatting. Newline-dependent adjacent strings and escaped strings are preserved.

`tests/format_styles.cjs` passed against real DuckDB for all three styles, including undo, equivalent query results, literal/comment edge cases, keyboard menu use, persisted preferences, narrow-editor width and wrapped line numbers. `tests/pivot_browser.cjs` passed click/drag placement, totals, folding, drill-through, filters, layouts, export and SQL handoff. The theme/editor, existing editor, completion, startup compatibility and HTTP smoke checks also passed. Generated bundles passed `tools/build_ui.py --check`. A read-only browser check against the existing running server confirmed the menu, Compact, pivot colors and workspace navigation load with no failed assets or browser errors; POST requests were intercepted to preserve user data.

Visually checked screenshots: `workspace/verification/night-format-menu.png`, `night-pivot-fields.png` and `compact-narrow-wrapping.png`. Refresh the existing page to load the update; no server restart or release ZIP rebuild is needed for the local source instance.

# Chart studio verification (2026-11-12)

- Live/background follow-up: removed the manual preview action. Browser tests verify automatic edits, cached appearance redraws with zero aggregation requests, editable controls during queued data changes, and latest-filter results after rapid edits. The studio is a 95vw × 94dvh floating card with an X; detached studios use their full window.
- Background coverage: app-following dark surfaces/text/axes/legends, linear/radial gradients, all seven pattern types, embedded PNG uploads and saved-image restoration. Actual GIF animation was verified with captures of changing background pixels. Uploads are limited to PNG/JPEG/WebP/GIF, 512 KB and 25 megapixels.
- Export coverage: current-design PNG retains uploaded image pixels; light PNG has white background pixels; dark/custom SVG contains the chosen background color. Export overrides do not change the live chart. The full 17-type chart suite, dashboard PDF printing, main browser smoke, HTTP smoke and legacy-asset startup checks passed.
- Detached sizing copies already-loaded CSS into the new document before measuring the canvas, with a local stylesheet fallback, and installs a window-local ResizeObserver. Tests delay stylesheet delivery and verify the initial SVG exactly matches its canvas without switching tabs, then verify light/dark synchronization, rejoin, close recovery and reload cleanup. Screenshots were visually inspected.

- Fullscreen follow-up: studio fills a 1500×1000 viewport, its chart uses over 800 px of height and over 1000 px of width, settings sit on the right, and hiding them expands the canvas. Settings are grouped into collapsible sections; appearance settings survive chart saving/reloading. The values picker was checked with 60 naturally flowing options and keyboard dismissal.
- Linked tabs: actual browser pop-ups verified shared source/edit state, matching owner/studio/results colors, independent second app instances, companion SVG export, narrow-window layout, close recovery, color-square rejoin, blocked-popup recovery and owner-reload cleanup. Screenshots were visually inspected. All 17 chart types, PNG/SVG and dashboard PDF export still pass.
- Combined source verification: all 71 Python tests passed, HTTP smoke and main browser smoke passed, legacy-asset startup compatibility passed, and query-builder SQL generation/calculation tests passed. Publishing includes the query-builder source dependencies and their tests in the explicit source allowlist.

- Follow-up loading fix: chart JavaScript/ECharts are included in the existing `editor.js` bundle, and chart CSS in `workbench.css`, so older running servers need no new asset routes for quick charts. Results rendering guards against unavailable chart functions. `tests/startup_compatibility.cjs` passed with every new chart asset URL blocked, including an actual quick-chart query/render. Full Chart studio browser tests passed with the bundled assets. Older backends show a specific restart message when Chart studio is requested.

- `runtime/python/python.exe tests/charts_http.py`: passed against an isolated workspace with the portable engine. All 17 chart types rendered; a 1,200-row result aggregated beyond its visible window; two measures split into four series; saved charts reopened after reload and clearing retained query results. PNG and SVG downloaded successfully, and dashboard print output produced a PDF. Screenshots were visually inspected.
- `runtime/python/python.exe -m unittest discover -s tests -p test_charts.py -v`: three tests passed, covering frozen-source independence, full-data aggregation, numeric conversion/nonfinite values, NULL labels, workspace isolation, persistence, filters, limits, identifier/configuration validation and unused-source cleanup.
- The full unit suite passed (70 tests at the time of the run, before adding the final numeric edge-case test). The HTTP smoke test and main browser smoke test passed. Detached-results browser coverage passed on retry; an initial run hit its Pivot positioning assertion immediately after switching modes.
- Source allowlist checked for all packaged chart files; JavaScript syntax and Python compilation checked. ECharts 6.0.0, Apache license and NOTICE are bundled locally. Chart rendering requires no network access.
