# Claude Code — Fix for New-Tab Auto-Splitting

Unofficial. Not affiliated with Anthropic.

Claude Code's native VS Code toolbar button opens a tab in a new editor group, for no good reason and without a setting to disable. This extension triggers on the precise sequence of events, corrects for Anthropic's lazy blank tab->Claude identity assignment, then moves it back into your active group automatically. The superfluous editor group dies automatically.

It acts only when Claude is the sole tab in a newly created group, so it will not fight you if you later drag a Claude tab into a split yourself.

## How to Use

### Build

Build the VSIX:

```sh
npm install
npm run package        # writes dist/claude-auto-split-fix-0.2.0.vsix
```

### Install

In VS Code:

- `Ctrl+Shift+P` to open Command Palette
- Select **Extensions: Install from VSIX...**
- pick the VSIX file (in `dist/` after a build)
- Reload

## Settings

| Setting                             | Default | Purpose                                                                                                                                   |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `claudeAutoSplitFix.enabled`        | `true`  | Turn the correction on or off.                                                                                                            |
| `claudeAutoSplitFix.restoreDelayMs` | `400`   | How long to wait before correcting. Claude stamps its identity on the tab a few hundred ms after opening it, so this cannot be too small. |
| `claudeAutoSplitFix.diagnostics`    | `true`  | Log tab and group events to the "Claude Auto-Split Fix" output channel.                                                                   |

## Troubleshooting

If the tab is not being moved, run **Claude Auto-Split Fix: Show Diagnostic
Output** from the Command Palette. The channel records every group and tab
event, why a candidate was skipped, and whether the correction ran.

## Layout

| Path           | Contents                                  |
| -------------- | ----------------------------------------- |
| `package.json` | Extension manifest.                       |
| `extension.js` | The entire implementation.                |
| `icon.png`     | 128×128 icon that ships in the VSIX.      |
| `assets/`      | Full-resolution icon master, not shipped. |
| `dist/`        | Current build output.                     |

## Scope

A workaround for current Claude Code extension behavior. If Anthropic adds
native support for opening a new conversation in the active editor group,
disable or uninstall this extension.

## License

MIT
