import { request } from "./client";

export const OKTELL_QUERY = ["oktell"] as const;
export type OktellScreen = "cabinet" | "phone" | "messages" | "journal";
export type OfficeStatus = "available" | "forward" | "dnd";
export type PauseReason = "technical" | "callback" | "training" | "break";
export interface OktellContact {
  id: string; name: string; number: string; department: string;
  status: "available" | "busy" | "offline";
}
export interface OktellCall {
  id: string; contact_id: string; number: string; name: string; department: string;
  direction: "outbound" | "inbound"; status: string; started_at: string; finished_at: string;
  duration_seconds: number; comment: string; tags: string[];
}
export interface OktellMessage { id: string; contact_id: string; recipient: string; text: string; sent_at: string }
export interface OktellExercise { id: string; title: string; description: string; screen: OktellScreen; done: boolean }
export interface OktellState {
  operator: { name: string; login: string; number: string };
  demo_credentials: { login: string; password: string };
  logged_in: boolean; center_joined: boolean; office_status: OfficeStatus;
  center_mode: "automatic" | "manual"; pause_reason: PauseReason | null; pause_seconds: number;
  forward_number: string; web_phone: boolean; auto_answer: boolean;
  active_call: { id: string; contact_id: string; number: string; name: string; started_at: string } | null;
  contacts: OktellContact[]; calls: OktellCall[]; messages: OktellMessage[];
  completed: string[]; exercises: OktellExercise[];
  metrics: { center_seconds: number; break_seconds: number; talk_seconds: number; busy_seconds: number; calls: number; successful: number };
}
export type OktellAction =
  | { action: "login"; login: string; password: string }
  | { action: "join" | "leave" | "logout" | "resume" | "call_end" | "reset" }
  | { action: "office_status"; status: OfficeStatus; number?: string }
  | { action: "center_mode"; mode: "automatic" | "manual" }
  | { action: "pause"; reason: PauseReason }
  | { action: "phone_settings"; web_phone: boolean; auto_answer: boolean }
  | { action: "call_start"; contact_id: string }
  | { action: "message"; contact_id: string; text: string }
  | { action: "call_comment"; call_id: string; comment: string; tags: string[] };
export type OktellCommand = OktellAction & { request_id: string };

const BASE = "/api/v1/learning/oktell";
export const oktell = {
  state: (signal?: AbortSignal) => request<OktellState>(BASE, { signal, timeoutMs: 20000 }),
  // The caller creates an id once. A retry reuses the exact command, including its id.
  action: (command: OktellCommand) => request<OktellState>(`${BASE}/actions`, { method: "POST", json: command, timeoutMs: 20000 }),
};
