export type VoicePlaybackPersona = "calm" | "confused" | "hurried" | "irritated";

export interface VoicePlaybackSegment {
  text: string;
  rate: number;
  pitch: number;
  pauseAfterMs: number;
}

const naturalVoiceName = /\b(?:natural|neural|premium|enhanced)\b|нейросет|улучшенн/iu;
// Chrome's named Google Russian voice is a useful step up from legacy desktop
// engines. Other remote voices receive no quality bonus just for being remote.
const googleVoiceName = /^Google\s/iu;
// These are names of known Russian male voices, rather than a guess based on
// locale, device, or whether a voice runs locally.
const maleVoiceName = /(?:^|[^\p{L}])(?:dmitry|dmitri|pavel|yuri|maxim|mikhail|alexander|aleksandr|nikolai|sergey|vladimir|дмитрий|павел|юрий|максим|михаил|александр|николай|сергей|владимир)(?=$|[^\p{L}])/iu;

/** Return a new, stably ranked list; a foreign default is never a fallback. */
export function rankRussianVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const score = (voice: SpeechSynthesisVoice) => [
    naturalVoiceName.test(voice.name) ? 2 : Number(googleVoiceName.test(voice.name)),
    Number(maleVoiceName.test(voice.name)),
    Number(voice.default),
  ];
  return voices
    .map((voice, index) => ({ voice, index, score: score(voice) }))
    .filter(({ voice }) => /^ru(?:-|$)/i.test(voice.lang.replace(/_/g, "-")))
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index++) {
        const difference = right.score[index] - left.score[index];
        if (difference) return difference;
      }
      return left.index - right.index;
    })
    .map(({ voice }) => voice);
}

const abbreviations = new Set([
  "г", "гг", "ул", "д", "кв", "оф", "им", "пр", "просп", "пер", "стр", "корп", "тел", "доб",
  "рис", "см", "руб", "коп", "мин", "сек", "ч", "шт", "т", "е", "п", "др", "напр",
]);
const closingPunctuation = /[»”’"')\]]/u;

function speechText(text: string): string {
  return text
    .replace(/(?<![\p{L}\p{N}_])SIM(?![\p{L}\p{N}_])/giu, "сим")
    .replace(/(?<![\p{L}\p{N}_])WhatsApp(?![\p{L}\p{N}_])/giu, "ватсап")
    .replace(/(?<![\p{L}\p{N}_])OKTELL?(?![\p{L}\p{N}_])/giu, "Октел")
    .replace(/\s+/gu, " ")
    .trim();
}

function protectedPeriod(prefix: string): boolean {
  const token = prefix.match(/([\p{L}\p{N}]+)\.$/u)?.[1];
  return Boolean(token && (
    (/^\d+$/u.test(token) && /^\s*\d+\.$/u.test(prefix)) || /^[A-ZА-ЯЁ]$/u.test(token) || abbreviations.has(token.toLocaleLowerCase("ru"))
  ));
}

/** Keep numeric values, initials and common Russian address abbreviations whole. */
function sentences(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (!/[.!?…]/u.test(text[index])) continue;
    const punctuationStart = index;
    while (index + 1 < text.length && /[.!?…]/u.test(text[index + 1])) index++;
    const punctuationEnd = index;
    while (index + 1 < text.length && closingPunctuation.test(text[index + 1])) index++;
    if (index + 1 < text.length && !/\s/u.test(text[index + 1])) continue;
    if (punctuationStart === punctuationEnd && text[punctuationStart] === "." && protectedPeriod(text.slice(start, punctuationEnd + 1))) continue;
    result.push(text.slice(start, index + 1).trim());
    start = index + 1;
  }
  const remaining = text.slice(start).trim();
  if (remaining) result.push(remaining);
  return result;
}

function safeWordBoundary(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const after = text.slice(index).trimStart();
  // A phone number may contain spaces; neither it nor a pair of initials should
  // acquire an artificial pause just because a phrase reached its size limit.
  if (/\d$/u.test(before) && /^\d/u.test(after)) return false;
  if (/№$/u.test(before)) return false;
  if (protectedPeriod(before)) return false;
  return true;
}

function phrases(sentence: string): string[] {
  const result: string[] = [];
  let remaining = sentence;
  const maximum = 220;
  while (remaining.length > maximum) {
    const punctuation = [...remaining.matchAll(/[,;:]\s+|\s[—–]\s+/gu)]
      .map((match) => (match.index ?? 0) + match[0].trimEnd().length)
      .filter((index) => index >= 80 && index <= maximum);
    const whitespace = [...remaining.matchAll(/\s+/gu)]
      .map((match) => match.index ?? 0)
      .filter((index) => safeWordBoundary(remaining, index));
    const beforeLimit = whitespace.filter((index) => index <= maximum);
    const boundary = punctuation.at(-1) ?? beforeLimit.at(-1) ?? whitespace[0];
    if (boundary === undefined) break; // Never cut through a word or a number.
    result.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

const profiles: Record<VoicePlaybackPersona, { rate: number; pitch: number; pause: number }> = {
  calm: { rate: 1, pitch: 1, pause: 180 },
  confused: { rate: 0.94, pitch: 1.01, pause: 230 },
  hurried: { rate: 1.08, pitch: 0.99, pause: 110 },
  irritated: { rate: 1.035, pitch: 0.985, pause: 150 },
};
const bounded = (value: number, minimum: number, maximum: number) => Math.round(Math.max(minimum, Math.min(maximum, value)) * 1000) / 1000;

/**
 * Modest, deterministic sentence prosody for browser TTS. The display transcript
 * stays untouched: pronunciation substitutions exist only in this returned plan.
 */
export function createVoicePlaybackPlan(text: string, persona: VoicePlaybackPersona): VoicePlaybackSegment[] {
  const profile = profiles[persona];
  const result: VoicePlaybackSegment[] = [];
  sentences(speechText(text)).forEach((sentence, sentenceIndex) => {
    const chunks = phrases(sentence);
    const question = /\?[!?…]*[»”’"')\]]*$/u.test(sentence);
    const variation = [0, 0.012, -0.008, 0.004][sentenceIndex % 4];
    chunks.forEach((chunk, chunkIndex) => {
      const lastPhrase = chunkIndex === chunks.length - 1;
      result.push({
        text: chunk,
        rate: bounded(profile.rate + variation - (question ? 0.005 : 0), 0.9, 1.12),
        pitch: bounded(profile.pitch + (question ? 0.015 : 0) + (sentenceIndex % 2 ? 0.004 : -0.004), 0.96, 1.04),
        pauseAfterMs: lastPhrase ? profile.pause + (question ? 30 : 0) : Math.min(profile.pause, 120),
      });
    });
  });
  if (result.length) result[result.length - 1].pauseAfterMs = 0;
  return result;
}
