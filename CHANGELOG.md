# Changelog


- Moves a newly opened Claude Code tab out of Claude's automatically created,
  locked editor group and into the preceding group.
- Settings: `claudeAutoSplitFix.enabled` and `claudeAutoSplitFix.restoreDelayMs`.

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
