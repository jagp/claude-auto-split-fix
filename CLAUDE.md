# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file, unofficial VS Code extension. Claude Code's toolbar button opens
a new conversation in a *new, locked* editor group; this extension detects that
one specific layout change and moves the tab back into the preceding group.

There is no build step, no TypeScript, no bundler, and no test suite. The whole
implementation is `extension.js` (~110 lines) plus the manifest.

## Commands

```sh
npm install            # installs vsce + @types/vscode; no runtime deps
npm run package        # -> dist/claude-auto-split-fix-<version>.vsix
```

`--no-dependencies` in the package script is load-bearing. `node_modules` is
~100 MB of build tooling; without that flag vsce would try to bundle it. The
extension's only import is `vscode`, which VS Code supplies at runtime.

Linting is Trunk (`.trunk/trunk.yaml`: prettier, markdownlint, yamllint,
shellcheck, plus security scanners). Note that `.trunk/` is excluded locally
via `.git/info/exclude`, so it is deliberately not tracked:

```sh
trunk check            # changed files
trunk fmt
```

### Testing a change

There is no test harness. Press `F5` to launch an Extension Development Host
(`.vscode/launch.json`), then click Claude Code's new-tab button in that
window and watch where the tab lands. This is the only way to confirm the
behavior — the logic is entirely reactive to VS Code window events, so nothing
meaningful can be asserted without a live editor.

## Architecture

The extension is one narrow heuristic. Its difficulty is timing, not logic:
Claude opens a *blank* tab in a new locked group and only stamps its
`Claude Code` identity onto that tab a few hundred milliseconds later. Asking
"is this Claude?" at the moment the tab appears always answers no -- that is
what made an earlier version do nothing at all.

The flow (all inside one `activate` closure in `extension.js`):

1. **Seed.** `rememberExistingInputs` records every existing `tab.input` in a
   `WeakSet`. Inputs, not `Tab` objects: VS Code may hand back a different
   `Tab` wrapper for the same editor, so `Tab` identity is unreliable.
2. **New group.** `onDidChangeTabGroups` stores each opened group in
   `pendingNewGroups` with a timestamp. Entries older than 5 s are dropped, so
   a stale group cannot trigger a correction later.
3. **New input in that group.** `onDidChangeTabs` fires for the opened tab. If
   its group opened moments ago and its input has never been seen, it is a
   candidate. A drag reuses an existing input, so it fails this check -- this is
   the load-bearing distinction between Claude's split and yours.
4. **Wait for identity.** `correct` sleeps `restoreDelayMs`, then polls every
   100 ms for up to 2.5 s until `isClaudeTab` becomes true. This is the step
   the blank phase requires.
5. **Re-validate against live state.** It reads `tabs.activeTabGroup` and its
   `activeTab` rather than comparing stored group objects, then requires the
   candidate to still be the sole tab in the still-active group.

Only then does it run `workbench.action.unlockEditorGroup`, pause 50 ms, and
run `workbench.action.moveEditorToPreviousGroup`. The unlock is required
because Claude locks the group programmatically; the pause lets the unlock land
before the move. VS Code collapses the now-empty split on its own.

`correctionRunning` guards re-entry, since the two `executeCommand` calls
themselves fire tab and group events.

`restoreDelayMs` (default 400 ms) is the first setting to raise when the fix
stops working. `diagnostics` (default on) writes every event to the
"Claude Auto-Split Fix" output channel; the
`claudeAutoSplitFix.showOutput` command reveals it. That channel is the only
practical way to debug this, because the behaviour cannot be reproduced outside
a live editor.

`isClaudeTab` is deliberately broad: it tests `/claude/i` against the label,
the input's `viewType`, its `uri`, and its class name. A narrow anchored
pattern (`/^Claude Code\b/i`) is what missed the tab before.

The VS Code API exposes no group lock state (`TabGroup` has only `isActive`,
`viewColumn`, `activeTab`, `tabs`), so "was this group locked by Claude?"
-- the signal we actually want -- cannot be asked directly. If Anthropic changes
how the tab is opened, `isClaudeTab` and the identity wait are what break
first.
## Identity and naming

Four name variants appear in the history. Only the first is current:

| Name | Where | Status |
| --- | --- | --- |
| `claude-auto-split-fix` | `package.json`, repo folder | current |
| `undo-claude-autogroups` | historical only (VSIX archive removed) | retired |
| `vscode-undo-claude-autogroups` | historical only (pre-rebrand lockfile, not in the repo) | retired |
| `claude-tab-same-group` | historical only (VSIX archive removed) | retired |

- Extension ID is `publisher.name` → **`jbot-local.claude-auto-split-fix`**.
  Changing `name` mints a *different* extension, which is why the rebrand reset
  the version to `0.1.0` instead of continuing the old `0.2.x` line, and why
  `CHANGELOG.md` does not backfill the retired IDs' releases.
- Settings namespace is `claudeAutoSplitFix.*`. It lives in two places that
  must stay in sync: `CONFIG_SECTION` at `extension.js:4` and
  `contributes.configuration.properties` in `package.json`.
- New command IDs should use the same prefix (`claudeAutoSplitFix.*`), with
  palette category and output channel named "Claude Auto-Split Fix". No
  commands are contributed today.
- `extension.vsixmanifest` is **generated by vsce** at package time from
  `package.json`. Never hand-edit or commit one; a checked-in copy is stale
  cruft, not configuration.
- `publisher` is `jbot-local`, a placeholder for local VSIX installs. It must
  become a real publisher ID before any marketplace publish.

## Repo conventions

- The manifest lives at the **repo root**, so vsce resolves `README.md`,
  `CHANGELOG.md`, and `LICENSE` from there, and `extension.js` sits beside it. An
  earlier layout put `package.json` inside `src/`, which forced a duplicate
  marketplace readme; do not reintroduce that.
- `.vscodeignore` decides what ships. It must keep excluding `.claude/**` —
  the repo root can contain `.claude/worktrees/<name>/` holding a full second
  copy of this project, which vsce would otherwise crawl into the package.
  After changing it, check vsce's printed file list: the package should be
  exactly the manifest, `extension.js`, `icon.png`, README,
  CHANGELOG, and LICENSE.
- `@types/vscode` is pinned with `~` to the same minor as `engines.vscode`.
  A caret there resolves to the newest types and offers APIs that do not exist
  in the minimum supported VS Code.
- `icon.png` is a 128×128 downscale of `assets/new-icon.png`.
  Regenerate it from the master rather than editing it; the master stays out of
  the VSIX because it is ~1.4 MB.
- `dist/` holds the current build only. VSIX archives for the retired IDs are
  no longer kept in the repo.
