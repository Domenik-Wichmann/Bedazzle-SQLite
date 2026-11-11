# Bedazzle verification

Validated on Windows on 2026-11-11 using the bundled Python 3.14.10 and native DuckDB 2.0.0. This machine reports approximately 16 GB installed RAM and eight logical CPUs; available RAM varies with other applications.

## Automated checks

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
