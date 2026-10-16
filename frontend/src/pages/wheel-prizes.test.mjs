/**
 * Призы ленты удачи.
 *
 * Список «Что может выпасть» открывается по значку и показывает призы
 * стикерами. Стикер зависит только от награды: самый крупный приз всегда
 * получает самый яркий, а сектор без награды — дружелюбный клевер.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build, transform } from "esbuild";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("./wheelPrizes.ts", import.meta.url), "utf8");
const built = await transform(source, { loader: "ts", format: "esm" });
const { prizeSticker, prizeChances, promisedCoins, mismatchedPrizes, monthlyChestCoins } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);

const wheel = [
  { title: "В этот раз без награды", coins: 0, weight: 1 },
  { title: "5 коинов", coins: 5, weight: 1 },
  { title: "10 коинов", coins: 10, weight: 1 },
  { title: "100 коинов", coins: 100, weight: 1 },
  { title: "1000 коинов", coins: 1000, weight: 4 },
];

test("every reward gets its own drawn sticker: the biggest the brightest, an empty sector a clover", () => {
  assert.deepEqual(wheel.map((prize) => prizeSticker(prize, wheel).kind), ["clover", "coin", "pouch", "gift", "gem"]);
  const six = [2, 5, 10, 20, 50, 100].map((coins) => ({ coins }));
  assert.deepEqual(six.map((prize) => prizeSticker(prize, six).kind), ["coin", "stack", "pouch", "gift", "crown", "gem"]);
  assert.equal(new Set(six.map((prize) => prizeSticker(prize, six).color)).size, 6, "every step has its own colour");
  assert.equal(prizeSticker({ coins: 7 }, [{ coins: 7 }, { coins: 9 }]).kind, "coin");
  assert.equal(prizeSticker({ coins: 9 }, [{ coins: 7 }, { coins: 9 }]).kind, "gem");
  assert.equal(prizeSticker({ coins: -3 }, wheel).kind, "clover");
  // Equal rewards share a sticker, picked by the amount itself.
  assert.equal(prizeSticker({ coins: 5 }, [{ coins: 5 }, { coins: 5 }]).kind, "stack");
  assert.equal(prizeSticker({ coins: 1000 }, [{ coins: 1000 }, { coins: 1000 }]).kind, "gem");
  assert.equal(prizeSticker({ coins: 1 }, [{ coins: 1 }]).kind, "coin");
});

test("a prize whose name promises another reward is caught, and the free chests are priced per month", () => {
  assert.equal(promisedCoins("5 коинов"), 5);
  assert.equal(promisedCoins("Джекпот 1\u00a0000 коинов"), 1000);
  assert.equal(promisedCoins("В этот раз без награды"), 0);
  assert.equal(promisedCoins("Сюрприз"), null);
  // The chest live in production on 16.10: every prize paid 1000, whatever its name said.
  const live = [
    { title: "В этот раз без награды", coins: 1000, weight: 1 },
    { title: "5 коинов", coins: 1000, weight: 1 },
    { title: "10 коинов", coins: 1000, weight: 1 },
    { title: "100 коинов", coins: 1000, weight: 1 },
    { title: "1000 коинов", coins: 1000, weight: 4 },
  ];
  assert.deepEqual(mismatchedPrizes(live), [0, 1, 2, 3]);
  assert.deepEqual(mismatchedPrizes(wheel), []);
  assert.equal(monthlyChestCoins(10, live), 220000);
  // The default chest (docs/COIN_ECONOMY.md): about 5 coins on average, one a day.
  const defaults = [[0, 30], [2, 25], [5, 25], [10, 12], [20, 6], [50, 2]].map(([coins, weight]) => ({ coins, weight }));
  assert.equal(monthlyChestCoins(1, defaults), 113);
  assert.equal(monthlyChestCoins(1, [{ coins: 5, weight: 0 }]), 0);
});

test("chances follow the weights and never divide by zero", () => {
  assert.deepEqual(prizeChances(wheel), [12.5, 12.5, 12.5, 12.5, 50]);
  assert.deepEqual(prizeChances([{ weight: 0 }, { weight: 0 }]), [0, 0]);
  assert.deepEqual(prizeChances([]), []);
});

test("the chest of the day is a site card: its prize strip shows what is inside, its lock the daily tasks", async () => {
  const require = createRequire(import.meta.url);
  const page = await build({ entryPoints: [fileURLToPath(new URL("./GamesPage.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false, define: { "import.meta.env": "{}" },
    plugins: [{ name: "test-auth", setup(plugin) { plugin.onResolve({ filter: /\/AuthContext$/ }, () => ({ path: "test:auth", external: true })); } }] });
  const module = { exports: {} };
  const config = { enabled: true, daily_spins: 1, used_today: 0, segments: wheel };
  const queries = [];
  new Function("require", "module", "exports", page.outputFiles[0].text)((name) => {
    if (name === "@tanstack/react-query") return { useQuery: ({ queryKey }) => { queries.push(queryKey[0]); return { data: config }; }, useMutation: () => ({ isPending: false, isError: false }), useQueryClient: () => ({}) };
    if (name === "react-router-dom") return { useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
    if (name === "test:auth") return { useAuth: () => ({ atLeast: () => false }) };
    return require(name);
  }, module, module.exports);
  const { GamesPage, PrizeStickers } = module.exports;
  const html = renderToStaticMarkup(React.createElement(GamesPage));
  assert.match(html, /class="wheel-prizes-button" aria-haspopup="dialog"><span class="wheel-prizes-button__sticker" aria-hidden="true"><svg class="prize-art" data-kind="gift"/);
  assert.doesNotMatch(html, /История розыгрышей|Вероятности указаны|wheel-legend/);
  // Лента удачи — обычная карточка сайта: название в шапке, рядом звук и призы.
  // Лента собрана из разметки, а не нарисована на холсте, поэтому берёт шрифты,
  // цвета и тёмную тему из общих стилей.
  assert.match(html, /<h2 class="card__title">Сундук дня<\/h2>/);
  assert.doesNotMatch(html, /Колес|КОЛЕСО|<canvas/);
  assert.match(html, /aria-label="Выключить звук" title="Выключить звук" aria-pressed="false"/);
  // Drawn stickers, not emoji: every tile shows its prize's own drawing.
  assert.match(html, /class="prize-strip__tile is-current"[^>]*><span class="prize-strip__sticker" data-kind="clover"[^>]*><svg class="prize-art" data-kind="clover"[\s\S]*?<\/svg><\/span><span class="prize-strip__title">В этот раз без награды<\/span><span class="prize-strip__reward prize-strip__reward--none">без награды<\/span>/);
  assert.match(html, /data-kind="gem"[^>]*><svg class="prize-art" data-kind="gem"[\s\S]*?<\/svg><\/span><span class="prize-strip__title">1000 коинов<\/span><span class="prize-strip__reward">\+1\s000 коинов<\/span>/);
  assert.doesNotMatch(html, />(🍀|🪙|💰|🎁|🏆|💎)</);
  assert.match(html, /<div class="prize-strip__window"><\/div>/);
  assert.match(html, />Открыть сундук<\/button><p class="wheel-card__note">Бесплатный сундук ждёт вас · новый сундук — завтра<\/p>/);
  assert.match(html, /class="chest" data-state="ready"/);
  // A ready chest is alive: sparks rise and light leaks through the lid; no coins until it opens.
  assert.match(html, /class="chest-scene__sparks"/);
  assert.match(html, /class="chest__seam"/);
  assert.doesNotMatch(html, /class="chest-scene__coins"/);
  assert.deepEqual(queries, ["wheel"]);
  // Выключенная лента не обещает попыток, которые нельзя потратить.
  config.enabled = false;
  const off = renderToStaticMarkup(React.createElement(GamesPage));
  assert.match(off, />Скоро вернёмся<\/button><p class="wheel-card__note">Сундук дня сейчас выключен\.<\/p>/);
  assert.match(off, /class="chest" data-state="paused"/);
  config.enabled = true; config.free_left = 0; config.paid_left = 0;
  const spent = renderToStaticMarkup(React.createElement(GamesPage));
  assert.match(spent, /class="chest" data-state="spent"/);
  assert.match(spent, /До встречи завтра!/);
  assert.match(spent, /disabled="">На сегодня всё/);
  delete config.free_left; delete config.paid_left;
  // A chest is shut until the day's tasks are answered: no strip, a way to the tasks.
  config.enabled = true; config.chest = { unlocked: false, answered: 1, total: 3 };
  const shut = renderToStaticMarkup(React.createElement(GamesPage));
  assert.match(shut, /class="chest" data-state="locked"/);
  assert.match(shut, /Задания дня: 1 из 3/);
  assert.match(shut, /Ответить на задания/);
  assert.doesNotMatch(shut, /prize-strip__window|Открыть сундук/);
  assert.doesNotMatch(shut, /class="chest-scene__reward"|class="chest-scene__burst"/);
  delete config.chest;
  const prizes = renderToStaticMarkup(React.createElement(PrizeStickers, { segments: wheel }));
  assert.equal((prizes.match(/class="prize-sticker-card"/g) ?? []).length, 5);
  assert.match(prizes, /data-kind="gem"[\s\S]*?<\/svg><\/span><strong class="prize-sticker-card__title">1000 коинов<\/strong><span class="prize-sticker-card__reward">\+1\s000 коинов<\/span><span class="prize-sticker-card__chance">Шанс 50%<\/span>/);
  assert.match(prizes, /data-kind="clover"[\s\S]*?<\/svg><\/span><strong class="prize-sticker-card__title">В этот раз без награды<\/strong><span class="prize-sticker-card__chance">Шанс 12,5%/);
});

test("chest audio starts only on opening, reuses its context and releases it on mute or exit", async () => {
  const source = readFileSync(new URL("./chestSounds.ts", import.meta.url), "utf8");
  const built = await transform(source, { loader: "ts", format: "cjs" });
  const module = { exports: {} };
  new Function("module", "exports", built.code)(module, module.exports);
  let contexts = 0, notes = 0, closed = 0;
  const originalWindow = globalThis.window;
  globalThis.window = { AudioContext: class {
    state = "running"; currentTime = 0; destination = {};
    constructor() { contexts++; }
    createOscillator() { notes++; return { frequency:{setValueAtTime(){}}, connect(){return this;}, start(){}, stop(){}, disconnect(){} }; }
    createGain() { return { gain:{setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}}, connect(){return this;}, disconnect(){} }; }
    close() { closed++; this.state = "closed"; return Promise.resolve(); }
  } };
  try {
    const sounds = module.exports.createChestSounds();
    sounds.tick(); sounds.reveal(true);
    assert.equal(contexts, 0, "no automatic audio context before a user gesture");
    assert.equal(notes, 0);
    sounds.unlock(); sounds.tick(); sounds.reveal(true); sounds.unlock();
    assert.equal(contexts, 1, "all stages share the user-activated context");
    assert.ok(notes > 4);
    sounds.close(); sounds.close();
    assert.equal(closed, 1);
    const before = notes; sounds.tick(); sounds.reveal(true);
    assert.equal(notes, before, "muting/exit stops later sounds too");
    sounds.unlock(); assert.equal(contexts, 2); sounds.close();
    globalThis.window.AudioContext = class { constructor() { throw new Error("Audio unavailable"); } };
    assert.doesNotThrow(() => { sounds.unlock(); sounds.tick(); sounds.reveal(false); sounds.close(); });
  } finally { globalThis.window = originalWindow; }
});
