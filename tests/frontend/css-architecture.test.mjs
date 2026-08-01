/* Архитектурные инварианты CSS: единственный владелец компонента,
   отсутствие !important вне whitelist и структурная целостность файлов. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "css/src";
const LAYERS = ["base", "layout", "components", "views"];

function cssFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".css")) out.push(path);
    }
  };
  for (const layer of LAYERS) walk(join(ROOT, layer));
  return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* Порядок склейки в scripts/build-frontend.mjs: слой, затем имя файла. */
function bundleOrder() {
  return cssFiles().sort((a, b) => {
    const la = LAYERS.indexOf(a.split("/")[2]);
    const lb = LAYERS.indexOf(b.split("/")[2]);
    if (la !== lb) return la - lb;
    return a.split("/").pop().localeCompare(b.split("/").pop());
  });
}

test("во всех CSS-файлах сбалансированы скобки", () => {
  for (const file of cssFiles()) {
    const css = stripComments(readFileSync(file, "utf8"));
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    assert.equal(open, close, `${file}: { ${open} против } ${close}`);
  }
});

test("собранный бандл разбирается без лишних закрывающих скобок", () => {
  const css = stripComments(readFileSync("css/styles.css", "utf8"));
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      assert.ok(depth >= 0, "лишняя закрывающая скобка в css/styles.css");
    }
  }
  assert.equal(depth, 0, "незакрытый блок в css/styles.css");
});

test("!important остался только там, где он обоснован", () => {
  // [hidden] обязан побеждать любой display компонента;
  // zzz-a11y-motion — глобальный guard prefers-reduced-motion.
  const ALLOWED = new Set([
    "css/src/base/00-base-layout.css",
    "css/src/views/zzz-a11y-motion.css",
  ]);
  const offenders = [];
  for (const file of cssFiles()) {
    const hits = (stripComments(readFileSync(file, "utf8")).match(/!important/g) || []).length;
    if (hits && !ALLOWED.has(file)) offenders.push(`${file}: ${hits}`);
  }
  // Пока идёт миграция вьюх — фиксируем текущий потолок, чтобы он не рос.
  const total = offenders.reduce((n, s) => n + Number(s.split(": ")[1]), 0);
  assert.ok(total <= 90, `!important вне whitelist: ${total}\n${offenders.join("\n")}`);
});

test("слой каркаса и слой контролов не используют !important", () => {
  for (const file of ["css/src/layout/10-app-shell.css",
                      "css/src/views/zz-legacy-controls.css",
                      "css/src/components/05-ui-primitives.css"]) {
    const css = stripComments(readFileSync(file, "utf8"));
    assert.ok(!css.includes("!important"), `${file} содержит !important`);
  }
});

test("оформление сайдбара объявлено ровно в одном файле", () => {
  const owners = cssFiles().filter((file) =>
    /^\s*\.side-nav-link(\.active)?\s*[,{]/m.test(stripComments(readFileSync(file, "utf8"))));
  assert.deepEqual(owners, ["css/src/layout/10-app-shell.css"],
    `.side-nav-link объявлен в: ${owners.join(", ")}`);
});

test("у ключевых legacy-контролов один владелец", () => {
  const SINGLE_OWNER = {
    ".btn-primary": "css/src/views/zz-legacy-controls.css",
    ".form-label": "css/src/views/zz-legacy-controls.css",
    ".kpi-value": "css/src/views/zz-legacy-controls.css",
    ".kpi-label": "css/src/views/zz-legacy-controls.css",
    ".tab-btn": "css/src/views/zz-legacy-controls.css",
  };
  for (const [selector, owner] of Object.entries(SINGLE_OWNER)) {
    const pattern = new RegExp(`^\\s*\\${selector}\\s*[,{]`, "m");
    const owners = cssFiles().filter((f) => pattern.test(stripComments(readFileSync(f, "utf8"))));
    assert.deepEqual(owners, [owner], `${selector} объявлен в: ${owners.join(", ")}`);
  }
});

test("prefers-reduced-motion c глобальным селектором объявлен один раз", () => {
  const owners = cssFiles().filter((f) => {
    const css = stripComments(readFileSync(f, "utf8"));
    const i = css.indexOf("prefers-reduced-motion");
    return i !== -1 && /^\s*\*\s*,/m.test(css.slice(i, i + 200));
  });
  assert.deepEqual(owners, ["css/src/views/zzz-a11y-motion.css"]);
});

test("глобальный guard движения грузится последним среди своих правил", () => {
  const order = bundleOrder();
  const guard = order.indexOf("css/src/views/zzz-a11y-motion.css");
  assert.ok(guard !== -1, "zzz-a11y-motion.css попадает в сборку");
  assert.ok(guard > order.indexOf("css/src/views/zz-legacy-controls.css"));
  assert.ok(guard > order.indexOf("css/src/views/90-visual-polish.css"));
});

test("универсальный transition на * не вернулся", () => {
  for (const file of cssFiles()) {
    const css = stripComments(readFileSync(file, "utf8"));
    const match = css.match(/^\s*\*\s*,\s*\*::before[^{]*\{([^}]*)\}/m);
    if (match) {
      assert.ok(!/transition\s*:/.test(match[1]) || file.endsWith("zzz-a11y-motion.css"),
        `${file}: transition на универсальном селекторе`);
    }
  }
});
