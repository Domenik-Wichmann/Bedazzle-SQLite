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
- **Detached results:** the ↗ beside Expand results moves the live results panel into a separate browser tab/window and gives the SQL editor the full panel height. Matching solid color buttons replace the expand controls; click either adjacent ↙ or double-click either color to reunite the panels (Enter on the color also works). The results tab follows the originating page's active query and shows its workspace, query name, source SQL and session ID. Each page owns its own link; colors cycle through eight choices and are visual cues rather than identifiers. Paging, charts, exports, modules and the data editor keep using the original session. Closing the results tab restores the panel; closing or reloading the original page closes its companion. Allow pop-ups if the browser blocks opening it.
- **Import as Parquet:** create a ZSTD-compressed working copy and open it automatically. The original stays intact. Existing output filenames are protected.
- **Rename:** click the pencil beside a dataset or its name in the top header. Spaces are allowed. Earlier SQL names keep working as hidden aliases.
- **SQL tabs:** Ctrl+Enter runs all or selected SQL; Ctrl+Space suggests names; Ctrl+S saves a query. Drafts, history and named queries are kept in your workspace.
- **SQL autocomplete:** automatic prefix suggestions for tables, columns, aliases, common functions and keywords; Ctrl+Space also loads the engine's function catalog with signatures, return types and descriptions. Arrow keys choose; Tab/Enter accepts; Escape dismisses. Quoted names, common CTE projections and ambiguous joins are handled without sending partially typed SQL to a server. Complex SQL scope inference is best effort, not a complete parser or syntax validator.
- **More text formats:** PSV (pipe), TAB, DAT and NDJSONL, plus gzip/zstd compressed CSV/TSV/JSON-family files. Preview, text-preserved IDs, SQL and Parquet conversion work through the same bounded native readers. These are individual compressed data files, not arbitrary ZIP archives or Excel workbooks.
- **Visual explorer:** filter and group by one or more columns, pick a measure, expand grouped records, or inspect the generated SQL.
- **Query builder layout:** dataset/query options and join types share a compact top toolbar, which scrolls sideways on narrower screens. The remaining space belongs to the canvas and query areas. Row limits accept whole positive numbers; zero clears the field and means no limit. Arithmetic menus use +, −, × and ÷. Validation messages appear only when a query needs attention.
- **Calculated columns:** in Query builder, choose **+ Calculated column**, name the result, then drop or select its two fields and choose add/subtract/multiply/divide. Fields can come from different joined datasets; either operand can also be a number. For example, `products.price − discounts.price` produces a Discount amount column. Choose **Each row**, **Sum of result**, or **Calculate from totals** (such as `SUM(price) − SUM(discount price)`), and drop Category into Group by for category totals. Each side of a totals calculation can use its own aggregate. Optional numeric filters and sorting stay inside the expandable card; collapse it to leave only its name and formula visible. Calculations use DOUBLE numeric conversion; missing/nonnumeric values and division by zero return NULL. Summaries ignore NULL values, so summing row differences can differ from subtracting two totals. Calculated columns travel with the visual draft and generated SQL; they do not modify the source datasets.
- **Query builder:** beside Pivot, add movable dataset cards and drag between matching columns to create joins. Drop fields into Output, Group by, Aggregates, Filters and Sort; configure join types, text/number/date comparisons, aggregate filters (HAVING), headings, distinct output and an optional row limit. Circles and + buttons provide click alternatives. Run updates the shared result grid; Explain and Save query use the generated SQL. The main sidebar collapses and the canvas expands above a compact results sample; the divider and expand controls still work, and leaving restores the earlier layout. Visual drafts and card positions are stored in this browser per workspace and SQL tab. Open SQL explicitly replaces that tab's SQL with the generated query; handwritten SQL is not automatically converted back into a diagram. Adding a dataset twice supports self joins. Multiple connections into one dataset are combined with AND and share a join type. Repeated join keys can multiply rows. Sum/Average explicitly convert values to DOUBLE and ignore nonnumeric values; the card displays this behavior. Nonaggregated output fields must be grouped when using aggregates.
- **Pivot:** beside Visual explorer, the main menu collapses into a full-height field chooser. Drag fields into Rows, Columns, Values and Filters, or choose an area and click a field. Add multiple measures, numeric/text/NULL filters, hierarchy subtotals, grand totals and percentages of grand totals. Reorder fields with arrows; collapse/expand groups from their parent row above the children; click result values to inspect their source records. Auto update is optional. Save layouts in this browser for the current workspace, switch to SQL editor for the generated query, and export full pivot results. Column categories are checked before building wide results; more than 40 combinations or 115 output columns requires narrower fields or filters.
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

## Edit query results and save back

Run a query and choose **Send to module → Data editor**. This opens the complete retained result as a persistent, disk-backed draft, without rerunning the query. Only a bounded page is loaded in the browser. Double-click a cell or press Enter/F2 to edit its full value; select a cell and paste a spreadsheet rectangle. Use the row checkboxes to delete records, Add row to insert, and Undo/Redo to reverse edits. Changed cells are highlighted. NULL and empty text are separate values. Find rows filters the editor; find/replace and bulk Set value apply to every matching row, including other pages.

**Save as…** offers four destinations:

- **Working dataset:** create a new named database table containing the complete edited result.
- **Source records:** choose a database table and one or more unique, non-NULL key columns. Updates/deletes affect matching original records; records outside the result and source columns omitted by the query are preserved. Adding records requires every source column in the editor. Table constraints are enforced transactionally.
- **Original file:** choose an opened source file and record key columns. Bedazzle rewrites the complete file, verifies that the rewritten data round-trips, keeps a uniquely named `.bak` beside the original, and replaces the original only after the write finishes. CSV dialect/header, compression and typed reader settings are retained where representable; quoting/formatting can change. Unsupported round-trips or preambles require saving a new export instead.
- **New exported file:** save all edited rows as CSV, TSV, Parquet, JSON or NDJSON, protecting existing output filenames.

Source saves check the original values of affected records and reject conflicts or duplicate keys. File saves also reject files changed since the draft opened. A result has no automatic write-back destination: choose the intended table/file and keys explicitly. A join or calculated result can always become a working dataset; source saving succeeds only when its original mapped values, column types and keys match the chosen destination. Renamed/omitted key columns must be included under their source names, without type-changing casts.

Drafts and typed undo history live in the workspace database and survive closing/restarting. Reopen or permanently discard them through **Editor drafts**. Working-copy/export saves keep the draft history. Successful source/file saves establish a new baseline and reset undo history; undo does not reverse an already applied source save. A file backup can restore a replaced original. Drafts, history, backups and file rewrite staging use disk space proportional to the data and edits; the engine buffer setting is not a hard process RAM limit. Grid previews shorten text; the full-value dialog supports values up to 700 KB. Clipboard paste is bounded to the visible page; bulk tools operate across the full filtered draft.

## Connecting datasets in Pivot

Choose your main dataset, click **Add dataset**, and select matching fields on each side. Names can differ (for example, Agent ID and Employee Number). Add more matching pairs for a composite key. **Suggest matches** compares names and bounded samples; **Check connection** checks every record for duplicate, missing and unmatched keys. Inspect unmatched keys before connecting. Exact text comparisons preserve leading zeros; trimming spaces and ignoring case are explicit choices.

Connected fields appear under their dataset name; unconnected fields stay dimmed. Connections require unique related keys so the main records are not multiplied. If the related keys repeat, add a matching pair or use the guided **Start with** action to make that dataset the main one. Keep all main records or only matching ones. Measures summarize joined main records, so a lookup value can repeat; those measures show a warning. Keys are rechecked before calculation, and the generated SQL also guards against repeated related keys.

While dragging, valid areas highlight and invalid areas dim. An invalid drop leaves the field in place and explains why; reduced-motion settings disable the shake. Drag a placed field back into **Your fields** to remove it, or use its cross button. Undo/redo covers placements, filters, connections and layout changes (Ctrl+Z / Ctrl+Shift+Z outside text inputs). Each field also has an area menu for adding it without dragging.

Sum and Average are dimmed for text fields. Open the measure's options and choose **Check as numbers** to enable them. Mixed numeric/text data requires explicit acknowledgement before ignoring nonnumeric values. Existing saved text-number calculations keep their previous conversion settings.

## Sorting pivot groups

Open **Sorts** and add ordered rules. Each rule targets a row group, then sorts by its label, an aggregate of another source field, or a configured value across all pivot columns. For example:

1. Product type: row label, A to Z.
2. Product name: Maximum price, high to low.
3. Product name: row label, Z to A (breaks equal-price ties).

Rules apply in priority order within each group; the Rows hierarchy still determines the order of parent groups. Use the arrows to reorder rules. Parents stay above their children, and collapsed groups keep the same ranking. Text fields can explicitly be compared as numbers; nonnumeric values then sort last. NULL sort values always come last. Sorts are saved with layouts and support undo/redo. Clicking a result header updates these rules rather than splitting the hierarchy; pivot-value headers sort by that particular column category.

The connection window explicitly labels **Left join** (default: all main records) and **Inner join** (matching records only). Neither includes records found only in the related dataset. Coverage counts describe the connection before pivot filters; displayed pivot rows are grouped summaries of those records.

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

The engine connection stays open between operations, so temporary tables, variables and ATTACH connections can be used across Run clicks while the app stays open. Ordinary tables/views survive app restarts. Restarting the app or recovering a hard-stopped worker resets temporary/session state. Cancel or a failed operation rolls back an open transaction; already committed statements remain committed. The main results grid retains each successful run on disk; paging and export reuse that snapshot. Run again to see source changes.

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

## Export current results

The **Chart** results tab offers 17 chart types, multiple value columns, tooltips, legends, zoom and PNG/SVG export. It uses the first 100 loaded rows; repeated labels are summed. The Values box shows selected columns; expand it to choose from the full vertical checkbox list. Quick charts use the displayed preview values, so use Chart studio for full retained data.

**Send to module → Chart studio** copies the complete retained query run into this workspace's `charts/sources/` folder without rerunning SQL. Choose column/horizontal/stacked bars, line/smooth line, area/stacked area, pie/donut/rose, scatter, histogram, box plot, heatmap, radar, treemap or funnel. Configure up to eight measures, a series split, sum/average/minimum/maximum/row count, date intervals, label filters, sorting, titles, axis headings, labels and four palettes. The preview updates automatically as you edit. Appearance changes reuse cached chart data; changes to data selections are debounced and serialized so older work cannot replace newer settings. Numeric text is converted to numbers; invalid and nonfinite values are reported and ignored. Pie-style, funnel, treemap and radar charts require nonnegative values. Single-measure charts explain incompatible selections.

Chart Studio opens as a large floating card (95% width, 94% height), leaving a visible edge and a dimmed backdrop. Close it with the upper-right X. The chart grows with the available width and height; **Hide settings** gives it the entire workspace. Settings live on the right in collapsible sections for Data & series, Titles & axes, Appearance & interaction, Chart details, Background, Save & export and Source data. Options include legend position, grid lines, tooltips, zoom, number/compact/percent formats, decimal places, font size, linear/logarithmic Y axes, category order and label rotation, line width and markers, connecting gaps, area opacity, bar width, histogram bins, donut hole size and PNG resolution. Type-specific controls apply to their matching charts. Logarithmic axes require positive values. Connecting gaps is an explicit visual choice; it does not fill source data.

The **Background** section follows the app theme by default, including dark chart surfaces, labels, axes, legends and tooltips. Override the theme or select a custom color, linear/radial gradient, or one of seven patterns (diagonal/horizontal/vertical stripes, dots, grid, checkerboard, crosshatch). Adjust colors, angle, spacing, line/dot size and opacity. Upload a local PNG, JPEG, WebP or GIF (up to 512 KB and 25 megapixels), then choose cover/fit/stretch/tile, opacity and a base-color overlay. Backgrounds and embedded image data save with the chart and remain local. GIFs animate in the live canvas; PNG is a still image and SVG animation depends on the viewer. Current-design exports embed the background; choosing light/dark/custom in the export dialog explicitly replaces it with a solid color.

The **↗** opens the live studio in its own tab, using the full companion window. The first draw waits for styles and layout, and an observer in that window keeps the chart sized correctly without needing a tab switch. Its upper-right color square matches the owner page and any detached results for that session. Separate app pages have independent links and colors. Use **↙**, double-click a square, or press Enter on it to bring the studio back. Closing the chart tab also returns it with edits intact. Reloading/closing the owner ends its companion link. Allow browser pop-ups if needed. The companion uses the original page's workspace, retained source and job queue; no second application session is started.

Aggregated charts read every matching source row and display up to 500 grouped points, with an explicit limit warning. Scatter, histogram and box plot use the first bounded raw observations (four times the point limit, at most 2,000), with a warning when incomplete; box-plot whiskers show minimum/maximum. Filter or summarize in SQL for complete large distributions. Radar supports at most 30 categories; charts support at most 40 series. Missing labels are marked NULL (missing), distinct from literal text; missing numeric observations remain gaps in line charts. Radar requires complete series for every category. Date grouping uses DuckDB timestamp conversion. Filter/sort/calculation settings do not modify source data.

**Save chart** creates or updates a chart in its named dashboard; **Save a copy** creates another. **Chart dashboards** in the sidebar reopens saved charts even after restart or clearing query results. Edit, delete, export each chart as PNG/SVG, or print the selected dashboard to PDF using the browser. Chart Studio saves and exports first finish the latest live preview. The export dialog lets you keep the current design or choose a solid light, dark or custom background without changing the live chart. Saved source copies use disk space, bounded separately by the configured temporary disk budget. **Free unused sources** removes source copies with no saved charts, including unsaved studio work. Chart rendering uses bundled Apache ECharts 6.0.0 and works offline.

The main Export results dialog has no SQL box. Choose All results from this run or Displayed rows, a format, and a filename/destination. Query runs retain a complete compressed Parquet snapshot on local disk. Export and paging read that snapshot, preserving values and order even if the source changes; they never silently rerun the original SQL. Selecting a displayed window exports its rows with full values and all selected columns, including values clipped in the preview.

A full result must be produced before it becomes browsable/exportable. This can take longer than the old first-page-only preview for a large query, but eliminates re-execution for paging, counting and export. Progress and cancellation remain available. Snapshot storage is bounded by the Temporary disk limit; closing a tab or replacing its result releases that snapshot. Performance settings has Clear retained results for orphaned/older snapshots. Clearing results removes no datasets or saved SQL; run a query again to create a new retained result. Cached results are not restored with SQL drafts after a browser reload.
