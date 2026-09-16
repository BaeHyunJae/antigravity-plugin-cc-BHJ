#!/usr/bin/env node
// Regenerate the flag and subcommand tables in docs/antigravity-cli-reference.md
// from the installed `agy --help`.
//
// The 0.1.0 reference drifted from 1.0.3 to 1.2.3 with nobody noticing, and half of
// that drift was one hand-maintained flag table. This makes that table derived, and
// CI fails when the committed copy no longer matches the installed CLI. It earned its
// keep the day it was written: agy auto-updated 1.2.3 -> 1.2.4 a few hours later and
// --check caught the stale version stamp immediately.
//
//   npm run gen:cli-ref          # rewrite the generated blocks
//   npm run gen:cli-ref -- --check   # exit 1 if they are out of date
//
// Stdlib only, like the rest of this repo.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveAgyBinary } from "../plugins/antigravity/scripts/lib/paths.mjs";

const DOC = fileURLToPath(new URL("../docs/antigravity-cli-reference.md", import.meta.url));

const BLOCKS = {
  "agy-flags": renderFlagTable,
  "agy-subcommands": renderSubcommandTable,
};

function agyHelp(binPath) {
  const res = spawnSync(binPath, ["--help"], { encoding: "utf8", timeout: 30000, windowsHide: true });
  // agy prints its usage on stderr on some platforms; take whichever is non-empty.
  const text = [res.stdout, res.stderr].filter((s) => s && s.trim()).join("\n");
  if (!text.trim()) throw new Error("`agy --help` produced no output");
  return text;
}

function agyVersion(binPath) {
  const res = spawnSync(binPath, ["--version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
  return ((res.stdout || res.stderr || "").trim().split(/\r?\n/)[0] || "unknown").trim();
}

/** Split `agy --help` into its flag section and its subcommand section. */
function parseHelp(text) {
  const flags = [];
  const subcommands = [];
  let inSubcommands = false;

  for (const raw of text.split(/\r?\n/)) {
    if (/^Available subcommands:/i.test(raw.trim())) {
      inSubcommands = true;
      continue;
    }
    if (/^Usage of/i.test(raw.trim())) {
      inSubcommands = false;
      continue;
    }

    const entry = raw.match(/^\s{2,}(\S+)\s{2,}(.+?)\s*$/);
    if (!entry) continue;
    const [, name, description] = entry;

    if (inSubcommands) {
      if (name.startsWith("-")) continue;
      subcommands.push({ name, description });
    } else {
      if (!name.startsWith("-")) continue;
      flags.push({ name, description });
    }
  }

  return { flags, subcommands };
}

function escapeCell(s) {
  return s.replace(/\|/g, "\\|");
}

function renderFlagTable({ flags }) {
  const rows = flags.map(({ name, description }) => {
    const defaultMatch = description.match(/\s*\(default (.+)\)\s*$/);
    let text = defaultMatch ? description.slice(0, defaultMatch.index).trim() : description;
    if (defaultMatch && !/[.!?]$/.test(text)) text += ".";
    const note = defaultMatch ? ` Default: \`${defaultMatch[1]}\`.` : "";
    return `| \`${name}\` | ${escapeCell(text)}${escapeCell(note)} |`;
  });
  return ["| Flag | Meaning |", "| --- | --- |", ...rows].join("\n");
}

function renderSubcommandTable({ subcommands }) {
  const seen = new Set();
  const rows = [];
  for (const { name, description } of subcommands) {
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push(`| \`${name}\` | ${escapeCell(description)} |`);
  }
  return ["| Subcommand | Meaning |", "| --- | --- |", ...rows].join("\n");
}

function replaceBlock(doc, id, body, version) {
  const open = `<!-- generated:${id} -->`;
  const close = `<!-- /generated:${id} -->`;
  const start = doc.indexOf(open);
  const end = doc.indexOf(close);
  if (start === -1 || end === -1) {
    throw new Error(`docs/antigravity-cli-reference.md is missing the ${id} markers`);
  }
  const note = `_Generated from \`agy --help\` (${version}) by \`npm run gen:cli-ref\`. Do not edit by hand._`;
  return doc.slice(0, start + open.length) + `\n\n${note}\n\n${body}\n\n` + doc.slice(end);
}

function main() {
  const check = process.argv.includes("--check");
  const bin = resolveAgyBinary();
  if (!bin) {
    console.error("agy not found — skipping. Set ANTIGRAVITY_CC_AGY_BIN to point at it.");
    process.exit(check ? 0 : 1); // in --check (CI) a missing agy is not a failure
  }

  const version = agyVersion(bin.path);
  const parsed = parseHelp(agyHelp(bin.path));
  if (!parsed.flags.length) throw new Error("parsed zero flags out of `agy --help` — the format changed");

  const before = readFileSync(DOC, "utf8");
  let after = before;
  for (const [id, render] of Object.entries(BLOCKS)) {
    after = replaceBlock(after, id, render(parsed), version);
  }

  if (check) {
    if (after !== before) {
      console.error("docs/antigravity-cli-reference.md is out of date. Run `npm run gen:cli-ref`.");
      process.exit(1);
    }
    console.log(`Generated blocks match agy ${version}.`);
    return;
  }

  if (after === before) {
    console.log(`Already up to date with agy ${version}.`);
    return;
  }
  writeFileSync(DOC, after);
  console.log(`Updated docs/antigravity-cli-reference.md from agy ${version} (${parsed.flags.length} flags, ${parsed.subcommands.length} subcommands).`);
}

main();
