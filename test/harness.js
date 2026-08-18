"use strict";

/**
 * Node-only regression harness for extension.js. No VS Code required.
 *
 * How this works, start to finish:
 *
 *   1. `require("vscode")` only resolves inside a real extension host, so we
 *      intercept Module._load and hand extension.js a hand-built mock instead.
 *   2. Each scenario builds a fresh mock world (tab groups, settings), loads a
 *      fresh copy of the extension, and activates it.
 *   3. The scenario then replays tab/group events in the same order VS Code
 *      fires them: the new group appears first, then the tab arrives inside it.
 *   4. Timers are real. The extension waits `restoreDelayMs` and polls for a
 *      Claude identity, so scenarios sleep past those windows before asserting.
 *   5. The one observable that matters: did the extension execute
 *      workbench.action.moveEditorToPreviousGroup, or not.
 *
 * Run with `npm test` (or `node test/harness.js`). Exit 0 means every scenario
 * matched its expectation.
 */

const path = require("path");
const Module = require("module");

const EXTENSION_PATH = path.resolve(__dirname, "..", "extension.js");
const MOVE_COMMAND = "workbench.action.moveEditorToPreviousGroup";

// ---------------------------------------------------------------------------
// vscode API mock — exactly the slice extension.js touches, nothing more.
// ---------------------------------------------------------------------------

// Real tab inputs are class instances; the extension distinguishes them with
// instanceof, so the mock must use real classes too, not plain objects.
class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}
class TabInputWebview {
  constructor(viewType) {
    this.viewType = viewType;
  }
}

// A minimal stand-in for vscode.Uri: the extension reads .scheme and
// stringifies the rest. Default scheme "file", like a real workspace file.
function makeUri(filePath, scheme) {
  const uriScheme = scheme || "file";
  return { scheme: uriScheme, toString: () => `${uriScheme}://${filePath}` };
}

function makeVscode(settings) {
  const executedCommands = []; // every commands.executeCommand call lands here
  const tabListeners = []; // onDidChangeTabs subscribers
  const groupListeners = []; // onDidChangeTabGroups subscribers

  const tabGroups = {
    all: [],
    activeTabGroup: undefined,
    onDidChangeTabGroups(listener) {
      groupListeners.push(listener);
      return { dispose() {} };
    },
    onDidChangeTabs(listener) {
      tabListeners.push(listener);
      return { dispose() {} };
    },
  };

  const vscodeMock = {
    TabInputText,
    TabInputWebview,
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {} }),
      showWarningMessage() {},
      tabGroups,
    },
    workspace: {
      // Settings not named by the scenario fall through to the extension's
      // own defaults, same as an untouched settings.json would.
      getConfiguration: () => ({
        get: (key, fallback) => (key in settings ? settings[key] : fallback),
      }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async (command) => {
        executedCommands.push(command);
      },
    },
  };

  return {
    vscodeMock,
    executedCommands,
    tabGroups,
    fireTabs: (event) => tabListeners.forEach((listener) => listener(event)),
    fireGroups: (event) => groupListeners.forEach((listener) => listener(event)),
  };
}

// ---------------------------------------------------------------------------
// Module interception — swap the unresolvable "vscode" for the current mock.
// ---------------------------------------------------------------------------

let activeVscodeMock = null;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return activeVscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};

function loadExtension(vscodeMock) {
  activeVscodeMock = vscodeMock;
  delete require.cache[EXTENSION_PATH]; // fresh closure state per scenario
  return require(EXTENSION_PATH);
}

// ---------------------------------------------------------------------------
// World-building helpers.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeGroup(viewColumn) {
  return { viewColumn, isActive: false, tabs: [], activeTab: undefined };
}

function makeFileTab(filePath, scheme) {
  return {
    label: path.basename(filePath),
    isActive: false,
    input: new TabInputText(makeUri(filePath, scheme)),
  };
}

// Standard opening position: one editor group holding one ordinary file, the
// state a user is in right before Claude opens anything.
function stage(settings) {
  const harness = makeVscode(settings);
  const groupOne = makeGroup(1);
  const existingTab = makeFileTab("/project/existing.js");
  existingTab.isActive = true;
  groupOne.tabs.push(existingTab);
  groupOne.activeTab = existingTab;
  groupOne.isActive = true;
  harness.tabGroups.all.push(groupOne);
  harness.tabGroups.activeTabGroup = groupOne;

  const extension = loadExtension(harness.vscodeMock);
  extension.activate({ subscriptions: [] });
  return { ...harness, groupOne, existingTab };
}

// Open `tab` alone in a brand-new group appended after the existing groups,
// in the event order the shipped Claude flow exhibits: group-opened fires,
// then the tab-opened event for the tab inside it.
function openInNewGroup(harness, tab) {
  const previousActive = harness.tabGroups.activeTabGroup;
  if (previousActive) previousActive.isActive = false;
  const newGroup = makeGroup(harness.tabGroups.all.length + 1);
  newGroup.isActive = true;
  harness.tabGroups.all.push(newGroup);
  harness.tabGroups.activeTabGroup = newGroup;
  harness.fireGroups({ opened: [newGroup], closed: [], changed: [] });

  tab.isActive = true;
  newGroup.tabs.push(tab);
  newGroup.activeTab = tab;
  harness.fireTabs({ opened: [tab], closed: [], changed: [] });
  return newGroup;
}

// ---------------------------------------------------------------------------
// Scenario runner — each scenario returns "did the move command run".
// ---------------------------------------------------------------------------

const results = [];

async function scenario(name, expectMoved, run) {
  const moved = await run();
  const pass = moved === expectMoved;
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} (moved=${moved}, expected=${expectMoved})`);
}

async function main() {
  // S1: the issue itself (anthropics/claude-code#33884). A file link clicked in
  // the Claude Code sidebar opens a never-before-seen file alone in a fresh
  // group. The extension should pull it back into the previous group.
  await scenario("S1 new file alone in new group -> moved", true, async () => {
    const harness = stage({ restoreDelayMs: 0 });
    openInNewGroup(harness, makeFileTab("/project/linked.js"));
    await sleep(400);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S2: same event flow, but the user opted out via moveFileTabs.
  await scenario("S2 moveFileTabs off -> not moved", false, async () => {
    const harness = stage({ restoreDelayMs: 0, moveFileTabs: false });
    openInNewGroup(harness, makeFileTab("/project/linked.js"));
    await sleep(400);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S3: the same document is already visible in another group. That layout is
  // what "split the current file to the side" produces, so the correction must
  // stand down even though the tab input object itself is brand-new.
  await scenario("S3 uri already open elsewhere -> not moved", false, async () => {
    const harness = stage({ restoreDelayMs: 0 });
    openInNewGroup(harness, makeFileTab("/project/existing.js"));
    await sleep(400);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S4: regression guard for the original feature. Claude's own tab opens
  // blank and only gains its identity a beat later; it must still be moved.
  await scenario("S4 Claude tab gains identity late -> moved", true, async () => {
    const harness = stage({ restoreDelayMs: 0 });
    const claudeTab = {
      label: "",
      isActive: false,
      input: new TabInputWebview("mainThreadWebview"),
    };
    openInNewGroup(harness, claudeTab);
    setTimeout(() => {
      claudeTab.label = "Claude Code"; // the late identity stamp
    }, 50);
    await sleep(700);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S5: a cross-group drag as the REAL extension host models it: the tab
  // closes in its old group and reopens in the new one with a brand-new
  // input object (VS Code recreates inputs freely, so object identity proves
  // nothing). The closed-URI correlation is what must catch this.
  await scenario("S5 dragged tab (close+reopen signature) -> not moved", false, async () => {
    const harness = stage({});
    const departedTab = harness.existingTab;
    harness.groupOne.tabs = [];
    harness.groupOne.activeTab = undefined;
    harness.fireTabs({ opened: [], closed: [departedTab], changed: [] });
    const draggedTab = makeFileTab("/project/existing.js"); // fresh input, same doc
    openInNewGroup(harness, draggedTab);
    await sleep(500);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S6: a second tab joins the new group before the file settle (150 ms)
  // elapses. The group is no longer "a lone unwanted split"; leave it alone.
  await scenario("S6 second tab arrives during delay -> not moved", false, async () => {
    const harness = stage({});
    const groupTwo = openInNewGroup(harness, makeFileTab("/project/first.js"));
    setTimeout(() => {
      const secondTab = makeFileTab("/project/second.js");
      secondTab.isActive = true;
      groupTwo.tabs[0].isActive = false;
      groupTwo.tabs.push(secondTab);
      groupTwo.activeTab = secondTab;
      harness.fireTabs({ opened: [secondTab], closed: [], changed: [] });
    }, 40);
    await sleep(700);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S7: the master switch wins over everything.
  await scenario("S7 enabled=false -> not moved", false, async () => {
    const harness = stage({ enabled: false, restoreDelayMs: 0 });
    openInNewGroup(harness, makeFileTab("/project/linked.js"));
    await sleep(400);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S8: a FILE whose path contains "claude" must obey the file rules - here
  // the user's opt-out - instead of riding the Claude-tab fast path. Before
  // the isClaudeTab TabInputText early-return, this scenario moved.
  await scenario("S8 claude-named file respects moveFileTabs off -> not moved", false, async () => {
    const harness = stage({ moveFileTabs: false });
    openInNewGroup(harness, makeFileTab("/project/claude-notes.md"));
    await sleep(500);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S9: a claude-named file already visible in another group must hit the
  // already-open-elsewhere guard, not bypass it via /claude/i.
  await scenario("S9 claude-named file open elsewhere -> not moved", false, async () => {
    const harness = stage({});
    const claudeDocTab = makeFileTab("/project/CLAUDE.md");
    harness.groupOne.tabs.push(claudeDocTab);
    harness.fireTabs({ opened: [claudeDocTab], closed: [], changed: [] });
    openInNewGroup(harness, makeFileTab("/project/CLAUDE.md")); // fresh input, same doc
    await sleep(500);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S10: two file links clicked in quick succession, each spawning its own
  // group. "Previous group" is untrustworthy for the second one (it would
  // land in the FIRST unwanted split, not the user's editing group), so the
  // extension must do nothing at all rather than move a file somewhere wrong.
  await scenario("S10 two new groups in flight -> nothing moved", false, async () => {
    const harness = stage({});
    openInNewGroup(harness, makeFileTab("/project/first.js"));
    setTimeout(() => {
      openInNewGroup(harness, makeFileTab("/project/second.js"));
    }, 40);
    await sleep(700);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S11: virtual documents (gitlens revision views etc.) are TabInputText
  // with a non-file scheme - other extensions open them beside on purpose.
  await scenario("S11 non-file scheme document -> not moved", false, async () => {
    const harness = stage({});
    openInNewGroup(harness, makeFileTab("/project/thing.js", "gitlens"));
    await sleep(500);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  // S12: the positive complement of S8/S9 - a claude-named file with default
  // settings and no guard tripped is still an ordinary file link and MOVES.
  // Proves the claude-named cases above fail for the right reason.
  await scenario("S12 claude-named file, defaults -> moved", true, async () => {
    const harness = stage({});
    openInNewGroup(harness, makeFileTab("/project/claude-notes.md"));
    await sleep(500);
    return harness.executedCommands.includes(MOVE_COMMAND);
  });

  const failures = results.filter((result) => !result.pass);
  if (failures.length > 0) {
    console.error(`${failures.length} scenario(s) failed`);
    process.exit(1);
  }
  console.log(`all ${results.length} scenarios passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
