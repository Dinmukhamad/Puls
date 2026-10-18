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

export interface VoicePlayback {
  ended: Promise<void>;
  stop(): void;
}

/**
 * Plays the cloud voice's clips through one audio context per page. A context resumed inside the operator's tap
 * keeps playing clips that arrive later from the server, where phones block a new audio element.
 */
export class VoicePlayer {
  constructor(readonly context: AudioContext) {}

  /** A context that a browser keeps suspended without a gesture is not used. */
  async ready(timeoutMs = 400): Promise<boolean> {
    // Read through a function: the state changes while resume() is awaited.
    const running = () => (this.context.state as string) === "running";
    if (running()) return true;
    try {
      await Promise.race([this.context.resume(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    } catch { /* Autoplay policy: the caller falls back to an audio element. */ }
    return running();
  }

  /** Plays a decoded driver line as it is: no filters, no backdrop. */
  async play(blob: Blob): Promise<VoicePlayback> {
    if (!await this.ready()) throw new Error("Audio context is suspended");
    const buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start();
    let stopped = false;
    let resolveEnded = () => {};
    const ended = new Promise<void>((resolve) => { resolveEnded = resolve; });
    const release = () => {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    };
    source.onended = () => { if (!stopped) { stopped = true; release(); resolveEnded(); } };
    return { ended, stop: () => { if (!stopped) { stopped = true; release(); } } };
  }
}
