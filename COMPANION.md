# Bedazzle local Claude Desktop integration

This integration runs data work in Bedazzle's existing local DuckDB worker. It uses
your Claude Desktop account, not an API key. It never requests Claude credentials.

## Install

On the existing development PC, `C:\dev\DuckDB` is already updated. Do not extract
a second application copy over it. Restart the background engine when no work is running, update
the Claude extension to 0.2.0, and replace the separately uploaded skill ZIP.


Install the rebuilt 0.2.0 MCPB from this repository's dist folder and replace the
uploaded skill ZIP. Updating application source alone does not replace Claude's
cached extension or uploaded instructions. Keep the same two folder settings.
This release retains the embedded-Node stream fix from 0.1.1. A connection or
discovery failure is separate from task authorization.

For an engine already running before this update, use **Start Bedazzle approvals.cmd
> Tasks and transfer > Restart background engine** after jobs finish. The helper
checks that the engine is idle, keeps the main window closed, and loads the updated
code. MCP detects older engines and provides this instruction instead of submitting
work to them. A reconnect never replays a write.

1. Extract the updated `Bedazzle-Windows.zip` to a writable folder. Keep its files
   together; the bundled Python/DuckDB/Pillow runtime is required. Existing user
   workspaces must be preserved when upgrading. Do not run an old service against
   the updated source; quit that service first.
2. Install `Bedazzle-Claude-Desktop.mcpb` through Claude Desktop's Extensions
   settings. Configure the extracted application folder and the workspace home
   (normally `<app>\workspace\bedazzle`). This is a thin extension using the
   configured application runtime. It does not contain another DuckDB installation.
3. Upload `Bedazzle-Skill.zip` under Claude's custom Skills settings and enable it.
   Skills and desktop extensions are separate installs. The optional Anthropic
   Data plugin need not be rebuilt or have its unrelated connectors configured.
4. Start **Start Bedazzle approvals.cmd**, or click **Tasks and approvals** in the
   activity panel. Choose permitted folders, describe the task and review/start it.
   Optional checkboxes authorize stored workspace tables, private image endpoints,
   or private dataset-download endpoints independently. Starting a task grants no
   edit permission. The helper is separate from the main window and does not start
   the data engine. It shows the selected workspace explicitly.

The existing development workspace home is normally `workspace/fieldwork` when
its saved preferences exist; otherwise the launcher uses `workspace/bedazzle`.
Use the same home in the extension. Do not select a nested workspace directory as
another independent workspace home.

If device policy blocks local PowerShell scripts, respect that policy. The terminal
helper remains available without changing execution policy:

```powershell
.\runtime\python\python.exe companion_local.py --workspace '.\workspace\fieldwork' task --folder 'C:\Data' --scope 'Inspect catalog prices and image URLs'
```

Review the displayed scope and type APPROVE. Add `--allow-workspace-data`,
`--allow-private-images` or `--allow-private-downloads` only when intended.

## Separate edit and analysis approvals

Claude proposes explicit cell edits against an immutable version. The proposal
shows all changes, destination and no-overwrite policy. Review its ID locally:

```powershell
.\runtime\python\python.exe companion_local.py --workspace '.\workspace\bedazzle' review REQUEST_ID
```

In the local window, choose Pending approvals, Refresh, select the exact request,
and approve or deny it. The terminal fallback accepts only APPROVE. The agent
cannot approve through MCP. Decisions are bound to the displayed request fingerprint;
stale requests cannot be approved. After applying the edit, the new copy remains
blocked from profiling, queries, previews and image checking. Claude must request
a separate analysis approval after creation; review that new ID with the same
helper. Further edits create another restricted version. Original findings remain.

Keyed cell edits use explicitly selected unique, non-NULL record columns and can
check the expected original value. This avoids confusing sorted preview positions
with immutable source row identities. Mismatches fail before editing any cells.

The local window and terminal helper are trusted surfaces outside the MCP tool suite. This is not
a sandbox against other software running as your Windows user with arbitrary
filesystem/process access. Do not give an agent an unrestricted shell connector
and then treat application-level approvals as protection from that connector.

## Tools and limits

Tools discover human-created tasks; browse folders; snapshot supported local files;
list versions; inspect schema/profile; submit SELECT queries; inspect, cancel and
export retained results; run image checks; propose/apply cell corrections; and open
Bedazzle explicitly. Every submitted operation returns a job reference; poll it.
Busy companion jobs queue behind the current operation (maximum 20 queued).

SQL aliases are `v0`, `v1`, etc. in declared input-version order. Query-local CTEs
bind them to immutable snapshots without replacing user temporary tables/views.
Read-only checks support TRIM/LIKE/CASE diagnostics, native allowlisted functions,
nonrecursive CTEs, joins, windows, set operations and bounded pivots with explicit
IN lists. External readers, user-defined functions/macros, arbitrary execution and
write SQL remain prohibited. This is an execution boundary, not a general SQL shell.

Corrected row projections use propose_transform/apply_transform: the exact SQL,
source versions and copy destination require edit approval. The output is marked
edited and remains blocked until a separate post-creation analysis approval. A
conservative structural classifier distinguishes known repairs from predicates,
flags and aggregates. It cannot infer all business intent from arbitrary formulas.
Every artifact records its actual SQL and input versions; source labels identify
inputs, not a promise that computed output values equal original fields. Do not
present diagnostic filters/casts as validation of excluded or replaced values.

CSV text preservation is intentional. Text min/max are lexical; casting is needed
for numeric ordering/statistics. Formatting differences are not automatically errors.
Built-in examples contain synthetic repeated values and illustrative image URLs.

Full results remain compressed on disk. Default previews return at most 200 rows,
512 characters per cell, 120 columns, and a conservatively bounded byte envelope.
All tool response fields count toward 64 KiB per call and a persistent 1 MiB budget
per human-created task. Pagination/reconnects do not reset that budget. The local
window offers cumulative/per-response/row increases under Tasks and transfer, with
a reason and human confirmation. The terminal equivalent, independent of edits or
analysis, is:

```powershell
.\runtime\python\python.exe companion_local.py --workspace '.\workspace\bedazzle' transfer TASK_ID --bytes 4194304 --reason 'Review additional exception pages; up to 4 MiB total'
```

To approve a scoped per-call exception, add `--response-bytes 131072 --rows 400` to
that human-reviewed transfer command. Defaults remain 64 KiB / 200 rows. Downloads have independent limits:
the image checker defaults to 10 MB per URL, bounded concurrency, timeouts and
actual-byte/decompression limits. Higher configured download limits create a local
approval request. Oversized images remain limited unless explicitly authorized.

The cell tool retrieves bounded text chunks from a targeted retained cell and
reports its complete character/byte length. Schema metadata is paginated. Artifact
and lineage tools recover saved results and explain source dependencies without
returning unauthorized edited rows. An explicit image_resume resumes an interrupted
module queue; ordinary reconnect never restarts it.

Parquet has no native DuckDB 128-bit integer type. Retained scalar HUGEINT/UHUGEINT
results use exact DECIMAL(38,0), rather than DuckDB's implicit lossy DOUBLE export.
Out-of-range or nested values require an explicit VARCHAR projection. Snapshotting
a stored table with this type is refused rather than claiming a schema-preserving
original snapshot. Original tables and source files are never changed by this rule.

## Background UI and recovery

Ordinary tools never open the browser. Headless startup reuses the authenticated
loopback service; the launcher has an OS owner lock. Closing the browser leaves
jobs running. Quit stops the service. Workspace switching causes the old MCP
session's requests to fail rather than changing its dataset context silently;
reconnect the extension for the new workspace.

The play/pause button immediately left of night mode controls Follow Claude.
Pause preserves the current view/focus while jobs and history continue. The adjacent
activity button shows or hides the Claude panel independently of following. The
panel starts completely minimized. Drag its header anywhere inside the Bedazzle
window, or focus the handle and use arrow keys (Shift moves farther). The minus
button or Escape minimizes it completely; new events never reopen it. Visibility,
position and follow preference survive reload, and resized windows keep it reachable.

The panel displays actual SQL, version events and retained-result links. Results
open on explicit selection without rerunning the query. Events/artifacts survive
UI reload. Jobs interrupted by service failure are not automatically replayed.
An edit with a recorded start but no completion receipt requires local review.
The local window lists interrupted operations. After checking the destination and
backups, Review interrupted operation abandons the old attempt and creates a NEW
unapproved retry proposal; it never automatically replays the write. Job outcomes
are persisted by the owner service, even if the agent disconnects before polling.

## Completed adapters and remaining boundaries

- Cell and set/replace/delete/add batches create approved repaired copies. SQL repair
  copies use the same two-gate model. Explicit source write-back supports files and
  stored workspace tables, with source fingerprints, unique keys and recoverable
  originals. Original-file saves use the existing editor's round-trip/conflict checks
  and atomic backup/replace path. Managed snapshots/results are never user-selected
  output destinations. Table restrictions survive renames and later snapshots.
- Image tools expose checks, rechecks, similarity pairs/rebuilds, locally approved
  review notes, approval-gated annotation merges and separately confirmed retention
  release/deletion. Deleting module files leaves original snapshots and complete
  companion-retained query reports intact.
- URL ingestion streams to a new explicit permitted destination. Default dataset
  limit is 100 MiB, independently of model-transfer limits; larger downloads require
  scoped local approval. Private addresses, credentials in URLs, unsafe schemes,
  redirects outside policy and HTTPS downgrades are blocked. Byte counting, deadlines,
  cancellation and disk checks apply even without Content-Length.
- Existing workspace files and stored tables can be snapshotted directly. Stored
  table access must be selected in the human task. Arbitrary persisted SQL views
  without a permitted file source are not executed as an authorization shortcut.
- Chart preview/save adapters use Chart Studio's retained sources, validate fields,
  retain input provenance and publish saved dashboards to the existing UI. Grouped
  charts aggregate all matching rows; raw charts are bounded samples. PNG/SVG export
  remains a browser-rendering action in the existing UI. SQL pivots are available
  through query tools; the visual builder remains available in the UI.
- Unknown future Python modules require a reviewed adapter. Recursive CTEs and
  arbitrary external/user functions are outside the SQL capability boundary.
- Same-byte edited files/exports remain restricted across tasks and workspaces in
  the same workspace home. Arbitrary external transformations or independent
  installations cannot always be linked perfectly.
- Task history, source snapshots and retained results consume disk. There is no
  silent automated deletion of original findings. Native task closure prevents
  subsequent model transfers; cancellation is a separate explicit control.
- Follow on selects fresh retained result views when the user is not editing.
  Existing drafts are preserved in separate tabs. Paused follow changes no tabs,
  editing focus, selection or scroll; jobs and activity history continue. The panel
  also offers a distinct Cancel Claude job action.
- Actual client activation/updated skill use and autonomous analytical choices still
  need observation in Claude Desktop. No account credentials or API billing are used.

## Build, test and troubleshoot

```powershell
.\runtime\python\python.exe -m unittest discover -s tests -p 'test_*.py' -v
.\runtime\python\python.exe tests/http_smoke.py
node tests/companion_browser.cjs
powershell.exe -NoProfile -STA -File companion_control.ps1 -VerifyLayout workspace/verification/companion-control.png
.\runtime\python\python.exe tools/build_ui.py --check
.\runtime\python\python.exe tools/package_companion.py
.\runtime\python\python.exe package.py
.\runtime\python\python.exe tests/companion_package.py
```

Use the official MCPB CLI/schema to validate the extension before distribution.
The Desktop extension uses its Node launcher to start Bedazzle's bundled Python;
development browser tests additionally require the repository's Playwright setup.
The application ZIP excludes user workspaces, snapshots, tokens, logs and test data.

Inspect `<workspace-home>\companion-service.log` for startup failures; Desktop MCP
logs for transport failures; and `companion\ledger.sqlite3` under the active
workspace for tasks/approvals/events. Never paste authentication tokens or signed
image URLs into a public issue. Source tampering produces a hash mismatch and a
blocked operation. Choose a fresh import/version instead of modifying snapshots.

Smoke check: with the main window closed, inspect a synthetic bad CSV; approve a
correction; verify corrected analysis stays blocked; grant its separate approval;
compare labelled original/edited findings; explicitly open Bedazzle; verify activity
recovery and Follow pause. Test install on a permitted clean Windows machine without
system Python, then disable/remove the extension and skill through Desktop settings.
Uninstall does not remove your data. Remove the application folder only after saving
any needed workspaces/backups; do not delete an old workspace as part of an upgrade.

Official packaging references checked during implementation:
https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
https://support.claude.com/en/articles/12512180-use-skills-in-claude
