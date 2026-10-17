/** Pure helpers of the QR access screens (docs/WORK_SITES_QR.md): the code's countdown and the device it was made on. */

/** A QR lives five minutes on the server (app/services/work_sites_access.py QR_LIFETIME). */
export const QR_LIFETIME_SECONDS = 300;

/** Whole seconds the code has left at `now`, 0 once it expired or when the time is unknown. */
export function secondsLeft(expiresAt: string | null | undefined, now: number) {
  const left = Math.ceil((Date.parse(expiresAt ?? "") - now) / 1000);
  return Number.isFinite(left) ? Math.min(QR_LIFETIME_SECONDS, Math.max(0, left)) : 0;
}

/** 4:05 */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The last minute is shown as running out. */
export const runningOut = (seconds: number) => seconds > 0 && seconds <= 60;

/** «Chrome · Windows» from the browser's user agent the operator's session was opened with. */
export function deviceName(agent: string) {
  const browser = /YaBrowser\//.test(agent) ? "Яндекс Браузер" : /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera"
    : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : null;
  const system = /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android"
    : /Windows/.test(agent) ? "Windows" : /Mac OS X|Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : null;
  return [browser, system].filter(Boolean).join(" · ") || "Неизвестное устройство";
}
