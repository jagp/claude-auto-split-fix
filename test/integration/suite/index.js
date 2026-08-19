"use strict";

/**
 * Real-extension-host checks. This module runs INSIDE VS Code's extension
 * host (launched by ../runTest.js), so require("vscode") below is the real
 * API and the extension under test is genuinely activated - real tab events,
 * real input objects, real workbench commands, real timing.
 *
 * The four checks, each mirroring a unit-harness scenario that previously
 * only proved our MODEL of the API:
 *
 *   T1  the issue repro (anthropics/claude-code#33884): a not-open-anywhere
 *       file opened Beside lands alone in a new group -> the extension must
 *       pull it back, leaving ONE group holding both files.
 *   T2  the same document already visible in another group -> hands off.
 *   T3  the moveFileTabs opt-out -> hands off.
 *   T4  close-then-reopen within the drag window (the tab-model signature of
 *       a drag) -> hands off.
 *
 * Every check ends by closing all editors, then waiting out the drag window
 * so one check's close events cannot bleed into the next check's guards.
 */

const vscode = require("vscode");
const assert = require("assert");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The extension corrects ~200ms after the beside-open (150ms settle + 50ms
// unlock pause); 2s leaves generous slack for a busy test host.
const CORRECTION_WAIT_MS = 2000;
// Must exceed the extension's DRAG_CLOSE_WINDOW_MS (1500) so closes from one
// check age out before the next check begins.
const BETWEEN_CHECKS_MS = 2000;

function groupCount() {
  return vscode.window.tabGroups.all.length;
}

// Which group (if any) shows this document right now.
function groupShowing(uri) {
  const uriKey = String(uri);
  return vscode.window.tabGroups.all.find((group) =>
    group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputText && String(tab.input.uri) === uriKey
    )
  );
}

async function openInFirstGroup(uri) {
  await vscode.window.showTextDocument(uri, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
}

// The layout Claude Code's sidebar file links produce: the document opens
// beside the active group, creating a brand-new group holding just it.
async function openBeside(uri) {
  await vscode.window.showTextDocument(uri, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
}

module.exports.run = async function run() {
  const extension = vscode.extensions.getExtension("jbot-local.claude-auto-split-fix");
  assert.ok(extension, "extension jbot-local.claude-auto-split-fix not found in test host");
  await extension.activate();

  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
  const fileA = vscode.Uri.joinPath(workspaceRoot, "a.txt");
  const fileB = vscode.Uri.joinPath(workspaceRoot, "b.txt");
  const fileC = vscode.Uri.joinPath(workspaceRoot, "c.txt");

  const failures = [];
  async function check(name, body) {
    try {
      await body();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}: ${(error && error.message) || error}`);
      failures.push(name);
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(BETWEEN_CHECKS_MS);
  }

  await check("T1 beside-open of a new file is pulled back into group 1", async () => {
    await openInFirstGroup(fileA);
    await openBeside(fileB); // real new group + real new tab, as a link click would
    await sleep(CORRECTION_WAIT_MS);
    assert.strictEqual(
      groupCount(),
      1,
      `expected the split to be undone, but ${groupCount()} groups remain`
    );
    assert.ok(groupShowing(fileB), "b.txt is not open anywhere after the correction");
  });

  await check("T2 document already open in another group stays where it opened", async () => {
    await openInFirstGroup(fileA);
    await openInFirstGroup(fileB); // b visible in group 1...
    await openBeside(fileA); // ...and a beside-open of the OTHER visible doc
    await sleep(CORRECTION_WAIT_MS);
    assert.strictEqual(groupCount(), 2, "the deliberate-looking split was collapsed");
  });

  await check("T3 moveFileTabs=false leaves the split alone", async () => {
    const config = vscode.workspace.getConfiguration("claudeAutoSplitFix");
    await config.update("moveFileTabs", false, vscode.ConfigurationTarget.Global);
    try {
      await openInFirstGroup(fileA);
      await openBeside(fileB);
      await sleep(CORRECTION_WAIT_MS);
      assert.strictEqual(groupCount(), 2, "split was collapsed despite the opt-out");
    } finally {
      await config.update("moveFileTabs", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  await check("T4 close-then-reopen (drag signature) stays put", async () => {
    await openInFirstGroup(fileA);
    await openInFirstGroup(fileC);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor"); // closes c
    await sleep(100);
    await openBeside(fileC); // same document, moments after its close - reads as a drag
    await sleep(CORRECTION_WAIT_MS);
    assert.strictEqual(groupCount(), 2, "drag-signature split was collapsed");
  });

  if (failures.length > 0) {
    throw new Error(`${failures.length} integration check(s) failed: ${failures.join("; ")}`);
  }
  console.log("all integration checks passed");
};
