# Changelog

## Unreleased

- Move a file that opens alone in a brand-new editor group back into the
  previous group — the layout produced by clicking a file link in the Claude
  Code sidebar
  ([anthropics/claude-code#33884](https://github.com/anthropics/claude-code/issues/33884)).
  On by default; controlled by the new `claudeAutoSplitFix.moveFileTabs`
  setting.
- File moves stand down whenever the layout looks like the user's own doing:
  the document is already open in another group (a deliberate split), the same
  document closed elsewhere moments ago (a drag — input-object identity is not
  reliable for this in the real extension host), the document has a non-file
  URI scheme (virtual documents from other extensions), or several new groups
  appeared within ~2.5 s (the "previous group" target would be untrustworthy).
- A file whose *path* contains "claude" (e.g. `CLAUDE.md`) is classified as a
  plain file, not a Claude conversation tab, so it obeys every file guard and
  the `moveFileTabs` opt-out.
- File tabs are corrected after a fixed 150 ms settle instead of the full
  `restoreDelayMs`, shrinking the visible bounce; `restoreDelayMs` now governs
  Claude conversation tabs only.
- Both correction paths stand down when the new group is already the
  leftmost/topmost in the grid, judged by `viewColumn` (VS Code would create
  a group instead of failing quietly), and re-confirm focus has not moved
  immediately before the move command runs.
- New `npm test`: a node-only harness (`test/harness.js`) replays tab events
  against a mocked VS Code API across 12 scenarios and asserts when the
  correction fires. New `npm run test:vscode`: four integration checks in a
  real extension host via `@vscode/test-electron` (downloads a VS Code test
  build and briefly opens a window). `npm run package` now creates `dist/`
  if missing, so it works on a fresh clone.

## 0.2.1

- New icon. Should be easier to grasp from the extensions menu
- Tweaked extension meta

## 0.2.0

- Wait for Claude to assign its new tab an identity
- Track new editors by `tab.input` identity rather than `Tab` object
  identity, which VS Code does not guarantee to be stable.
- Re-validate against `tabGroups.activeTabGroup` instead of comparing stored group objects.
- Pause 50 ms between unlocking the group and moving the editor.
- Broaden Claude detection to match `/claude/i` against the label, webview
  `viewType`, `uri`, and input class name.
- `restoreDelayMs` default raised from 100 to 400 ms (maximum 3000).
- New `claudeAutoSplitFix.diagnostics` setting (on by default) and
  **Claude Auto-Split Fix: Show Diagnostic Output** command.

## 0.1.2

- Recognize Claude's buggy "blank" tab behavior
- Blank tabs are only moved when brand-new and alone in a brand-new active
  group, so ordinary untitled files opened in a split are left alone

## 0.1.1

- `extension.js` moved to the repo root; `main` updated to match.
- New 128x128 `icon.png`, downscaled from `assets/new-icon.png`.
- Removed an unused settings helper and its commented-out leftovers.
- `repository`, `bugs`, and `homepage` URLs corrected to the real origin.

## 0.1.0

- Moves a newly opened Claude Code tab out of Claude's automatically created, locked editor group and into the previously active group.
- Settings: `claudeAutoSplitFix.enabled` and `claudeAutoSplitFix.restoreDelayMs`.
