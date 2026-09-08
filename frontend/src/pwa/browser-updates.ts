import { type Release, readRelease } from "./release";

async function fetchFresh(path: string): Promise<{ body: string; contentType: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { cache: "no-store", credentials: "omit", signal: controller.signal });
    if (!response.ok) throw new Error("Сервер обновлений недоступен. Повторите проверку позже.");
    return { body: await response.text(), contentType: response.headers.get("content-type") ?? "" };
  } catch {
    throw new Error("Не удалось связаться с сервером обновлений. Проверьте подключение и повторите.");
  } finally { window.clearTimeout(timer); }
}

export async function latestRelease(): Promise<Release> {
  const response = await fetchFresh("/version.json");
  if (!response.contentType.includes("application/json")) throw new Error("Сведения о версии пока недоступны. Повторите проверку позже.");
  let value: unknown;
  try { value = JSON.parse(response.body); } catch { throw new Error("Сведения о версии пока недоступны. Повторите проверку позже."); }
  return readRelease(value);
}

export async function confirmReleasePage(release: Release): Promise<void> {
  const response = await fetchFresh(window.location.href);
  const page = new DOMParser().parseFromString(response.body, "text/html");
  if (page.querySelector('meta[name="puls-build"]')?.getAttribute("content") !== release.buildId) {
    throw new Error("Новая версия ещё публикуется. Попробуйте обновить приложение чуть позже.");
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
function workerRelease(worker: ServiceWorker): Promise<Release | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (release: Release | null) => { window.clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(release); };
    const timer = window.setTimeout(() => finish(null), 750);
    channel.port1.onmessage = (event) => { try { finish(readRelease(event.data)); } catch { finish(null); } };
    try { worker.postMessage({ type: "GET_RELEASE" }, [channel.port2]); } catch { finish(null); }
  });
}

/** Версия worker должна совпасть с загруженными сведениями о выпуске. */
export function browserUpdates(current: Release) {
  let registration: Promise<ServiceWorkerRegistration> | null = null;
  const supported = "serviceWorker" in navigator;
  const register = () => registration ??= navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => { registration = null; throw error; });
  const report = () => { navigator.serviceWorker?.controller?.postMessage({ type: "CLIENT_READY", buildId: current.buildId }); };
  async function matching(reg: ServiceWorkerRegistration, buildId: string) {
    for (const worker of [reg.waiting, reg.active]) {
      if (worker && (await workerRelease(worker))?.buildId === buildId) return worker;
    }
    return null;
  }
  return {
    report,
    async prepare(release: Release) {
      if (!supported) return;
      const reg = await register();
      if (await matching(reg, release.buildId)) return;
      await reg.update();
      const started = Date.now();
      while (Date.now() - started < 20000) {
        if (await matching(reg, release.buildId)) return;
        await delay(250);
      }
      throw new Error("Файлы обновления ещё не готовы. Повторите проверку через минуту.");
    },
    async activate(release: Release) {
      if (!supported) return;
      const reg = await register();
      const worker = await matching(reg, release.buildId);
      if (!worker) throw new Error("Файлы обновления изменились. Повторите проверку.");
      if (worker.state !== "activated") worker.postMessage({ type: "ACTIVATE_UPDATE" });
      const started = Date.now();
      while (Date.now() - started < 10000) {
        if (worker.state === "activated" && navigator.serviceWorker.controller === worker) { report(); return; }
        await delay(100);
      }
      throw new Error("Не удалось применить обновление. Попробуйте ещё раз.");
    },
  };
}
