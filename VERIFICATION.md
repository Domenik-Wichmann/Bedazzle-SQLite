# Bedazzle verification

Validated on Windows on 2026-11-11 using the bundled Python 3.14.10 and native DuckDB 2.0.0. This machine reports approximately 16 GB installed RAM and eight logical CPUs; available RAM varies with other applications.

## Automated checks

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
