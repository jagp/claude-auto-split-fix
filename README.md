# Claude Code — Fix for New-Tab Auto-Splitting

Unofficial. Not affiliated with Anthropic.

Claude Code's native VS Code toolbar button opens a tab in a new editor group, for no good reason and without a setting to disable. This extension triggers on the precise sequence of events, corrects for Anthropic's lazy blank tab->Claude identity assignment, then moves it back into your active group automatically. The superfluous editor group dies automatically.

It also catches the sibling annoyance ([anthropics/claude-code#33884](https://github.com/anthropics/claude-code/issues/33884)): with Claude Code docked in the sidebar, clicking a file link — a `Read` tool result, say — opens that file in a brand-new editor group instead of the one you were working in. A file that opens alone in a fresh group gets moved back too, unless the same document is already visible in another group, since that layout is what a deliberate split-to-the-side looks like. This half is controlled by `claudeAutoSplitFix.moveFileTabs`.

Either way it acts only on the sole tab of a newly created group, and the file half stands down whenever the layout looks like your own doing: the document is already visible in another group (a deliberate split), the same document closed somewhere else moments ago (a drag), the document is a virtual one from another extension (non-`file` scheme), or several new groups appeared at once (the move target would be untrustworthy). One case is honestly indistinguishable at the API level: opening a file that is not open anywhere into a new split on purpose — Open to the Side, Go to Definition to the Side, dragging from the Explorer. If you use those often, turn `claudeAutoSplitFix.moveFileTabs` off.

## How to Use

2 methods supported:

### Download & Install

1. Grab the most recent version from github in the Releases section.
2. Point your VSCode at the VSIX.

### Build & Install

Build the VSIX:

```sh
npm install
npm run package        # writes dist/claude-auto-split-fix-<version>.vsix
```

In VS Code:

- `Ctrl+Shift+P` to open Command Palette
- Select **Extensions: Install from VSIX...**
- pick the VSIX file (in `dist/` after a build)
- Reload

## Settings

| Setting                             | Default | Purpose                                                                                                                                   |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `claudeAutoSplitFix.enabled`        | `true`  | Turn the correction on or off.                                                                                                            |
| `claudeAutoSplitFix.moveFileTabs`   | `true`  | Also move a file that opens alone in a brand-new group (the sidebar file-link case) back into the previous group. Turn off if you deliberately open not-yet-open files into new splits — the tab API cannot tell those apart from a Claude file link. |
| `claudeAutoSplitFix.restoreDelayMs` | `400`   | How long to wait before correcting. Claude stamps its identity on the tab a few hundred ms after opening it, so this cannot be too small. |
| `claudeAutoSplitFix.diagnostics`    | `true`  | Log tab and group events to the "Claude Auto-Split Fix" output channel.                                                                   |

## Troubleshooting

If the tab is not being moved, run **Claude Auto-Split Fix: Show Diagnostic
Output** from the Command Palette. The channel records every group and tab
event, why a candidate was skipped, and whether the correction ran.

Known limits of the file-link correction, all deliberate do-no-harm choices:
a link to a file already open in another group is left alone (that layout also
describes your own splits); for about 2.5 seconds after any new split appears
— yours or a pending correction's — further corrections stand down rather than
risk moving a file into the wrong group, so the second of two rapid link
clicks keeps its split; and a link clicked within about a second of closing a
tab on the same file reads as a drag and is left alone.

## Layout

| Path           | Contents                                  |
| -------------- | ----------------------------------------- |
| `package.json` | Extension manifest.                       |
| `extension.js` | The entire implementation.                |
| `icon.png`     | 128×128 icon that ships in the VSIX.      |
| `assets/`      | Full-resolution icon master, not shipped. |
| `test/`        | `npm test`: node-only harness against a mocked VS Code API. `npm run test:vscode`: integration checks in a real, briefly visible VS Code window. Neither ships. |
| `dist/`        | Current build output.                     |

## Scope

A workaround for current Claude Code extension behavior. If Anthropic adds
native support for opening a new conversation in the active editor group,
disable or uninstall this extension.

## License

MIT
