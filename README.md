# Bedazzle ✧

My local tools for poking around big CSVs with SQL. Uses native DuckDB, with a small browser UI. Open files, convert them to Parquet, explore, and export without uploading the dataset anywhere.

## Download and run

**Easiest:** [download the ready-to-run Windows ZIP](https://github.com/Domenik-Wichmann/Bedazzle-SQLite/releases/latest/download/Bedazzle-Windows.zip), extract **all** of it into a folder, and double-click **Start Bedazzle.cmd**. Python and DuckDB are included; no installation or account needed.

**Editable source:** use GitHub’s green **Code → Download ZIP**, then extract it and run the same **Start Bedazzle.cmd**. This smaller download fetches portable Python and DuckDB into its own `runtime` folder on first launch (about 27 MB, internet required once). Both downloads are checksum-verified. Nothing is installed system-wide. Future launches work offline.

The browser opens automatically. Keep the terminal open while using the app. Use **Quit** in the sidebar or Ctrl+C in the terminal to stop it.

## Working on the project

A Git clone keeps your edits connected to GitHub:

```powershell
git clone https://github.com/Domenik-Wichmann/Bedazzle-SQLite.git
cd Bedazzle-SQLite
.\Start Bedazzle.cmd
```

Edit the source in that folder. Refresh the browser after HTML/CSS/JavaScript changes; stop and restart after Python changes. Commit/push with Git or GitHub Desktop when you want to save your changes back to GitHub. Download ZIP gives you editable files too, but does not set up a Git connection.

If Python 3.12+ is already installed, `python workbench.py` also works. Development dependencies are in `requirements.txt`; use a virtual environment if desired. The release targets 64-bit Windows 10/11. The repository name is Bedazzle-SQLite; its query engine is **DuckDB 2.0**, so use DuckDB SQL.

## Using it

- **Open file:** choose CSV, TSV, Parquet, JSON, JSONL or NDJSON; preview how it will be read; optionally give it your own SQL name.
- **Import as Parquet:** create a ZSTD-compressed working copy and open it automatically. The original stays intact. Existing output filenames are protected.
- **Rename:** click the pencil beside a dataset or its name in the top header. Spaces are allowed. Earlier SQL names keep working as hidden aliases.
- **SQL tabs:** Ctrl+Enter runs all or selected SQL; Ctrl+Space suggests names; Ctrl+S saves a query. Drafts, history and named queries are kept in your workspace.
- **Visual explorer:** filter and group by one or more columns, pick a measure, expand grouped records, or inspect the generated SQL.
- **Exact result totals:** the first page appears while the complete result is counted. You’ll see **Rows 1–100 of 12,456**, not a `100+` guess. Grouping and explicit SQL LIMITs affect that total. Counting can take time; cancelling it keeps the page already shown.
- **Charts, column profiles and query plans:** use Chart, Data profile, Count dataset, and Explain when you need them.
- **Export full results:** CSV, TSV, Parquet, JSON or NDJSON. Streams every matching result row to disk, not just the visible page. A LIMIT in the SQL still applies.
- **Tips off/on:** the optional little information badges explain controls. Off by default. Reduced-motion preferences disable moving glitter/shimmer.
- **Agent instructions:** download a detailed Markdown guide with SQL examples, feature explanations, and current dataset/column names. No row values or full source paths are included. Hand that file to an LLM when asking for help.

For example, if the sidebar shows a dataset named `My catalogs`:

```sql
SELECT "url", COUNT(*) AS records
FROM "My catalogs"
GROUP BY "url"
ORDER BY records DESC, "url";
```

Names use double quotes; text values use single quotes. **Columns** shows the actual schema. The [full guide](AGENT_INSTRUCTIONS.md) has joins, pivots, deduplication, numeric casts, exports and the connection/session boundaries.

## Large files and laptop resources

CSV columns are preserved as text by default to protect identifiers and leading zeros. Choose automatic typing or explicit casts when you want numbers/dates. A malformed CSV fails visibly rather than silently skipping records.

For repeated analysis of a large CSV, import it as Parquet once. Keep the working files on an SSD and leave space for both output and temporary files. Conversion may change row order; use ORDER BY when order matters.

Bedazzle keeps a warm engine instead of starting Python/DuckDB for every query. CSV types and separators are learned at import and reused, and compatible older imported views are upgraded after their schema is checked. Normal read queries no longer rebuild the workspace sidebar/history. See the measured before/after results in `VERIFICATION.md`.

**Performance & settings** shows installed/available RAM and free disk. Automatic defaults leave room for Windows and other applications: up to 4 GB of DuckDB buffer memory, up to four query threads (fewer with small memory budgets), a bounded spill directory, and a five-minute operation limit. Quiet uses at most two threads. Raise the time limit for long conversions, or select Until I cancel.

The buffer budget is **not a hard cap on total process RAM**. Heavy work runs in a separate lower-priority engine process that stays warm between queries. Cancel/timeouts interrupt the active query; a stuck or crashed worker is restarted automatically. This reduces repeated startup and cache loss without promising every query will avoid slowdown. No real user-provided 5 GB file has been benchmarked here.

The UI normally shows 100 rows per page, optionally 250/500. Responses are additionally bounded to about 1 MB of values, 10,000 cells, 120 displayed columns and 4,096 preview characters per text cell. Full exports preserve complete values and all selected columns. There is no fixed 100,000-row total browsing limit. Deep OFFSET pages can be slower. Exact counts are briefly reused for navigation while source-file/database stamps are unchanged; clicking Run requests a fresh count.

## Workspace and privacy

Your files, saved SQL, settings and local database live under `workspace/bedazzle`. An existing older workspace is reused in place so earlier data is preserved. These folders and `runtime` are ignored by Git; the source/release packages exclude your datasets, queries, tokens and history.

The app binds to `127.0.0.1` and uses a random session token. Its UI has no external fonts/scripts, analytics, AI service or cloud dependency. SQL you choose to run can still write local files, access remote data or install extensions with your account’s permissions.

The engine connection stays open between operations, so temporary tables, variables and ATTACH connections can be used across Run clicks while the app stays open. Ordinary tables/views survive app restarts. Restarting the app or recovering a hard-stopped worker resets temporary/session state. Cancel or a failed operation rolls back an open transaction; already committed statements remain committed. Pages/exports rerun SQL; external changes or nondeterministic queries can change their results.

The Done effect is a small, transparent, click-through animation lasting about 1.4 seconds. It has no card, background, border or dismiss button, and does not move other notifications. Reduced motion disables flying confetti.

## Source and checks

- `engine.py`: native queries, imports, exact counts, renaming, exports.
- `app_server.py`: local API, isolated jobs, cancellation and settings.
- `ui/app.js`: editor, results and visual exploration.
- `ui/bedazzle.js` / `ui/bedazzle.css`: optional explanations, compact layout and small celebrations.
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
