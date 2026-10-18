/**
 * Drivers of the voice trainer call into the training Oktell. A call comes only to an operator who
 * takes calls: in the call-centre, automatic mode, no pause, «На связи», web phone on. The server
 * checks the same; these rules decide when the softphone rings and what the cabinet explains.
 */
import type { OktellState } from "../../api/oktell";

/** The operator stopped speaking: this long without new words sends the answer to the driver. */
export const SILENCE_MS = 1700;
/** «Автоответ» picks the call up after one ring. */
export const AUTO_ANSWER_MS = 1600;
/** The driver who got his answer hangs up himself if the operator does not. */
export const DRIVER_HANGS_UP_MS = 20000;

type Line = Pick<OktellState, "logged_in" | "center_joined" | "web_phone" | "pause_reason" | "center_mode" | "office_status" | "active_call" | "ringing" | "voice_calls">;

/** Why calls do not come now, in the operator's words; empty when they do. */
export function callsBlocked(state: Line): string {
  if (!state.voice_calls) return "Учебные звонки недоступны для этой учётной записи";
  if (!state.logged_in) return "Войдите в Oktell";
  if (!state.center_joined) return "Войдите в call-центр";
  if (!state.web_phone) return "Включите «Веб-телефон» в меню статусов";
  if (state.pause_reason) return "Вы в паузе: вернитесь к работе";
  if (state.center_mode !== "automatic") return "Выберите автоматический режим";
  if (state.office_status !== "available") return "Выберите статус «На связи»";
  return "";
}

/** Nobody on the line and nothing ringing: the next driver may call. */
export function readyForCall(state: Line) {
  return !callsBlocked(state) && !state.active_call && !state.ringing;
}

/** A first call soon after the operator is ready; later ones leave a pause between drivers. */
export function nextRingDelay(first: boolean, random: () => number = Math.random) {
  return first ? 5000 + Math.round(random() * 4000) : 15000 + Math.round(random() * 10000);
}

/** The operator said something and then kept quiet long enough: the answer goes. */
export function answerReady(text: string, lastWordAt: number, now: number) {
  return text.trim().length >= 2 && now - lastWordAt >= SILENCE_MS;
}

/** «+7 701 555 01 92» for a Kazakhstan mobile number; anything else as it came. */
export function formatCaller(number: string) {
  const digits = number.replace(/\D/g, "");
  if (digits.length !== 11 || !digits.startsWith("7")) return number;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

/** «Повторить момент» asks Oktell for the same driver: the attempt and the answer to start from. */
export function retryFromParams(params: URLSearchParams): { attempt_id: number; turn: number } | null {
  const attempt = Number(params.get("voiceRetry")), turn = Number(params.get("voiceTurn") || NaN);
  return Number.isInteger(attempt) && attempt > 0 && Number.isInteger(turn) && turn >= 0 && turn <= 100 ? { attempt_id: attempt, turn } : null;
}
