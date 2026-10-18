/**
 * The softphone's sounds, synthesised: a two-tone ring every few seconds and one short beep when
 * «Автоответ» picks the call up. Browsers start audio only after the user's gesture, so `unlock`
 * runs on any tap in the work sites; without it the call still rings on screen.
 */
type AudioWindow = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

export class Ringtone {
  private context: AudioContext | null = null;
  private timer: number | null = null;

  unlock() {
    if (!this.context) {
      const audio = window as AudioWindow, Context = audio.AudioContext || audio.webkitAudioContext;
      if (!Context) return;
      try { this.context = new Context(); } catch { return; }
    }
    if (this.context.state !== "running") void this.context.resume().catch(() => {});
  }

  ring() {
    this.stop();
    const twice = () => { this.tone(0, 0.4, [440, 480]); this.tone(0.55, 0.4, [440, 480]); };
    twice();
    this.timer = window.setInterval(twice, 2800);
  }

  beep() { this.tone(0, 0.16, [880]); }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  close() {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }

  private tone(delay: number, length: number, frequencies: number[]) {
    const context = this.context;
    if (!context || context.state !== "running") return;
    try {
      const at = context.currentTime + delay, gain = context.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.08, at + 0.02);
      gain.gain.setValueAtTime(0.08, at + length - 0.04);
      gain.gain.linearRampToValueAtTime(0, at + length);
      gain.connect(context.destination);
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(at);
        oscillator.stop(at + length);
      }
    } catch { /* Sound is a courtesy: the call shows on screen without it. */ }
  }
}
