#!/usr/bin/env node
/**
 * Deterministic production minification for the generated Puls frontend bundles.
 *
 * `npm run minify` writes the three .min artifacts.
 * `npm run check:minified` renders the expected artifacts in memory and fails when
 * a committed file is missing, stale, or not smaller than its source bundle.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import CleanCSS from "clean-css";
import { minify as terserMinify } from "terser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const MINIFIED_ARTIFACTS = Object.freeze([
  Object.freeze({
    kind: "js",
    source: "js/api.js",
    output: "js/api.min.js",
    banner: "/*! Puls generated minified bundle from js/api.js. Run npm run build; do not edit directly. */",
  }),
  Object.freeze({
    kind: "js",
    source: "js/app.js",
    output: "js/app.min.js",
    banner: "/*! Puls generated minified bundle from js/app.js. Run npm run build; do not edit directly. */",
  }),
  Object.freeze({
    kind: "css",
    source: "css/styles.css",
    output: "css/styles.min.css",
    banner: "/*! Puls generated minified bundle from css/styles.css. Run npm run build; do not edit directly. */",
  }),
]);

function normalizeSource(value) {
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "") + "\n";
}

export async function minifyJavaScript(source) {
  const result = await terserMinify(normalizeSource(source), {
    compress: {
      defaults: true,
      passes: 2,
      toplevel: false,
    },
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
      toplevel: false,
    },
    format: {
      ascii_only: false,
      beautify: false,
      comments: false,
      semicolons: true,
    },
    sourceMap: false,
  });
  if (!result.code) {
    throw new Error("Terser returned an empty JavaScript bundle");
  }
  return result.code.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

export function minifyCss(source) {
  const result = new CleanCSS({
    level: 1,
    rebase: false,
    sourceMap: false,
  }).minify(normalizeSource(source));
  if (result.errors.length) {
    throw new Error(`CleanCSS failed: ${result.errors.join("; ")}`);
  }
  return result.styles.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

export async function renderMinifiedArtifact(artifact) {
  const sourcePath = join(ROOT, ...artifact.source.split("/"));
  const source = readFileSync(sourcePath, "utf8");
  const body = artifact.kind === "js"
    ? await minifyJavaScript(source)
    : minifyCss(source);
  return `${artifact.banner}\n${body}\n`;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function sizeSummary(source, minified) {
  const sourceBytes = byteLength(source);
  const minifiedBytes = byteLength(minified);
  const savedPercent = sourceBytes
    ? Math.round((1 - minifiedBytes / sourceBytes) * 100)
    : 0;
  return `${sourceBytes} -> ${minifiedBytes} bytes (${savedPercent}% smaller)`;
}

export async function writeMinifiedArtifacts() {
  for (const artifact of MINIFIED_ARTIFACTS) {
    const sourcePath = join(ROOT, ...artifact.source.split("/"));
    const outputPath = join(ROOT, ...artifact.output.split("/"));
    const source = readFileSync(sourcePath, "utf8");
    const minified = await renderMinifiedArtifact(artifact);
    if (byteLength(minified) >= byteLength(source)) {
      throw new Error(`${artifact.output} is not smaller than ${artifact.source}`);
    }
    writeFileSync(outputPath, minified, "utf8");
    console.log(`minified ${artifact.source} -> ${artifact.output}: ${sizeSummary(source, minified)}`);
  }
}

export async function checkMinifiedArtifacts() {
  const failures = [];
  for (const artifact of MINIFIED_ARTIFACTS) {
    const sourcePath = join(ROOT, ...artifact.source.split("/"));
    const outputPath = join(ROOT, ...artifact.output.split("/"));
    if (!existsSync(outputPath)) {
      failures.push(`${artifact.output} is missing`);
      continue;
    }

    const source = readFileSync(sourcePath, "utf8");
    const actual = readFileSync(outputPath, "utf8");
    const expected = await renderMinifiedArtifact(artifact);
    if (actual !== expected) {
      failures.push(`${artifact.output} is stale or was edited manually`);
      continue;
    }
    if (byteLength(actual) >= byteLength(source)) {
      failures.push(`${artifact.output} is not smaller than ${artifact.source}`);
      continue;
    }
    console.log(`checked ${artifact.output}: ${sizeSummary(source, actual)}`);
  }

  if (failures.length) {
    throw new Error(`${failures.join("; ")}. Run npm run build and commit the generated artifacts.`);
  }
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const checkOnly = process.argv.includes("--check");
  try {
    if (checkOnly) {
      await checkMinifiedArtifacts();
    } else {
      await writeMinifiedArtifacts();
    }
  } catch (error) {
    console.error(`[frontend-minify] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
