// Pins the VSIX file list: exactly the six files CLAUDE.md names. Catches
// stray working directories (e.g. .remember/, .claude/worktrees/) leaking in.
const { execSync } = require("child_process");
const expected = ["CHANGELOG.md", "LICENSE", "README.md", "extension.js", "icon.png", "package.json"];
const actual = execSync("npx vsce ls --no-dependencies", { encoding: "utf8" })
  .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).sort();
const extra = actual.filter((f) => !expected.includes(f));
const missing = expected.filter((f) => !actual.includes(f));
if (extra.length || missing.length) {
  console.error(`FAIL package contents: extra=${JSON.stringify(extra)} missing=${JSON.stringify(missing)}`);
  process.exit(1);
}
console.log(`PASS package contents: ${actual.length} files`);
