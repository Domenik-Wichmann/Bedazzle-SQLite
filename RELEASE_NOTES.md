# Bedazzle 1.6.0

This release brings local Claude Desktop integration, richer query/chart tools,
and more control over background activity. The companion extension is version 0.2.0.

- Claude can inspect authorized local files while Bedazzle's main window is closed.
  Read-only diagnostics include TRIM, LIKE, CASE, CTEs, joins, windows and bounded
  pivots. Full results stay local with bounded model transfers and durable history.
- A separate Windows approvals window starts scoped tasks. Repairs require local
  edit approval; analyzing the edited output requires a second approval after
  creation. Original snapshots/findings remain distinct. Keyed edits, approved SQL
  repair copies and explicit source write-back with backups are supported.
- Image checks/rechecks, similarity review notes and retention, URL ingestion,
  workspace snapshots, charts, cancellation and interrupted-job recovery share
  the existing engine and permission model.
- Follow Claude has a play/pause button immediately left of night mode. Its activity
  panel starts fully minimized, can be dragged within the app, and remembers its
  position/visibility. Hiding it does not stop jobs or force it open on new events.
- Chart Studio adds persistent dashboards, live previews, custom backgrounds and
  export choices. Visual Query builder supports joins and calculated columns;
  pivots include connected datasets and ordered sorting. Detached result/chart
  windows and full retained-row inspection complement the main workbench.
- Retained scalar 128-bit integer results use exact decimal storage where possible,
  avoiding implicit floating-point loss. Unsupported ranges/types fail explicitly.

## Downloads and upgrade

Download `Bedazzle-Windows.zip` for the application and bundled runtime. To use
Claude Desktop, also download `Bedazzle-Claude-Desktop.mcpb` and `Bedazzle-Skill.zip`.
SHA-256 checksums accompany the assets.

Close/stop the idle application before replacing application files. Preserve the
existing workspace folders. Configure the extension with the application folder
and the same workspace home; upload/enable the skill separately. Use
`Start Bedazzle approvals.cmd` to start tasks and review requests. Existing
`C:\dev\DuckDB` development files are already updated; use the approvals window's
**Tasks and transfer > Restart background engine** after running jobs finish.
Static UI updates only need a browser refresh.

See [COMPANION.md](COMPANION.md) for complete installation and recovery,
[COMPANION_VERIFICATION.md](COMPANION_VERIFICATION.md) for integration verification,
and [VERIFICATION.md](VERIFICATION.md) for other application checks. Deterministic
tool tests do not verify autonomous Claude judgment, account activation or policy
compatibility. No inference API key or direct Claude account changes are required.
