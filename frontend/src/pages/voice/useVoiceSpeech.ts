import { useCallback, useEffect, useRef, useState } from "react";
import { createVoicePlaybackPlan, rankRussianVoices, type VoicePlaybackPersona } from "./voicePlayback";

// Web Speech recognition is still vendor-prefixed in some browsers and is not
// included in TypeScript's DOM declarations. Keep its small interface local.
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}
interface RecognitionEvent {
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  AudioContext?: typeof AudioContext;
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  webkitAudioContext?: typeof AudioContext;
};

interface MicCheck {
  stream: MediaStream | null;
  context: AudioContext | null;
  timer: number | null;
  interval: number | null;
  finishSample: (() => void) | null;
}
interface RecordingSession {
  recognition: Recognition;
  finalText: string;
  interimText: string;
  hasResult: boolean;
  failed: boolean;
  stopTimer: number | null;
}
interface SpeakingSession {
  utterance: SpeechSynthesisUtterance | null;
  resolve: (completed: boolean) => void;
  timer: number | null;
  removeVoiceListener: (() => void) | null;
  audio?: HTMLAudioElement;
  audioUrl?: string;
  controller?: AbortController;
}

export interface VoiceAudioSource {
  label: string;
  /** Immutable provider/voice + saved driver turn (or fixed preview/persona). */
  cacheKey?: string;
  /** Load only a saved driver turn or the server's fixed preview. */
  load: (signal: AbortSignal) => Promise<{ audio_base64: string; mime_type: "audio/mpeg" }>;
}

export type MicSignal = "unknown" | "detected" | "quiet";
export interface VoiceSpeechOptions {
  /** Current full draft, including interim recognition. Review it before sending. */
  onTranscript?: (text: string) => void;
  voicePreferenceKey?: string;
}

function browser(): SpeechWindow | null {
  return typeof window === "undefined" ? null : window as SpeechWindow;
}

function availableRussianVoices(): SpeechSynthesisVoice[] {
  try { return rankRussianVoices(browser()?.speechSynthesis?.getVoices() ?? []); } catch { return []; }
}

function storedVoice(key: string): string {
  try { return browser()?.localStorage.getItem(key) ?? ""; } catch { return ""; }
}

function clearPlayback(session: SpeakingSession) {
  if (session.timer !== null) window.clearTimeout(session.timer);
  session.timer = null;
  session.removeVoiceListener?.();
  session.removeVoiceListener = null;
  if (session.utterance) {
    session.utterance.onstart = null;
    session.utterance.onend = null;
    session.utterance.onerror = null;
    session.utterance = null;
  }
}

function clearCloudPlayback(session: SpeakingSession) {
  session.controller?.abort();
  session.controller = undefined;
  if (session.audio) {
    session.audio.onended = null;
    session.audio.onerror = null;
    session.audio.onplaying = null;
    session.audio.pause();
    session.audio.removeAttribute("src");
    session.audio.load();
    session.audio = undefined;
  }
  if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
  session.audioUrl = undefined;
}

function microphoneError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Нет доступа к микрофону. Разреши его в настройках браузера и повтори проверку или введи ответ текстом.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Микрофон не найден. Подключи его и повтори проверку или введи ответ текстом.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Микрофон занят или недоступен. Проверь другие приложения и повтори проверку или введи ответ текстом.";
  }
  return "Не удалось проверить микрофон. Повтори проверку или введи ответ текстом.";
}

function recognitionError(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Браузер запретил распознавание речи. Проверь разрешение микрофона или введи ответ текстом.";
  }
  if (code === "audio-capture") return "Не удалось получить звук. Проверь микрофон и повтори запись или введи ответ текстом.";
  if (code === "no-speech") return "Речь не распознана. Повтори запись или введи ответ текстом. Этап разговора сохранён.";
  if (code === "network") return "Сервис распознавания недоступен. Повтори запись или введи ответ текстом. Этап разговора сохранён.";
  return "Не удалось распознать речь. Повтори запись или введи ответ текстом. Этап разговора сохранён.";
}

function releaseMic(check: MicCheck) {
  if (check.timer !== null) window.clearTimeout(check.timer);
  if (check.interval !== null) window.clearInterval(check.interval);
  check.timer = null;
  check.interval = null;
  check.finishSample?.();
  check.finishSample = null;
  check.stream?.getTracks().forEach((track) => track.stop());
  check.stream = null;
  if (check.context && check.context.state !== "closed") void check.context.close().catch(() => {});
  check.context = null;
}

/**
 * Turn-based ru-RU browser recognition with browser or server-synthesized output. Call checkMicrophone/startRecording only from
 * explicit user controls. Microphone checks retain only a signal-level result;
 * operator audio is never uploaded by this hook. Cloud output loads only a
 * server-owned driver line and retains at most four clips in page memory. Browser recognition can
 * use the browser vendor's remote service, so it is not guaranteed to be local.
 *
 * Failed retries preserve the previous draft. stopRecording waits for the
 * recognizer's final result; automatic recognition end also makes it reviewable.
 * `muted` controls microphone input, independently from driver speech output.
 * `speak` settles on completion/cancellation, including unsupported TTS; callers
 * must keep the driver's text available as an accessible fallback.
 */
export function useVoiceSpeech({ onTranscript, voicePreferenceKey = "puls:voice-output" }: VoiceSpeechOptions = {}) {
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [checkingMic, setCheckingMic] = useState(false);
  const [micChecked, setMicChecked] = useState(false);
  const [micSignal, setMicSignal] = useState<MicSignal>("unknown");
  const [muted, updateMuted] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [russianVoices, setRussianVoices] = useState(availableRussianVoices);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => storedVoice(voicePreferenceKey));
  const selectedVoiceRef = useRef(selectedVoiceURI);
  const mounted = useRef(true);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const mutedRef = useRef(false);
  const micCheckedRef = useRef(false);
  const micCheckRef = useRef<MicCheck | null>(null);
  const recordingRef = useRef<RecordingSession | null>(null);
  const startingRef = useRef(false);
  const inputGeneration = useRef(0);
  const speakingRef = useRef<SpeakingSession | null>(null);
  const audioCacheRef = useRef(new Map<string, Blob>());

  const speechWindow = browser();
  const support = {
    recognition: Boolean(speechWindow?.SpeechRecognition || speechWindow?.webkitSpeechRecognition),
    synthesis: Boolean(speechWindow?.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined"),
    microphone: Boolean(typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && speechWindow?.isSecureContext !== false),
  };

  const publish = useCallback((session: RecordingSession, finalize = false) => {
    if (!mounted.current || !session.hasResult) return;
    const fullText = [session.finalText, session.interimText].filter(Boolean).join(" ").trim();
    setTranscript(finalize ? fullText : session.finalText);
    setInterimTranscript(finalize ? "" : session.interimText);
    onTranscriptRef.current?.(fullText);
  }, []);

  const endRecording = useCallback((session: RecordingSession, abort: boolean) => {
    if (recordingRef.current !== session) return;
    recordingRef.current = null;
    if (session.stopTimer !== null) window.clearTimeout(session.stopTimer);
    session.recognition.onstart = null;
    session.recognition.onresult = null;
    session.recognition.onerror = null;
    session.recognition.onend = null;
    if (abort) {
      try { session.recognition.abort(); } catch { /* Already ended. */ }
    }
    publish(session, true);
    if (mounted.current) setRecording(false);
  }, [publish]);

  const cancelMicCheck = useCallback(() => {
    const check = micCheckRef.current;
    micCheckRef.current = null;
    if (check) releaseMic(check);
    if (mounted.current) setCheckingMic(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    const session = speakingRef.current;
    speakingRef.current = null;
    if (session) {
      clearPlayback(session);
      clearCloudPlayback(session);
      session.resolve(false);
      browser()?.speechSynthesis?.cancel();
    }
    if (mounted.current) { setSpeaking(false); setLoadingAudio(false); }
  }, []);

  const checkMicrophone = useCallback(async (): Promise<boolean> => {
    if (micCheckRef.current || !mounted.current) return false;
    if (mutedRef.current) {
      setError("Микрофон выключен. Включи его перед проверкой или введи ответ текстом.");
      return false;
    }
    const currentWindow = browser();
    if (!currentWindow || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || currentWindow.isSecureContext === false) {
      setError("Проверка микрофона недоступна. Открой сайт по HTTPS в поддерживаемом браузере или введи ответ текстом.");
      return false;
    }
    const check: MicCheck = { stream: null, context: null, timer: null, interval: null, finishSample: null };
    micCheckRef.current = check;
    setCheckingMic(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permissions can resolve after cancellation, route changes or unmount.
      if (micCheckRef.current !== check || !mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      check.stream = stream;
      let signal: MicSignal = "unknown";
      const Context = currentWindow.AudioContext || currentWindow.webkitAudioContext;
      if (Context) {
        try {
          const context = new Context();
          check.context = context;
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          context.createMediaStreamSource(stream).connect(analyser);
          // Do not wait indefinitely for an audio context on autoplay-restricted
          // browsers. Permission still gives a useful microphone check result.
          void context.resume().catch(() => {});
          const samples = new Uint8Array(analyser.fftSize);
          let detected = false;
          const sample = () => {
            if (micCheckRef.current !== check) return;
            analyser.getByteTimeDomainData(samples);
            let energy = 0;
            for (const value of samples) energy += ((value - 128) / 128) ** 2;
            detected ||= Math.sqrt(energy / samples.length) > 0.012;
          };
          await new Promise<void>((resolve) => {
            check.finishSample = resolve;
            sample();
            check.interval = window.setInterval(sample, 40);
            check.timer = window.setTimeout(resolve, 480);
          });
          signal = context.state === "running" ? (detected ? "detected" : "quiet") : "unknown";
        } catch {
          // Signal metering is optional; it must not make an allowed mic fail.
          signal = "unknown";
        }
      }
      if (micCheckRef.current !== check || !mounted.current) return false;
      micCheckedRef.current = true;
      setMicChecked(true);
      setMicSignal(signal);
      return true;
    } catch (cause) {
      if (micCheckRef.current === check && mounted.current) {
        micCheckedRef.current = false;
        setMicChecked(false);
        setMicSignal("unknown");
        setError(microphoneError(cause));
      }
      return false;
    } finally {
      releaseMic(check);
      if (micCheckRef.current === check) {
        micCheckRef.current = null;
        if (mounted.current) setCheckingMic(false);
      }
    }
  }, []);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (!mounted.current || recordingRef.current || startingRef.current) return false;
    if (mutedRef.current) {
      setError("Микрофон выключен. Включи его перед записью или введи ответ текстом.");
      return false;
    }
    const currentWindow = browser();
    const Constructor = currentWindow?.SpeechRecognition || currentWindow?.webkitSpeechRecognition;
    if (!Constructor) {
      setError("В этом браузере нет распознавания речи. Введи ответ текстом — текущий этап сохранён.");
      return false;
    }
    const generation = ++inputGeneration.current;
    startingRef.current = true;
    stopSpeaking();
    try {
      if (!micCheckedRef.current && !await checkMicrophone()) return false;
      if (!mounted.current || generation !== inputGeneration.current || mutedRef.current) return false;
      const recognition = new Constructor();
      const session: RecordingSession = { recognition, finalText: "", interimText: "", hasResult: false, failed: false, stopTimer: null };
      recordingRef.current = session;
      const isCurrent = () => mounted.current && recordingRef.current === session;
      recognition.lang = "ru-RU";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => { if (isCurrent()) setRecording(true); };
      recognition.onresult = (event) => {
        if (!isCurrent()) return;
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0]?.transcript.trim();
          if (text) (result.isFinal ? finalParts : interimParts).push(text);
        }
        const finalText = finalParts.join(" ");
        const interimText = interimParts.join(" ");
        if (!finalText && !interimText) return;
        session.finalText = finalText;
        session.interimText = interimText;
        session.hasResult = true;
        publish(session);
      };
      recognition.onerror = (event) => {
        if (!isCurrent()) return;
        session.failed = true;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          micCheckedRef.current = false;
          setMicChecked(false);
        }
        if (event.error !== "aborted") setError(recognitionError(event.error));
        endRecording(session, true);
      };
      recognition.onend = () => {
        if (!isCurrent()) return;
        if (!session.hasResult && !session.failed) setError(recognitionError("no-speech"));
        endRecording(session, false);
      };
      try {
        recognition.start();
        if (isCurrent()) {
          setError(null);
          setRecording(true);
        }
        return isCurrent();
      } catch (cause) {
        endRecording(session, true);
        if (mounted.current) setError(microphoneError(cause));
        return false;
      }
    } catch (cause) {
      if (mounted.current && generation === inputGeneration.current) setError(microphoneError(cause));
      return false;
    } finally {
      if (generation === inputGeneration.current) startingRef.current = false;
    }
  }, [checkMicrophone, endRecording, publish, stopSpeaking]);

  const stopRecording = useCallback(() => {
    const session = recordingRef.current;
    if (!session || session.stopTimer !== null) return;
    // Most browsers emit the final result just before onend. Guard engines that
    // omit onend so the review controls cannot remain stuck indefinitely.
    session.stopTimer = window.setTimeout(() => endRecording(session, true), 1500);
    try { session.recognition.stop(); } catch { endRecording(session, true); }
  }, [endRecording]);

  const speak = useCallback((text: string, persona: VoicePlaybackPersona = "calm", cloudSource?: VoiceAudioSource): Promise<boolean> => {
    stopSpeaking();
    inputGeneration.current += 1;
    startingRef.current = false;
    cancelMicCheck();
    const session = recordingRef.current;
    if (session) endRecording(session, true);
    const currentWindow = browser();
    if (!mounted.current || !currentWindow || !text.trim()) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const synthesis = currentWindow.speechSynthesis;
      const output: SpeakingSession = { utterance: null, resolve, timer: null, removeVoiceListener: null };
      speakingRef.current = output;
      const active = () => speakingRef.current === output && mounted.current;
      const finish = (completed: boolean, message?: string) => {
        if (!active()) return;
        speakingRef.current = null;
        const usedBrowser = Boolean(output.utterance || output.removeVoiceListener);
        clearPlayback(output);
        clearCloudPlayback(output);
        if (!completed && usedBrowser) synthesis?.cancel();
        setSpeaking(false);
        setLoadingAudio(false);
        if (message) setError(message);
        resolve(completed);
      };
      const failureMessage = "Не удалось озвучить реплику. Прочитай её в расшифровке или нажми «Повторить реплику».";
      const playBrowser = (fallback = false) => {
        if (!active()) return;
        clearPlayback(output);
        clearCloudPlayback(output);
        setLoadingAudio(false);
        if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") {
          finish(false, "Озвучивание недоступно. Прочитай реплику водителя в расшифровке или нажми «Повторить реплику».");
          return;
        }
        if (fallback) setPlaybackNotice(`Не удалось получить голос ${cloudSource?.label ?? "облачного сервиса"}. Используем голос браузера.`);
        const plan = createVoicePlaybackPlan(text, persona);
        const begin = () => {
          if (!active()) return;
          clearPlayback(output);
          const voices = availableRussianVoices();
          const voice = voices.find(candidate => candidate.voiceURI === selectedVoiceRef.current) ?? voices[0];
          const play = (index: number) => {
            if (!active()) return;
            clearPlayback(output);
            const segment = plan[index];
            if (!segment) { finish(true); return; }
            const utterance = new SpeechSynthesisUtterance(segment.text);
            utterance.lang = "ru-RU";
            if (voice) utterance.voice = voice;
            utterance.rate = segment.rate;
            utterance.pitch = segment.pitch;
            output.utterance = utterance;
            const isCurrent = () => active() && output.utterance === utterance;
            utterance.onend = () => {
              if (!isCurrent()) return;
              clearPlayback(output);
              if (index + 1 === plan.length) finish(true);
              else output.timer = window.setTimeout(() => play(index + 1), segment.pauseAfterMs);
            };
            utterance.onerror = () => { if (isCurrent()) finish(false, failureMessage); };
            utterance.onstart = () => {
              if (!isCurrent()) return;
              if (output.timer !== null) window.clearTimeout(output.timer);
              output.timer = window.setTimeout(() => finish(false, failureMessage), Math.min(120000, Math.max(20000, segment.text.length * 180)));
            };
            output.timer = window.setTimeout(() => finish(false, failureMessage), 10000);
            try { synthesis.speak(utterance); } catch { finish(false, failureMessage); }
          };
          play(0);
        };
        if (availableRussianVoices().length) begin();
        else {
          const onVoicesChanged = () => { if (availableRussianVoices().length) begin(); };
          synthesis.addEventListener?.("voiceschanged", onVoicesChanged);
          output.removeVoiceListener = () => synthesis.removeEventListener?.("voiceschanged", onVoicesChanged);
          output.timer = window.setTimeout(begin, 700);
        }
      };
      setSpeaking(true);
      setLoadingAudio(Boolean(cloudSource));
      setPlaybackNotice(null);
      setError(null);
      if (!cloudSource) { playBrowser(); return; }
      const playBlob = (blob: Blob) => {
        if (!active()) return;
        const url = URL.createObjectURL(blob);
        output.audioUrl = url;
        const audio = new Audio();
        output.audio = audio;
        const isCurrent = () => active() && output.audio === audio;
        const blocked = (error: unknown) => {
          if (!isCurrent()) return;
          if (error && typeof error === "object" && "name" in error && error.name === "NotAllowedError") {
            finish(false, "Браузер заблокировал автоматическое воспроизведение. Нажми «Повторить реплику». Текст и этап разговора сохранены.");
          } else playBrowser(true);
        };
        audio.onended = () => { if (isCurrent()) finish(true); };
        audio.onerror = () => { if (isCurrent()) playBrowser(true); };
        audio.onplaying = () => { if (isCurrent()) setLoadingAudio(false); };
        audio.src = url;
        if (output.timer !== null) window.clearTimeout(output.timer);
        output.timer = window.setTimeout(() => { if (isCurrent()) playBrowser(true); }, 120000);
        try {
          void Promise.resolve(audio.play()).then(() => { if (isCurrent()) setLoadingAudio(false); }, blocked);
        } catch (error) { blocked(error); }
      };
      const cached = cloudSource.cacheKey ? audioCacheRef.current.get(cloudSource.cacheKey) : undefined;
      if (cached) {
        // A blocked initial autoplay can be retried directly inside the repeat
        // button's user gesture, without awaiting synthesis or a second fetch.
        try { playBlob(cached); } catch { playBrowser(true); }
        return;
      }
      const controller = new AbortController();
      output.controller = controller;
      output.timer = window.setTimeout(() => playBrowser(true), 25000);
      // Cancellation can race a late provider response. Never create audio for
      // an inactive session. Cache only four small driver clips in page memory.
      void Promise.resolve().then(() => active() ? cloudSource.load(controller.signal) : null).then(result => {
        if (!active() || controller.signal.aborted || !result) return;
        if (result.mime_type !== "audio/mpeg" || !result.audio_base64 || result.audio_base64.length > 1000000) throw new Error("Invalid speech audio");
        const binary = atob(result.audio_base64);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: result.mime_type });
        if (cloudSource.cacheKey) {
          const cache = audioCacheRef.current;
          cache.delete(cloudSource.cacheKey);
          cache.set(cloudSource.cacheKey, blob);
          if (cache.size > 4) cache.delete(cache.keys().next().value!);
        }
        playBlob(blob);
      }).catch(() => { if (active() && !controller.signal.aborted) playBrowser(true); });
    });
  }, [cancelMicCheck, endRecording, stopSpeaking]);

  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value;
    if (mounted.current) updateMuted(value);
    if (value) {
      inputGeneration.current += 1;
      startingRef.current = false;
      cancelMicCheck();
      const session = recordingRef.current;
      if (session) endRecording(session, true);
    }
  }, [cancelMicCheck, endRecording]);

  const cancel = useCallback(() => {
    inputGeneration.current += 1;
    startingRef.current = false;
    cancelMicCheck();
    const session = recordingRef.current;
    if (session) endRecording(session, true);
    stopSpeaking();
  }, [cancelMicCheck, endRecording, stopSpeaking]);

  const resetTranscript = useCallback(() => {
    const session = recordingRef.current;
    if (session) endRecording(session, true);
    if (mounted.current) {
      setTranscript("");
      setInterimTranscript("");
      onTranscriptRef.current?.("");
    }
  }, [endRecording]);

  const clearError = useCallback(() => { if (mounted.current) setError(null); }, []);

  const selectVoice = useCallback((uri: string) => {
    selectedVoiceRef.current = uri;
    setSelectedVoiceURI(uri);
    try { browser()?.localStorage.setItem(voicePreferenceKey, uri); } catch { /* Device preference is optional. */ }
  }, [voicePreferenceKey]);

  useEffect(() => {
    const uri = storedVoice(voicePreferenceKey);
    audioCacheRef.current.clear();
    selectedVoiceRef.current = uri;
    setSelectedVoiceURI(uri);
  }, [voicePreferenceKey]);

  useEffect(() => {
    const synthesis = browser()?.speechSynthesis;
    if (!synthesis) return;
    const update = () => { if (mounted.current) setRussianVoices(availableRussianVoices()); };
    update();
    synthesis.addEventListener?.("voiceschanged", update);
    return () => synthesis.removeEventListener?.("voiceschanged", update);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
      audioCacheRef.current.clear();
    };
  }, [cancel]);

  return {
    support, recording, speaking, loadingAudio, playbackNotice, checkingMic, micChecked, micSignal, muted,
    transcript, interimTranscript, error, russianVoices, selectedVoiceURI, selectVoice,
    checkMicrophone, startRecording, stopRecording, speak, stopSpeaking,
    setMuted, clearError, resetTranscript, cancel,
  };
}
