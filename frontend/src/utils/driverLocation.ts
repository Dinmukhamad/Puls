export interface GeoPoint { latitude: number; longitude: number }
export interface LocationFix extends GeoPoint { accuracy: number; captured_at: string }
export const PICKUP_RADIUS = 500, MAX_ACCURACY = 200, MAX_FIX_AGE = 30000;
export const pointOf = ({ latitude, longitude }: GeoPoint): GeoPoint => ({ latitude, longitude });
export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const rad = Math.PI / 180, lat = (b.latitude - a.latitude) * rad, lng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function freshFix(value: (GeoPoint & { accuracy: number; captured_at?: string }) | null | undefined, now = Date.now()): value is LocationFix {
  if (!value?.captured_at) return false;
  const age = now - Date.parse(value.captured_at);
  return Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= MAX_ACCURACY && age >= -5000 && age <= MAX_FIX_AGE;
}
export function pickupAllowed(fix: LocationFix | null | undefined, pickup: GeoPoint | null, now = Date.now()) {
  return !!pickup && freshFix(fix, now) && distanceMeters(fix, pickup) + fix.accuracy <= PICKUP_RADIUS;
}
export interface LocationState { fix: LocationFix | null; status: "requesting" | "ready" | "denied" | "unavailable" | "paused"; message: string }
interface LocationEnvironment {
  navigator: Pick<Navigator, "geolocation" | "permissions">; document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  now: () => number; interval: (callback: () => void, ms: number) => number; clear: (id: number) => void;
}

// Каждый ответ принадлежит своему запросу и видимой сессии экрана. Поздние ответы
// после ухода/отказа не могут восстановить разрешение или старые координаты.
export function trackDriverLocation(emit: (state: LocationState) => void, env: LocationEnvironment) {
  if (typeof env.navigator.geolocation?.watchPosition === "function") return watchDriverLocation(emit, env);
  let stopped = false, denied = false, pending = false, generation = 0;
  let fix: LocationFix | null = null, permission: PermissionStatus | undefined;
  const publish = (status: LocationState["status"], message: string) => emit({ fix, status, message });
  const read = () => {
    if (stopped || env.document.visibilityState !== "visible") return;
    if (fix && !freshFix(fix, env.now())) { fix = null; publish("unavailable", "Геопозиция устарела. Определяем её заново…"); }
    if (denied || pending) return;
    if (!env.navigator.geolocation) { fix = null; publish("unavailable", "Геолокация недоступна. Откройте Puls в браузере с доступом к местоположению."); return; }
    pending = true;
    const request = ++generation;
    if (!fix) publish("requesting", "Разрешите доступ к местоположению. Определяем вашу точку…");
    env.navigator.geolocation.getCurrentPosition(value => {
      if (stopped || request !== generation || env.document.visibilityState !== "visible") return;
      pending = false;
      const next = { latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy, captured_at: Number.isFinite(value.timestamp) ? new Date(value.timestamp).toISOString() : "" };
      const accuracy = next.accuracy;
      if (!freshFix(next, env.now())) { fix = null; publish("unavailable", accuracy > MAX_ACCURACY ? `Точность ±${Math.round(accuracy)} м. Включите точное местоположение — нужно не хуже ±${MAX_ACCURACY} м.` : "Браузер вернул устаревшую геопозицию. Обновите местоположение."); return; }
      fix = next; publish("ready", "Местоположение обновляется каждые 10 секунд");
    }, error => {
      if (stopped || request !== generation || env.document.visibilityState !== "visible") return;
      pending = false; fix = null; denied = error.code === 1;
      publish(denied ? "denied" : "unavailable", denied ? "Разрешите местоположение в настройках этого сайта и нажмите «Обновить геопозицию»." : "Не удалось определить местоположение. Проверьте геолокацию устройства и повторите.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  };
  const retry = () => { if (stopped) return; denied = false; read(); };
  const visibility = () => {
    if (env.document.visibilityState !== "visible") { generation++; pending = false; fix = null; publish("paused", "Геолокация приостановлена"); }
    else read();
  };
  const permissionChanged = () => {
    if (permission?.state === "denied") { generation++; pending = false; denied = true; fix = null; publish("denied", "Доступ к местоположению отключён в настройках сайта."); }
    else { denied = false; read(); }
  };
  env.document.addEventListener("visibilitychange", visibility);
  void env.navigator.permissions?.query({ name: "geolocation" }).then(value => {
    if (stopped) return; permission = value; value.addEventListener("change", permissionChanged);
    if (value.state === "denied") permissionChanged();
  }).catch(() => {});
  read(); const timer = env.interval(read, 10000);
  return { retry, stop: () => { stopped = true; generation++; env.clear(timer); env.document.removeEventListener("visibilitychange", visibility); permission?.removeEventListener("change", permissionChanged); } };
}

// Датчик может присылать позиции чаще; наружу выходит только последний отсчёт
// раз в 10 секунд. Буфера пути нет. Первый точный отсчёт показываем сразу.
function watchDriverLocation(emit: (state: LocationState) => void, env: LocationEnvironment) {
  let stopped = false, denied = false, watch: number | undefined, generation = 0;
  let refreshPending = false, refresh: (() => void) | undefined;
  let latest: LocationFix | null = null, published: LocationFix | null = null, permission: PermissionStatus | undefined;
  const publish = (status: LocationState["status"], message: string) => emit({ fix: published, status, message });
  const clear = () => { generation++; if (watch !== undefined) env.navigator.geolocation.clearWatch(watch); watch = undefined; latest = null; published = null; refresh = undefined; refreshPending = false; };
  const flush = () => {
    if (stopped || env.document.visibilityState !== "visible" || denied) return;
    if (latest && freshFix(latest, env.now())) { published = latest; publish("ready", "Местоположение обновляется каждые 10 секунд"); }
    else if (published) { published = null; publish("unavailable", "Нет свежего сигнала GPS. Определяем местоположение…"); }
  };
  const start = () => {
    if (stopped || denied || watch !== undefined || env.document.visibilityState !== "visible") return;
    const token = ++generation;
    publish("requesting", "Разрешите доступ к местоположению. Определяем вашу точку…");
    const accept: PositionCallback = value => {
      if (stopped || token !== generation || env.document.visibilityState !== "visible") return;
      const next = { latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy, captured_at: Number.isFinite(value.timestamp) ? new Date(value.timestamp).toISOString() : "" };
      const accuracy = next.accuracy;
      if (!freshFix(next, env.now())) { latest = null; published = null; publish("unavailable", accuracy > MAX_ACCURACY ? `Точность ±${Math.round(accuracy)} м. Включите точное местоположение.` : "Браузер вернул устаревшую геопозицию."); return; }
      if (latest && Date.parse(next.captured_at) < Date.parse(latest.captured_at)) return;
      latest = next;
      if (!published) flush();
    };
    const reject: PositionErrorCallback = error => {
      if (stopped || token !== generation || env.document.visibilityState !== "visible") return;
      latest = null; published = null;
      if (error.code === 1) { denied = true; clear(); }
      publish(denied ? "denied" : "unavailable", denied ? "Доступ к местоположению отключён. Разрешите его в настройках сайта." : "Нет сигнала GPS. Проверьте геолокацию устройства.");
    };
    watch = env.navigator.geolocation.watchPosition(accept, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    refresh = () => {
      // watchPosition может молчать у неподвижного устройства. Уточняем свежесть
      // отдельным запросом, сохраняя прежнее правило публикации раз в 10 секунд.
      if (refreshPending || typeof env.navigator.geolocation.getCurrentPosition !== "function" || (latest && env.now() - Date.parse(latest.captured_at) < 10000)) return;
      refreshPending = true;
      env.navigator.geolocation.getCurrentPosition(value => { if (token !== generation) return; refreshPending = false; accept(value); flush(); }, error => { if (token !== generation) return; refreshPending = false; reject(error); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
    };
  };
  const retry = () => { if (!stopped) { denied = false; clear(); start(); } };
  const visibility = () => { if (env.document.visibilityState === "visible") start(); else { clear(); publish("paused", "Геолокация приостановлена"); } };
  const permissionChanged = () => {
    if (permission?.state === "denied") { denied = true; clear(); publish("denied", "Доступ к местоположению отключён в настройках сайта."); }
    else { denied = false; start(); }
  };
  env.document.addEventListener("visibilitychange", visibility);
  void env.navigator.permissions?.query({ name: "geolocation" }).then(value => { if (stopped) return; permission = value; value.addEventListener("change", permissionChanged); if (value.state === "denied") permissionChanged(); }).catch(() => {});
  start(); const timer = env.interval(() => { flush(); if (!stopped && !denied && env.document.visibilityState === "visible") refresh?.(); }, 10000);
  return { retry, stop: () => { stopped = true; clear(); env.clear(timer); env.document.removeEventListener("visibilitychange", visibility); permission?.removeEventListener("change", permissionChanged); } };
}
