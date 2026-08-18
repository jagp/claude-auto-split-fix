const vscode = require("vscode");

const CONFIG_SECTION = "claudeAutoSplitFix";

/**
 * The whole extension in one activation closure.
 *
 * Pseudocode for what this does, because the timing is the hard part:
 *
 *   1. Remember every tab input that already exists, so we can later tell a
 *      brand-new tab from one the user merely dragged somewhere else.
 *   2. When a new editor group appears, note it and the moment it appeared.
 *   3. When a tab opens inside a group that appeared moments ago, and that
 *      tab's input is one we have never seen, treat it as a candidate.
 *   4. Wait. Claude opens a *blank* tab first and only assigns the
 *      "Claude Code" identity a few hundred milliseconds later, so asking
 *      "is this Claude?" immediately always answers no. Poll until the
 *      identity shows up or we give up.
 *   5. Re-check that the candidate is still the sole, active tab in the
 *      still-active group. If the user has touched anything, do nothing.
 *   6. Accept the candidate if it is Claude's own tab - or, new for
 *      anthropics/claude-code#33884, a plain file tab: a file link clicked in
 *      the Claude Code sidebar opens the file alone in a fresh group, the same
 *      unwanted split with a different tab type. A file only qualifies when
 *      every guard agrees it is not the user's own doing: real-file URI
 *      scheme, document not already visible in another group (a deliberate
 *      split looks like that), no same-document close moments ago (a drag
 *      looks like that), and no OTHER group born moments ago (then "previous
 *      group" would point at the wrong place).
 *   7. Unlock the group Claude locked, pause, re-confirm focus never moved,
 *      then move the editor back - unless this group has no previous group,
 *      in which case the move would create yet another split.
 *
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const output = vscode.window.createOutputChannel("Claude Auto-Split Fix");
  const tabs = vscode.window.tabGroups;

  // Inputs, not Tab objects. VS Code may hand back a different Tab wrapper for
  // the same editor. Beware: the extension host also recreates INPUT objects
  // freely (every tab update makes a fresh one), so this filter is
  // best-effort only - it must never be the sole guard for anything.
  const knownInputs = new WeakSet();
  // group -> timestamp it was opened, so a stale group cannot trigger later.
  // Consumed (deleted) as soon as a candidate tab appears in the group.
  const pendingNewGroups = new Map();
  // Same timestamps, but NOT consumed at candidacy: the accept step scans
  // this to notice when several splits appeared at nearly the same moment,
  // which makes "move to previous group" point somewhere untrustworthy.
  const recentGroupCreations = new Map();
  // uri string -> when a tab showing that document closed. A cross-group drag
  // surfaces in the tab model as open-in-new-group + close-in-old-group with
  // brand-new input objects, so the close half is the only reliable drag
  // signature. See the drag guard in correct().
  const recentlyClosedUris = new Map();
  let correctionRunning = false;

  // How long a freshly opened group stays eligible to trigger a correction.
  const GROUP_ELIGIBLE_MS = 5000;
  // How long to keep waiting for Claude to stamp its identity on the tab.
  const IDENTITY_TIMEOUT_MS = 2500;
  const IDENTITY_POLL_MS = 100;
  // Breathing room between unlocking the group and moving the editor.
  const UNLOCK_SETTLE_MS = 50;
  // A plain file tab needs no identity wait, only a short settle. This is
  // also how long the file visibly sits in the wrong group, so keep it small.
  const FILE_SETTLE_MS = 150;
  // How recent (ms) a same-document close must be to read as a drag.
  const DRAG_CLOSE_WINDOW_MS = 1500;
  // URI schemes that count as "a plain file". Virtual documents from other
  // extensions (gitlens:, search-editor:, ...) are opened beside on purpose
  // by those extensions - never by a Claude file link - so leave them be.
  const PLAIN_FILE_SCHEMES = ["file", "vscode-remote", "vscode-vfs"];

  const config = () => vscode.workspace.getConfiguration(CONFIG_SECTION);
  const setting = (key, fallback) => config().get(key, fallback);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function log(message) {
    if (setting("diagnostics", true)) {
      output.appendLine(`${new Date().toISOString()} ${message}`);
    }
  }

  // Render an input for the log without throwing on exotic input types.
  function inputDetails(input) {
    if (!input) return "input=<none>";
    const ctor = (input.constructor && input.constructor.name) || "unknown";
    const fields = [];
    for (const key of ["viewType", "uri"]) {
      try {
        const value = input[key];
        if (value !== undefined) fields.push(`${key}=${String(value)}`);
      } catch {}
    }
    return `input=${ctor}${fields.length ? " " + fields.join(" ") : ""}`;
  }

  function describeTab(tab) {
    return `label=${JSON.stringify(tab && tab.label)} active=${!!(tab && tab.isActive)} ${inputDetails(tab && tab.input)}`;
  }

  // Deliberately broad: match "claude" anywhere in the label, the webview
  // viewType, the uri, or even the input's class name. A narrow, anchored
  // pattern is what made the previous version miss the tab entirely.
  function isClaudeTab(tab) {
    if (!tab) return false;
    // A plain text-file tab is never Claude's conversation tab, no matter
    // what its PATH says. Without this, CLAUDE.md - or any file inside a
    // claude-named repo - would match /claude/i below and ride the Claude
    // fast path straight past every file guard, including the user's own
    // moveFileTabs opt-out.
    if (tab.input instanceof vscode.TabInputText) return false;
    const input = tab.input;
    const values = [tab.label];
    if (input) {
      for (const key of ["viewType", "uri"]) {
        try {
          values.push(String(input[key] === undefined ? "" : input[key]));
        } catch {}
      }
      values.push((input.constructor && input.constructor.name) || "");
    }
    return values.some((value) => /claude/i.test(String(value)));
  }

  // A "plain file" tab: exactly the TabInputText case a clicked file link
  // produces (anthropics/claude-code#33884), restricted to real-file URI
  // schemes. Diff editors, notebooks, custom editors, and virtual documents
  // stay out of scope on purpose - each extra input type is another chance
  // to fight a layout the user (or another extension) built deliberately.
  function isPlainFileTab(tab) {
    if (!tab || !(tab.input instanceof vscode.TabInputText)) return false;
    const uri = tab.input.uri;
    return !!uri && PLAIN_FILE_SCHEMES.includes(String(uri.scheme));
  }

  // True when the same document is already visible in some other group. That
  // layout is what "split the current file to the side" produces, so a new tab
  // matching it is almost certainly the user's own split, not a Claude file
  // link - the correction must stand down. Compares URIs as strings because
  // input *objects* are not stable across opens (see knownInputs above).
  function uriOpenInAnotherGroup(tab, homeGroup) {
    const uriKey = String(tab.input.uri);
    for (const group of tabs.all) {
      if (group === homeGroup) continue; // only *other* groups matter
      for (const otherTab of group.tabs) {
        if (
          otherTab.input instanceof vscode.TabInputText &&
          String(otherTab.input.uri) === uriKey
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function rememberExistingInputs() {
    for (const group of tabs.all) {
      for (const tab of group.tabs) {
        if (tab.input && typeof tab.input === "object") knownInputs.add(tab.input);
      }
    }
  }

  async function correct(group, openedTab, reason) {
    if (correctionRunning) return;
    if (!setting("enabled", true)) return;

    // Claude's blank tab needs the full user-configurable delay because its
    // identity arrives a few hundred ms after opening. A tab that is ALREADY
    // a plain file needs only a short settle - which also shrinks how long
    // the file visibly sits in the wrong group before being pulled back.
    await sleep(isPlainFileTab(openedTab) ? FILE_SETTLE_MS : setting("restoreDelayMs", 400));

    // Claude's tab is blank at first and gains its identity shortly after.
    // Wait for that rather than rejecting it during the blank phase. A plain
    // file tab needs no such wait - the file itself is the identity - so the
    // loop exits immediately for the file-link case.
    const deadline = Date.now() + IDENTITY_TIMEOUT_MS;
    while (!isClaudeTab(openedTab) && !isPlainFileTab(openedTab) && Date.now() < deadline) {
      await sleep(IDENTITY_POLL_MS);
    }

    // Ask the API what is active right now instead of comparing against group
    // objects we stored earlier - those comparisons are what break.
    const activeGroup = tabs.activeTabGroup;
    const activeTab = activeGroup && activeGroup.activeTab;

    if (activeGroup !== group || activeTab !== openedTab || group.tabs.length !== 1) {
      log(`SKIP ${reason}: no longer the sole active tab; active=${describeTab(activeTab)}`);
      return;
    }
    // Acceptance. Two kinds of tab qualify, each with its own rules:
    //   - a plain file tab (anthropics/claude-code#33884: sidebar file links
    //     open the file alone in a fresh group), carrying extra guards
    //     because ordinary user gestures can produce the same signature;
    //   - Claude's own conversation tab, the original feature, unchanged.
    // Files are checked FIRST on purpose: a file whose path merely contains
    // "claude" must use the file rules, never the Claude fast path.
    if (isPlainFileTab(activeTab)) {
      if (!setting("moveFileTabs", true)) {
        log(`SKIP ${reason}: file tab, moveFileTabs is off: ${describeTab(activeTab)}`);
        return;
      }
      if (uriOpenInAnotherGroup(activeTab, activeGroup)) {
        log(`SKIP ${reason}: document already open in another group: ${describeTab(activeTab)}`);
        return;
      }
      // Drag guard: a cross-group drag is open-here + close-there for the
      // same document, with input objects recreated - the close event is the
      // only part a drag cannot disguise. See recentlyClosedUris above.
      const closedAt = recentlyClosedUris.get(String(activeTab.input.uri));
      if (closedAt !== undefined && Date.now() - closedAt <= DRAG_CLOSE_WINDOW_MS) {
        log(`SKIP ${reason}: same document closed elsewhere moments ago (a drag?): ${describeTab(activeTab)}`);
        return;
      }
      // Multi-split guard: if ANOTHER group also appeared moments ago,
      // "previous group" may point at that split instead of the user's real
      // editing group, and moving would land the file somewhere wrong.
      for (const [recentGroup, createdAt] of recentGroupCreations) {
        if (recentGroup !== activeGroup && Date.now() - createdAt <= GROUP_ELIGIBLE_MS) {
          log(`SKIP ${reason}: multiple new groups in flight; move target untrustworthy`);
          return;
        }
      }
    } else if (!isClaudeTab(activeTab)) {
      log(`SKIP ${reason}: neither a Claude tab nor a plain file: ${describeTab(activeTab)}`);
      return;
    }

    // With no group before this one, "move to previous" does not fail
    // quietly - VS Code CREATES a group on the other side and moves the
    // editor there, churning the layout. Doing nothing beats that.
    if (tabs.all.indexOf(activeGroup) <= 0) {
      log(`SKIP ${reason}: no previous group to move into`);
      return;
    }

    correctionRunning = true;
    try {
      log(`CORRECT ${reason}: ${describeTab(activeTab)}`);
      // Claude locks the group programmatically, so unlock before moving.
      // A file-link group may arrive unlocked; unlocking is then a no-op.
      await vscode.commands.executeCommand("workbench.action.unlockEditorGroup");
      await sleep(UNLOCK_SETTLE_MS);
      // Last look before pulling the trigger: the move command acts on
      // whatever editor is active AT THIS INSTANT. If focus moved during the
      // waits above, aborting beats relocating the user's editor.
      if (tabs.activeTabGroup !== activeGroup || tabs.activeTabGroup.activeTab !== activeTab) {
        log(`SKIP ${reason}: focus moved during correction; aborting`);
        return;
      }
      await vscode.commands.executeCommand("workbench.action.moveEditorToPreviousGroup");
      log("CORRECT completed");
    } catch (error) {
      output.appendLine(`ERROR correction failed: ${(error && error.stack) || error}`);
      output.show(true);
      vscode.window.showWarningMessage(
        `Could not relocate the new Claude tab: ${(error && error.message) || error}`
      );
    } finally {
      correctionRunning = false;
    }
  }

  rememberExistingInputs();
  log(`activated; groups=${tabs.all.length}`);

  context.subscriptions.push(
    output,

    vscode.commands.registerCommand(`${CONFIG_SECTION}.showOutput`, () => output.show()),

    tabs.onDidChangeTabGroups((event) => {
      const now = Date.now();
      for (const group of event.opened) {
        pendingNewGroups.set(group, now);
        recentGroupCreations.set(group, now); // kept for the multi-split guard
        log(`GROUP opened tabs=${group.tabs.length} active=${group.isActive}`);
      }
      for (const group of event.closed) {
        pendingNewGroups.delete(group);
        recentGroupCreations.delete(group);
      }

      // Forget groups that never received a qualifying tab, or are too old
      // for the multi-split guard to care about.
      for (const [group, created] of pendingNewGroups) {
        if (now - created > GROUP_ELIGIBLE_MS) pendingNewGroups.delete(group);
      }
      for (const [group, created] of recentGroupCreations) {
        if (now - created > GROUP_ELIGIBLE_MS) recentGroupCreations.delete(group);
      }
    }),

    tabs.onDidChangeTabs((event) => {
      const now = Date.now();

      // Remember which documents just lost a tab somewhere. A cross-group
      // drag is "closed in the old group + opened in the new one", and the
      // close half is the only part fresh input objects cannot disguise.
      for (const tab of event.closed) {
        if (tab.input instanceof vscode.TabInputText && tab.input.uri) {
          recentlyClosedUris.set(String(tab.input.uri), now);
        }
      }
      for (const [uriKey, closedAt] of recentlyClosedUris) {
        if (now - closedAt > DRAG_CLOSE_WINDOW_MS) recentlyClosedUris.delete(uriKey);
      }

      for (const tab of event.opened) {
        const inputWasKnown = !!tab.input && knownInputs.has(tab.input);
        log(`OPEN knownInput=${inputWasKnown} ${describeTab(tab)}`);
        if (tab.input && typeof tab.input === "object") knownInputs.add(tab.input);

        const group = tabs.all.find((candidate) => candidate.tabs.includes(tab));
        const openedAt = group && pendingNewGroups.get(group);
        const isRecentNewGroup =
          openedAt !== undefined && Date.now() - openedAt < GROUP_ELIGIBLE_MS;

        // A drag would ideally reuse an existing input, but VS Code recreates
        // input objects freely, so inputWasKnown is best-effort only - the
        // real drag protection is the closed-URI correlation in correct().
        if (group && isRecentNewGroup && !inputWasKnown) {
          pendingNewGroups.delete(group);
          void correct(group, tab, "new group + new input");
        }
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
