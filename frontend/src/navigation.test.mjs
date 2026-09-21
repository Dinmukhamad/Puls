import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const built = await build({ entryPoints: [fileURLToPath(new URL("./navigation.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const nav = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("trainer navigation stays within learning even with explicit grants", () => {
  const all = Object.fromEntries(Object.keys(nav.defaultAccess("admin")).map(key => [key, true]));
  assert.deepEqual(nav.visibleNavigation("trainer", all).map(x => x.label), ["Главная", "Пользователи", "Обучение", "Тесты", "Миссии", "Driver Simulator", "Аналитика обучения", "Мой кабинет"]);
  assert.equal(nav.visibleNavigation("trainer")[0].to, "/trainer");
  for (const path of ["/admin/groups", "/admin/access", "/admin/sessions", "/admin/summary", "/progress", "/wallet", "/rating", "/analytics", "/shop", "/games"]) {
    assert.equal(nav.canVisit("trainer", path, all, true), false, path);
  }
  for (const path of ["/admin/users/42", "/admin/learning", "/admin/learning-analytics", "/training", "/simulator", "/profile"]) {
    assert.equal(nav.canVisit("trainer", path, all), true, path);
  }
  assert.equal(nav.currentSection("trainer", "/admin/learning", "?kind=test")?.id, "tests");
  assert.equal(nav.currentSection("trainer", "/admin/learning", "?kind=mission")?.id, "missions");
  assert.equal(nav.currentSection("trainer", "/admin/learning", "?kind=simulator")?.id, "driver");
  assert.equal(nav.canVisit("operator", "/admin/users", all), false);
});

test("roles expose task-specific defaults with an account entry", () => {
  // «Колесо WOW» стоит отдельным пунктом, а не третьей вкладкой внутри
  // «Наград»: это ежедневное действие на минуту, и прятать его вглубь
  // значит каждый раз заставлять оператора вспоминать, где оно.
  assert.deepEqual(nav.visibleNavigation("operator").map((item) => item.label), ["Главная", "Результаты", "Обучение", "Колесо WOW", "Награды", "Профиль"]);
  assert.deepEqual(nav.visibleNavigation("supervisor").map((item) => item.label), ["Главная", "Команда", "Аналитика", "Обучение", "Рейтинг и мотивация", "Профиль"]);
  assert.deepEqual(nav.visibleNavigation("head").map((item) => item.label), ["Главная", "Команда", "Аналитика", "Производительность", "Обучение", "Мотивация", "Отчёты", "Профиль"]);
  assert.deepEqual(nav.visibleNavigation("admin").map((item) => item.label), ["Главная", "Пользователи и структура", "Производительность", "Аналитика", "Обучение", "Мотивация", "Система", "Профиль"]);
  assert.equal(nav.visibleNavigation("operator")[0].to, "/cabinet");
  assert.equal(nav.visibleNavigation("head")[0].to, "/admin/summary");
});

test("management roles do not have empty operator destinations", () => {
  for (const role of ["supervisor", "head", "admin"]) {
    const tabs = nav.visibleNavigation(role).flatMap((item) => item.tabs);
    for (const path of ["/cabinet", "/progress", "/wallet", "/training", "/shop", "/games"]) {
      assert.ok(!tabs.some((tab) => tab.to.split("?")[0] === path), `${role}: ${path}`);
      assert.equal(nav.canVisit(role, path, nav.defaultAccess(role)), false);
    }
  }
});

test("operator progress has a single entry in results while the home keeps cabinet and wallet", () => {
  const sections = nav.visibleNavigation("operator");
  assert.deepEqual(sections.find((item) => item.id === "home").tabs.map((item) => item.to), ["/cabinet", "/wallet"]);
  assert.deepEqual(sections.find((item) => item.id === "results").tabs.map((item) => item.to), ["/rating?tab=board", "/progress"]);
  assert.equal(sections.flatMap((item) => item.tabs).filter((item) => item.label === "Мой прогресс").length, 1);
  assert.equal(nav.currentSection("operator", "/progress")?.id, "results");
  assert.ok(sections.every((item) => item.tabs.every((item) => item.to !== "/rating?tab=progress")));
});

test("operator progress follows results access independently of cabinet access", () => {
  const allowed = { ...nav.defaultAccess("operator"), personal: false };
  assert.equal(nav.currentSection("operator", "/progress", "", allowed)?.id, "results");
  assert.deepEqual(nav.visibleNavigation("operator", allowed).find((item) => item.id === "results").tabs.map((item) => item.to), ["/rating?tab=board", "/progress"]);
  const denied = { ...nav.defaultAccess("operator"), results: false };
  assert.equal(nav.canVisit("operator", "/progress", denied), false);
  assert.ok(nav.visibleNavigation("operator", denied).every((item) => item.tabs.every((item) => item.to !== "/progress")));
});

test("sessions have one developer-only entry and never appear in the profile", () => {
  for (const role of ["operator", "supervisor", "head", "admin"]) {
    const all = Object.fromEntries(Object.keys(nav.defaultAccess(role)).map((key) => [key, true]));
    assert.equal(nav.canVisit(role, "/sessions", all), false);
    assert.equal(nav.canVisit(role, "/admin/sessions", all), false);
    assert.ok(!nav.visibleNavigation(role, all).flatMap((item) => item.tabs).some((tab) => tab.to.includes("sessions")));
    assert.equal(nav.canVisit(role, "/admin/sessions", all, true), role === "admin");
  }
  const items = nav.visibleNavigation("admin", {}, true);
  const entries = items.flatMap((item) => item.tabs.filter((tab) => tab.to.includes("sessions")).map((tab) => ({ section: item.id, to: tab.to })));
  assert.deepEqual(entries, [{ section: "system", to: "/admin/sessions" }]);
  assert.equal(nav.currentSection("admin", "/admin/sessions", "", {}, true)?.id, "system");
  assert.ok(nav.ACCOUNT_SECTION.tabs.every((tab) => !tab.to.includes("sessions")));
});

test("grants add discoverable destinations and revocations remove every tab", () => {
  for (const role of ["operator", "supervisor", "head", "admin"]) {
    const all = Object.fromEntries(Object.keys(nav.defaultAccess(role)).map((key) => [key, true]));
    const allowed = nav.visibleNavigation(role, all);
    for (const item of allowed) for (const tab of item.tabs) {
      const url = new URL(tab.to, "https://puls.test");
      assert.equal(nav.currentSection(role, url.pathname, url.search, all)?.id, item.id, `${role}: ${tab.to}`);
      assert.equal(nav.canVisit(role, tab.to, all), true);
    }
    for (const code of Object.keys(all)) {
      const denied = { ...all, [code]: false };
      for (const item of nav.visibleNavigation(role, denied)) for (const tab of item.tabs) {
        const url = new URL(tab.to, "https://puls.test");
        assert.notEqual(nav.routeSection(url.pathname, url.search, role), code);
        assert.equal(nav.currentSection(role, url.pathname, url.search, denied)?.id, item.id);
      }
    }
    const none = nav.visibleNavigation(role, {});
    assert.deepEqual(none.map((item) => item.id), role === "admin" ? ["system", "profile"] : ["profile"]);
    assert.equal(nav.canVisit(role, "/profile", {}), true);
    assert.equal(nav.canVisit(role, "/admin/access", {}), role === "admin");
  }
  assert.ok(nav.visibleNavigation("operator", { analytics: true }).some((item) => item.to.startsWith("/analytics")));
  assert.ok(nav.visibleNavigation("head", { training: true }).some((item) => item.to.startsWith("/training")));
});

test("every subsection activates its parent, including settings shared by domains", () => {
  for (const role of ["operator", "supervisor", "head", "admin"]) {
    for (const section of nav.visibleNavigation(role)) for (const tab of section.tabs) {
      const url = new URL(tab.to, "https://puls.test");
      assert.equal(nav.currentSection(role, url.pathname, url.search)?.id, section.id, `${role}: ${tab.to}`);
      assert.equal(nav.currentTab(section, url.pathname, url.search)?.to, tab.to, `${role}: ${tab.to}`);
    }
  }
});

test("deep links and query filters retain the proper section", () => {
  assert.equal(nav.currentSection("admin", "/admin/users/25", "?tab=progress")?.id, "team");
  assert.equal(nav.currentSection("operator", "/training/attempts/23")?.id, "training");
  assert.equal(nav.currentSection("head", "/profile")?.id, "profile");
  assert.equal(nav.currentSection("operator", "/admin/wallet"), undefined);
  assert.equal(nav.currentSection("supervisor", "/admin/audit"), undefined);
  assert.equal(nav.currentSection("head", "/admin/users-invalid"), undefined);
  const learning = nav.currentSection("head", "/admin/learning");
  assert.equal(nav.currentTab(learning, "/admin/learning", "?tab=results&kind=simulator").label, "Результаты команды");
});

test("mobile bar keeps the wheel in reach and bounds larger role menus", () => {
  // Разделов у оператора стало шесть, и панель перешла в режим «четыре плюс
  // меню». Это осознанный размен: колесо остаётся на виду, а в скрытое меню
  // уходят «Награды» и «Профиль». Проверка стережёт именно это — что
  // вынесенный пункт не оказался спрятан тем же движением, которым его
  // доставали из глубины.
  const operator = nav.mobileNavigation(nav.visibleNavigation("operator"));
  assert.equal(operator.primary.length, 4);
  assert.ok(operator.primary.some((item) => item.id === "wheel"), "колесо ушло в скрытое меню");
  assert.deepEqual([...operator.primary, ...operator.overflow], nav.visibleNavigation("operator"));
  for (const role of ["supervisor", "head", "admin"]) {
    const menu = nav.mobileNavigation(nav.visibleNavigation(role));
    assert.equal(menu.primary.length, 4);
    assert.deepEqual([...menu.primary, ...menu.overflow], nav.visibleNavigation(role));
  }
});

test("all navigation destinations have an implemented application route", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const paths = new Set(Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g), (match) => match[1]));
  for (const role of ["operator", "supervisor", "head", "admin"]) for (const section of nav.visibleNavigation(role)) for (const tab of section.tabs) {
    assert.ok(paths.has(new URL(tab.to, "https://puls.test").pathname), tab.to);
  }
});

test("section switches preserve selected reporting periods and reset pagination", () => {
  const to = (destination, path, search) => new URL(nav.subsectionDestination({ to: destination, label: "Test" }, path, search), "https://puls.test").searchParams;
  const rating = to("/rating?tab=progress", "/rating", "?week=42&page=3&search=Anna");
  assert.equal(rating.get("week"), "42"); assert.equal(rating.get("tab"), "progress"); assert.equal(rating.has("page"), false);
  const analytics = to("/analytics?tab=quality", "/analytics", "?week_id=42&group_id=5&page=3");
  assert.equal(analytics.get("week_id"), "42"); assert.equal(analytics.get("group_id"), "5"); assert.equal(analytics.has("page"), false);
  const results = to("/admin/learning?tab=results", "/admin/learning", "?kind=simulator");
  assert.equal(results.get("kind"), "simulator");
  const materials = to("/admin/learning?kind=test", "/admin/learning", "?tab=results&kind=simulator");
  assert.equal(materials.get("kind"), "test"); assert.equal(materials.has("tab"), false);
});
