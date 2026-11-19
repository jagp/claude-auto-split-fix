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

// The publish workflow runs `vsce publish --oidc`; v0.4.0's run died because
// the locked vsce predated that flag. Fail here, before a tag is pushed.
const help = execSync("npx vsce publish --help", { encoding: "utf8" });
if (!/--oidc\b/.test(help)) {
  console.error("FAIL vsce publish lacks --oidc (Trusted Publishing); upgrade @vscode/vsce");
  process.exit(1);
}
console.log("PASS vsce supports --oidc");
