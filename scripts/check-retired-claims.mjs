#!/usr/bin/env node
// Fails if any outward surface of this package still carries a claim that was
// corrected elsewhere. Exists because a 2026-10-21 README fix never reached
// the identical string in src/index.ts: the tool kept telling every MCP client
// "500 of ~1,656 four-years. Absence from this list is itself a signal."
//
// Scans every file that ships or is listed (code, README, registry manifests),
// not just docs. When you correct a claim anywhere, add the old wording here.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const RETIRED = [
  { re: /itself a signal/i, why: "absence is a coverage statement, not a verdict (2026-10-21)" },
  { re: /% of programs that never break even/i, why: "pct_never_breakeven is a share of graduate cohort weight, not of programs (2026-10-21 README; src 2026-11-10)" },
  { re: /% never break even/i, why: "unqualified; say whose share: graduates in programs that never break even (2026-10-21)" },
  { re: /1,?656/, why: "1,656 is four-years with FREOPP earnings, not the envelope's denominator; the API states coverage itself (2026-10-21)" },
];

const SURFACES = ["src", "dist", "README.md", "package.json", "manifest.json", "server.json", "smithery.yaml", "glama.json"];

function files(p) {
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).flatMap((f) => files(join(p, f)));
}

const hits = [];
for (const f of SURFACES.flatMap(files)) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const { re, why } of RETIRED) if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}\n    retired: ${why}`);
  });
}
if (hits.length) {
  console.error(`check-retired-claims: ${hits.length} retired claim(s) still shipping:\n` + hits.join("\n"));
  process.exit(1);
}
console.log("check-retired-claims: clean");
