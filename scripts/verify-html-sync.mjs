#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-html-sync.mjs — CI guard for the build-free runtime contract.
//
// vcf-design-studio-v5.html is a generated artifact (engine.js + .jsx stitched
// together by scripts/build-html.mjs). If a contributor edits the .html by
// hand — or forgets to re-run build-html after editing engine.js or the .jsx —
// the runtime will drift from the source.
//
// This script regenerates the HTML in-memory and compares against the
// committed HTML byte-for-byte. It never writes to disk. Exits non-zero on
// mismatch with a clear diff hint so the contributor knows to run
// `npm run build-html`.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { buildHtml, OUTPUT_PATH } from "./build-html.mjs";

const committed  = fs.readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n");
const regenerated = buildHtml();

if (committed === regenerated) {
  console.log("verify-html-sync: HTML is in sync with engine.js + JSX source");
  process.exit(0);
}

const a = committed.split("\n");
const b = regenerated.split("\n");
let firstDiff = -1;
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) { firstDiff = i; break; }
}

console.error("verify-html-sync: committed HTML differs from freshly-generated output.");
console.error("");
console.error("This means either:");
console.error("  - engine.js or vcf-design-studio-v5.jsx was edited without re-running build-html, or");
console.error("  - vcf-design-studio-v5.html was edited by hand (it is a generated artifact).");
console.error("");
console.error("Fix:  npm run build-html  &&  git add vcf-design-studio-v5.html");
console.error("");
if (firstDiff >= 0) {
  console.error(`First divergence at line ${firstDiff + 1}:`);
  console.error(`  committed:    ${JSON.stringify(a[firstDiff] ?? "<EOF>")}`);
  console.error(`  regenerated:  ${JSON.stringify(b[firstDiff] ?? "<EOF>")}`);
}
process.exit(1);
