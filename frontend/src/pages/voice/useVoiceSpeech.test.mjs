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

const russianVoice = { voiceURI: "ru-test", name: "Pavel", lang: "ru-RU", localService: true, default: false };
const naturalRussianVoice = { voiceURI: "ru-natural", name: "Dmitry Natural", lang: "ru-RU", localService: false, default: false };
const flushEvents = async () => { await Promise.resolve(); await Promise.resolve(); };

/** Persistent hook state, browser event dispatch and an explicit unmount. */
function fixture(t, { recognition = true, synthesis = true, server = false, voices = [russianVoice] } = {}) {
  const original = new Map(["window", "navigator", "SpeechSynthesisUtterance", "localStorage", "Audio"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const calls = { streamsStopped: 0, micRequests: 0, synthesisCancelled: 0, afterUnmountUpdates: 0, transcripts: [] };
  let mounted = true;
  const recognizers = [];
  const utterances = [];
  const audios = [];
  const createdUrls = [], revokedUrls = [];
  const originalCreateUrl = URL.createObjectURL, originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { const url = `blob:voice-${createdUrls.length}`; createdUrls.push({ url, blob }); return url; };
  URL.revokeObjectURL = (url) => revokedUrls.push(url);
  class FakeAudio {
    constructor() { audios.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
    load() { this.unloaded = true; }
  }
  Object.defineProperty(globalThis, "Audio", { configurable: true, writable: true, value: FakeAudio });
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
  let availableVoices = voices;
  const speechListeners = new Map();
  const speechSynthesis = {
    getVoices: () => availableVoices,
    speak: (utterance) => { utterances.push(utterance); },
    cancel: () => { calls.synthesisCancelled++; },
    addEventListener(type, listener) {
      if (!speechListeners.has(type)) speechListeners.set(type, new Set());
      speechListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { speechListeners.get(type)?.delete(listener); },
  };
  const stored = new Map();
  const localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  };
  const testWindow = {
    isSecureContext: true,
    localStorage,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args), clearInterval: (...args) => clearInterval(...args),
    ...(recognition ? { SpeechRecognition: FakeRecognition } : {}),
    ...(synthesis ? { speechSynthesis } : {}),
  };
  if (server) {
    delete globalThis.window;
    delete globalThis.navigator;
    delete globalThis.SpeechSynthesisUtterance;
    delete globalThis.localStorage;
  } else {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: testWindow });
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { mediaDevices } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: localStorage });
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
    calls, recognizers, utterances, audios, createdUrls, revokedUrls, mediaDevices, stream, testWindow, localStorage,
    voiceListeners() { return speechListeners.get("voiceschanged")?.size ?? 0; },
    setVoices(next, emit = true) {
      availableVoices = next;
      if (emit) this.emitVoicesChanged();
    },
    emitVoicesChanged() {
      const event = { type: "voiceschanged" };
      [...(speechListeners.get("voiceschanged") ?? [])].forEach((listener) => listener(event));
      speechSynthesis.onvoiceschanged?.(event);
    },
    render() {
      cursor = 0;
      const result = module.exports.useVoiceSpeech({ onTranscript: (text) => calls.transcripts.push(text), voicePreferenceKey: "test-voice" });
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
    URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl;
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

test("TTS requests Russian and settles on end or cancellation", async (t) => {
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

test("late Russian voices are used once without replaying the current driver line", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t, { voices: [] });
  const speak = hook.render().speak;
  const playback = speak("Здравствуйте!", "calm");
  assert.equal(hook.render().speaking, true);
  assert.equal(hook.utterances.length, 0, "wait briefly instead of selecting a browser fallback too soon");
  t.mock.timers.tick(200);
  hook.setVoices([russianVoice, naturalRussianVoice]);
  await flushEvents();
  assert.equal(hook.utterances.length, 1);
  assert.equal(hook.utterances[0].voice.voiceURI, naturalRussianVoice.voiceURI);
  assert.equal(hook.utterances[0].lang, "ru-RU");
  assert.equal(hook.render().russianVoices.length, 2);
  assert.equal(hook.render().speak, speak, "voice availability must not restart the page playback effect");
  hook.emitVoicesChanged();
  t.mock.timers.tick(700);
  await flushEvents();
  assert.equal(hook.utterances.length, 1);
  hook.utterances[0].onend();
  assert.equal(await playback, true);
  assert.equal(hook.render().speaking, false);
});

test("missing Russian voices have a bounded wait and keep the Russian language fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const english = { ...russianVoice, voiceURI: "en-test", name: "English", lang: "en-US", default: true };
  const hook = fixture(t, { voices: [english] });
  const playback = hook.render().speak("Алло!", "calm");
  t.mock.timers.tick(699);
  await flushEvents();
  assert.equal(hook.utterances.length, 0);
  assert.equal(hook.render().speaking, true);
  t.mock.timers.tick(1);
  await flushEvents();
  assert.equal(hook.utterances.length, 1);
  assert.equal(hook.utterances[0].lang, "ru-RU");
  assert.equal(hook.utterances[0].voice == null, true, "never explicitly select a foreign default");
  hook.utterances[0].onend();
  assert.equal(await playback, true);
});

test("cancelling delayed voice loading settles immediately and prevents late playback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t, { voices: [] });
  const baselineListeners = hook.voiceListeners();
  const playback = hook.render().speak("Здравствуйте!", "calm");
  hook.render().stopSpeaking();
  assert.equal(await playback, false);
  assert.equal(hook.render().speaking, false);
  assert.equal(hook.voiceListeners(), baselineListeners, "release session listeners while retaining the catalog listener");
  hook.setVoices([russianVoice]);
  t.mock.timers.tick(1000);
  await flushEvents();
  assert.equal(hook.utterances.length, 0);
});

test("unmount during delayed voice loading releases listeners without late state updates", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t, { voices: [] });
  const playback = hook.render().speak("Здравствуйте!", "calm");
  hook.dispose();
  assert.equal(await playback, false);
  assert.equal(hook.voiceListeners(), 0);
  hook.setVoices([russianVoice]);
  t.mock.timers.tick(1000);
  await flushEvents();
  assert.equal(hook.utterances.length, 0);
  assert.equal(hook.calls.afterUnmountUpdates, 0);
});

test("sentence pauses retain speaking state and complete only after the last sentence", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t);
  let settled = false;
  const playback = hook.render().speak("Здравствуйте! Я потерял SIM-карту.", "calm").then((completed) => { settled = true; return completed; });
  assert.equal(hook.utterances.length, 1, "enqueue one sentence at a time");
  hook.utterances[0].onend();
  await flushEvents();
  assert.equal(settled, false);
  assert.equal(hook.render().speaking, true, "the microphone must stay blocked during a speech pause");
  assert.equal(hook.utterances.length, 1);
  t.mock.timers.tick(1000);
  await flushEvents();
  assert.equal(hook.utterances.length, 2);
  assert.match(hook.utterances[1].text, /Я потерял сим-карту/);
  assert.equal(hook.render().speaking, true);
  hook.utterances[1].onend();
  assert.equal(await playback, true);
  assert.equal(hook.render().speaking, false);
});

test("starting microphone input during a speech pause cancels remaining sentences", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t);
  const playback = hook.render().speak("Здравствуйте! Скажите, что делать дальше.", "confused");
  hook.utterances[0].onend();
  assert.equal(hook.render().speaking, true);
  assert.equal(await hook.render().startRecording(), true);
  assert.equal(await playback, false);
  t.mock.timers.tick(1000);
  await flushEvents();
  assert.equal(hook.utterances.length, 1, "a cancelled intersentence timer cannot speak into the microphone");
  assert.equal(hook.render().speaking, false);
  assert.equal(hook.render().recording, true);
  hook.recognizers[0].result([["Откройте приложение", true]]);
  hook.recognizers[0].onend();
  assert.equal(hook.render().transcript, "Откройте приложение");
});

test("late events from replaced utterances cannot finish the current playback", async (t) => {
  const hook = fixture(t);
  const first = hook.render().speak("Первая реплика.", "calm");
  const staleEnd = hook.utterances[0].onend;
  const staleError = hook.utterances[0].onerror;
  const second = hook.render().speak("Вторая реплика.", "calm");
  assert.equal(await first, false);
  const cancelledBeforeLateEvents = hook.calls.synthesisCancelled;
  staleEnd();
  staleError({ error: "interrupted" });
  assert.equal(hook.render().speaking, true);
  assert.equal(hook.calls.synthesisCancelled, cancelledBeforeLateEvents);
  assert.equal(hook.render().error, null);
  hook.utterances[1].onend();
  assert.equal(await second, true);
});

test("changing the selected Russian voice keeps speak stable and takes effect on the next playback", async (t) => {
  const hook = fixture(t, { voices: [russianVoice, naturalRussianVoice] });
  const speak = hook.render().speak;
  const first = speak("Здравствуйте!", "calm");
  const currentVoice = hook.utterances[0].voice;
  hook.render().selectVoice(russianVoice.voiceURI);
  assert.equal(hook.render().selectedVoiceURI, russianVoice.voiceURI);
  assert.equal(hook.localStorage.getItem("test-voice"), russianVoice.voiceURI);
  assert.equal(hook.render().speak, speak);
  assert.equal(hook.utterances.length, 1, "selection alone must not replay the driver line");
  assert.equal(hook.utterances[0].voice, currentVoice, "do not change an utterance already playing");
  hook.utterances[0].onend();
  assert.equal(await first, true);
  const second = speak("Что мне делать?", "calm");
  assert.equal(hook.utterances[1].voice.voiceURI, russianVoice.voiceURI);
  hook.utterances[1].onend();
  assert.equal(await second, true);
  hook.localStorage.setItem = () => { throw new Error("Storage blocked"); };
  assert.doesNotThrow(() => hook.render().selectVoice(naturalRussianVoice.voiceURI));
  assert.equal(hook.render().selectedVoiceURI, naturalRussianVoice.voiceURI, "blocked device storage must not prevent selecting a voice");
});


const cloudResult = { audio_base64: "SUQz", mime_type: "audio/mpeg" };
const cloud = (load) => ({ label: "Google Cloud TTS", cacheKey: "test:google:driver:0", load });

test("cloud audio keeps speaking during synthesis and releases its object URL after playback", async (t) => {
  const hook = fixture(t);
  const response = deferred();
  let requestSignal;
  const playback = hook.render().speak("Сохранённая реплика водителя.", "calm", cloud(signal => { requestSignal = signal; return response.promise; }));
  assert.equal(hook.render().speaking, true);
  assert.equal(hook.render().loadingAudio, true);
  await flushEvents();
  assert.equal(requestSignal.aborted, false);
  response.resolve(cloudResult);
  await flushEvents(); await flushEvents();
  assert.equal(hook.audios.length, 1);
  assert.equal(hook.audios[0].played, true);
  assert.equal(hook.render().loadingAudio, false);
  assert.equal(hook.render().speaking, true);
  assert.equal(hook.utterances.length, 0, "successful cloud output does not invoke browser TTS");
  assert.equal(hook.createdUrls[0].blob.type, "audio/mpeg");
  hook.audios[0].onended();
  assert.equal(await playback, true);
  assert.equal(hook.render().speaking, false);
  assert.equal(hook.audios[0].paused, true);
  assert.equal(hook.audios[0].unloaded, true);
  assert.deepEqual(hook.revokedUrls, [hook.createdUrls[0].url]);
});

test("cancelling pending cloud synthesis aborts the request and ignores its late response", async (t) => {
  const hook = fixture(t);
  const response = deferred();
  let requestSignal;
  const playback = hook.render().speak("Алло!", "calm", cloud(signal => { requestSignal = signal; return response.promise; }));
  await flushEvents();
  hook.render().stopSpeaking();
  assert.equal(await playback, false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(hook.render().loadingAudio, false);
  response.resolve(cloudResult);
  await flushEvents(); await flushEvents();
  assert.equal(hook.audios.length, 0);
  assert.equal(hook.createdUrls.length, 0);
  assert.equal(hook.utterances.length, 0);
});

test("cloud failure uses browser output with a visible explanation and preserves the operator draft", async (t) => {
  const hook = fixture(t);
  await hook.render().startRecording();
  hook.recognizers[0].result([["Откройте Яндекс Про", true]]);
  hook.recognizers[0].onend();
  const playback = hook.render().speak("Как это сделать?", "calm", cloud(async () => { throw new Error("Unavailable"); }));
  await flushEvents(); await flushEvents();
  assert.equal(hook.utterances.length, 1);
  assert.equal(hook.render().speaking, true);
  assert.match(hook.render().playbackNotice, /Google Cloud TTS.*голос браузера/);
  assert.equal(hook.render().transcript, "Откройте Яндекс Про");
  hook.utterances[0].onend();
  assert.equal(await playback, true);
});

test("autoplay rejection asks to repeat without silently claiming browser or cloud playback", async (t) => {
  const hook = fixture(t);
  globalThis.Audio.prototype.play = () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  const playback = hook.render().speak("Алло!", "calm", cloud(async () => cloudResult));
  await flushEvents(); await flushEvents();
  assert.equal(await playback, false);
  assert.match(hook.render().error, /Повторить реплику/);
  assert.equal(hook.render().playbackNotice, null);
  assert.equal(hook.utterances.length, 0);
  assert.equal(hook.revokedUrls.length, 1);
});

test("starting input stops cloud audio and stale media callbacks cannot affect the next playback", async (t) => {
  const hook = fixture(t);
  const first = hook.render().speak("Алло!", "calm", cloud(async () => cloudResult));
  await flushEvents(); await flushEvents();
  const staleEnd = hook.audios[0].onended, staleError = hook.audios[0].onerror;
  assert.equal(await hook.render().startRecording(), true);
  assert.equal(await first, false);
  assert.equal(hook.audios[0].paused, true);
  assert.equal(hook.revokedUrls.length, 1);
  const second = hook.render().speak("Что дальше?", "calm", { ...cloud(async () => cloudResult), cacheKey: "test:google:driver:1" });
  await flushEvents(); await flushEvents();
  staleEnd(); staleError();
  assert.equal(hook.render().speaking, true);
  assert.equal(hook.utterances.length, 0);
  hook.audios[1].onended();
  assert.equal(await second, true);
  assert.equal(hook.revokedUrls.length, 2);
});

test("unmount during cloud loading never creates late audio or updates disposed state", async (t) => {
  const hook = fixture(t);
  const response = deferred();
  const playback = hook.render().speak("Алло!", "calm", cloud(() => response.promise));
  await flushEvents();
  hook.dispose();
  assert.equal(await playback, false);
  response.resolve(cloudResult);
  await flushEvents(); await flushEvents();
  assert.equal(hook.audios.length, 0);
  assert.equal(hook.calls.afterUnmountUpdates, 0);
});

test("a stalled cloud request has a bounded wait and cannot play after browser fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = fixture(t);
  const response = deferred();
  const playback = hook.render().speak("Алло!", "calm", cloud(() => response.promise));
  await flushEvents();
  t.mock.timers.tick(25000);
  assert.equal(hook.utterances.length, 1);
  assert.equal(hook.render().loadingAudio, false);
  response.resolve(cloudResult);
  await flushEvents(); await flushEvents();
  assert.equal(hook.audios.length, 0);
  hook.utterances[0].onend();
  assert.equal(await playback, true);
});

test("muting input preserves active cloud output and cloud works without browser synthesis", async (t) => {
  const hook = fixture(t, { synthesis: false });
  const playback = hook.render().speak("Алло!", "calm", cloud(async () => cloudResult));
  await flushEvents(); await flushEvents();
  hook.render().setMuted(true);
  assert.equal(hook.render().speaking, true);
  assert.equal(hook.audios[0].paused, undefined);
  hook.audios[0].onended();
  assert.equal(await playback, true);
});


test("a blocked cloud clip can be repeated in the click gesture without a second asynchronous request", async (t) => {
  const hook = fixture(t);
  let requests = 0;
  const source = cloud(async () => { requests++; return cloudResult; });
  const play = globalThis.Audio.prototype.play;
  globalThis.Audio.prototype.play = () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  const first = hook.render().speak("Алло!", "calm", source);
  await flushEvents(); await flushEvents();
  assert.equal(await first, false);
  assert.equal(requests, 1);
  globalThis.Audio.prototype.play = play;
  const repeated = hook.render().speak("Алло!", "calm", source);
  assert.equal(hook.audios.length, 2, "construct and play the cached clip synchronously during the repeat gesture");
  assert.equal(hook.audios[1].played, true);
  assert.equal(requests, 1);
  await flushEvents();
  hook.audios[1].onended();
  assert.equal(await repeated, true);
  assert.equal(hook.revokedUrls.length, 2);
});

test("a Kazakh call records Kazakh speech and explains an unsupported recognizer", async (t) => {
  const hook = fixture(t);
  assert.equal(await hook.render().startRecording("kk"), true);
  assert.equal(hook.recognizers[0].lang, "kk-KZ");
  hook.recognizers[0].onerror({ error: "language-not-supported" });
  assert.match(hook.render().error, /казахскую речь/);
  assert.match(hook.render().error, /Этап разговора сохранён/);
});

test("a Kazakh line uses a Kazakh browser voice when the device has one", async (t) => {
  const kazakhVoice = { voiceURI: "kk-test", name: "Aigul", lang: "kk-KZ", localService: true, default: false };
  const hook = fixture(t, { voices: [russianVoice, kazakhVoice] });
  const playback = hook.render().speak("Сәлеметсіз бе!", "calm", undefined, { language: "kk" });
  assert.equal(hook.utterances[0].lang, "kk-KZ");
  assert.equal(hook.utterances[0].voice, kazakhVoice);
  hook.utterances[0].onend();
  assert.equal(await playback, true);
  const russian = fixture(t);
  const fallback = russian.render().speak("Сәлеметсіз бе!", "calm", undefined, { language: "kk" });
  assert.equal(russian.utterances[0].lang, "ru-RU");
  assert.equal(russian.utterances[0].voice, russianVoice);
  russian.utterances[0].onend();
  assert.equal(await fallback, true);
});
