import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const { migrateFleet, sizeFleet } = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const SNAPSHOTS = path.resolve(__dirname, "../../test-fixtures/snapshots");

const v5Files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

// Strip non-deterministic / very-deep fields and round any float to 6 decimal
// places so cross-platform serialization differences don't churn snapshots.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      // The full `fleet` and `instance` objects round-trip the input verbatim;
      // they don't add information beyond what's in the fixture file. Drop
      // them from the snapshot so the snapshot focuses on derived values.
      if (key === "fleet" || key === "instance") continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  return value;
}

describe("snapshot — fixture sizing stability", () => {
  it.each(v5Files)("sizing for %s matches snapshot", async (file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
    const fleet = migrateFleet(raw);
    const result = sizeFleet(fleet);
    const snapshot = canonicalize(result);
    const snapPath = path.join(SNAPSHOTS, file.replace(/\.json$/, ".snap.json"));
    await expect(JSON.stringify(snapshot, null, 2) + "\n").toMatchFileSnapshot(snapPath);
  });
});
