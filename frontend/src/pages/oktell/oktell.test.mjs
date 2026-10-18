import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = fileURLToPath(new URL(".", import.meta.url));
const built = await build({ stdin: { contents: "export * from './oktellTour.ts'; export * from './oktellDial.ts'; export * from './oktellVoice.ts';", resolveDir: here, loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
const { OKTELL_TOUR, checkDial, looksLikeNumber, formatNumber, callsBlocked, readyForCall, nextRingDelay, answerReady, formatCaller, SILENCE_MS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const site = readFileSync(new URL("./OktellSite.tsx", import.meta.url), "utf8");
const PARKS = { "0880": "iTaxi" };
const at = (target, from = 0) => OKTELL_TOUR.findIndex((step, i) => i >= from && step.target === target);

test("every Oktell step is short, and a step that waits lets the learner act", () => {
  for (const step of OKTELL_TOUR) {
    assert.ok(step.target && step.title, step.title);
    assert.ok(step.text.length > 20 && step.text.length < 200, step.title);
    if (step.advanceWhen || step.waitClick) assert.ok(step.action, `${step.title} waits but the lit element is locked`);
  }
});

test("the walk follows the team's order: phone, cabinet, messages, journal, then the statuses", () => {
  const order = ["[data-coach=oktell-people]", "[data-coach=oktell-join]", "[data-coach=oktell-nav-messages]", "[data-coach=oktell-nav-journal]", "[data-coach=oktell-status]", "[data-coach=oktell-automatic]", "[data-coach=oktell-phone-settings]", "[data-coach=oktell-manual]", "[data-coach=oktell-pauses]", "[data-coach=oktell-pause-callback]", "[data-coach=oktell-dial]", "[data-coach=oktell-dial-call]", "[data-coach=oktell-resume]", "[data-coach=oktell-play]"];
  const places = order.map(target => at(target));
  assert.ok(places.every(place => place >= 0), places.join());
  assert.deepEqual([...places].sort((a, b) => a - b), places);
  const colours = OKTELL_TOUR[at("[data-coach=oktell-people]")].text;
  assert.match(colours, /Красным/); assert.match(colours, /чёрным/);
});

test("the callback is practised with the park's code and the three-minute limit is told twice", () => {
  const dial = OKTELL_TOUR[at("[data-coach=oktell-dial]")];
  assert.match(dial.text, /0880/); assert.match(dial.text, /без плюса/);
  assert.equal(checkDial(dial.text.match(/\d{15}/)[0], PARKS).ok, true, "the example in the bubble must be dialable");
  assert.match(OKTELL_TOUR[at("[data-coach=oktell-pause-callback]")].text, /3 минут/);
  assert.match(OKTELL_TOUR[at("[data-coach=oktell-resume]")].text, /3 минут/);
  // A forced logout during the walk leads back in instead of pointing at what is gone.
  const kicked = OKTELL_TOUR.find(step => step.when === "[data-coach=oktell-kicked]");
  assert.ok(kicked && kicked.advanceWhen === "[data-coach=oktell-workspace]");
  for (const step of OKTELL_TOUR.slice(at("[data-coach=oktell-pause-callback]") + 1, OKTELL_TOUR.indexOf(kicked))) assert.equal(step.when, "[data-coach=oktell-workspace]", step.title);
});

test("every place Pulsar points at is marked in the Oktell workspace", () => {
  const templates = { "oktell-nav-": ["phone", "cabinet", "messages", "journal"], "oktell-pause-": ["technical", "callback", "training", "break"], "oktell-": ["automatic", "manual"] };
  const names = new Set(OKTELL_TOUR.flatMap(step => [step.target, step.advanceWhen, step.when, step.allow].filter(Boolean)).flatMap(selector => [...selector.matchAll(/data-coach=([\w-]+)/g)].map(match => match[1])));
  for (const name of names) {
    const literal = site.includes(`"${name}"`);
    const templated = Object.entries(templates).some(([prefix, ids]) => site.includes(`data-coach={\`${prefix}\${`) && ids.some(id => `${prefix}${id}` === name));
    assert.ok(literal || templated, name);
  }
});

test("a driver's number is the park's code, then 11 digits from 7 without «+»", () => {
  assert.deepEqual(checkDial("0880 7 707 505 36 36", PARKS), { ok: true, digits: "088077075053636", code: "0880", park: "iTaxi", phone: "77075053636" });
  for (const [typed, hint] of [["+77075053636", "без «+»"], ["0880+77075053636", "без «+»"], ["77075053636", "код таксопарка: iTaxi — 0880"], ["87075053636", "код таксопарка"], ["0880", "номер водителя с 7"], ["088087075053636", "начинается с 7"], ["0880770750536", "ещё 2 цифры"], ["08807707505363", "ещё 1 цифра"], ["08807", "ещё 10 цифр"], ["0880770750536367", "11 цифр"], ["0880 (707)", "цифрами"]]) {
    const result = checkDial(typed, PARKS);
    assert.equal(result.ok, false, typed); assert.ok(result.hint.includes(hint), `${typed}: ${result.hint}`);
  }
  assert.equal(looksLikeNumber("Айдана"), false);
  assert.equal(looksLikeNumber("6601", ["6601"]), false, "an extension finds the colleague");
  assert.equal(looksLikeNumber("660"), false);
  assert.equal(looksLikeNumber("0880 7"), true);
  assert.equal(formatNumber("088077075053636", PARKS), "0880 · 7 707 505 36 36");
  assert.equal(formatNumber("6602", PARKS), "6602");
});

const line = (patch = {}) => ({ voice_calls: true, logged_in: true, center_joined: true, web_phone: true, pause_reason: null, center_mode: "automatic", office_status: "available", active_call: null, ringing: null, ...patch });

test("a driver calls only an operator who takes calls, and the cabinet says why one does not", () => {
  assert.equal(callsBlocked(line()), "");
  assert.equal(readyForCall(line()), true);
  for (const [patch, reason] of [
    [{ voice_calls: false }, "недоступны"], [{ logged_in: false }, "Войдите в Oktell"], [{ center_joined: false }, "call-центр"],
    [{ web_phone: false }, "Веб-телефон"], [{ pause_reason: "callback" }, "паузе"], [{ center_mode: "manual" }, "автоматический"], [{ office_status: "dnd" }, "На связи"],
  ]) {
    assert.match(callsBlocked(line(patch)), new RegExp(reason), JSON.stringify(patch));
    assert.equal(readyForCall(line(patch)), false);
  }
  // One driver at a time: nothing rings during a call or over another ringing call.
  assert.equal(readyForCall(line({ active_call: { id: "a" } })), false);
  assert.equal(readyForCall(line({ ringing: { id: "r" } })), false);
});

test("the first driver calls soon, the next after a pause; a pause in speech sends the answer", () => {
  assert.equal(nextRingDelay(true, () => 0), 5000);
  assert.equal(nextRingDelay(true, () => 1), 9000);
  assert.equal(nextRingDelay(false, () => 0), 15000);
  assert.equal(nextRingDelay(false, () => 1), 25000);
  assert.equal(answerReady("Здравствуйте", 1000, 1000 + SILENCE_MS), true);
  assert.equal(answerReady("Здравствуйте", 1000, 1000 + SILENCE_MS - 1), false, "still speaking");
  assert.equal(answerReady(" а ", 0, 10000), false, "a sound is not an answer");
  assert.equal(formatCaller("+77015550192"), "+7 701 555 01 92");
  assert.equal(formatCaller("6602"), "6602");
});

test("the call lives in Oktell: its panel, the cabinet's line and the journal's review link", () => {
  const call = readFileSync(new URL("./OktellVoiceCall.tsx", import.meta.url), "utf8");
  const pages = readFileSync(new URL("../WorkSitesPage.tsx", import.meta.url), "utf8");
  assert.match(site, /data-coach="oktell-voice"/);
  assert.match(site, /action: "voice_language"/);
  assert.match(site, /\/training\/voice\/attempts\/\$\{call\.voice_attempt_id\}/);
  assert.match(call, /action: "ring"/);
  assert.match(call, /action: "answer"/);
  assert.match(call, /state\.auto_answer/);
  // No driver rings while Pulsar walks the operator through Oktell or before Oktell is opened.
  assert.match(pages, /<OktellVoiceCall quiet=\{!!coach \|\| !oktellOpened\}/);
});
