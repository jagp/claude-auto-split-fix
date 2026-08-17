# Claude Code — Fix for New-Tab Auto-Splitting

Unofficial. Not affiliated with Anthropic.

Claude Code opens its tab in a new editor group, forcing a split — this moves
it back into your active group.

The Claude Code toolbar button opens each new conversation in a new, *locked*
editor group. This extension detects that specific layout change and moves the
new tab into the group you were already working in.

It acts only when Claude is the sole tab in a newly created group, so it will
not fight you if you later drag a Claude tab into a split yourself: dragging
moves an existing tab, while the toolbar action creates a new one.

## Install

Build the VSIX, then install it from disk:

```sh
npm install
npm run package        # writes dist/claude-auto-split-fix-0.2.0.vsix
```

In VS Code, open the Command Palette (`Ctrl+Shift+P`), run
**Extensions: Install from VSIX...**, pick the file in `dist/`, and reload.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `claudeAutoSplitFix.enabled` | `true` | Turn the correction on or off. |
| `claudeAutoSplitFix.restoreDelayMs` | `400` | How long to wait before correcting. Claude stamps its identity on the tab a few hundred ms after opening it, so this cannot be too small. |
| `claudeAutoSplitFix.diagnostics` | `true` | Log tab and group events to the "Claude Auto-Split Fix" output channel. |

## Troubleshooting

If the tab is not being moved, run **Claude Auto-Split Fix: Show Diagnostic
Output** from the Command Palette. The channel records every group and tab
event, why a candidate was skipped, and whether the correction ran.

## Develop

Press `F5` to launch an Extension Development Host with the extension loaded
from source, then click Claude Code's new-tab button in that window.

## Layout

| Path | Contents |
| --- | --- |
| `package.json` | Extension manifest. |
| `extension.js` | The entire implementation. |
| `icon.png` | 128×128 icon that ships in the VSIX. |
| `assets/` | Full-resolution icon master, not shipped. |
| `dist/` | Current build output. |

## Scope

A workaround for current Claude Code extension behavior. If Anthropic adds
native support for opening a new conversation in the active editor group,
disable or uninstall this extension.

## License

MIT
