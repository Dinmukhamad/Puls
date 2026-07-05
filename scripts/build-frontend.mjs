#!/usr/bin/env node
/*
 * Кросс-платформенный сборщик фронтенда (замена build-frontend.ps1).
 * Склеивает исходники из js/src и css/src в единые js/app.js, js/api.js,
 * css/styles.css. Реальная минификация выполняется дальше terser/cleancss
 * (npm run minify:js / minify:css). Работает на Linux/macOS/Windows/Railway/CI.
 *
 * Порядок склейки — по имени файла (числовые префиксы 00-, 10-, ...).
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sortedFiles(dir, ext) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return sortedFiles(path, ext);
      }
      return entry.isFile() && entry.name.endsWith(ext) ? [path] : [];
    })
    .sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
}

function orderedFiles(groups, ext) {
  return groups.flatMap((group) => sortedFiles(join(ROOT, ...group), ext));
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

const apiFiles = orderedFiles(
  [
    ["js", "src", "api", "client"],
    ["js", "src", "api", "domains"],
  ],
  ".js",
);
const appFiles = orderedFiles(
  [
    ["js", "src", "app"],
    ["js", "src", "auth"],
    ["js", "src", "components"],
    ["js", "src", "utils"],
    ["js", "src", "views"],
  ],
  ".js",
);
const cssFiles = orderedFiles(
  [
    ["css", "src", "base"],
    ["css", "src", "layout"],
    ["css", "src", "components"],
    ["css", "src", "views"],
  ],
  ".css",
);

joinFiles(
  apiFiles,
  join(ROOT, "js", "api.js"),
  "/* Generated from js/src/api/**/*.js. Run npm run build after editing. */",
);
joinFiles(
  appFiles,
  join(ROOT, "js", "app.js"),
  "/* Generated from js/src/{app,auth,components,utils,views}/**/*.js. Run npm run build after editing. */",
);
joinFiles(
  cssFiles,
  join(ROOT, "css", "styles.css"),
  "/* Generated from css/src/{base,layout,components,views}/**/*.css. Run npm run build after editing. */",
  true,
);
