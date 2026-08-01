/* Каркас приложения: топбар, мобильный таб-бар, шторка навигации.
   Бандл исполняется в jsdom — проверяется поведение, а не наличие строк. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function bootShell() {
  const dom = new JSDOM(readFileSync("index.html", "utf8"), {
    runScripts: "outside-only",
    url: "http://localhost/",
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  window.scrollTo = () => {};

  // Функции бандла живут в его собственной области видимости — пробрасываем
  // наружу только то, что нужно тесту.
  const expose = `
    window.__shell = { initAppShell, buildTabbar, syncTopbarTitle,
                       syncTabbarActive, setShellNav, allowedViewsForRole };`;
  window.eval(readFileSync("js/api.js", "utf8"));
  window.eval(readFileSync("js/app.js", "utf8") + expose);

  window.__shell.initAppShell();
  return { window, doc: window.document, shell: window.__shell };
}

const tabTargets = (doc) =>
  [...doc.querySelectorAll(".app-tabbar__item[data-nav-target]")].map((i) => i.dataset.navTarget);

test("бандл исполняется и каркас инициализируется без ошибок", () => {
  const { doc } = bootShell();
  assert.ok(doc.getElementById("app-topbar"), "топбар есть в разметке");
  assert.ok(doc.getElementById("app-tabbar"), "таб-бар есть в разметке");
  assert.ok(doc.querySelector(".mobile-nav-backdrop"), "подложка шторки создаётся");
  assert.equal(doc.querySelector(".side-nav").id, "primary-navigation");
});

test("таб-бар оператора не содержит административных разделов", () => {
  const { doc, shell } = bootShell();
  shell.buildTabbar("operator");
  const targets = tabTargets(doc);
  const allowed = shell.allowedViewsForRole("operator");
  assert.ok(targets.length > 0);
  for (const view of targets) {
    assert.ok(allowed.includes(view), `раздел ${view} недоступен роли operator`);
  }
  for (const forbidden of ["summary", "analytics", "operators", "coins", "sessions", "groups"]) {
    assert.ok(!targets.includes(forbidden), `${forbidden} не должен попадать в таб-бар оператора`);
  }
});

test("таб-бар админа начинается с приоритетных разделов", () => {
  const { doc, shell } = bootShell();
  shell.buildTabbar("admin");
  assert.deepEqual(tabTargets(doc), ["summary", "analytics", "operators", "coins"]);
});

test("в таб-баре не больше пяти пунктов, последний — «Ещё»", () => {
  for (const role of ["operator", "admin", "supervisor", "manager"]) {
    const { doc, shell } = bootShell();
    shell.buildTabbar(role);
    const items = [...doc.querySelectorAll(".app-tabbar__item")];
    assert.ok(items.length <= 5, `${role}: пунктов ${items.length}, ожидалось ≤5`);
    assert.equal(items.at(-1).id, "app-tabbar-more", `${role}: последний пункт — «Ещё»`);
  }
});

test("каждый пункт таб-бара имеет иконку и текстовую подпись", () => {
  const { doc, shell } = bootShell();
  shell.buildTabbar("admin");
  for (const item of doc.querySelectorAll(".app-tabbar__item")) {
    assert.ok(item.querySelector("svg"), "иконка");
    assert.ok(item.querySelector("span")?.textContent.trim(), "подпись не пустая");
  }
});

test("активный раздел подсвечивается, «Ещё» — когда раздел не в основных", () => {
  const { doc, shell } = bootShell();
  shell.buildTabbar("admin");

  shell.syncTabbarActive("analytics");
  assert.ok(doc.querySelector('.app-tabbar__item[data-nav-target="analytics"]').classList.contains("active"));
  assert.ok(!doc.getElementById("app-tabbar-more").classList.contains("active"));

  shell.syncTabbarActive("tests"); // раздел есть, но не в основных четырёх
  assert.ok(doc.getElementById("app-tabbar-more").classList.contains("active"));
});

test("заголовок топбара и title документа следуют за разделом", () => {
  const { doc, shell } = bootShell();
  shell.syncTopbarTitle("analytics");
  assert.equal(doc.getElementById("app-topbar-title").textContent, "Аналитика");
  assert.equal(doc.title, "Аналитика — Puls");

  shell.syncTopbarTitle("shop");
  assert.equal(doc.getElementById("app-topbar-title").textContent, "Магазин");
});

test("шторка открывается и закрывается, aria-expanded синхронно", () => {
  const { doc, shell } = bootShell();
  shell.buildTabbar("admin");
  const menu = doc.getElementById("app-topbar-menu");

  shell.setShellNav(true);
  assert.ok(doc.body.classList.contains("mobile-nav-open"));
  assert.equal(menu.getAttribute("aria-expanded"), "true");
  assert.equal(doc.getElementById("app-tabbar-more").getAttribute("aria-expanded"), "true");

  shell.setShellNav(false);
  assert.ok(!doc.body.classList.contains("mobile-nav-open"));
  assert.equal(menu.getAttribute("aria-expanded"), "false");
});

test("Escape закрывает шторку", () => {
  const { window, doc, shell } = bootShell();
  shell.setShellNav(true);
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!doc.body.classList.contains("mobile-nav-open"));
});

test("клик по подложке закрывает шторку", () => {
  const { doc, shell } = bootShell();
  shell.setShellNav(true);
  doc.querySelector(".mobile-nav-backdrop").click();
  assert.ok(!doc.body.classList.contains("mobile-nav-open"));
});

test("в разметке каркаса не осталось захардкоженных цветов", () => {
  const html = readFileSync("index.html", "utf8");
  const shellMarkup = html.slice(html.indexOf("<!-- SIDE NAV -->"), html.indexOf("<!-- SCRIPTS -->"));
  const inlineColour = shellMarkup.match(/style="[^"]*(?:color|background)\s*:[^"]*"/gi) || [];
  assert.deepEqual(inlineColour, [], `инлайновые цвета: ${inlineColour.join(", ")}`);
});

test("каркас и базовый слой не используют !important", () => {
  const shellCss = readFileSync("css/src/layout/10-app-shell.css", "utf8");
  assert.equal(shellCss.includes("!important"), false, "layout/10-app-shell.css");

  const baseCss = readFileSync("css/src/base/00-base-layout.css", "utf8");
  const hits = baseCss.match(/!important/g) || [];
  // Допустим ровно один — [hidden] должен побеждать любой display у компонента.
  assert.equal(hits.length, 1, `в базовом слое ${hits.length} !important, ожидался 1 ([hidden])`);
});

test("мобильный каркас учитывает safe-area", () => {
  const css = readFileSync("css/src/layout/10-app-shell.css", "utf8");
  for (const token of ["--safe-bottom", "--safe-top", "--tabbar-h"]) {
    assert.ok(css.includes(token), `${token} используется в каркасе`);
  }
});

test("бургер скрыт на десктопе и не перебивается слоем примитивов", () => {
  const shell = readFileSync("css/src/layout/10-app-shell.css", "utf8");
  // Одиночный класс проиграл бы .ui-icon-btn из components/, который
  // грузится позже. Правило обязано иметь специфичность выше (0,1,0).
  assert.ok(shell.includes(".app-topbar .app-topbar__menu { display: none; }"),
    "правило скрытия бургера должно быть на составном селекторе");
  assert.ok(!/^\.app-topbar__menu\s*\{\s*display:\s*none/m.test(shell),
    "одиночный .app-topbar__menu{display:none} снова проиграет каскаду");
});

test("заголовок топбара совпадает с подписью раздела в сайдбаре", () => {
  const { doc, shell } = bootShell();
  for (const link of doc.querySelectorAll(".side-nav-link[data-nav-target]")) {
    const view = link.dataset.navTarget;
    const sidebarLabel = link.querySelector("span")?.textContent.trim();
    if (!sidebarLabel) continue;
    shell.syncTopbarTitle(view);
    assert.equal(doc.getElementById("app-topbar-title").textContent, sidebarLabel,
      `раздел ${view}: топбар и сайдбар называют его по-разному`);
  }
});
