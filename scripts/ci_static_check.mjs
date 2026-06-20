import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

function listMjs(dir) {
  const full = path.join(root, dir);
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMjs(rel));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      out.push(rel);
    }
  }
  return out.sort();
}

function run(label, command, args) {
  console.log(`\n## ${label}`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      QUALITY_REFINE_CI_STATIC: "1",
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const file of listMjs("scripts")) {
  run(`syntax ${file}`, process.execPath, ["--check", file]);
}

for (const unit of [
  "scripts/refine-tests/judge_unit.mjs",
  "scripts/refine-tests/pool_visual_unit.mjs",
  "scripts/refine-tests/diagram_candidates_unit.mjs",
]) {
  if (statSync(path.join(root, unit), { throwIfNoEntry: false })?.isFile()) {
    run(`unit ${unit}`, process.execPath, [unit]);
  }
}

run("content schema/contract", process.execPath, ["scripts/validate_content.mjs"]);
run("quality scan", process.execPath, ["scripts/quality_scan.mjs"]);
run("quality audit", process.execPath, ["scripts/content_quality_audit.mjs", "--min-score=90"]);

console.log("\nStatic CI checks passed.");
