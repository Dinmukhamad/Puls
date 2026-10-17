import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./useVoiceSpeech.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Persistent hook state, browser event dispatch and an explicit unmount. */
function fixture(t, { recognition = true, synthesis = true, server = false } = {}) {
  const original = new Map(["window", "navigator", "SpeechSynthesisUtterance"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const calls = { streamsStopped: 0, micRequests: 0, synthesisCancelled: 0, afterUnmountUpdates: 0, transcripts: [] };
  let mounted = true;
  const recognizers = [];
  const utterances = [];
  class FakeRecognition {
    start() { this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    result(parts) {
      this.onresult?.({ results: parts.map(([text, isFinal]) => ({ 0: { transcript: text }, length: 1, isFinal })) });
    }
    constructor() { recognizers.push(this); }
  }
  const stream = { getTracks: () => [{ stop: () => { calls.streamsStopped++; } }] };
  const mediaDevices = {
    async getUserMedia() { calls.micRequests++; return stream; },
  };
  const speechSynthesis = {
    getVoices: () => [],
    speak: (utterance) => { utterances.push(utterance); },
    cancel: () => { calls.synthesisCancelled++; },
  };
  const testWindow = {
    isSecureContext: true,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args), clearInterval: (...args) => clearInterval(...args),
    ...(recognition ? { SpeechRecognition: FakeRecognition } : {}),
    ...(synthesis ? { speechSynthesis } : {}),
  };
  if (server) {
    delete globalThis.window;
    delete globalThis.navigator;
    delete globalThis.SpeechSynthesisUtterance;
  } else {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: testWindow });
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { mediaDevices } });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      configurable: true, writable: true,
      value: synthesis ? class { constructor(text) { this.text = text; } } : undefined,
    });
  }
  const slots = [];
  let cursor = 0;
  const effects = [];
  const equal = (previous, next) => previous && next && previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));
  const react = {
    useState(initial) {
      const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (next) => {
        if (!mounted) calls.afterUnmountUpdates++;
        slot.value = typeof next === "function" ? next(slot.value) : next;
      }];
    },
    useRef(current) { return slots[cursor++] ??= { current }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !equal(previous.deps, deps)) {
        const slot = { deps, cleanup: previous?.cleanup };
        slots[index] = slot;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((name) => name === "react" ? react : require(name), module, module.exports);
  let disposed = false;
  const hook = {
    calls, recognizers, utterances, mediaDevices, stream, testWindow,
    render() {
      cursor = 0;
      const result = module.exports.useVoiceSpeech({ onTranscript: (text) => calls.transcripts.push(text) });
      effects.splice(0).forEach((effect) => effect());
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      slots.forEach((slot) => slot.cleanup?.());
      mounted = false;
    },
  };
  t.after(() => {
    hook.dispose();
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  hook.render();
  return hook;
}

test("server rendering and unsupported recognition expose a usable text fallback", async (t) => {
  const hook = fixture(t, { server: true });
  assert.deepEqual(hook.render().support, { recognition: false, synthesis: false, microphone: false });
  assert.equal(await hook.render().startRecording(), false);
  assert.match(hook.render().error, /Введи ответ текстом/);
  assert.equal(hook.calls.micRequests, 0);
});

test("recognition accumulates final and interim phrases and waits for final stop before review", async (t) => {
  const hook = fixture(t);
  assert.equal(await hook.render().startRecording(), true);
  const recognizer = hook.recognizers[0];
  assert.equal(recognizer.lang, "ru-RU");
  assert.equal(hook.calls.streamsStopped, 1, "permission check releases its media stream");
  recognizer.result([["Проверьте номер", true], ["в приложении", false]]);
  assert.equal(hook.render().transcript, "Проверьте номер");
  assert.equal(hook.render().interimTranscript, "в приложении");
  assert.equal(hook.calls.transcripts.at(-1), "Проверьте номер в приложении");
  hook.render().stopRecording();
  assert.equal(hook.render().recording, true, "the recognizer still has time to emit a final result");
  recognizer.result([["Проверьте номер", true], ["в приложении Яндекса", true]]);
  recognizer.onend();
  assert.equal(hook.render().recording, false);
  assert.equal(hook.render().transcript, "Проверьте номер в приложении Яндекса");
  assert.equal(hook.render().interimTranscript, "");
});

test("permission errors and failed rerecording preserve the previous reviewed answer", async (t) => {
  const hook = fixture(t);
  await hook.render().startRecording();
  hook.recognizers[0].result([["Можно обратиться в WhatsApp", true]]);
  hook.recognizers[0].onend();
  await hook.render().startRecording();
  hook.recognizers[1].onerror({ error: "not-allowed" });
  hook.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error("permission"), { name: "NotAllowedError" }); };
  assert.equal(await hook.render().startRecording(), false);
  assert.match(hook.render().error, /Нет доступа/);
  assert.equal(hook.render().transcript, "Можно обратиться в WhatsApp");
  assert.equal(hook.calls.transcripts.at(-1), "Можно обратиться в WhatsApp");
  assert.equal(hook.render().micChecked, false);
});

test("a recognition error makes the current interim answer reviewable", async (t) => {
  const hook = fixture(t);
  await hook.render().startRecording();
  hook.recognizers[0].result([["Откройте приложение", false]]);
  hook.recognizers[0].onerror({ error: "network" });
  assert.equal(hook.render().recording, false);
  assert.equal(hook.render().transcript, "Откройте приложение");
  assert.equal(hook.render().interimTranscript, "");
  assert.match(hook.render().error, /Этап разговора сохранён/);
});

test("a microphone permission grant arriving after unmount immediately releases its stream", async (t) => {
  const hook = fixture(t);
  const permission = deferred();
  hook.mediaDevices.getUserMedia = () => permission.promise;
  const pending = hook.render().startRecording();
  hook.dispose();
  permission.resolve(hook.stream);
  assert.equal(await pending, false);
  assert.equal(hook.calls.streamsStopped, 1);
  assert.equal(hook.calls.afterUnmountUpdates, 0);
  assert.equal(hook.recognizers.length, 0);
});

test("the explicit microphone check measures a brief signal and closes all media resources", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const hook = fixture(t);
  const contexts = [];
  hook.testWindow.AudioContext = class {
    state = "running";
    constructor() { contexts.push(this); }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData: (values) => values.fill(140) }; }
    createMediaStreamSource() { return { connect() {} }; }
    async resume() {}
    async close() { this.state = "closed"; }
  };
  const pending = hook.render().checkMicrophone();
  await Promise.resolve();
  t.mock.timers.tick(480);
  assert.equal(await pending, true);
  assert.equal(hook.render().micSignal, "detected");
  assert.equal(hook.render().micChecked, true);
  assert.equal(hook.calls.streamsStopped, 1);
  assert.equal(contexts[0].state, "closed");
});

test("a stuck recognition stop times out into review without losing the draft", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t);
  await hook.render().startRecording();
  hook.recognizers[0].result([["Позвоните с номера регистрации", false]]);
  hook.render().stopRecording();
  t.mock.timers.tick(1500);
  assert.equal(hook.render().recording, false);
  assert.equal(hook.render().transcript, "Позвоните с номера регистрации");
  assert.equal(hook.recognizers[0].aborted, true);
});

test("TTS requests Russian even before voices load and settles on end or cancellation", async (t) => {
  const hook = fixture(t);
  const completed = hook.render().speak("Здравствуйте!");
  assert.equal(hook.utterances[0].lang, "ru-RU");
  assert.equal(hook.render().speaking, true);
  hook.utterances[0].onend();
  assert.equal(await completed, true);
  const cancelled = hook.render().speak("Я потерял SIM-карту.");
  hook.render().stopSpeaking();
  assert.equal(await cancelled, false);
  assert.equal(hook.render().speaking, false);
  assert.equal(hook.calls.synthesisCancelled, 1);
});

test("muting aborts microphone input while preserving the answer and driver playback", async (t) => {
  const hook = fixture(t);
  await hook.render().startRecording();
  hook.recognizers[0].result([["Давайте проверим", false]]);
  hook.render().setMuted(true);
  assert.equal(hook.render().recording, false);
  assert.equal(hook.render().transcript, "Давайте проверим");
  assert.equal(hook.recognizers[0].aborted, true);
  assert.equal(await hook.render().startRecording(), false);
  const playback = hook.render().speak("Что мне делать дальше?");
  assert.equal(hook.render().speaking, true);
  hook.render().setMuted(true);
  assert.equal(hook.render().speaking, true);
  hook.utterances[0].onend();
  assert.equal(await playback, true);
});

test("driver playback cancels a pending input request so it cannot record its own speech", async (t) => {
  const hook = fixture(t);
  const permission = deferred();
  hook.mediaDevices.getUserMedia = () => permission.promise;
  const input = hook.render().startRecording();
  const playback = hook.render().speak("Алло!");
  permission.resolve(hook.stream);
  assert.equal(await input, false);
  assert.equal(hook.recognizers.length, 0);
  assert.equal(hook.calls.streamsStopped, 1);
  hook.dispose();
  assert.equal(await playback, false);
  assert.equal(hook.calls.synthesisCancelled, 1);
});
