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
const { prizeSticker, prizeChances } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);

const wheel = [
  { title: "В этот раз без награды", coins: 0, weight: 1 },
  { title: "5 коинов", coins: 5, weight: 1 },
  { title: "10 коинов", coins: 10, weight: 1 },
  { title: "100 коинов", coins: 100, weight: 1 },
  { title: "1000 коинов", coins: 1000, weight: 4 },
];

test("the biggest reward gets the brightest sticker and an empty sector gets a clover", () => {
  assert.deepEqual(wheel.map((prize) => prizeSticker(prize, wheel).icon), ["🍀", "🪙", "💰", "🏆", "💎"]);
  assert.equal(prizeSticker({ coins: 5 }, [{ coins: 5 }, { coins: 5 }]).icon, "🎁");
  assert.equal(prizeSticker({ coins: 7 }, [{ coins: 7 }, { coins: 9 }]).icon, "🪙");
  assert.equal(prizeSticker({ coins: 9 }, [{ coins: 7 }, { coins: 9 }]).icon, "💎");
  assert.equal(prizeSticker({ coins: -3 }, wheel).icon, "🍀");
});

test("chances follow the weights and never divide by zero", () => {
  assert.deepEqual(prizeChances(wheel), [12.5, 12.5, 12.5, 12.5, 50]);
  assert.deepEqual(prizeChances([{ weight: 0 }, { weight: 0 }]), [0, 0]);
  assert.deepEqual(prizeChances([]), []);
});

test("the prize strip is a site card and shows its prizes behind a sticker button", async () => {
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
  assert.match(html, /class="wheel-prizes-button" aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /История розыгрышей|Вероятности указаны|wheel-legend/);
  // Лента удачи — обычная карточка сайта: название в шапке, рядом звук и призы.
  // Лента собрана из разметки, а не нарисована на холсте, поэтому берёт шрифты,
  // цвета и тёмную тему из общих стилей.
  assert.match(html, /<h2 class="card__title">Лента удачи<\/h2>/);
  assert.doesNotMatch(html, /Колес|КОЛЕСО|<canvas/);
  assert.match(html, /aria-label="Выключить звук" title="Выключить звук" aria-pressed="false"/);
  assert.match(html, /class="prize-strip__tile is-current"[^>]*><span class="prize-strip__sticker"[^>]*>🍀<\/span><span class="prize-strip__title">В этот раз без награды<\/span><span class="prize-strip__reward prize-strip__reward--none">без награды<\/span>/);
  assert.match(html, /💎<\/span><span class="prize-strip__title">1000 коинов<\/span><span class="prize-strip__reward">\+1\s000 коинов<\/span>/);
  assert.match(html, /<div class="prize-strip__window"><\/div>/);
  assert.match(html, />Крутить<\/button><p class="wheel-card__note">Бесплатно · осталось 1 из 1 · попытки обновляются в 00:00 UTC<\/p>/);
  assert.deepEqual(queries, ["wheel"]);
  // Выключенная лента не обещает попыток, которые нельзя потратить.
  config.enabled = false;
  const off = renderToStaticMarkup(React.createElement(GamesPage));
  assert.match(off, />Скоро вернёмся<\/button><p class="wheel-card__note">Сейчас лента удачи выключена\. Попытки появятся, когда её снова включат\.<\/p>/);
  assert.doesNotMatch(off, /осталось/);
  const prizes = renderToStaticMarkup(React.createElement(PrizeStickers, { segments: wheel }));
  assert.equal((prizes.match(/class="prize-sticker-card"/g) ?? []).length, 5);
  assert.match(prizes, /💎<\/span><strong class="prize-sticker-card__title">1000 коинов<\/strong><span class="prize-sticker-card__reward">\+1\s000 коинов<\/span><span class="prize-sticker-card__chance">Шанс 50%<\/span>/);
  assert.match(prizes, /🍀<\/span><strong class="prize-sticker-card__title">В этот раз без награды<\/strong><span class="prize-sticker-card__chance">Шанс 12,5%/);
});
