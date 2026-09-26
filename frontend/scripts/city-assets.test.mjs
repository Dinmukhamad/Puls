import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OUT_DIR, SOURCES, checkBudgets } from "./city-assets.mjs";

test("generated city models fit the budgets and every model has LOD1 and LOD2", async () => {
  const manifest = JSON.parse(await readFile(`${OUT_DIR}/manifest.json`, "utf8"));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...SOURCES].sort(), "run npm run city:assets");
  const problems = checkBudgets(manifest);
  assert.equal(problems.length, 0, problems.join("\n"));
});
