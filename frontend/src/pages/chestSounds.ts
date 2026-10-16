/** Tiny synthesized sounds: no downloads, and no audio before a user gesture. */
export function createChestSounds() {
  let context: AudioContext | null = null;
  function tone(frequency: number, delay: number, duration: number, volume: number, type: OscillatorType = "sine") {
    if (!context || context.state !== "running") return;
    const time = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  return {
    unlock() {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        if (!context || context.state === "closed") context = new Ctor();
        // Called directly by the open button, including on Safari/iOS.
        if (context.state === "suspended") void context.resume().catch(() => {});
        tone(440, 0, .12, .05, "triangle");
        tone(660, .09, .18, .04, "triangle");
      } catch { /* Audio is optional; it never blocks a reward. */ }
    },
    tick() {
      try { tone(1180, 0, .035, .025, "triangle"); } catch { /* Audio is optional. */ }
    },
    reveal(won: boolean) {
      try {
        const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25];
        notes.forEach((note, index) => tone(note, index * .09, .4, .045));
      } catch { /* Audio is optional. */ }
    },
    close() {
      if (context && context.state !== "closed") void context.close().catch(() => {});
      context = null;
    },
  };
}
