# Claude Code — Fix for New-Tab Auto-Splitting
```bug
BUG: Claude Code's VSCode extension doesn't open new conversations where 
you'd expect; the toolbar button spawns a new Editor group, places the new 
conversation into it, then locks the group. 
```
This extension fixes the closed-as-unplanned bug, by detecting that specific chain of events, and moving the new conversation back into the group you were already working in - right where you'd expect.

Dead simple. Just set it and forget it.

Unoficial plugin.

## Install

Build the VSIX, then install it from disk:

```sh
npm install
npm run package        # writes dist/claude-auto-split-fix-<version>.vsix
```

1. In VS Code, open the Command Palette (`Ctrl+Shift+P`)
2. run **Extensions: Install from VSIX...**
3. pick the file in `dist/`
4. reload

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `claudeAutoSplitFix.enabled` | `true` | Turn the correction on or off. |
| `claudeAutoSplitFix.restoreDelayMs` | `400` | How long to wait before correcting. Claude stamps its identity on the tab a few hundred ms after opening it, so this cannot be too small. |
| `claudeAutoSplitFix.diagnostics` | `true` | Log tab and group events to the "Claude Auto-Split Fix" output channel. |

## Troubleshooting

If the tab is not reloacting, run **Claude Auto-Split Fix: Show Diagnostic
Output** from the Command Palette. The channel records every group and tab
event, why a candidate was skipped, and whether the correction ran.

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
