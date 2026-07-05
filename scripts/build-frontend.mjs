#!/usr/bin/env node
/*
 * Кросс-платформенный сборщик фронтенда (замена build-frontend.ps1).
 * Склеивает исходники из js/src и css/src в единые js/app.js, js/api.js,
 * css/styles.css. Реальная минификация выполняется дальше terser/cleancss
 * (npm run minify:js / minify:css). Работает на Linux/macOS/Windows/Railway/CI.
 *
 * Порядок склейки — по имени файла (числовые префиксы 00-, 10-, ...).
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sortedFiles(dir, ext) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
}

function joinFiles(files, outPath, banner, includeSourceComments = false) {
  const chunks = [banner];
  for (const file of files) {
    if (includeSourceComments) {
      const name = file.split(/[\\/]/).pop();
      chunks.push(`/* source: ${name} */`);
    }
    chunks.push(readFileSync(file, "utf8"));
  }
  writeFileSync(outPath, chunks.join("\n") + "\n", "utf8");
  console.log(`bundled ${files.length} file(s) -> ${outPath.replace(ROOT + "/", "")}`);
}

const apiFiles = sortedFiles(join(ROOT, "js", "src", "api"), ".js");
const appFiles = sortedFiles(join(ROOT, "js", "src", "app"), ".js");
const cssFiles = sortedFiles(join(ROOT, "css", "src"), ".css");

joinFiles(
  apiFiles,
  join(ROOT, "js", "api.js"),
  "/* Generated from js/src/api/*.js. Run scripts/build-frontend.ps1 after editing. */",
);
joinFiles(
  appFiles,
  join(ROOT, "js", "app.js"),
  "/* Generated from js/src/app/*.js. Run scripts/build-frontend.ps1 after editing. */",
);
joinFiles(
  cssFiles,
  join(ROOT, "css", "styles.css"),
  "/* Generated from css/src/*.css. Run scripts/build-frontend.ps1 after editing. */",
  true,
);
