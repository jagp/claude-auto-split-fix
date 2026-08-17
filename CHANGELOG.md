# Changelog

## 0.1.0

First release under the extension ID `claude-auto-split-fix`.

- Moves a newly opened Claude Code tab out of Claude's automatically created,
  locked editor group and into the preceding group.
- Settings: `claudeAutoSplitFix.enabled` and `claudeAutoSplitFix.restoreDelayMs`.

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
