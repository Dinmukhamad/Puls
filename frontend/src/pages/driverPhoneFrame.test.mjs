import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const built = await transform(readFileSync(new URL("./driverPhoneFrame.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { inkFor, phoneExit, phoneFit, readPhoneMessage, staysInPhone } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);
const origin = "https://puls.example";

test("the phone keeps its real size on a monitor and shrinks whole on a short laptop screen", () => {
  assert.deepEqual(phoneFit(1080), { screen: 844, scale: 1 });
  // 900px window: the screen gets shorter first, the text stays full size.
  assert.deepEqual(phoneFit(900), { screen: 822, scale: 1 });
  // 1366×768 laptop: below 640px of screen the whole phone scales instead.
  const laptop = phoneFit(657);
  assert.equal(laptop.screen, 640);
  assert.ok(laptop.scale > 0.9 && laptop.scale < 0.91);
  assert.ok((laptop.screen + 30) * laptop.scale <= 657 - 48, "the phone fits between the margins");
});

test("only the driver app stays inside the phone", () => {
  assert.equal(staysInPhone("/simulator"), true);
  assert.equal(phoneExit("/simulator?section=money&view=balance", origin), null);
  assert.equal(phoneExit(`${origin}/training/city?district=driver`, origin), "/training/city?district=driver");
  assert.equal(phoneExit("/profile#telegram", origin), "/profile#telegram");
  assert.equal(phoneExit("/simulator/attempts/5", origin), "/simulator/attempts/5", "the older simulator opens in Puls");
  assert.equal(phoneExit("https://t.me/puls_i_bot", origin), null, "external links keep their own behaviour");
});

test("messages from the phone are checked before the page acts on them", () => {
  assert.deepEqual(readPhoneMessage({ type: "puls:phone-location", path: "/simulator?section=money" }), { type: "puls:phone-location", path: "/simulator?section=money" });
  assert.equal(readPhoneMessage({ type: "puls:phone-location", path: "/admin/users" }), null, "the address mirror never leaves the simulator");
  assert.deepEqual(readPhoneMessage({ type: "puls:phone-leave", path: "/training/city?district=driver" }), { type: "puls:phone-leave", path: "/training/city?district=driver" });
  for (const path of ["//evil.example/x", "/\\evil.example", "https://evil.example", "training", 42]) {
    assert.equal(readPhoneMessage({ type: "puls:phone-leave", path }), null, String(path));
  }
  assert.deepEqual(readPhoneMessage({ type: "puls:phone-signed-out" }), { type: "puls:phone-signed-out" });
  assert.deepEqual(readPhoneMessage({ type: "puls:phone-colors", top: "rgb(8, 8, 8)", bottom: "rgba(0, 0, 0, 0.7)" }), { type: "puls:phone-colors", top: "rgb(8, 8, 8)", bottom: "rgba(0, 0, 0, 0.7)" });
  assert.equal(readPhoneMessage({ type: "puls:phone-colors", top: "red; background: url(x)", bottom: "rgb(0, 0, 0)" }), null);
  assert.equal(readPhoneMessage({ type: "something-else" }), null);
  assert.equal(readPhoneMessage("puls:phone-signed-out"), null);
});

test("the status bar is dark on a light app and light on a dark one", () => {
  assert.equal(inkFor("rgb(8, 8, 8)"), "light");
  assert.equal(inkFor("rgb(246, 245, 242)"), "dark");
  assert.equal(inkFor("rgb(136, 136, 136)"), "dark", "mid grey reads better with dark text");
  assert.equal(inkFor("rgba(255, 255, 255, 0.2)"), "light", "a faint layer over the black screen is dark");
  assert.equal(inkFor("rgb(255 255 255 / 90%)"), "dark");
  assert.equal(inkFor("not a colour"), "light");
});

test("the operator hint from photo control reaches the page only in its expected shape", () => {
  const coach = { title: "Водитель открыл фотоконтроль", body: [["Что на экране", "Советы перед съёмкой"], ["Что сказать водителю", "Найдите светлое место"]] };
  assert.deepEqual(readPhoneMessage({ type: "puls:phone-coach", coach }), { type: "puls:phone-coach", coach });
  assert.deepEqual(readPhoneMessage({ type: "puls:phone-coach", coach: null }), { type: "puls:phone-coach", coach: null });
  assert.equal(readPhoneMessage({ type: "puls:phone-coach" }), null);
  assert.equal(readPhoneMessage({ type: "puls:phone-coach", coach: { title: "Камера", body: [["Без текста"]] } }), null);
  assert.equal(readPhoneMessage({ type: "puls:phone-coach", coach: { title: "x".repeat(201), body: [] } }), null);
  assert.equal(readPhoneMessage({ type: "puls:phone-coach", coach: { title: "Камера", body: Array(9).fill(["a", "b"]) } }), null);
});
