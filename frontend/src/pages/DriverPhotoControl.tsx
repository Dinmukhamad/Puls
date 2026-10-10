import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DriverShift, ShiftAct } from "../api/driverShift";
import { DAction, DChoice, DExplain, DInfo } from "./DriverButtons";
import { Confetti, SuccessMark } from "./DriverMotion";
import { PhotoGuide, PhotoScene, PhotoThumb, plateParts, type PhotoArtData, type PhotoKind } from "./DriverPhotoArt";
import { usePhoneCoach } from "./DriverPhone";
import "./driver-photo.css";

/* Фотоконтроль машины и СТС — так, как его проходит водитель в Яндекс Про.
   Профиль → Фотоконтроль: список проверок по группам «Блокирует работу» и «Пройденные».
   Проверка — сетка плиток с подписями. Плитка открывает камеру с рамкой ракурса, после снимка —
   «Всё хорошо видно?», потом «Отправляем?» со всеми фото и статус «Смотрим ваши фото».
   Камера устройства не нужна: видоискатель показывает учебную сцену, её надо поймать в рамку.
   На компьютере камера стоит в рамке телефона, а сбоку — подсказка оператору. */

export interface PhotoStep {
  kind: PhotoKind; title: string; short: string;
  /** Что совмещать с рамкой: «машину», «салон», «багажник», «документ». */
  subject: string;
  /** Подсказка на экране камеры — её видит водитель. */
  hint: string;
  /** Что смотрит проверка на этом снимке. */
  checks: string[];
  /** Частая причина, по которой снимок не проходит. */
  mistake: string;
  /** Что оператор подсказывает водителю. */
  tell: string;
  /** В салоне темно: без вспышки кадр не примут. */
  dark?: boolean;
  /** Документ: со вспышкой блик закрывает данные. */
  doc?: boolean;
}

export const PHOTO_CHECK = "Фотоконтроль машины и СТС";

/** Порядок плиток повторяет приложение: машина по кругу, салон, багажник, затем техпаспорт. */
export const PHOTO_STEPS: PhotoStep[] = [
  { kind: "front", subject: "машину", title: "Машина спереди", short: "Спереди",
    hint: "Встаньте прямо перед машиной в 3–4 шагах. Номер целиком в кадре и читается.",
    checks: ["Номер читается и совпадает с профилем", "Машина целиком, края не обрезаны"],
    mistake: "Номер грязный или обрезан краем кадра.",
    tell: "Протрите номер и отойдите на пару шагов, чтобы машина целиком встала в рамку." },
  { kind: "left", subject: "машину", title: "Машина слева", short: "Слева",
    hint: "Встаньте напротив середины машины: весь бок и оба колеса в рамке. Снимайте прямо, не под углом.",
    checks: ["Кузов целиком, от фары до фонаря", "Все детали одного цвета"],
    mistake: "Снято под углом — часть машины не попала в кадр.",
    tell: "Встаньте ровно напротив водительской двери и держите телефон вертикально." },
  { kind: "rear", subject: "машину", title: "Машина сзади", short: "Сзади",
    hint: "Задний номер и фонари целиком. Солнце лучше держать за спиной.",
    checks: ["Задний номер читается", "Нет посторонних наклеек"],
    mistake: "Блик или тень закрывает номер.",
    tell: "Встаньте так, чтобы солнце светило в спину, и переснимите кадр." },
  { kind: "right", subject: "машину", title: "Машина справа", short: "Справа",
    hint: "Вся правая сторона: двери, колёса и оклейка.",
    checks: ["Кузов чистый, без серьёзных повреждений", "Нет рекламы на боковых стёклах"],
    mistake: "Машина грязная — не видно цвета и повреждений.",
    tell: "Грязную машину проверка не пропустит: лучше пройти фотоконтроль после мойки." },
  { kind: "seats-front", subject: "салон", title: "Передний ряд сидений", short: "Передний ряд", dark: true,
    hint: "Откройте переднюю дверь. В салоне темно — включите вспышку.",
    checks: ["Сиденья чистые, без пятен", "Ремни на месте и не спрятаны"],
    mistake: "Темно в салоне или на сиденьях лежат вещи.",
    tell: "Откройте двери для света или включите вспышку, уберите вещи с сидений." },
  { kind: "seats-rear", subject: "салон", title: "Задний ряд сидений", short: "Задний ряд", dark: true,
    hint: "Откройте заднюю дверь и снимите весь диван. Нужна вспышка.",
    checks: ["На сиденьях нет вещей", "Ремни и замки ремней не закрыты"],
    mistake: "Ремни спрятаны за спинку или замки закрыты заглушками.",
    tell: "Достаньте ремни из-за спинок и снимите заглушки: без ремней фотоконтроль не пройти." },
  { kind: "trunk", subject: "багажник", title: "Открытый багажник", short: "Багажник",
    hint: "Откройте багажник и снимите сзади. Половина места должна быть свободна.",
    checks: ["Свободна половина багажника", "Багажник чистый"],
    mistake: "Багажник заставлен вещами.",
    tell: "Для вещей пассажира должна быть свободна минимум половина багажника." },
  { kind: "doc-front", subject: "документ", title: "Свидетельство ТС (лицевая сторона)", short: "СТС, лицевая", doc: true,
    hint: "Техпаспорт целиком в рамке, текст горизонтально. Вспышку выключите.",
    checks: ["Номер, марка и год совпадают с профилем", "Документ — оригинал, не копия и не экран"],
    mistake: "Блик от вспышки или пальцы закрывают данные.",
    tell: "Выключите вспышку, положите техпаспорт на стол и снимите сверху." },
  { kind: "doc-back", subject: "документ", title: "Свидетельство ТС (обратная сторона)", short: "СТС, оборот", doc: true,
    hint: "Переверните документ. Все поля и края в рамке, без вспышки.",
    checks: ["Документ целиком, края не обрезаны", "Текст резкий и читается"],
    mistake: "Данные техпаспорта не совпадают с карточкой машины в парке.",
    tell: "Если данные СТС и профиля не совпадают, карточку машины исправляет парк — сверьте номер, марку, цвет и год в CRM." },
];
const COUNT = PHOTO_STEPS.length;

// «Смотрим ваши фото»: пункты загораются по очереди.
const REVIEW = ["Номера читаются спереди и сзади", "Машина совпадает с профилем", "Кузов и салон чистые", "Ремни на месте, багажник свободен", "СТС совпадает с данными машины"];

const TIPS = [
  { icon: "sun", title: "Светло и прямо", text: "Днём или под фонарём. Машину снимайте ровно с каждой стороны, без косых ракурсов." },
  { icon: "frame", title: "Всё в рамке", text: "Кадр можно делать, когда рамка на экране станет зелёной." },
  { icon: "flash", title: "Вспышка: салон — да, документы — нет", text: "В тёмном салоне включите вспышку. На техпаспорте она даёт блик." },
  { icon: "cam", title: "Только камера приложения", text: "Старые фото, скриншоты и снимки с экрана проверка не примет." },
];

// Проверки, которые учебный водитель уже прошёл: список выглядит так же, как в приложении.
const EARLIER = [
  { title: "Проверка селфи", note: "Проверка пройдена" },
  { title: "Фотоконтроль в/у", note: "Пройдено" },
];

type Stage = "tips" | "camera" | "summary" | "sending" | "checking" | "result";
type Quality = "ok" | "blur" | "glare" | "dark";
type Shot = { step: number; quality: Quality; image?: string };
type Queued = { action: "photo_step" | "photo_submit"; values?: Record<string, unknown> };

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const canUseCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
// Снимки своей камерой живут только в памяти вкладки: переход по разделам их не стирает.
const shotCache = new Map<string, Record<number, string>>();

function Glyph({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" /></>,
    frame: <><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /><path d="m8.5 12.5 2.4 2.4 4.6-5" /></>,
    flash: <path d="m13 3-7 10h5l-1 8 7-10h-5z" />,
    cam: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></>,
    car: <><path d="M4 16h16M5 16v2m14-2v2" /><path d="M4.5 16 6 9.5A2 2 0 0 1 8 8h8a2 2 0 0 1 2 1.5L19.5 16" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

interface Props {
  shift: DriverShift; busy: boolean; act: ShiftAct; go: (view: string, detail?: string) => void;
  /** Открытая проверка: «car» — фотоконтроль машины и СТС, пусто — список проверок. */
  detail: string;
  /** Шапка раздела профиля с кнопкой «Назад». */
  head: (title: string, big?: boolean) => ReactNode;
  /** Во время заказа проверку не перезапустить. */
  orderActive: boolean;
  /** Сообщает профилю, что камера открыта: жест «назад» не должен уводить со страницы. */
  onOverlay?: (open: boolean) => void;
}

export function DriverPhotoControl({ shift, busy, act, go, detail, head, orderActive, onOverlay }: Props) {
  const d = shift.data;
  const car = d.cars.find(x => x.id === d.car_id) ?? d.cars[0];
  const art: PhotoArtData = { plate: car?.plate ?? "000AAA00", car: car ? `${car.brand} ${car.model}` : "Учебный автомобиль", year: car?.year };
  const passed = d.photo_status === "passed";
  const taken = new Set(passed ? PHOTO_STEPS.map((_, i) => i) : d.photo_steps.filter(i => i >= 0 && i < COUNT));
  const count = taken.size;
  const missing = PHOTO_STEPS.map((_, i) => i).filter(i => !taken.has(i));
  const firstMissing = missing[0] ?? -1;
  // Причину берём из журнала смены: повтор по кнопке или смена машины.
  const restarted = [...(shift.events ?? [])].reverse().find(x => x.action === "photo_restart" || x.action === "car_select")?.action === "photo_restart";

  const [stage, setStage] = useState<Stage | null>(null);
  const [current, setCurrent] = useState(0);
  const [retake, setRetake] = useState<"grid" | "summary" | null>(null);
  const [aim, setAim] = useState(0);
  const [locked, setLocked] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [flash, setFlash] = useState(false);
  const [example, setExample] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [queued, setQueued] = useState<Queued | null>(null);
  const [silent, setSilent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [device, setDevice] = useState<"off" | "starting" | "on">("off");
  // Кадры с камеры устройства реально идут: без этого рамка зеленела бы над чёрным экраном.
  const [streaming, setStreaming] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const [images, setImages] = useState<Record<number, string>>(() => shotCache.get(shift.id) ?? {});
  const sawBusy = useRef(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const exampleButton = useRef<HTMLButtonElement>(null);
  const hadExample = useRef(false);
  // Экраны профиля въезжают анимацией transform, а она запирает position: fixed внутри себя.
  // Поэтому камера выносится в корень приложения: там она закрывает и шапку, и нижнее меню.
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(anchor.current?.closest<HTMLElement>(".driver-app") ?? document.body); }, []);

  const step = stage === "camera" ? PHOTO_STEPS[current] : undefined;
  const open = stage !== null;
  const cameraMode = device !== "off";
  const live = device === "on" && streaming;

  useEffect(() => { onOverlay?.(open); }, [open, onOverlay]);
  useEffect(() => () => onOverlay?.(false), [onOverlay]);
  useEffect(() => { shotCache.set(shift.id, images); }, [shift.id, images]);
  // «Пройти ещё раз» обнуляет проверку — прежние снимки своей камерой тоже уходят.
  useEffect(() => { if (!passed && d.photo_steps.length === 0) setImages(prev => Object.keys(prev).length ? {} : prev); }, [passed, d.photo_steps.length]);

  // Команды на сервер ждут, пока освободится предыдущая: иначе смена отбросит нажатие.
  // Сторож живёт в ref: act меняется на каждом рендере смены, и таймер в эффекте сбрасывался бы.
  const watchdog = useRef<number>();
  useEffect(() => () => window.clearTimeout(watchdog.current), []);
  useEffect(() => { if (busy) sawBusy.current = true; }, [busy]);
  useEffect(() => {
    if (!queued || busy) return;
    sawBusy.current = false;
    act(queued.action, queued.values);
    setQueued(null);
    window.clearTimeout(watchdog.current);
    watchdog.current = window.setTimeout(() => { if (!sawBusy.current) setSilent(true); }, 3000);
  }, [queued, busy, act]);

  // Кадр сохранён, когда сервер засчитал плитку. Не засчитал — кадр остаётся, показываем ошибку.
  useEffect(() => {
    if (saving === null) return;
    if (taken.has(saving)) {
      setSaving(null);
      // Двигаем камеру дальше, только если это та же съёмка, что сохраняла кадр.
      if (stage !== "camera" || retake !== null || current !== saving) return;
      setShot(null); setAim(a => a + 1);
      const next = missing.find(i => i > saving) ?? missing[0];
      if (next === undefined) { close(); return; }
      setCurrent(next);
      return;
    }
    if (!queued && !busy && (sawBusy.current || silent)) { setSaving(null); setSilent(false); setError("Фото не сохранилось. Проверьте связь и нажмите «Подходит» ещё раз."); }
  });

  // Рамка «ловит» объект: сцена доезжает до места, рамка зеленеет — можно снимать.
  useEffect(() => {
    if (stage !== "camera" || shot) return;
    setLocked(false);
    if (cameraMode && !live) return;
    const timer = window.setTimeout(() => setLocked(true), reduced() ? 0 : live ? 900 : 1250);
    return () => window.clearTimeout(timer);
  }, [stage, aim, shot, current, live, cameraMode]);

  // Отправка: фото «улетают» по одному, затем смена засчитывает проверку.
  useEffect(() => {
    if (stage !== "sending") return;
    if (uploaded >= COUNT) { setQueued({ action: "photo_submit" }); setReviewed(0); setStage("checking"); return; }
    const timer = window.setTimeout(() => setUploaded(n => n + 1), reduced() ? 0 : 150);
    return () => window.clearTimeout(timer);
  }, [stage, uploaded]);
  useEffect(() => {
    if (stage !== "checking") return;
    if (reviewed < REVIEW.length) { const timer = window.setTimeout(() => setReviewed(n => n + 1), reduced() ? 0 : 620); return () => window.clearTimeout(timer); }
    if (passed) setStage("result");
  }, [stage, reviewed, passed]);
  // Ответ потерялся, но обновление смены принесло «пройдено» — показываем результат, а не повтор.
  useEffect(() => { if (stage === "summary" && passed) setStage("result"); }, [stage, passed]);
  useEffect(() => {
    if (stage !== "checking" || passed || queued || busy || !(sawBusy.current || silent)) return;
    setSilent(false); setStage("summary"); setError("Фото не отправились. Проверьте связь и отправьте ещё раз.");
  }, [stage, passed, queued, busy, silent]);

  // Своя камера: включается кнопкой, выключается при закрытии камеры.
  const wantCamera = device !== "off" && stage === "camera";
  useEffect(() => {
    if (!wantCamera) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false }).then(media => {
      if (cancelled) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      if (video.current) { video.current.srcObject = media; void video.current.play().catch(() => undefined); }
      setDevice("on"); setDeviceNote(null);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setDevice("off");
      const denied = reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "SecurityError");
      setDeviceNote(denied ? "Браузер не дал доступ к камере. Снимаем учебную сцену." : "Камера не найдена или занята. Снимаем учебную сцену.");
    });
    return () => { cancelled = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setStreaming(false); };
  }, [wantCamera]);
  const attachVideo = (element: HTMLVideoElement | null) => {
    video.current = element;
    if (element && stream.current && element.srcObject !== stream.current) { element.srcObject = stream.current; void element.play().catch(() => undefined); }
  };

  // Пока открыта камера, остальное приложение недоступно: ни Tab, ни экранный диктор не уводят
  // за неё — иначе можно уйти со страницы посреди отправки и потерять её.
  useEffect(() => {
    if (!open || !host) return;
    const others = [...host.children].filter((x): x is HTMLElement => x instanceof HTMLElement && x !== dialog.current && !x.hasAttribute("inert"));
    others.forEach(x => x.setAttribute("inert", ""));
    return () => others.forEach(x => x.removeAttribute("inert"));
  }, [open, host]);
  // Фокус возвращается после того, как с приложения снят inert, иначе браузер его не примет.
  // Кнопки, с которой открыли камеру, может уже не быть: после проверки «Отправить» сменяется
  // на «Перейти к заказам». Тогда фокус встаёт на первую кнопку под сеткой или на первую плитку.
  const restore = useRef<HTMLElement | true | null>(null);
  useEffect(() => {
    if (open || !restore.current) return;
    const back = restore.current; restore.current = null;
    const page = anchor.current?.parentElement;
    const target = back !== true && back.isConnected ? back : page?.querySelector<HTMLElement>(".pc-shots ~ .du-choice, button.pc-shot, .pc-check");
    target?.focus({ preventScroll: true });
  }, [open]);

  // Диалог: фокус внутрь, Tab не уходит за камеру, Escape закрывает, фокус возвращается к плитке.
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (example) setExample(false); else if (stage !== "sending" && stage !== "checking" && saving === null) cancel();
        return;
      }
      const scope = example ? dialog.current?.querySelector<HTMLElement>(".pc-example") : dialog.current;
      if (event.key !== "Tab" || !scope) return;
      const items = [...scope.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent !== null);
      // На экранах отправки нажимать нечего: фокус остаётся на самом окне.
      if (!items.length) { event.preventDefault(); dialog.current?.focus({ preventScroll: true }); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!open) return;
    const closedExample = hadExample.current && !example;
    hadExample.current = example;
    const target = example ? dialog.current?.querySelector<HTMLElement>(".pc-example [data-autofocus]")
      : closedExample && exampleButton.current ? exampleButton.current
      : stage === "camera" && !shot ? shutter.current : dialog.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.current;
    target?.focus({ preventScroll: true });
  }, [open, stage, shot, current, example]);

  function remember() { if (!opener.current && document.activeElement instanceof HTMLElement) opener.current = document.activeElement; }
  function openCamera(index: number, from: "grid" | "summary" | null = null) {
    remember(); setError(null); setShot(null); setExample(false); setCurrent(index); setRetake(from); setAim(a => a + 1);
    setStage(count === 0 && from === null && stage === null ? "tips" : "camera");
  }
  /** × и Escape: пересъёмка из «Отправляем?» возвращает к нему, остальное закрывает камеру. */
  function cancel() {
    if (stage === "camera" && retake === "summary") { setRetake(null); setShot(null); setExample(false); setError(null); setStage("summary"); return; }
    close();
  }
  function close() {
    setStage(null); setShot(null); setRetake(null); setExample(false); setDevice("off"); setDeviceNote(null);
    restore.current = opener.current ?? true; opener.current = null;
  }
  function capture() {
    const element = video.current;
    if (!element || !element.videoWidth) return undefined;
    const width = 600, height = 800, canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    const scale = Math.max(width / element.videoWidth, height / element.videoHeight);
    const sw = width / scale, sh = height / scale;
    context.drawImage(element, (element.videoWidth - sw) / 2, (element.videoHeight - sh) / 2, sw, sh, 0, 0, width, height);
    try { return canvas.toDataURL("image/jpeg", 0.82); } catch { return undefined; }
  }
  function shoot() {
    if (!step || shot || saving !== null) return;
    const image = live ? capture() : undefined;
    if (cameraMode && !image) return;
    const quality: Quality = !locked ? "blur" : image ? "ok" : step.doc && flash ? "glare" : step.dark && !flash ? "dark" : "ok";
    setError(null); setFlashKey(k => k + 1); setShot({ step: current, quality, image });
  }
  function again() { setShot(null); setError(null); setAim(a => a + 1); }
  function accept() {
    if (!shot || shot.quality !== "ok" || saving !== null) return;
    const image = shot.image;
    setImages(prev => { const next = { ...prev }; if (image) next[shot.step] = image; else delete next[shot.step]; return next; });
    if (retake) { const back = retake; setRetake(null); setShot(null); if (back === "summary") setStage("summary"); else close(); return; }
    setError(null); setSilent(false); setSaving(shot.step); setQueued({ action: "photo_step", values: { step: shot.step } });
  }
  function send() { setError(null); setSilent(false); if (passed) { setStage("result"); return; } setUploaded(0); setStage("sending"); }

  const photo = (index: number, className: string, wide = true) => images[index]
    ? <img className={className} src={images[index]} alt="" />
    : <PhotoThumb className={className} kind={PHOTO_STEPS[index].kind} data={art} wide={wide} />;

  // ── список проверок и сама проверка ───────────────────────────────────
  const state = passed ? "passed" : count >= COUNT ? "ready" : count > 0 ? "progress" : "required";
  const status = { passed: "Пройдено", ready: "Все фото сделаны — отправьте", progress: `Снято ${count} из ${COUNT}`, required: "Не пройдено" }[state];
  const plate = car ? plateParts(car.plate) : null;
  const carRow = car && <div className="pc-car">
    <span className="pc-car-icon" aria-hidden="true"><Glyph name="car" /></span>
    <div><strong>{car.brand} {car.model}</strong><small>{car.year} · проверка для этой машины</small></div>
    {plate && <span className="pc-plate"><b>{plate.main}</b>{plate.region && <i>{plate.region}</i>}</span>}
  </div>;
  const explain = <DExplain real="после смены машины, по сроку (обычно раз в 10 дней) или по запросу парка водитель снимает машину, салон и СТС камерой Яндекс Про. Проверка занимает 5–15 минут, результат приходит в чат, до успешной проверки доступ к заказам закрыт."
    sim="камера показывает учебную сцену — её нужно поймать в рамку. Можно включить камеру устройства: снимки остаются в памяти браузера и никуда не загружаются. Проверка засчитывается за пару секунд." />;

  const list = <>
    {head("Фотоконтроль")}
    <section className="pc-hero" data-state={state}>
      <div className="pc-hero-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64"><path className="pc-hero-shield" d="M32 6 12 13v15c0 13 8.6 24 20 30 11.4-6 20-17 20-30V13z" /><path className="pc-hero-cam" d="M22 27h5l2.5-3.5h5L37 27h5v14H22z" /><circle className="pc-hero-lens" cx="32" cy="34" r="4.2" /><path className="pc-hero-tick" d="m24 33 6 6 11-12" /></svg>
      </div>
      <div className="pc-hero-body">
        <span className="pc-chip" data-state={state}>{passed ? "Доступ к заказам открыт" : "Нет доступа к заказам"}</span>
        <h2>{passed ? "Все проверки пройдены" : "Пройдите фотоконтроль"}</h2>
        <p>{passed ? "Следующая проверка машины — через 10 дней." : restarted ? "Проверка запущена заново: нужны свежие фото машины и техпаспорта. Без них заказы не поступают." : "Сменился автомобиль в профиле: нужны фото машины и техпаспорта. Без них заказы не поступают."}</p>
      </div>
    </section>
    {!passed && <>
      <div className="dp-bar pc-bar">Блокирует работу</div>
      <div className="dp-card dp-card--flat">
        <button className="dp-row pc-check" type="button" onClick={() => go("photo", "car")}>
          <span className="dp-status" data-tone={count ? "warn" : "danger"}>{count ? "…" : "✕"}</span>
          <div><strong>{PHOTO_CHECK}</strong><small data-tone={count ? "warn" : "danger"}>{status}</small></div>
          <i aria-hidden="true">›</i>
        </button>
      </div>
    </>}
    {passed && <>
      <div className="dp-bar pc-bar">Информация</div>
      <div className="dp-card dp-card--flat">
        <button className="dp-row pc-check" type="button" onClick={() => go("photo", "car")}>
          <span className="dp-status" data-tone="warn" aria-hidden="true">i</span>
          <div><strong>{PHOTO_CHECK}</strong><small>Следующая проверка через 10 дней. Вы можете пройти её сейчас.</small></div>
          <i aria-hidden="true">›</i>
        </button>
      </div>
    </>}
    <details className="pc-passed" open={passed || undefined}>
      <summary className="dp-bar pc-bar">Пройденные проверки <b>{EARLIER.length + (passed ? 1 : 0)}</b></summary>
      <div className="dp-card dp-card--flat">
        {passed && <div className="dp-row"><span className="dp-status" data-tone="done">✓</span><div><strong>{PHOTO_CHECK}</strong><small>Пройдено</small></div></div>}
        {EARLIER.map(x => <div className="dp-row" key={x.title}><span className="dp-status" data-tone="done">✓</span><div><strong>{x.title}</strong><small>{x.note}</small></div></div>)}
      </div>
    </details>
    <DInfo title="Что спрашивают водители">
      <dl className="pc-faq">
        <dt>«Где пройти фотоконтроль?»</dt><dd>Профиль → Фотоконтроль или Диагностика → нужная проверка. Проверки, без которых нельзя работать, стоят в группе «Блокирует работу».</dd>
        <dt>«Можно загрузить фото из галереи?»</dt><dd>Нет: снимать нужно камерой в приложении. Старые фото, скриншоты и снимки с экрана не принимаются.</dd>
        <dt>«Фотоконтроль не прошёл»</dt><dd>Причина приходит в чат «Предупреждения». Исправьте замечание и переснимите — иногда только часть фото.</dd>
        <dt>«Сколько ждать проверку?»</dt><dd>Обычно 5–15 минут. После успешной проверки доступ к заказам открывается сразу.</dd>
        <dt>«Данные в СТС не совпадают»</dt><dd>Карточку машины исправляет парк: сверьте госномер, марку, цвет и год выпуска.</dd>
        <dt>«Камера не открывается»</dt><dd>Разрешите приложению доступ к камере, перезапустите его или телефон, обновите приложение.</dd>
      </dl>
    </DInfo>
    {explain}
  </>;

  const check = <>
    {head(PHOTO_CHECK, true)}
    <p className="pc-reason">{passed ? "Проверка пройдена. Следующая — через 10 дней." : `Необходимо пройти проверку. Причина: ${restarted ? "проверка запущена заново" : "сменился автомобиль"} — нет фото машины и СТС.`}</p>
    {carRow}
    <div className="pc-meter" role="img" aria-label={`Снято ${count} из ${COUNT}`}>
      <div className="pc-meter-bar">{PHOTO_STEPS.map((x, i) => <i key={x.kind} data-done={taken.has(i)} data-now={!passed && i === firstMissing} />)}</div>
      <span><b>{count}</b> из {COUNT} фото{!passed && firstMissing >= 0 ? ` · нажмите на плитку «${PHOTO_STEPS[firstMissing].title}»` : ""}</span>
    </div>
    <div className="pc-shots">{PHOTO_STEPS.map((x, i) => {
      const status = taken.has(i) ? "done" : i === firstMissing ? "next" : "empty";
      const label = `${x.title}: ${passed ? "принято" : status === "done" ? "снято, нажмите, чтобы переснять" : "не снято, открыть камеру"}`;
      const body = <>
        <span className="pc-shot-pic">
          {status === "done" ? photo(i, "pc-shot-img") : <><PhotoThumb kind={x.kind} data={art} wide className="pc-shot-img pc-shot-hint" /><span className="pc-shot-plus" aria-hidden="true">+</span></>}
          {status === "done" && <span className="pc-shot-ok" aria-hidden="true">✓</span>}
        </span>
        <span className="pc-shot-label">{x.title}</span>
      </>;
      return passed
        ? <div key={x.kind} className="pc-shot" data-status={status} role="img" aria-label={label}>{body}</div>
        : <button key={x.kind} type="button" className="pc-shot" data-status={status} aria-label={label} style={{ "--i": i } as CSSProperties} onClick={() => openCamera(i, status === "done" ? "grid" : null)}>{body}</button>;
    })}</div>
    {passed ? <>
      <DChoice arrow onClick={() => go("orders")}>Перейти к заказам</DChoice>
      {confirmRestart ? <div className="pc-confirm" role="group" aria-label="Пройти фотоконтроль ещё раз?">
        <p>В тренажёре повтор сбрасывает проверку: пока фото не отправлены заново, выйти на линию нельзя. В приложении пройти проверку заранее можно без потери доступа.</p>
        <DChoice className="du-danger" disabled={busy || orderActive} onClick={() => { setConfirmRestart(false); act("photo_restart"); }}>Сбросить и снять заново</DChoice>
        <DChoice onClick={() => setConfirmRestart(false)}>Отмена</DChoice>
      </div> : <DChoice disabled={busy || orderActive} onClick={() => setConfirmRestart(true)}>Пройти фотоконтроль ещё раз</DChoice>}
      {orderActive && <p className="pc-note">Во время заказа проверку не перезапустить — сначала завершите поездку.</p>}
    </> : <div className="dp-bottom pc-actions">
      <DChoice onClick={() => go("photo")}>Назад</DChoice>
      <DAction label="Отправить" busy={busy && count >= COUNT} blocked={count < COUNT} progress={count / COUNT}
        onClick={() => { remember(); setError(null); setStage("summary"); }}
        reason={`Осталось снять ${COUNT - count} из ${COUNT}`} readyNote="Перед отправкой можно переснять любой кадр." />
    </div>}
    <DInfo title="Как снять, чтобы проверка прошла">
      <ul className="pc-tip-list">{TIPS.map(x => <li key={x.icon}><span aria-hidden="true"><Glyph name={x.icon} /></span><div><b>{x.title}</b><p>{x.text}</p></div></li>)}</ul>
    </DInfo>
    {explain}
  </>;

  // ── камера и отправка ─────────────────────────────────────────────────
  const review = shot ? PHOTO_STEPS[shot.step] : undefined;
  const verdict: Record<Quality, string | null> = {
    ok: null,
    blur: "Фото смазано: объект не встал в рамку. Такое фото не примут.",
    glare: "Блик от вспышки закрыл данные. Выключите вспышку и переснимите.",
    dark: "Темно: салон почти не виден. Включите вспышку и переснимите.",
  };
  const problem = shot ? verdict[shot.quality] : null;
  const darkNow = !!step?.dark && !flash && !cameraMode;
  const cue = cameraMode && !live ? "Включаем камеру…" : !locked ? `Совместите ${step?.subject ?? "объект"} с рамкой` : live ? "Держите телефон ровно — снимайте"
    : step?.doc && flash ? "Выключите вспышку — будет блик" : darkNow ? "Темно — включите вспышку" : "Кадр ровный — снимайте";
  const cueTone = !locked ? "aim" : (step?.doc && flash && !cameraMode) || darkNow ? "warn" : "ok";
  const coach = operatorNote(stage, step ?? review, retake !== null, count);
  // На компьютере приложение работает в телефоне, и подсказка встаёт рядом с ним.
  usePhoneCoach(open ? coach : null);

  const overlay = open && <div className="pc-overlay" ref={dialog} role="dialog" aria-modal="true" aria-label={`${PHOTO_CHECK}: камера приложения`} tabIndex={-1} data-stage={stage}>
    <div className="pc-device">
      {stage === "tips" && <div className="pc-panel pc-tips">
        <button type="button" className="pc-icon-btn pc-close" aria-label="Закрыть" onClick={close}>×</button>
        <div className="pc-tips-art" aria-hidden="true"><PhotoThumb kind="front" data={art} wide className="pc-tips-scene" /><svg className="pc-tips-guide" viewBox="0 142 300 225" preserveAspectRatio="xMidYMid slice"><PhotoGuide kind="front" /></svg><span className="pc-tips-scan" /></div>
        <h2>{PHOTO_CHECK}</h2>
        <p className="pc-lead">{COUNT} фото: машина с четырёх сторон, салон, багажник и обе стороны техпаспорта. Готовые кадры сохраняются — можно прерваться.</p>
        <ul className="pc-tip-list pc-tip-list--big">{TIPS.map((x, i) => <li key={x.icon} style={{ "--i": i } as CSSProperties}><span aria-hidden="true"><Glyph name={x.icon} /></span><div><b>{x.title}</b><p>{x.text}</p></div></li>)}</ul>
        <div className="pc-panel-foot"><button type="button" className="pc-primary" data-autofocus onClick={() => { setAim(a => a + 1); setStage("camera"); }}>Открыть камеру</button></div>
      </div>}

      {stage === "camera" && step && <div className="pc-camera" data-locked={locked} data-shot={!!shot} data-dark={darkNow} data-cue={cueTone}>
        <header className="pc-top">
          <button type="button" className="pc-icon-btn" aria-label={retake === "summary" ? "Назад к отправке" : "Закрыть камеру"} disabled={saving !== null} onClick={cancel}>×</button>
          <div className="pc-top-title"><strong>{step.title}</strong><span>{retake ? "Пересъёмка кадра" : `Фото ${count + 1} из ${COUNT}`}</span></div>
          <button type="button" className="pc-icon-btn" aria-pressed={flash} aria-label="Вспышка" disabled={!!shot || cameraMode} onClick={() => setFlash(!flash)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 3-7 10h5l-1 8 7-10h-5z" />{!flash && <path d="M4 4l16 16" />}</svg>
          </button>
        </header>
        <div className="pc-steps" aria-hidden="true">{PHOTO_STEPS.map((x, i) => <i key={x.kind} data-done={taken.has(i)} data-now={i === current} />)}</div>
        <div className="pc-stagebox">
          <div className="pc-finder">
            {device !== "off" && <video className="pc-video" ref={attachVideo} playsInline muted autoPlay aria-hidden="true" onPlaying={() => setStreaming(true)} onEmptied={() => setStreaming(false)} />}
            {shot ? <div className="pc-photo" data-quality={shot.quality} data-flash={flash && !shot.image}>{shot.image ? <img src={shot.image} alt={`Снимок: ${PHOTO_STEPS[shot.step].title}`} /> : <PhotoThumb kind={PHOTO_STEPS[shot.step].kind} data={art} className="pc-photo-img" />}{shot.quality === "glare" && <span className="pc-glare" aria-hidden="true" />}</div>
              : <svg className="pc-view" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                {!cameraMode && <g className="pc-scene" key={`${aim}-${current}`}><PhotoScene kind={step.kind} data={art} /></g>}
                <g className="pc-guide"><PhotoGuide kind={step.kind} /></g>
              </svg>}
            {!shot && <span className="pc-corners" aria-hidden="true"><i /><i /><i /><i /></span>}
            {!shot && <p className="pc-status" aria-live="polite">{cue}</p>}
            <span className="pc-flash" key={flashKey} data-on={flashKey > 0} data-strong={flash && !live} aria-hidden="true" />
            {saving !== null && <span className="pc-saving" role="status"><i aria-hidden="true" />Сохраняем фото…</span>}
          </div>
        </div>
        {!shot ? <footer className="pc-bottom">
          <p className="pc-hint" key={current}>{step.hint}</p>
          {deviceNote && <p className="pc-device-note" role="status">{deviceNote}</p>}
          <div className="pc-controls">
            <button type="button" className="pc-side-btn" ref={exampleButton} onClick={() => setExample(true)}><span className="pc-side-thumb" aria-hidden="true"><PhotoThumb kind={step.kind} data={art} /></span>Пример</button>
            <button type="button" className="pc-shutter" ref={shutter} aria-label={`Сделать фото: ${step.title}`} disabled={cameraMode && !live} onClick={shoot}><span /></button>
            {canUseCamera() ? <button type="button" className="pc-side-btn" aria-pressed={device !== "off"} aria-label="Своя камера" onClick={() => { setDeviceNote(null); setDevice(device === "off" ? "starting" : "off"); }}>
              <span className="pc-side-icon" aria-hidden="true"><Glyph name="cam" /></span>{device === "starting" ? "Включаем…" : "Своя камера"}
            </button> : <span className="pc-side-btn" aria-hidden="true" />}
          </div>
        </footer> : <footer className="pc-bottom pc-bottom--review">
          <h3>{problem ? "Переснимите кадр" : "Всё хорошо видно?"}</h3>
          {problem ? <p className="pc-verdict" role="alert">{problem}</p>
            : <ul className="pc-checks">{review!.checks.map((x, i) => <li key={x} style={{ "--i": i } as CSSProperties}>{x}</li>)}</ul>}
          {error && <p className="pc-verdict" role="alert">{error}</p>}
          <div className="pc-review-actions">
            <button type="button" className={problem ? "pc-primary" : "pc-secondary"} data-autofocus={problem ? true : undefined} disabled={saving !== null} onClick={again}>Переснять</button>
            {!problem && <button type="button" className="pc-primary" data-autofocus disabled={saving !== null} onClick={accept}>{saving !== null ? "Сохраняем…" : retake ? "Заменить фото" : missing.length <= 1 ? "Подходит · готово" : "Подходит · дальше"}</button>}
          </div>
        </footer>}
        {example && <div className="pc-example" role="dialog" aria-modal="true" aria-label={`Пример: ${step.title}`}>
          <div className="pc-example-card">
            <PhotoThumb kind={step.kind} data={art} wide className="pc-example-img" />
            <h3>Так должен выглядеть кадр</h3>
            <ul className="pc-checks">{step.checks.map(x => <li key={x}>{x}</li>)}</ul>
            <p className="pc-example-miss"><b>Частая ошибка:</b> {step.mistake}</p>
            <button type="button" className="pc-primary" data-autofocus onClick={() => setExample(false)}>Понятно</button>
          </div>
        </div>}
      </div>}

      {stage === "summary" && <div className="pc-panel pc-summary">
        <h2>Отправляем?</h2>
        <p className="pc-lead">Изображение должно соответствовать подписи. Чтобы переснять, нажмите на фото.</p>
        <div className="pc-grid">{PHOTO_STEPS.map((x, i) => <button key={x.kind} type="button" className="pc-grid-item" style={{ "--i": i } as CSSProperties} aria-label={`${x.title}: переснять`} onClick={() => openCamera(i, "summary")}>
          {photo(i, "pc-grid-img")}<span>{x.title}</span><em aria-hidden="true">↻</em>
        </button>)}</div>
        {error && <p className="pc-verdict" role="alert">{error}</p>}
        <div className="pc-panel-foot pc-panel-foot--row">
          <button type="button" className="pc-secondary" onClick={close}>Назад</button>
          <button type="button" className="pc-primary" data-autofocus onClick={send}>Отправить</button>
        </div>
      </div>}

      {(stage === "sending" || stage === "checking") && <div className="pc-panel pc-progress">
        {stage === "checking" && <span className="pc-toast" role="status">✓ Данные отправились</span>}
        <div className="pc-stack" aria-hidden="true">{PHOTO_STEPS.map((x, i) => <span key={x.kind} className="pc-stack-item" data-sent={stage === "checking" || i < uploaded}>{photo(i, "pc-stack-img", false)}</span>)}
          {stage === "checking" && <span className="pc-scanline" />}
        </div>
        <h2>{stage === "sending" ? "Отправляем фото" : "Смотрим ваши фото"}</h2>
        {stage === "sending" ? <>
          <div className="pc-upload" role="progressbar" aria-valuemin={0} aria-valuemax={COUNT} aria-valuenow={uploaded} aria-label="Загрузка фото"><i style={{ width: `${(uploaded / COUNT) * 100}%` }} /></div>
          <p className="pc-lead">Загружено {uploaded} из {COUNT}</p>
        </> : <ul className="pc-review">{REVIEW.map((x, i) => <li key={x} data-state={i < reviewed ? "done" : i === reviewed ? "now" : "wait"}><i aria-hidden="true" />{x}<span className="sr-only">{i < reviewed ? " — проверено" : i === reviewed ? " — проверяем" : ""}</span></li>)}</ul>}
        <p className="sr-only" role="status">{stage === "sending" ? "Отправляем фото" : reviewed >= REVIEW.length ? "Проверка закончена" : "Данные отправились. Смотрим ваши фото"}</p>
        <p className="pc-small">{stage === "sending" ? "Не закрывайте приложение, пока идёт загрузка." : "В приложении проверка занимает 5–15 минут. В тренажёре — пару секунд."}</p>
      </div>}

      {stage === "result" && <div className="pc-panel pc-result">
        <div className="dx-done pc-result-mark"><SuccessMark /><Confetti /></div>
        <h2>Фотоконтроль пройден</h2>
        <p className="pc-lead">Доступ к заказам открыт{car ? `: ${car.brand} ${car.model} · ${car.plate}` : ""}. Уведомление о результате пришло в Чаты → «Предупреждения».</p>
        <div className="pc-panel-foot">
          <button type="button" className="pc-primary" data-autofocus onClick={() => { close(); go("orders"); }}>Перейти к заказам</button>
          <button type="button" className="pc-secondary" onClick={close}>Готово</button>
        </div>
      </div>}
    </div>
    {coach && <aside className="pc-coach" aria-label="Подсказка оператору">
      <span className="pc-coach-tag">Подсказка оператору</span>
      <h3>{coach.title}</h3>
      {coach.body.map(([label, text]) => <div key={label}><b>{label}</b><p>{text}</p></div>)}
    </aside>}
  </div>;

  return <>{detail === "car" ? check : list}<span ref={anchor} hidden />{overlay && host ? createPortal(overlay, host) : null}</>;
}

/** Боковая подсказка на компьютере: что сейчас на экране водителя и что ему сказать. */
function operatorNote(stage: Stage | null, step: PhotoStep | undefined, retake: boolean, count: number): { title: string; body: [string, string][] } | null {
  if (stage === "tips") return { title: "Водитель открыл фотоконтроль", body: [
    ["Когда это бывает", "После смены машины или её данных в парке, по сроку — обычно раз в 10 дней, или по запросу службы качества. Пройти можно заранее."],
    ["Что на экране", "Советы перед съёмкой и кнопка «Открыть камеру». Дальше — камера с рамкой нужного ракурса, всего 9 фото."],
    ["Что сказать водителю", "Найдите светлое место, протрите номер, уберите вещи из салона и приготовьте оригинал техпаспорта."],
  ] };
  if (stage === "camera" && step) return { title: `${retake ? "Пересъёмка" : `Фото ${count + 1} из ${COUNT}`}: ${step.title}`, body: [
    ["Что проверяют", step.checks.join(". ") + "."],
    ["Частая причина отказа", step.mistake],
    ["Что сказать водителю", step.tell],
  ] };
  if (stage === "summary") return { title: "Экран «Отправляем?»", body: [
    ["Что на экране", "Все фото с подписями. Нажатие на фото открывает пересъёмку этого кадра."],
    ["Что сказать водителю", "Проверьте, что на каждом фото то, что написано под ним, и номер читается. Затем «Отправить»."],
  ] };
  if (stage === "sending" || stage === "checking") return { title: "«Смотрим ваши фото»", body: [
    ["Сколько ждать", "Обычно 5–15 минут. Проверяет автоматика, в спорных случаях — сотрудник."],
    ["Где результат", "Придёт в чат «Предупреждения». Если не прошёл — будет указано, какие фото переснять."],
    ["Что сказать водителю", "Дождитесь уведомления. Если доступ был закрыт, он откроется сразу после успешной проверки."],
  ] };
  if (stage === "result") return { title: "Проверка пройдена", body: [
    ["Что изменилось", "Ограничение снято: тарифы доступны, можно выходить на линию."],
    ["Что сказать водителю", "Можно работать. Если заказов всё ещё нет — проверьте Диагностику и включённые тарифы."],
  ] };
  return null;
}
