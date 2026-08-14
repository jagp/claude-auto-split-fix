const vscode = require("vscode");

// Settings namespace, mirrored in package.json's contributes.configuration.
const CONFIG_SECTION = "claudeAutoSplitFix";

const pendingNewGroups = new Set();
const handledTabs = new WeakSet();
const knownTabs = new WeakSet();
let correctionInProgress = false;

function setting(key, fallback) {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get(key, fallback);
}

function enabled() {
  return setting("enabled", true);
}

function isClaudeTab(tab) {
  const labelMatches = /^Claude Code(?:\b|$)/i.test(tab.label);
  const input = tab.input;
  const viewTypeMatches =
    input instanceof vscode.TabInputWebview &&
    /claude/i.test(input.viewType);

  return labelMatches || viewTypeMatches;
}

function findGroupForTab(tab) {
  return vscode.window.tabGroups.all.find((group) =>
    group.tabs.includes(tab)
  );
}

async function correctPlacement(tab) {
  if (correctionInProgress || handledTabs.has(tab)) return;

  const group = findGroupForTab(tab);
  if (!group || !pendingNewGroups.has(group)) return;

  // Only undo Claude's one-tab split. If anything else has entered the group,
  // leave the user's layout alone.
  if (group.tabs.length !== 1 || group.tabs[0] !== tab) return;
  if (!group.isActive || !tab.isActive) return;

  handledTabs.add(tab);
  pendingNewGroups.delete(group);
  correctionInProgress = true;

  try {
    // Claude locks the newly created group programmatically. Unlock it first,
    // then move its sole editor into the preceding group. VS Code removes the
    // now-empty split automatically.
    await vscode.commands.executeCommand("workbench.action.unlockEditorGroup");
    await vscode.commands.executeCommand(
      "workbench.action.moveEditorToPreviousGroup"
    );
  } catch (error) {
    console.error("Claude Auto-Split Fix failed:", error);
    vscode.window.showWarningMessage(
      `Could not relocate the new Claude tab: ${error.message || error}`
    );
  } finally {
    correctionInProgress = false;
  }
}

function scheduleNewClaudeTabs(tabs) {
  const restoreDelayMs = setting("restoreDelayMs", 100);

  for (const tab of tabs) {
    const isNewTab = !knownTabs.has(tab);
    knownTabs.add(tab);

    // A manual drag into the editor drop zone creates a new group but moves an
    // existing Tab object. Only Claude's toolbar action creates both a group
    // and a genuinely new Claude tab.
    if (isNewTab && isClaudeTab(tab)) {
      setTimeout(() => correctPlacement(tab), restoreDelayMs);
    }
  }
}

function activate(context) {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) knownTabs.add(tab);
  }

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups((event) => {
      if (!enabled()) return;
      for (const group of event.opened) {
        pendingNewGroups.add(group);
        // Depending on VS Code's event ordering, the group may already contain
        // its first tab when the group-open event reaches us.
        scheduleNewClaudeTabs(group.tabs);
      }
      for (const group of event.closed) pendingNewGroups.delete(group);
    }),

    vscode.window.tabGroups.onDidChangeTabs((event) => {
      if (!enabled()) return;
      scheduleNewClaudeTabs(event.opened);
    })
  );
}

function deactivate() { }

module.exports = { activate, deactivate };
