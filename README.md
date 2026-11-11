# Bedazzle ✧

My local tools for poking around big CSVs with SQL. Uses native DuckDB, with a small browser UI. Open files, convert them to Parquet, explore, and export without uploading the dataset anywhere.

## Download and run

**Easiest:** [download the ready-to-run Windows ZIP](https://github.com/Domenik-Wichmann/Bedazzle-SQLite/releases/latest/download/Bedazzle-Windows.zip), extract **all** of it into a folder, and double-click **Start Bedazzle.cmd**. Python and DuckDB are included; no installation or account needed.

**Editable source:** use GitHub’s green **Code → Download ZIP**, then extract it and run the same **Start Bedazzle.cmd**. This smaller download fetches portable Python, DuckDB and Pillow into its own `runtime` folder on first launch (about 34 MB, internet required once). Downloads are checksum-verified. Nothing is installed system-wide. Local-file work then works offline; image URL checks contact the selected image servers.

The browser opens automatically. Keep the terminal open while using the app. Use **Quit** in the sidebar or Ctrl+C in the terminal to stop it.

## Working on the project

A Git clone keeps your edits connected to GitHub:

```powershell
git clone https://github.com/Domenik-Wichmann/Bedazzle-SQLite.git
cd Bedazzle-SQLite
.\Start Bedazzle.cmd
```

Edit the source in that folder. Refresh the browser after HTML/CSS/JavaScript changes; stop and restart after Python changes. Commit/push with Git or GitHub Desktop when you want to save your changes back to GitHub. A ZIP also contains editable files. In **Performance & settings → Clone / connect this folder**, connect the extracted folder to GitHub without moving or overwriting those files. Git for Windows must be installed first. **Check updates** fetches the upstream version; **Apply update** accepts only a clean, fast-forward update, then asks you to restart. Local edits, divergent commits and untracked-file collisions block updates. These controls never push or upload your files.

If Python 3.12+ is already installed, `python workbench.py` also works. Development dependencies are in `requirements.txt`; use a virtual environment if desired. The release targets 64-bit Windows 10/11. The repository name is Bedazzle-SQLite; its query engine is **DuckDB 2.0**, so use DuckDB SQL.

## Using it

The sidebar workspace button opens **Workspace home** with dataset/query counts, source-file sizes and created/last-worked dates. Its small arrow is the workspace switcher. Create and rename workspaces here; **Delete** removes a workspace from the active list into a recoverable local archive. Restore it from Deleted workspaces on the home page. Archiving keeps its saved work on disk and does not free that space. The initial workspace's container is kept in place because it also contains the registry and other workspaces; deleting it never recursively removes that container.

Dataset rows have rename and remove controls. Removing an imported dataset leaves its source file intact. Removing a database table deletes its stored rows after confirmation. Saved queries are kept, but SQL referencing a removed dataset may need updating. The query library has **Rename** and **Delete** controls for saved entries.

First launch includes an **Example workspace**: [products.csv](examples/products.csv) (1,000 rows), [offers.csv](examples/offers.csv) (1,200 rows), two SQL tabs and four saved queries with joins, grouping, a CTE/window ranking and missing matches. Use Run or Explain to explore. Image URLs use example.com and are illustrative, not working image fixtures. Delete the example if unwanted; **Performance & settings → Restore example workspace** creates a fresh copy without overwriting your work. Existing installations also receive an example workspace without changing their selected workspace.

- **Open file:** below the Bedazzle name in the sidebar, choose CSV, TSV, Parquet, JSON, JSONL or NDJSON; preview how it will be read; optionally give it your own SQL name.
- **Workspaces:** use the sidebar chooser and **+** to create separate collections of datasets, saved queries, history, drafts and settings. Switching saves your current drafts first. Workspace switches close the engine connection, so temporary tables and session variables do not survive the switch; ordinary tables and saved work do.
- **Screen layout:** drag the divider to resize the actual editor/results cards. The line-number gutter scrolls with the editor instead of stretching the card. Each card has a corner expand/restore button; compact **Editor / Results** tabs switch views while expanded. Escape restores the split. The top-left menu button collapses the sidebar.
- **Import as Parquet:** create a ZSTD-compressed working copy and open it automatically. The original stays intact. Existing output filenames are protected.
- **Rename:** click the pencil beside a dataset or its name in the top header. Spaces are allowed. Earlier SQL names keep working as hidden aliases.
- **SQL tabs:** Ctrl+Enter runs all or selected SQL; Ctrl+Space suggests names; Ctrl+S saves a query. Drafts, history and named queries are kept in your workspace.
- **SQL autocomplete:** automatic prefix suggestions for tables, columns, aliases, common functions and keywords; Ctrl+Space also loads the engine's function catalog with signatures, return types and descriptions. Arrow keys choose; Tab/Enter accepts; Escape dismisses. Quoted names, common CTE projections and ambiguous joins are handled without sending partially typed SQL to a server. Complex SQL scope inference is best effort, not a complete parser or syntax validator.
- **More text formats:** PSV (pipe), TAB, DAT and NDJSONL, plus gzip/zstd compressed CSV/TSV/JSON-family files. Preview, text-preserved IDs, SQL and Parquet conversion work through the same bounded native readers. These are individual compressed data files, not arbitrary ZIP archives or Excel workbooks.
- **Visual explorer:** filter and group by one or more columns, pick a measure, expand grouped records, or inspect the generated SQL.
- **Exact result totals:** the first page appears while the complete result is counted. You’ll see **Rows 1–100 of 12,456**, not a `100+` guess. Grouping and explicit SQL LIMITs affect that total. Counting can take time; cancelling it keeps the page already shown.
- **Charts, column profiles and query plans:** use Chart, Data profile, Count dataset, and Explain when you need them. Explain shows a structured operation tree with planner estimates and details, an optional raw JSON view, and its own expand button. It does not run the query.
- **Export full results:** CSV, TSV, Parquet, JSON or NDJSON. Streams every matching result row to disk, not just the visible page. A LIMIT in the SQL still applies.
- **Send to module → Image URL Checker:** beside Export, send the complete SELECT to a reusable module. Choose multiple URL columns, optional expected width/height/bytes/MIME columns, and limits. It checks HTTP/TLS/redirects, downloads and actually verifies/decodes supported images, reports dimensions/animation/metadata/type mismatches and image statistics, deduplicates repeated URLs, and saves progress for Resume. Open/export the full report, or **Merge back to results** to create an enriched dataset with every original row preserved. Original files are kept intact. Private-network URLs are off by default; unsupported/incomplete checks are explicit. See [module details and how to add your own](MODULES.md).
- **Tips off/on:** the optional little information badges explain controls. Off by default. Reduced-motion preferences disable moving glitter/shimmer.
- **Agent instructions:** opens a card with **Copy instructions** and **Download file**. Both give the complete guide with SQL examples, feature explanations, and current dataset/column names. No row values or full source paths are included. Paste it into an LLM when asking for help.

For example, if the sidebar shows a dataset named `My catalogs`:

```sql
SELECT "url", COUNT(*) AS records
FROM "My catalogs"
GROUP BY "url"
ORDER BY records DESC, "url";
```

Names use double quotes; text values use single quotes. **Columns** shows the actual schema. The [full guide](AGENT_INSTRUCTIONS.md) has joins, pivots, deduplication, numeric casts, exports and the connection/session boundaries.

## Large files and laptop resources

Low-memory mode permits 64–255 MB engine buffer budgets with one query thread instead of refusing every import below 256 MB. Automatic still leaves most currently available RAM for Windows; very low system memory (below about 160 MB available) blocks new work. RAM readings refresh while the app is visible and after operations. Opening a file does not guarantee every large sort/join can complete with a small buffer budget; Parquet and sufficient disk space help.

CSV columns are preserved as text by default to protect identifiers and leading zeros. Choose automatic typing or explicit casts when you want numbers/dates. A malformed CSV fails visibly rather than silently skipping records.

For repeated analysis of a large CSV, import it as Parquet once. Keep the working files on an SSD and leave space for both output and temporary files. Conversion may change row order; use ORDER BY when order matters.

Bedazzle keeps a warm engine instead of starting Python/DuckDB for every query. CSV types and separators are learned at import and reused, and compatible older imported views are upgraded after their schema is checked. Normal read queries no longer rebuild the workspace sidebar/history. See the measured before/after results in `VERIFICATION.md`.

**Performance & settings** shows installed/available RAM and free disk. Automatic defaults leave room for Windows and other applications: up to 4 GB of DuckDB buffer memory, up to four query threads (fewer with small memory budgets), a bounded spill directory, and a five-minute operation limit. Quiet uses at most two threads. Raise the time limit for long conversions, or select Until I cancel.

The buffer budget is **not a hard cap on total process RAM**. Heavy work runs in a separate lower-priority engine process that stays warm between queries. Cancel/timeouts interrupt the active query; a stuck or crashed worker is restarted automatically. This reduces repeated startup and cache loss without promising every query will avoid slowdown. No real user-provided 5 GB file has been benchmarked here.

Rows per page offers **100, 250, 500, 1,000, 5,000, 10,000, 50,000, 100,000, 250,000, 500,000 and 1,000,000**. Set the workspace default in Performance & settings. Pages above 500 rows use a scrolling window: the page range can cover a million rows while the browser loads at most 500 at a time. Scroll to browse that page, or use the arrows to change pages. Responses are additionally bounded to about 1 MB of values, 10,000 cells, 120 displayed columns and 4,096 preview characters per text cell, so wide results use smaller windows. Full exports preserve complete values and all selected columns. There is no fixed total browsing limit. Deep OFFSET windows can be slower; add ORDER BY for stable paging. Scripts with setup statements cannot be paged: run their final SELECT separately. Exact counts are briefly reused for navigation while source-file/database stamps are unchanged; clicking Run requests a fresh count.

## Workspace and privacy

Your initial workspace lives under `workspace/bedazzle`. An existing older workspace is reused in place so earlier data is preserved. The workspace registry is `workspaces.json` inside that initial workspace; additional workspaces have their own folders under its `workspaces/` directory. Files opened directly stay in their original location; converted working copies default to the selected workspace's `imports/` folder. These folders and `runtime` are ignored by Git; the source/release packages exclude your datasets, queries, tokens and history.

Module runs keep frozen Parquet inputs, a disk-backed queue and report Parquet files under the selected workspace's `modules/runs/<id>/`. Leave room for these working files. The module menu reopens previous reports and unfinished runs. Image bytes are discarded after inspection. Checks are observations at a particular time; URLs can change, require logins, block automated clients, or show valid but incorrect content. Pixel/animation limits and heuristics do not prove image quality or intended subject matter.

The app binds to `127.0.0.1` and uses a random session token. Its UI has no external fonts/scripts, analytics, AI service or cloud dependency. SQL you choose to run can still write local files, access remote data or install extensions with your account’s permissions.

The engine connection stays open between operations, so temporary tables, variables and ATTACH connections can be used across Run clicks while the app stays open. Ordinary tables/views survive app restarts. Restarting the app or recovering a hard-stopped worker resets temporary/session state. Cancel or a failed operation rolls back an open transaction; already committed statements remain committed. Pages/exports rerun SQL; external changes or nondeterministic queries can change their results.

The Done effect is a small, transparent, click-through animation lasting about 1.4 seconds. It has no card, background, border or dismiss button, and does not move other notifications. Reduced motion disables flying confetti.

## Source and checks

- `engine.py`: native queries, imports, exact counts, renaming, exports.
- `app_server.py`: local API, isolated jobs, cancellation and settings.
- `ui/app.js`: editor, results and visual exploration.
- `ui/bedazzle.js` / `ui/bedazzle.css`: optional explanations, compact layout and small celebrations.
- `ui/workbench.js` / `ui/workbench.css`: split/focused layouts, scrolling result windows, workspace chooser and query-plan tree.
- `workspaces.py` / `repository.py`: separate local workspaces and conservative Git updates.
- `module_runtime.py` / `modules/`: manifest discovery, validated options, resumable frozen inputs, typed reports and stable-key joins; first-party Image URL Checker.
- `MODULES.md`: the local module contract and a working example for adding modules without changing the header or server routes.
- `bootstrap.py` / `Start Bedazzle.cmd`: pinned, local-only dependency setup.
- `AGENT_INSTRUCTIONS.md`: the downloadable base guide.

```powershell
runtime\python\python.exe -m unittest discover -s tests -v
runtime\python\python.exe tests/http_smoke.py
```

Browser tests use a separate test-only Playwright/Chromium installation. `python package.py` builds `dist/Bedazzle-Windows.zip` from the explicit source allowlist and the two runtime folders. See [verification details](VERIFICATION.md). Source is Apache-2.0; bundled Python/DuckDB licenses are in [third-party notices](THIRD_PARTY_NOTICES.md).

Optional browser-test setup (requires Node.js):

```powershell
npm install --prefix .test-tools --no-save playwright
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.test-tools\browsers"
node .test-tools/node_modules/playwright/cli.js install chromium
runtime\python\python.exe tests/http_smoke.py
node tests/browser_smoke.cjs
node tests/bedazzle_smoke.cjs
runtime\python\python.exe tests/stop_test_servers.py
```
