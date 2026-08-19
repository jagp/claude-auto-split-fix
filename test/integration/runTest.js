"use strict";

/**
 * Launcher for the real-VS-Code integration tests. What happens, in order:
 *
 *   1. Build a throwaway workspace in the OS temp dir holding three small
 *      text files the tests will open (a.txt, b.txt, c.txt).
 *   2. Download (first run only) and launch a test build of VS Code with
 *      this repo loaded as the extension under development. Marketplace
 *      extensions are disabled; the dev extension is not.
 *   3. VS Code runs test/integration/suite/index.js INSIDE the extension
 *      host, where require("vscode") is the real API. See that file for the
 *      actual checks.
 *   4. Exit 0 when every check passed, 1 otherwise.
 *
 * Run with `npm run test:vscode`. A VS Code window will open briefly.
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "suite");

  // A fresh workspace per run keeps prior layouts and trust state out of it.
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "casf-itest-"));
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    fs.writeFileSync(path.join(workspaceDir, name), `${name} test contents\n`);
  }

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        "--disable-extensions", // marketplace only; the dev extension still loads
        "--disable-workspace-trust", // no modal trust prompt over the temp folder
      ],
    });
  } catch (error) {
    console.error("Integration tests failed:", (error && error.message) || error);
    process.exit(1);
  }
}

main();
