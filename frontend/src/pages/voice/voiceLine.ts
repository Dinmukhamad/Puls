import type { VoicePlaybackPersona } from "./voicePlayback";

/**
 * Where the driver calls from. The sound passes through a telephone band (about
 * 300–3400 Hz) with the backdrop of his car or the street, generated here so no
 * recordings are downloaded. Levels stay low so the operator's microphone, which
 * records only after the driver stops, never picks the backdrop up.
 */
export interface LineScene {
  /** The backdrop: inside a moving car or a busy street. */
  bed: "car" | "street";
  bedLevel: number;
  /** Seconds after the first word when another car honks. */
  horns: number[];
  hornLevel: number;
  /** The confused driver's turn signal ticking while he thinks. */
  ticks: boolean;
}

export const LINE_SCENES: Record<VoicePlaybackPersona, LineScene> = {
  calm: { bed: "car", bedLevel: 0.05, horns: [], hornLevel: 0, ticks: false },
  confused: { bed: "car", bedLevel: 0.045, horns: [], hornLevel: 0, ticks: true },
  hurried: { bed: "car", bedLevel: 0.085, horns: [0.1, 0.42], hornLevel: 0.09, ticks: false },
  irritated: { bed: "street", bedLevel: 0.09, horns: [1.4], hornLevel: 0.07, ticks: false },
};
/** The backdrop is heard a moment before the first word and after the last one. */
export const PRE_ROLL = 0.35;
export const TAIL = 0.3;

/**
 * iOS mutes Web Audio while the ring/silent switch is on, unlike the browser's own voice.
 * "playback" makes the page's audio a media session the switch does not mute (Safari 16.4+);
 * "auto" gives the microphone back its play-and-record session before the operator answers.
 */
export type AudioSessionType = "auto" | "playback";
interface AudioSessionNavigator { audioSession?: { type: string } }

export function setAudioSession(type: AudioSessionType, nav: AudioSessionNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator as AudioSessionNavigator) {
  try {
    const session = nav?.audioSession;
    if (session && session.type !== type) session.type = type;
  } catch { /* Not supported: the switch keeps its usual effect. */ }
}

export interface LinePlayback {
  ended: Promise<void>;
  stop(): void;
}

type Stoppable = AudioScheduledSourceNode;

export class PhoneLine {
  private noise: AudioBuffer | null = null;

  constructor(readonly context: AudioContext) {}

  /** A context that a browser keeps suspended without a gesture is not used. */
  async ready(timeoutMs = 400): Promise<boolean> {
    // Read through a function: the state changes while resume() is awaited.
    const running = () => (this.context.state as string) === "running";
    if (running()) return true;
    try {
      await Promise.race([this.context.resume(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    } catch { /* Autoplay policy: the caller falls back to plain playback. */ }
    return running();
  }

  /** Plays a decoded driver line through the telephone band with its backdrop. */
  async play(blob: Blob, persona: VoicePlaybackPersona): Promise<LinePlayback> {
    if (!await this.ready()) throw new Error("Audio context is suspended");
    const buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
    const { input, nodes } = this.band();
    const now = this.context.currentTime;
    const speechAt = now + PRE_ROLL;
    const end = speechAt + buffer.duration + TAIL;
    const backdrop = this.backdrop(persona, input, now, end, speechAt);
    const sources: Stoppable[] = backdrop.sources;
    nodes.push(...backdrop.nodes);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(input);
    source.start(speechAt);
    sources.push(source);
    let stopped = false;
    let resolveEnded = () => {};
    const ended = new Promise<void>((resolve) => { resolveEnded = resolve; });
    const release = () => {
      for (const item of sources) { try { item.stop(); } catch { /* Already stopped. */ } }
      for (const node of nodes) node.disconnect();
    };
    source.onended = () => {
      if (stopped) return;
      setTimeout(() => { if (!stopped) { stopped = true; release(); resolveEnded(); } }, TAIL * 1000);
    };
    return { ended, stop: () => { if (!stopped) { stopped = true; release(); } } };
  }

  /** The backdrop alone, for the browser's own voice which cannot be filtered. */
  ambience(persona: VoicePlaybackPersona): () => void {
    const { input, nodes } = this.band();
    const now = this.context.currentTime;
    const { sources, nodes: backdrop } = this.backdrop(persona, input, now, now + 120, now + PRE_ROLL);
    nodes.push(...backdrop);
    return () => {
      for (const item of sources) { try { item.stop(); } catch { /* Already stopped. */ } }
      for (const node of nodes) node.disconnect();
    };
  }

  /** The telephone band: input → band-pass → presence → gentle compression → output. */
  private band() {
    const context = this.context;
    const input = context.createGain();
    const high = context.createBiquadFilter();
    high.type = "highpass"; high.frequency.value = 320; high.Q.value = 0.7;
    const low = context.createBiquadFilter();
    low.type = "lowpass"; low.frequency.value = 3300; low.Q.value = 0.8;
    const presence = context.createBiquadFilter();
    presence.type = "peaking"; presence.frequency.value = 1900; presence.Q.value = 1; presence.gain.value = 4;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24; compressor.ratio.value = 4; compressor.attack.value = 0.005; compressor.release.value = 0.15;
    const output = context.createGain();
    output.gain.value = 1.15;
    input.connect(high); high.connect(low); low.connect(presence); presence.connect(compressor);
    compressor.connect(output); output.connect(context.destination);
    return { input, nodes: [input, high, low, presence, compressor, output] as AudioNode[] };
  }

  private noiseBuffer() {
    if (this.noise) return this.noise;
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 7;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[index] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }

  private backdrop(persona: VoicePlaybackPersona, input: AudioNode, start: number, end: number, speechAt: number) {
    const context = this.context;
    const scene = LINE_SCENES[persona];
    const sources: Stoppable[] = [];
    const nodes: AudioNode[] = [];
    // The road or street roar, faded in and out.
    const bed = context.createBufferSource();
    bed.buffer = this.noiseBuffer(); bed.loop = true;
    const tone = context.createBiquadFilter();
    if (scene.bed === "car") { tone.type = "lowpass"; tone.frequency.value = 900; }
    else { tone.type = "bandpass"; tone.frequency.value = 1300; tone.Q.value = 0.45; }
    const level = context.createGain();
    level.gain.setValueAtTime(0, start);
    level.gain.linearRampToValueAtTime(scene.bedLevel, start + 0.25);
    level.gain.setValueAtTime(scene.bedLevel, Math.max(start + 0.25, end - 0.25));
    level.gain.linearRampToValueAtTime(0, end);
    bed.connect(tone); tone.connect(level); level.connect(input);
    bed.start(start); bed.stop(end + 0.05);
    sources.push(bed); nodes.push(tone, level);
    if (scene.bed === "street") {
      // Passing cars: the roar swells and falls slowly.
      const swell = context.createOscillator();
      swell.frequency.value = 0.18;
      const depth = context.createGain();
      depth.gain.value = scene.bedLevel * 0.6;
      swell.connect(depth); depth.connect(level.gain);
      swell.start(start); swell.stop(end + 0.05);
      sources.push(swell); nodes.push(depth);
    }
    for (const offset of scene.horns) {
      const at = speechAt + offset;
      if (at >= end) continue;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(scene.hornLevel, at + 0.015);
      gain.gain.setValueAtTime(scene.hornLevel, at + 0.22);
      gain.gain.linearRampToValueAtTime(0, at + 0.27);
      const soften = context.createBiquadFilter();
      soften.type = "lowpass"; soften.frequency.value = 1800;
      soften.connect(gain); gain.connect(input);
      nodes.push(soften, gain);
      for (const frequency of [392, 466]) {
        const horn = context.createOscillator();
        horn.type = "sawtooth"; horn.frequency.value = frequency;
        horn.connect(soften);
        horn.start(at); horn.stop(at + 0.3);
        sources.push(horn);
      }
    }
    if (scene.ticks) {
      const click = context.createBiquadFilter();
      click.type = "bandpass"; click.frequency.value = 2600; click.Q.value = 3;
      const gain = context.createGain();
      gain.gain.value = 0;
      click.connect(gain); gain.connect(input);
      nodes.push(click, gain);
      for (let at = start + 0.1; at < end; at += 0.45) {
        gain.gain.setValueAtTime(0.06, at);
        gain.gain.setValueAtTime(0, at + 0.012);
      }
      const ticks = context.createBufferSource();
      ticks.buffer = this.noiseBuffer(); ticks.loop = true;
      ticks.connect(click);
      ticks.start(start); ticks.stop(end + 0.05);
      sources.push(ticks);
    }
    return { sources, nodes };
  }
}
