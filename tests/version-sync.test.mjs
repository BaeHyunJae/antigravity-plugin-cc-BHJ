import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The plugin version lives in four unsynchronized files. They drifted once already;
// this keeps a release from shipping three different numbers.
function read(relative) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
}

test("every manifest reports the same plugin version", () => {
  const pkg = read("../package.json");
  const plugin = read("../plugins/antigravity/.claude-plugin/plugin.json");
  const marketplace = read("../.claude-plugin/marketplace.json");
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);

  assert.ok(entry, `marketplace.json has no entry for plugin "${plugin.name}"`);
  assert.deepEqual(
    {
      package: pkg.version,
      plugin: plugin.version,
      marketplaceMetadata: marketplace.metadata.version,
      marketplaceEntry: entry.version,
    },
    {
      package: pkg.version,
      plugin: pkg.version,
      marketplaceMetadata: pkg.version,
      marketplaceEntry: pkg.version,
    },
  );
});

test("the CHANGELOG documents the current version", () => {
  const pkg = read("../package.json");
  const changelog = readFileSync(
    fileURLToPath(new URL("../plugins/antigravity/CHANGELOG.md", import.meta.url)),
    "utf8",
  );
  assert.match(
    changelog,
    new RegExp(`^## \\[${pkg.version.replace(/\./g, "\\.")}\\]`, "m"),
    `CHANGELOG.md has no "## [${pkg.version}]" section`,
  );
});

test("the marketplace entry points at the plugin directory that holds the manifest", () => {
  const marketplace = read("../.claude-plugin/marketplace.json");
  const plugin = read("../plugins/antigravity/.claude-plugin/plugin.json");
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  assert.equal(entry.source, "./plugins/antigravity");
});
