# Bedazzle companion 0.2.0 verification - 2026-11-12

Follow control placement and panel usability update: the toolbar play/pause button
is immediately left of night mode. A separate activity icon restores the completely
minimized panel. Header dragging, keyboard movement, position/visibility persistence,
resize bounds and incoming activity remaining hidden passed the real browser test.
The image-check fixture still completes with the panel minimized and follow paused.
Theme/editor browser regressions passed in light/dark and compact layouts. This
change is static UI code: refresh the existing app; no extension reinstall is needed.

This release addresses the limitations demonstrated by the example-data inspection
and completes the previously omitted adapters. It retains the 0.1.1 embedded-Node
stdio fix that allowed the user's actual Claude inspection to run.

## Changes and rationale

- Read-only SQL now supports TRIM, LIKE, diagnostic CASE expressions, nonrecursive
  CTEs, safe native functions, joins, windows, unions and explicit-list pivots.
  Query-local aliases do not overwrite user tables/views. Corrected row projections
  use separately approved transform copies; external readers/macros remain blocked.
- Tool descriptions and the installable skill explain that import creates an
  untouched inspection snapshot. CSV text types, decimal formatting and repeated
  synthetic example URLs are not automatically data-quality defects. Exact counts,
  failed conversions, samples and omitted checks must be distinguished.
- Keyed cell edits with expected original values avoid sorted-preview row mistakes.
  SQL repairs, original-file/table write-back with backups, image review notes,
  retention actions, bounded URL ingestion and Chart Studio adapters are available.
- A separate native Windows window starts scoped tasks and reviews pending edit,
  analysis, overwrite, download and retention decisions. It also manages transfer
  limits and interrupted operations. MCP cannot approve its own requests. The
  terminal helper remains available; no execution-policy bypass is used.
- Provenance follows retained rows, joins, module reports, exports/reimports and
  renamed stored tables. Immutable originals and original findings remain available.
  Full results stay local. Cell chunks, schema pages, saved artifacts and bounded
  lineage metadata improve targeted investigation and recovery.
- Durable jobs survive agent disconnects. Reconnection refreshes local credentials
  and never replays writes. Older engines produce actionable restart instructions;
  the local helper can restart an idle engine without opening the main window.
- Follow opens fresh result tabs while preserving drafts. Pause preserves active
  tabs, focus, selection and scroll while jobs continue. Explicit result links work
  in a fresh authenticated browser without replaying historic show events.
- Scalar 128-bit integer results are retained as exact DECIMAL(38,0) where possible,
  avoiding Parquet's implicit conversion to DOUBLE. A regression verifies the exact
  sum 27021597764222979. Out-of-range/nested values need explicit VARCHAR projection;
  original stored-table snapshots with unsupported types are refused safely.

## Verification in this Windows workspace

The complete Python discovery suite passed: **88 tests in 70.750 seconds**. These
include actual stdio MCP -> loopback HTTP -> serialized DuckDB-worker integration,
not mocks standing in for execution. Existing editor, results, chart, module,
network, similarity, launcher, workspace and memory regressions also passed.

Companion regressions exercise unchanged original bytes, exact version binding,
both approval gates, denial and stale approvals, a new gate after further editing,
forged SQL, keyed edits, hypothetical SQL repairs, original write-back/backups,
workspace-table renames, join/export/reimport provenance and scoped transfer
exceptions. One million locally processed rows and a million-character cell test
bounded retrieval and durable cumulative accounting. Controlled HTTP fixtures cover
successful images, missing/oversized responses, private-network policy, streaming
dataset downloads with missing Content-Length, interruption and no partial publish.
Image notes, retention, recheck/resume, report preservation and charts are exercised.

Additional real UI and HTTP checks passed:

- Authenticated HTTP import/query, full-result export in five formats, conversions,
  saved queries and profiling.
- Companion browser: activity recovery, fresh-client retained-result deep links,
  Follow persistence and paused focus/selection with background work continuing.
- Existing editor browser: alias-aware completion, keyboard acceptance, large
  editor performance and drafts restored without running SQL.
- Image-module HTTP/browser and similarity workflows: full reports, source-row
  identity, non-destructive merges, deduplication, saved requirements and exports.
- Native Windows Forms layout rendered and inspected; actual PowerShell-to-Python
  UTF-8 controller pipe, stale decisions, task closure and transfer preservation.
- Generated UI consistency, JavaScript syntax and Python compilation.

Final delivery checks passed: clean portable extraction into a path with spaces
and an apostrophe, bundled runtime startup/restart, shipped MCPB discovery and real
authorized import, ZIP integrity/exclusion of user data, and the official MCPB
manifest validator. The installed-client extension and skill were not changed.

## Practical boundaries

The updated extension and skill still need activation in the user's Claude Desktop
account. This workspace's deterministic tests do not establish autonomous Claude
judgment, client policy compatibility, real-catalog performance or infallibility.
No account configuration, installed Claude extension or uploaded skill was modified
directly, and no inference API keys were requested.

Unknown future modules require reviewed adapters. Recursive CTEs, external SQL
execution and user macros are deliberately outside the capability boundary.
Browser-rendered PNG/SVG chart export stays in the existing UI. Arbitrary external
transformations and separate installations cannot always be linked to prior edited
data. The trusted local approval window is an application authorization mechanism,
not protection against another process with unrestricted access as the same user.

Build, install, limits, recovery and supported operations are documented in
COMPANION.md. The existing application folder is updated already; install the new
0.2.0 extension, replace the uploaded skill and restart the idle background engine.
