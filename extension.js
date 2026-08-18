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
 *      its document is not already visible in another group, because "already
 *      visible elsewhere" is what a deliberate split-to-the-side looks like.
 *   7. Unlock the group Claude locked, pause, then move the editor back.
 *
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const output = vscode.window.createOutputChannel("Claude Auto-Split Fix");
  const tabs = vscode.window.tabGroups;

  // Inputs, not Tab objects. VS Code may hand back a different Tab wrapper for
  // the same editor, but the input object is stable enough to identify "this
  // editor already existed".
  const knownInputs = new WeakSet();
  // group -> timestamp it was opened, so a stale group cannot trigger later.
  const pendingNewGroups = new Map();
  let correctionRunning = false;

  // How long a freshly opened group stays eligible to trigger a correction.
  const GROUP_ELIGIBLE_MS = 5000;
  // How long to keep waiting for Claude to stamp its identity on the tab.
  const IDENTITY_TIMEOUT_MS = 2500;
  const IDENTITY_POLL_MS = 100;
  // Breathing room between unlocking the group and moving the editor.
  const UNLOCK_SETTLE_MS = 50;

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
  // produces (anthropics/claude-code#33884). Diff editors, notebooks, and
  // custom editors stay out of scope on purpose - each extra input type is
  // another chance to fight a layout the user built deliberately.
  function isPlainFileTab(tab) {
    return !!(tab && tab.input instanceof vscode.TabInputText);
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

    await sleep(setting("restoreDelayMs", 400));

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
    // Acceptance: Claude's own tab always qualifies. Otherwise a plain file
    // tab can qualify (anthropics/claude-code#33884 - sidebar file links open
    // in a fresh group), but only when the user allows it and the document is
    // not already showing in another group.
    if (!isClaudeTab(activeTab)) {
      if (!isPlainFileTab(activeTab)) {
        log(`SKIP ${reason}: neither a Claude tab nor a plain file: ${describeTab(activeTab)}`);
        return;
      }
      if (!setting("moveFileTabs", true)) {
        log(`SKIP ${reason}: file tab, moveFileTabs is off: ${describeTab(activeTab)}`);
        return;
      }
      if (uriOpenInAnotherGroup(activeTab, activeGroup)) {
        log(`SKIP ${reason}: document already open in another group: ${describeTab(activeTab)}`);
        return;
      }
    }

    correctionRunning = true;
    try {
      log(`CORRECT ${reason}: ${describeTab(activeTab)}`);
      // Claude locks the group programmatically, so unlock before moving.
      // A file-link group may arrive unlocked; unlocking is then a no-op.
      await vscode.commands.executeCommand("workbench.action.unlockEditorGroup");
      await sleep(UNLOCK_SETTLE_MS);
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
        log(`GROUP opened tabs=${group.tabs.length} active=${group.isActive}`);
      }
      for (const group of event.closed) pendingNewGroups.delete(group);

      // Forget groups that never received a qualifying tab.
      for (const [group, created] of pendingNewGroups) {
        if (now - created > GROUP_ELIGIBLE_MS) pendingNewGroups.delete(group);
      }
    }),

    tabs.onDidChangeTabs((event) => {
      for (const tab of event.opened) {
        const inputWasKnown = !!tab.input && knownInputs.has(tab.input);
        log(`OPEN knownInput=${inputWasKnown} ${describeTab(tab)}`);
        if (tab.input && typeof tab.input === "object") knownInputs.add(tab.input);

        const group = tabs.all.find((candidate) => candidate.tabs.includes(tab));
        const openedAt = group && pendingNewGroups.get(group);
        const isRecentNewGroup =
          openedAt !== undefined && Date.now() - openedAt < GROUP_ELIGIBLE_MS;

        // A drag reuses an existing input, so inputWasKnown filters it out.
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
