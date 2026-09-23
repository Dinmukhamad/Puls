import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { dateTime } from "../utils/format";
import { CURRENT_RELEASE, type Release } from "./release";
import { INITIAL_UPDATE, UpdateManager, updateBlockReason, type UpdateState } from "./updates";

import { Sheet } from "../components/Sheet";
import { Button, Card } from "../components/ui";
import "./pwa.css";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  update: UpdateState;
  checkUpdate: () => void;
  applyUpdate: () => void;
  installed: boolean;
  canInstall: boolean;
  installing: boolean;
  install: () => Promise<void>;
  installError: string | null;
}

const PwaContext = createContext<PwaState | null>(null);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function PwaProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { loading } = useAuth();
  const authLoading = useRef(loading); authLoading.current = loading;
  const updater = useRef<UpdateManager | null>(null);
  const [update, setUpdate] = useState(INITIAL_UPDATE);
  const [installed, setInstalled] = useState(standalone);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [iosInstructions, setIosInstructions] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onDisplayMode = () => setInstalled(standalone());
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); setIosInstructions(false); };
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayMode);
    };
  }, []);

  useEffect(() => {
    // Вернулась сеть - молча перезапрашиваем открытые данные, без сообщения.
    // Повторяются только чтения: покупки, награды и прочие записи не копятся.
    const onOnline = () => { void queryClient.invalidateQueries({ refetchType: "active" }); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [queryClient]);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let runtime: Promise<typeof import("./browser-updates")> | null = null;
    const load = () => runtime ??= import("./browser-updates").catch(() => { runtime = null; throw new Error("Не удалось загрузить проверку обновлений. Попробуйте ещё раз."); });
    let workerRuntime: ReturnType<typeof import("./browser-updates")["browserUpdates"]> | null = null;
    const worker = async () => workerRuntime ??= (await load()).browserUpdates(CURRENT_RELEASE);
    const workers = {
      report: () => { void worker().then((runtime) => runtime.report()).catch(() => undefined); },
      prepare: async (release: Release) => (await worker()).prepare(release),
      activate: async (release: Release) => (await worker()).activate(release),
    };
    const edited = new Set<Element>();
    let activity = 0;
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const storage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
    const session = { getItem: (key: string) => sessionStorage.getItem(key), setItem: (key: string, value: string) => sessionStorage.setItem(key, value) };
    const manager = new UpdateManager(CURRENT_RELEASE, {
      latest: async () => (await load()).latestRelease(), prepare: workers.prepare, activate: workers.activate,
      confirmPage: async (release) => (await load()).confirmReleasePage(release), reload: () => window.location.reload(),
      blocked: () => updateBlockReason(document, window.location.pathname, authLoading.current || queryClient.isMutating() > 0, edited),
      visible: () => document.visibilityState === "visible" && navigator.onLine,
      lastActivity: () => activity, storage, session,
    }, setUpdate);
    updater.current = manager;
    const interact = () => { activity++; };
    const edit = (event: Event) => {
      interact();
      const target = event.target;
      if (target instanceof Element && target.matches('input,textarea,select,[contenteditable="true"]')) {
        edited.add(target.closest('form,[role="dialog"],[data-update-guard]') ?? target);
      }
    };
    const check = (auto = false) => {
      workers.report();
      if (document.visibilityState === "visible" && navigator.onLine) void manager.check(auto);
    };
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else { const returned = hiddenAt !== null && Date.now() - hiddenAt >= 30000; hiddenAt = null; check(returned); }
    };
    const onOnline = () => check(false);
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) check(true); };
    for (const event of ["pointerdown", "keydown", "touchstart", "wheel"]) document.addEventListener(event, interact, { passive: true, capture: true });
    document.addEventListener("input", edit, true); document.addEventListener("change", edit, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline); window.addEventListener("pageshow", onPageShow);
    navigator.serviceWorker?.addEventListener("controllerchange", workers.report);
    const startup = window.setTimeout(() => check(true), 1500);
    const interval = window.setInterval(() => check(false), 5 * 60 * 1000);
    return () => {
      manager.stop(); if (updater.current === manager) updater.current = null;
      window.clearTimeout(startup); window.clearInterval(interval);
      for (const event of ["pointerdown", "keydown", "touchstart", "wheel"]) document.removeEventListener(event, interact, true);
      document.removeEventListener("input", edit, true); document.removeEventListener("change", edit, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline); window.removeEventListener("pageshow", onPageShow);
      navigator.serviceWorker?.removeEventListener("controllerchange", workers.report);
    };
  }, [queryClient]);

  const install = useCallback(async () => {
    setInstallError(null);
    if (installed) return;
    if (!installPrompt) {
      if (isIOS()) setIosInstructions(true);
      return;
    }
    setInstalling(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      // Only appinstalled/display-mode confirms that installation succeeded.
    } catch {
      setInstallError("Не удалось открыть установку. Попробуйте ещё раз через меню браузера.");
    } finally {
      setInstallPrompt(null);
      setInstalling(false);
    }
  }, [installed, installPrompt]);

  return (
    <PwaContext.Provider value={{ installed, canInstall: !installed && Boolean(installPrompt || isIOS()), installing, install, installError,
      update, checkUpdate: () => { void updater.current?.check(); }, applyUpdate: () => { void updater.current?.apply(); } }}>
      {children}
      {/* Установка открывается только по действию пользователя - это не всплывающее уведомление. */}
      {iosInstructions && (
        <Sheet title="Установить Puls" onClose={() => setIosInstructions(false)} size="s" footer={<Button onClick={() => setIosInstructions(false)}>Понятно</Button>}>
          <ol className="pwa-install-steps">
            <li>Нажмите «Поделиться» в меню браузера.</li>
            <li>Выберите «На экран Домой».</li>
            <li>Нажмите «Добавить».</li>
          </ol>
          <p className="secondary small">После этого открывайте Puls с экрана Домой.</p>
        </Sheet>
      )}
    </PwaContext.Provider>
  );
}

export function PwaInstallCard() {
  const pwa = useContext(PwaContext);
  const { user } = useAuth();
  if (!pwa) return null;
  return (
    <Card id="app-updates" title="Приложение Puls" action={<img src="/icons/puls-app-192-v2.png" width={48} height={48} alt="" />}>
      {/* Состав выпуска — рабочий инструмент администратора. Остальным приложение
          обновляется само при следующем заходе, просить их об этом незачем. */}
      {user?.role === "admin" && <PwaReleaseDetails pwa={pwa} />}
      {pwa.installed ? <p className="secondary">Puls установлен на этом устройстве.</p> : pwa.canInstall ? (
        <><p className="secondary small">Открывайте Puls с экрана Домой в отдельном окне.</p><Button block onClick={() => void pwa.install()} disabled={pwa.installing} className="pwa-install-button">{pwa.installing ? "Открываем установку…" : "Установить Puls"}</Button></>
      ) : <p className="secondary small">Если браузер поддерживает установку, она будет доступна в его меню.</p>}
      {pwa.installError && <p className="pwa-error" role="alert">{pwa.installError}</p>}
    </Card>
  );
}

function PwaReleaseDetails({ pwa }: { pwa: PwaState }) {
  return (
    <div className="pwa-update">
      <div className="pwa-version"><strong>Версия {CURRENT_RELEASE.version}</strong>{CURRENT_RELEASE.builtAt && <span>Выпущена {dateTime(CURRENT_RELEASE.builtAt)}</span>}</div>
      {pwa.update.installedAt && <p className="secondary small">На этом устройстве с {dateTime(pwa.update.installedAt)}</p>}
      <p className="pwa-update-status" role="status">{pwa.update.applying ? "Применяем обновление…" : pwa.update.checking ? "Проверяем и загружаем обновление…" : pwa.update.available ? "Доступно обновление Puls" : pwa.update.checkedAt && !pwa.update.error ? "Установлена актуальная версия" : "Обновления проверяются автоматически"}</p>
      {pwa.update.available && <><p className="secondary small">Обновление от {dateTime(pwa.update.available.builtAt)} · версия {pwa.update.available.version}</p><p className="secondary small">{pwa.update.blocked || "Применится при следующем открытии в подходящий момент. Можно обновить сейчас."}</p></>}
      <div className="pwa-update-actions">
        {pwa.update.available && <Button variant="primary" onClick={pwa.applyUpdate} disabled={pwa.update.applying || pwa.update.checking}>Обновить приложение</Button>}
        <Button onClick={pwa.checkUpdate} disabled={pwa.update.checking || pwa.update.applying || !import.meta.env.PROD}>Проверить обновления</Button>
      </div>
      {pwa.update.error && <p className="pwa-error" role="alert">{pwa.update.error}</p>}
      {pwa.update.checkedAt && <p className="secondary small">Последняя проверка: {dateTime(pwa.update.checkedAt)}</p>}
      <details className="pwa-release-notes">
        <summary>Что нового в версии {(pwa.update.available ?? CURRENT_RELEASE).version}</summary>
        <ul>{(pwa.update.available ?? CURRENT_RELEASE).changes.map((line, index) => <li key={index}>{line}</li>)}</ul>
      </details>
    </div>
  );
}
