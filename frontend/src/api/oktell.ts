import { request } from "./client";

export const OKTELL_QUERY = ["oktell"] as const;
export type OktellScreen = "cabinet" | "phone" | "messages" | "journal";
export type OfficeStatus = "available" | "forward" | "dnd";
export type PauseReason = "technical" | "callback" | "training" | "break";
export interface OktellContact {
  id: string; name: string; number: string; department: string;
  /** Free colleagues are black in the phone, those on a call red, those in a pause faded. */
  status: "available" | "busy" | "paused";
}
export interface OktellCall {
  id: string; contact_id: string; number: string; name: string; department: string;
  direction: "outbound" | "inbound"; status: "completed" | "missed"; started_at: string; finished_at: string;
  duration_seconds: number; comment: string; tags: string[];
  /** A driver's call of the voice trainer: its review is this attempt. */
  voice_attempt_id?: number;
}
/** A driver's call ringing now. Who calls, and why, is known only after answering. */
export interface OktellRinging { id: string; number: string; name: string; department: string; started_at: string }
export type OktellVoiceLanguage = "ru" | "kk";
export interface OktellMessage { id: string; contact_id: string; recipient: string; text: string; sent_at: string }
export interface OktellExercise { id: string; title: string; description: string; screen: OktellScreen; done: boolean }
export interface OktellState {
  operator: { name: string; login: string; number: string };
  demo_credentials: { login: string; password: string };
  logged_in: boolean; center_joined: boolean; office_status: OfficeStatus;
  center_mode: "automatic" | "manual"; pause_reason: PauseReason | null; pause_seconds: number;
  forward_number: string; web_phone: boolean; auto_answer: boolean;
  active_call: {
    id: string; contact_id: string; number: string; name: string; department: string; started_at: string;
    direction?: "outbound" | "inbound"; voice_attempt_id?: number;
  } | null;
  ringing: OktellRinging | null; ring_seconds: number;
  /** Drivers call this account in the call-centre; the language they speak. */
  voice_calls: boolean; voice_language: OktellVoiceLanguage;
  /** Claude speaks for the drivers and grades their calls (connected and within the month's budget). */
  voice_ai?: boolean;
  /** Set when Oktell ended the session by itself: «Перезвон» lasted longer than its limit. */
  notice: { kind: "callback_timeout"; at: string } | null;
  /** Codes dialled before a driver's number, e.g. 0880 for iTaxi. */
  park_codes: Record<string, string>;
  callback_limit_seconds: number;
  contacts: OktellContact[]; calls: OktellCall[]; messages: OktellMessage[];
  completed: string[]; exercises: OktellExercise[];
  metrics: { center_seconds: number; break_seconds: number; talk_seconds: number; busy_seconds: number; calls: number; successful: number };
}
export type OktellAction =
  | { action: "login"; login: string; password: string }
  | { action: "join" | "leave" | "logout" | "resume" | "call_end" | "reset" | "answer" }
  | { action: "voice_language"; language: OktellVoiceLanguage }
  | { action: "ring"; retry?: { attempt_id: number; turn: number } }
  | { action: "office_status"; status: OfficeStatus; number?: string }
  | { action: "center_mode"; mode: "automatic" | "manual" }
  | { action: "pause"; reason: PauseReason }
  | { action: "phone_settings"; web_phone: boolean; auto_answer: boolean }
  | { action: "call_start"; contact_id: string }
  | { action: "dial"; number: string }
  | { action: "message"; contact_id: string; text: string }
  | { action: "call_comment"; call_id: string; comment: string; tags: string[] };
export type OktellCommand = OktellAction & { request_id: string };

const BASE = "/api/v1/learning/oktell";
export const oktell = {
  state: (signal?: AbortSignal) => request<OktellState>(BASE, { signal, timeoutMs: 20000 }),
  // The caller creates an id once. A retry reuses the exact command, including its id.
  // Hanging up a driver's call waits for its review by the AI: give it time.
  action: (command: OktellCommand) => request<OktellState>(`${BASE}/actions`, { method: "POST", json: command, timeoutMs: command.action === "call_end" ? 45000 : 20000 }),
};
