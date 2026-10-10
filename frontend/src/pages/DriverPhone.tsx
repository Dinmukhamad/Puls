import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { tokenStore } from "../api/client";
import { inkFor, parseColor, phoneExit, phoneFit, PHONE_FRAME_NAME, PHONE_STAGE_QUERY, readPhoneMessage, staysInPhone, type PhoneCoach, type PhoneMessage } from "./driverPhoneFrame";
import "./driver-phone.css";

/** Этот Puls открыт внутри телефона симулятора, а не в обычной вкладке. */
const insidePhone = typeof window !== "undefined" && window.name === PHONE_FRAME_NAME && window.parent !== window;
const tell = (message: PhoneMessage) => window.parent.postMessage(message, window.location.origin);
const phoneTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "numeric", minute: "2-digit" });
const DARK = "rgb(8, 8, 8)";

/** На компьютере Driver Simulator открывается в телефоне посреди экрана, на телефоне и планшете — во весь экран. */
export function DriverSimulator({ app }: { app: ReactNode }) {
  const topLevel = window.top === window;
  const [desktop, setDesktop] = useState(() => topLevel && window.matchMedia(PHONE_STAGE_QUERY).matches);
  useEffect(() => {
    if (!topLevel) return;
    const query = window.matchMedia(PHONE_STAGE_QUERY), sync = () => setDesktop(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [topLevel]);
  return desktop ? <DriverPhoneStage /> : <>{app}</>;
}

function DriverPhoneStage() {
  const navigate = useNavigate();
  const location = useLocation();
  const frame = useRef<HTMLIFrameElement>(null);
  // Телефон ведёт свою историю переходов, поэтому адрес загрузки берётся один раз.
  const [src] = useState(() => location.pathname + location.search + location.hash);
  const [fit, setFit] = useState(() => phoneFit(window.innerHeight));
  const [colors, setColors] = useState({ top: DARK, bottom: DARK });
  const [coach, setCoach] = useState<PhoneCoach | null>(null);
  const [time, setTime] = useState(phoneTime);
  useEffect(() => {
    const resize = () => setFit(phoneFit(window.innerHeight));
    const clock = window.setInterval(() => setTime(phoneTime()), 10_000);
    window.addEventListener("resize", resize);
    return () => { window.clearInterval(clock); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || !frame.current || event.source !== frame.current.contentWindow) return;
      const message = readPhoneMessage(event.data);
      if (!message) return;
      if (message.type === "puls:phone-colors") setColors({ top: message.top, bottom: message.bottom });
      else if (message.type === "puls:phone-coach") setCoach(message.coach);
      // Адрес страницы повторяет экран телефона: после перезагрузки откроется тот же раздел.
      else if (message.type === "puls:phone-location") { if (message.path !== window.location.pathname + window.location.search + window.location.hash) navigate(message.path, { replace: true }); }
      else if (message.type === "puls:phone-leave") navigate(message.path);
      // Сессию закрыли внутри телефона и токены уже стёрты: вход покажет сам Puls.
      else if (!tokenStore.refresh) window.location.reload();
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [navigate]);
  const style = {
    "--phone-screen-h": `${fit.screen}px`, "--phone-scale": fit.scale,
    "--phone-top": colors.top, "--phone-top-ink": inkFor(colors.top) === "dark" ? "#0b0b0c" : "#fff",
    "--phone-bottom": colors.bottom, "--phone-home": inkFor(colors.bottom) === "dark" ? "rgb(0 0 0 / .78)" : "rgb(255 255 255 / .85)",
  } as CSSProperties;
  return <div className="phone-stage" style={style}>
    <div className="phone">
      <span className="phone__key phone__key--action" aria-hidden="true" />
      <span className="phone__key phone__key--volume-up" aria-hidden="true" />
      <span className="phone__key phone__key--volume-down" aria-hidden="true" />
      <span className="phone__key phone__key--power" aria-hidden="true" />
      <div className="phone__screen">
        <div className="phone__status" aria-hidden="true">
          <span className="phone__time">{time}</span>
          <span className="phone__island" />
          <span className="phone__icons"><SignalIcon /><WifiIcon /><BatteryIcon /></span>
        </div>
        <iframe ref={frame} name={PHONE_FRAME_NAME} title="Driver Simulator" src={src} allow="geolocation; camera" />
        <div className="phone__home" aria-hidden="true"><span /></div>
      </div>
    </div>
    {coach && <aside className="phone-coach" aria-label="Подсказка оператору">
      <span className="phone-coach__tag">Подсказка оператору</span>
      <h3>{coach.title}</h3>
      {coach.body.map(([label, text]) => <div key={label}><b>{label}</b><p>{text}</p></div>)}
    </aside>}
  </div>;
}

/** Фотоконтроль внутри телефона: подсказка оператору встаёт рядом с телефоном, как раньше рядом с камерой. */
export function usePhoneCoach(coach: PhoneCoach | null) {
  const key = coach && JSON.stringify(coach);
  useEffect(() => { if (insidePhone) tell({ type: "puls:phone-coach", coach }); }, [key]);
  useEffect(() => () => { if (insidePhone) tell({ type: "puls:phone-coach", coach: null }); }, []);
}

/**
 * Puls внутри телефона: в нём живёт только приложение водителя. Переход в любой другой
 * раздел, выход из симулятора и конец сессии отдаются странице с телефоном.
 * Возвращает true, пока такой переход передаётся: на это время App ничего не рисует.
 */
export function usePhoneFrameBridge(signedOut: boolean): boolean {
  const location = useLocation();
  const path = location.pathname + location.search + location.hash;
  const leaving = insidePhone && !staysInPhone(location.pathname);
  useEffect(() => { if (insidePhone) tell(leaving ? { type: "puls:phone-leave", path } : { type: "puls:phone-location", path }); }, [leaving, path]);
  useEffect(() => { if (insidePhone && signedOut) tell({ type: "puls:phone-signed-out" }); }, [signedOut]);
  useEffect(() => {
    if (!insidePhone) return;
    // Ссылку перехватываем до роутера, чтобы чужой раздел даже не начал рисоваться в телефоне.
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const exit = phoneExit(anchor.href, window.location.origin);
      if (!exit) return;
      event.preventDefault();
      event.stopPropagation();
      tell({ type: "puls:phone-leave", path: exit });
    }
    // Строка состояния и полоска внизу повторяют цвет приложения у краёв экрана.
    let frame = 0, last = "";
    function sample() {
      frame = 0;
      const top = colorAt(window.innerWidth / 2, 1), bottom = colorAt(window.innerWidth / 2, window.innerHeight - 2);
      if (`${top}|${bottom}` === last) return;
      last = `${top}|${bottom}`;
      tell({ type: "puls:phone-colors", top, bottom });
    }
    const schedule = () => { frame ||= requestAnimationFrame(sample); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", click, true);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("click", click, true);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return leaving;
}

/** Первый непрозрачный фон под точкой экрана. */
function colorAt(x: number, y: number): string {
  for (let element = document.elementFromPoint(x, y); element; element = element.parentElement) {
    const color = getComputedStyle(element).backgroundColor;
    if ((parseColor(color)?.alpha ?? 0) > 0) return color;
  }
  return DARK;
}

function SignalIcon() {
  return <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="7.5" width="3" height="4.5" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>;
}
function WifiIcon() {
  return <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.6 5.7 9.3a3.3 3.3 0 0 1 4.6 0z" /><path d="M3.3 6.9a6.8 6.8 0 0 1 9.4 0l-1.5 1.5a4.7 4.7 0 0 0-6.4 0z" /><path d="M.9 4.5a10.2 10.2 0 0 1 14.2 0l-1.5 1.5a8.1 8.1 0 0 0-11.2 0z" /></svg>;
}
function BatteryIcon() {
  return <svg width="27" height="13" viewBox="0 0 27 13" fill="currentColor"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4" /><rect x="2" y="2" width="17" height="9" rx="2.2" /><path d="M25 4.4v4.2a2.2 2.2 0 0 0 0-4.2z" opacity=".45" /></svg>;
}
