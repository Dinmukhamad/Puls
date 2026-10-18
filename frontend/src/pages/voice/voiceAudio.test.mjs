import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const built = await build({
  entryPoints: [fileURLToPath(new URL("./voiceAudio.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, () => ({}));
const { VoicePlayer, setAudioSession } = loaded.exports;

/** A minimal Web Audio context that records the one source of each clip. */
class FakeContext {
  constructor(state = "running") { this.state = state; this.destination = { name: "destination" }; this.sources = []; }
  async resume() { if (this.allowResume) this.state = "running"; }
  createBufferSource() {
    const source = { buffer: null, outputs: [], started: false, stopped: false, disconnected: false, onended: null,
      connect(target) { this.outputs.push(target); }, disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop() { this.stopped = true; } };
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() { return { duration: 2 }; }
}
const blob = { arrayBuffer: async () => new ArrayBuffer(8) };

test("a driver line plays straight to the speakers, without a telephone band or a backdrop", async () => {
  const context = new FakeContext();
  const playback = await new VoicePlayer(context).play(blob);
  assert.equal(context.sources.length, 1);
  const [source] = context.sources;
  assert.deepEqual(source.outputs, [context.destination]);
  assert.equal(source.started, true);
  let ended = false;
  void playback.ended.then(() => { ended = true; });
  source.onended();
  await Promise.resolve();
  assert.equal(ended, true);
  assert.equal(source.disconnected, true);
});

test("stopping a line silences it at once and never reports an end", async () => {
  const context = new FakeContext();
  const playback = await new VoicePlayer(context).play(blob);
  let ended = false;
  void playback.ended.then(() => { ended = true; });
  playback.stop();
  assert.equal(context.sources[0].stopped, true);
  context.sources[0].onended();
  await Promise.resolve();
  assert.equal(ended, false);
});

test("a context the browser keeps suspended is not used", async () => {
  const blocked = new FakeContext("suspended");
  await assert.rejects(new VoicePlayer(blocked).play(blob));
  assert.equal(blocked.sources.length, 0);
  const allowed = new FakeContext("suspended");
  allowed.allowResume = true;
  assert.equal(await new VoicePlayer(allowed).ready(), true);
});

test("the page asks iOS for a media session the silent switch does not mute", () => {
  const nav = { audioSession: { type: "auto" } };
  setAudioSession("playback", nav);
  assert.equal(nav.audioSession.type, "playback");
  setAudioSession("auto", nav);
  assert.equal(nav.audioSession.type, "auto");
  // Browsers without the API, or that refuse the change, are left as they are.
  setAudioSession("playback", {});
  const refusing = { audioSession: { get type() { return "auto"; }, set type(_) { throw new Error("refused"); } } };
  assert.doesNotThrow(() => setAudioSession("playback", refusing));
});
