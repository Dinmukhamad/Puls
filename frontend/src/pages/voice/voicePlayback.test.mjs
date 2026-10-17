import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const built = await build({
  entryPoints: [fileURLToPath(new URL("./voicePlayback.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
const { rankRussianVoices, createVoicePlaybackPlan } = loaded.exports;
const voice = (name, lang = "ru-RU", extra = {}) => ({ name, lang, default: false, localService: true, voiceURI: name, ...extra });

test("Russian natural voices outrank basic voices regardless of local availability", () => {
  const basic = voice("Microsoft Pavel Desktop", "ru-RU", { default: true });
  const natural = voice("Microsoft Svetlana Online (Natural)", "ru_RU", { localService: false });
  const neural = voice("Dmitry Neural");
  const voices = Object.freeze([basic, natural, neural]);
  assert.deepEqual(rankRussianVoices(voices), [neural, natural, basic]);
  assert.deepEqual(voices, [basic, natural, neural]);
});

test("a foreign default is never selected and locale matching is exact", () => {
  const russian = voice("Google русский", "RU_ru");
  assert.deepEqual(rankRussianVoices([
    voice("Natural English", "en-US", { default: true }),
    voice("Ruby", "ruby"), voice("Russian sounding name", "uk-UA"), russian,
  ]), [russian]);
  assert.deepEqual(rankRussianVoices([voice("Pavel Natural", "en-US")]), []);
});

test("Chrome's named Google Russian voice outranks legacy desktop but not Natural", () => {
  const desktop = voice("Microsoft Pavel Desktop", "ru-RU", { default: true });
  const google = voice("Google русский", "ru-RU", { localService: false });
  const natural = voice("Microsoft Svetlana Online (Natural)", "ru-RU", { localService: false });
  const unknownRemote = voice("Unknown service", "ru-RU", { localService: false });
  assert.deepEqual(rankRussianVoices([desktop, google, unknownRemote, natural]), [natural, google, desktop, unknownRemote]);
});

test("known male names break quality ties; unknown voices retain default and stable order", () => {
  const first = voice("First Premium");
  const second = voice("Second Enhanced");
  const standardDefault = voice("Default Russian", "ru-RU", { default: true });
  const male = voice("Yuri Premium");
  const naturalDefault = voice("Default Neural", "ru-RU", { default: true });
  assert.deepEqual(rankRussianVoices([standardDefault, first, second, naturalDefault, male]), [male, naturalDefault, first, second, standardDefault]);
  assert.deepEqual(rankRussianVoices([voice("Unknown A"), voice("Unknown B"), standardDefault]).map((item) => item.name), ["Default Russian", "Unknown A", "Unknown B"]);
});

test("TTS substitutions keep punctuation and leave the display transcript untouched", () => {
  const text = "Старой SIM-карты нет. Можно через WhatsApp? Проверьте OKTEL и SIM.";
  const result = createVoicePlaybackPlan(text, "calm");
  assert.deepEqual(result.map((item) => item.text), ["Старой сим-карты нет.", "Можно через ватсап?", "Проверьте Октел и сим."]);
  assert.equal(text, "Старой SIM-карты нет. Можно через WhatsApp? Проверьте OKTEL и SIM.");
  assert.equal(createVoicePlaybackPlan("eSIM и WhatsApplication", "calm")[0].text, "eSIM и WhatsApplication");
});

test("numbers, initials, abbreviations and quoted questions are not incorrectly fragmented", () => {
  const text = "Я И. И. Иванов из г. Алматы. Баланс 12.50, версия 2.24.88. Номер +7 777 123 45 67. Что делать? «Можно в приложении?» Да.";
  const chunks = createVoicePlaybackPlan(text, "calm").map((item) => item.text);
  assert.deepEqual(chunks, [
    "Я И. И. Иванов из г. Алматы.",
    "Баланс 12.50, версия 2.24.88.", "Номер +7 777 123 45 67.", "Что делать?",
    "«Можно в приложении?»", "Да.",
  ]);
  assert.equal(chunks.join(" "), text);
  assert.deepEqual(createVoicePlaybackPlan("1. Откройте аккаунт. 2. Сверьте номер.", "calm").map((item) => item.text), ["1. Откройте аккаунт.", "2. Сверьте номер."]);
});

test("personas use bounded, deterministic prosody with a subtle question rise", () => {
  const text = "Здравствуйте. Как мне поменять номер? Старой сим-карты нет. Я вас слушаю.";
  const byPersona = Object.fromEntries(["calm", "confused", "hurried", "irritated"].map((persona) => [persona, createVoicePlaybackPlan(text, persona)]));
  for (const [persona, plan] of Object.entries(byPersona)) {
    assert.deepEqual(plan, createVoicePlaybackPlan(text, persona));
    assert.equal(plan.at(-1).pauseAfterMs, 0);
    assert.ok(plan[1].pitch > plan[0].pitch);
    assert.ok(new Set(plan.map((item) => item.rate)).size > 1);
    for (const segment of plan) {
      assert.ok(segment.rate >= 0.9 && segment.rate <= 1.12);
      assert.ok(segment.pitch >= 0.96 && segment.pitch <= 1.04);
      assert.ok(segment.pauseAfterMs >= 0 && segment.pauseAfterMs <= 260);
    }
  }
  assert.ok(byPersona.hurried[0].rate > byPersona.calm[0].rate);
  assert.ok(byPersona.confused[0].rate < byPersona.calm[0].rate);
  assert.ok(byPersona.confused[0].pauseAfterMs > byPersona.hurried[0].pauseAfterMs);
});

test("long speech uses phrase or word boundaries without losing words or splitting a phone number", () => {
  const introduction = "Мне нужно разобраться, потому что ";
  const text = introduction + "я уже несколько раз пытался изменить данные в приложении и не понимаю, почему это не получается, а номер регистрации сейчас недоступен; " + "пожалуйста ".repeat(12) + "+7 777 123 45 67 поможет найти мой аккаунт?";
  const plan = createVoicePlaybackPlan(text, "confused");
  assert.ok(plan.length > 1);
  assert.equal(plan.map((item) => item.text).join(" "), text);
  assert.ok(plan.some((item) => item.text.includes("+7 777 123 45 67")));
  assert.ok(plan.slice(0, -1).every((item) => item.pauseAfterMs <= 120));
  assert.ok(plan.every((item) => item.text.length <= 220));
});

test("blank input creates no audio and a single unbroken word is preserved", () => {
  assert.deepEqual(createVoicePlaybackPlan(" \n\t ", "calm"), []);
  const longWord = "а".repeat(250);
  assert.equal(createVoicePlaybackPlan(longWord, "calm")[0].text, longWord);
});
