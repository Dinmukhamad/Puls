import type { VoiceProvider, VoiceSpeechConfig } from "../../api/voiceTraining";

/** A missing cloud provider falls back visibly; an explicit browser choice wins. */
export function resolveVoiceProvider(preferred: string | null, config?: VoiceSpeechConfig): VoiceProvider {
  if (preferred === "browser") return "browser";
  if (preferred) return config?.providers.some(item => item.id === preferred) ? preferred as VoiceProvider : "browser";
  const available = config?.providers ?? [];
  if (config?.default_provider !== "browser" && available.some(item => item.id === config?.default_provider)) return config!.default_provider;
  return available.find(item => item.id === "google")?.id ?? available.find(item => item.id === "azure")?.id ?? "browser";
}
