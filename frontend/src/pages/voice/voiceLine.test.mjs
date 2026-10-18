import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const built = await build({
  entryPoints: [fileURLToPath(new URL("./voiceLine.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, () => ({}));
const { LINE_SCENES, PhoneLine, PRE_ROLL, TAIL } = loaded.exports;

/** A minimal Web Audio graph that records connections, schedules and stops. */
class FakeContext {
  constructor(state = "running") {
    this.state = state; this.currentTime = 10; this.sampleRate = 8000;
    this.destination = { name: "destination" }; this.nodes = []; this.sources = [];
  }
  async resume() { if (this.allowResume) this.state = "running"; }
  param(value = 0) { return { value, events: [], setValueAtTime(v, t) { this.events.push(["set", v, t]); }, linearRampToValueAtTime(v, t) { this.events.push(["ramp", v, t]); } }; }
  node(kind, extra = {}) {
    const node = { kind, outputs: [], disconnected: false, connect(target) { this.outputs.push(target); }, disconnect() { this.disconnected = true; }, ...extra };
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.node("gain", { gain: this.param(1) }); }
  createBiquadFilter() { return this.node("filter", { type: "", frequency: this.param(), Q: this.param(), gain: this.param() }); }
  createDynamicsCompressor() { return this.node("compressor", { threshold: this.param(), ratio: this.param(), attack: this.param(), release: this.param() }); }
  source(kind, extra = {}) {
    const source = this.node(kind, { started: null, stopped: null, start(at) { this.started = at; }, stop(at = "now") { this.stopped = at; }, ...extra });
    this.sources.push(source);
    return source;
  }
  createOscillator() { return this.source("oscillator", { type: "sine", frequency: this.param() }); }
  createBufferSource() { return this.source("buffer", { buffer: null, loop: false, onended: null }); }
  createBuffer(channels, length) { const data = new Float32Array(length); return { length, getChannelData: () => data }; }
  async decodeAudioData() { return { duration: 2 }; }
}
const blob = { arrayBuffer: async () => new ArrayBuffer(8) };
const speechSource = (context) => context.sources.find((source) => source.kind === "buffer" && source.buffer?.duration === 2);

test("every character calls from his own place, quietly enough for the microphone", () => {
  const scenes = Object.values(LINE_SCENES);
  assert.equal(new Set(scenes.map((scene) => JSON.stringify(scene))).size, 4);
  assert.equal(LINE_SCENES.irritated.bed, "street");
  assert.ok(LINE_SCENES.hurried.horns.length > 0 && LINE_SCENES.confused.ticks);
  assert.ok(!LINE_SCENES.calm.horns.length && !LINE_SCENES.calm.ticks);
  for (const scene of scenes) assert.ok(scene.bedLevel <= 0.1 && scene.hornLevel <= 0.1);
});

test("a driver line plays through the telephone band after the backdrop starts", async () => {
  const context = new FakeContext();
  const line = new PhoneLine(context);
  const playback = await line.play(blob, "hurried");
  const speech = speechSource(context);
  assert.equal(speech.started, context.currentTime + PRE_ROLL);
  const filters = context.nodes.filter((node) => node.kind === "filter").map((node) => [node.type, node.frequency.value]);
  assert.deepEqual(filters.slice(0, 3), [["highpass", 320], ["lowpass", 3300], ["peaking", 1900]]);
  assert.ok(context.sources.filter((source) => source.kind === "oscillator").length >= 4, "two horn beeps of two tones");
  let ended = false;
  void playback.ended.then(() => { ended = true; });
  speech.onended();
  await new Promise((resolve) => setTimeout(resolve, TAIL * 1000 + 30));
  assert.equal(ended, true);
  assert.ok(context.sources.every((source) => source.stopped !== null));
  assert.ok(context.nodes.filter((node) => node.kind !== "buffer" && node.kind !== "oscillator").every((node) => node.disconnected));
});

test("stopping the line silences it at once and never reports an end", async () => {
  const context = new FakeContext();
  const playback = await new PhoneLine(context).play(blob, "confused");
  let ended = false;
  void playback.ended.then(() => { ended = true; });
  playback.stop();
  assert.ok(context.sources.every((source) => source.stopped === "now"));
  speechSource(context).onended?.();
  await new Promise((resolve) => setTimeout(resolve, TAIL * 1000 + 30));
  assert.equal(ended, false);
});

test("a context the browser keeps suspended is not used", async () => {
  const context = new FakeContext("suspended");
  const line = new PhoneLine(context);
  assert.equal(await line.ready(20), false);
  await assert.rejects(line.play(blob, "calm"));
  context.allowResume = true;
  assert.equal(await line.ready(20), true);
});

test("the backdrop alone plays for the browser's own voice and stops cleanly", () => {
  const context = new FakeContext();
  const stop = new PhoneLine(context).ambience("irritated");
  assert.ok(context.sources.some((source) => source.kind === "buffer" && source.loop));
  stop();
  assert.ok(context.sources.every((source) => source.stopped !== null));
});

test("the page asks iOS for a media session the silent switch does not mute", () => {
  const nav = { audioSession: { type: "auto" } };
  loaded.exports.setAudioSession("playback", nav);
  assert.equal(nav.audioSession.type, "playback");
  loaded.exports.setAudioSession("auto", nav);
  assert.equal(nav.audioSession.type, "auto");
  // Browsers without the API, or that refuse the change, are left as they are.
  loaded.exports.setAudioSession("playback", {});
  const refusing = { audioSession: { get type() { return "auto"; }, set type(_) { throw new Error("refused"); } } };
  assert.doesNotThrow(() => loaded.exports.setAudioSession("playback", refusing));
});
