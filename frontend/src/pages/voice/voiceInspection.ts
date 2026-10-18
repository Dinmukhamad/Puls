import type { VoiceAttempt, VoiceInspection } from "../../api/voiceTraining";

/** Selecting an account is part of the exercise; only its visible details can count. */
export function voiceDispatchInspection(attempt: VoiceAttempt | undefined, driverId: string | undefined, parkId: string, tab: string | undefined): VoiceInspection | null {
  if (!attempt || attempt.state !== "in_progress" || attempt.custom || attempt.practice.dispatch
    || driverId !== attempt.driver.id || parkId !== attempt.driver.park_id || (tab ?? "details") !== "details") return null;
  return { system: "dispatch", driver_id: driverId, park_id: parkId };
}
