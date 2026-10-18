import type { VoiceProvider, VoiceSpeechConfig } from "../../api/voiceTraining";

/** The server's cloud voice (Yandex SpeechKit first), or the browser's own voice without one. */
export function resolveVoiceProvider(config?: VoiceSpeechConfig): VoiceProvider {
  const available = config?.providers ?? [];
  if (config?.default_provider !== "browser" && available.some(item => item.id === config?.default_provider)) return config!.default_provider;
  return available.find(item => item.id === "yandex")?.id ?? available.find(item => item.id === "google")?.id ?? available.find(item => item.id === "azure")?.id ?? "browser";
}
