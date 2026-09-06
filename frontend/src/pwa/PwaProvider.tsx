import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Sheet } from "../components/Sheet";
import { Button, Card } from "../components/ui";
import "./pwa.css";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
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
  const [installed, setInstalled] = useState(standalone);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [iosInstructions, setIosInstructions] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [reconnected, setReconnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateDialog, setUpdateDialog] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const reloadRequested = useRef(false);
  const reloadTimer = useRef<number | undefined>();

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
    const onOffline = () => { setOnline(false); setReconnected(false); };
    const onOnline = () => {
      setOnline(true);
      setReconnected(true);
      setConnectionError(null);
      // Only reads are retried. Purchases, rewards and other writes are not queued.
      void queryClient.invalidateQueries({ refetchType: "active" });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let cleanupRegistration: (() => void) | undefined;
    let alreadyControlled = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      window.clearTimeout(reloadTimer.current);
      if (reloadRequested.current) {
        window.location.reload();
      } else if (alreadyControlled) {
        // Another tab accepted an update. This tab keeps its forms and waits.
        setUpdateAvailable(true);
        setUpdateDismissed(false);
      }
      alreadyControlled = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      if (cancelled) return;
      registration.current = reg;
      const offerUpdate = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
          setUpdateDismissed(false);
        }
      };
      const workers = new Set<ServiceWorker>();
      const watchInstalling = () => {
        const worker = reg.installing;
        if (!worker) return;
        workers.add(worker);
        worker.addEventListener("statechange", offerUpdate);
      };
      offerUpdate();
      watchInstalling();
      reg.addEventListener("updatefound", watchInstalling);
      const checkUpdate = () => {
        if (document.visibilityState === "visible" && navigator.onLine) void reg.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", checkUpdate);
      cleanupRegistration = () => {
        reg.removeEventListener("updatefound", watchInstalling);
        workers.forEach((worker) => worker.removeEventListener("statechange", offerUpdate));
        document.removeEventListener("visibilitychange", checkUpdate);
      };
    }).catch((error: unknown) => {
      // PWA support is optional; normal web navigation must keep working.
      console.error("Puls service worker registration failed", error);
    });
    return () => {
      cancelled = true;
      cleanupRegistration?.();
      window.clearTimeout(reloadTimer.current);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

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

  async function reconnect() {
    setReconnecting(true);
    setConnectionError(null);
    setOnline(navigator.onLine);
    if (!navigator.onLine) {
      setReconnecting(false);
      setConnectionError("Сеть пока недоступна. Проверьте подключение и повторите.");
      return;
    }
    try {
      await queryClient.refetchQueries({ type: "active" }, { throwOnError: true });
      setReconnected(true);
    } catch {
      setConnectionError("Не удалось загрузить данные. Попробуйте ещё раз.");
    } finally {
      setReconnecting(false);
    }
  }

  function applyUpdate() {
    setUpdateError(null);
    const worker = registration.current?.waiting;
    if (!worker) {
      window.location.reload();
      return;
    }
    setUpdating(true);
    reloadRequested.current = true;
    worker.postMessage({ type: "ACTIVATE_UPDATE" });
    reloadTimer.current = window.setTimeout(() => {
      reloadRequested.current = false;
      setUpdating(false);
      setUpdateError("Обновление не завершилось. Попробуйте ещё раз.");
    }, 15000);
  }

  return (
    <PwaContext.Provider value={{ installed, canInstall: !installed && Boolean(installPrompt || isIOS()), installing, install, installError }}>
      {children}
      {(!online || reconnected || connectionError || (updateAvailable && !updateDismissed)) && (
        <aside className="pwa-status" aria-label="Состояние приложения">
          {(!online || reconnected || connectionError) && (
            <div className="pwa-status__card" role="status">
              <div>
                <strong>{online ? "Сеть доступна" : "Нет соединения"}</strong>
                <p>{connectionError || (online ? "Можно продолжить работу и обновить данные." : "Данные могут быть устаревшими. Подключитесь к сети, чтобы сохранить изменения.")}</p>
              </div>
              <div className="row">
                <Button size="s" disabled={reconnecting} onClick={() => void reconnect()}>{reconnecting ? "Проверяем…" : "Повторить"}</Button>
                {online && <Button size="s" onClick={() => { setReconnected(false); setConnectionError(null); }}>Закрыть</Button>}
              </div>
            </div>
          )}
          {updateAvailable && !updateDismissed && (
            <div className="pwa-status__card" role="status">
              <div><strong>Доступна новая версия Puls</strong><p>Установите обновление, когда завершите текущую работу.</p></div>
              <div className="row">
                <Button size="s" onClick={() => setUpdateDialog(true)}>Обновить</Button>
                <Button size="s" onClick={() => setUpdateDismissed(true)}>Позже</Button>
              </div>
            </div>
          )}
        </aside>
      )}
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
      {updateDialog && (
        <Sheet title="Обновить Puls?" onClose={() => { if (!updating) setUpdateDialog(false); }} size="s" footer={<>
          <Button disabled={updating} onClick={() => setUpdateDialog(false)}>Позже</Button>
          <Button variant="primary" disabled={updating} onClick={applyUpdate}>{updating ? "Обновляем…" : "Обновить сейчас"}</Button>
        </>}>
          <p>Страница перезагрузится. Сначала сохраните введённые данные или завершите текущее действие.</p>
          {updateError && <p className="pwa-error" role="alert">{updateError}</p>}
        </Sheet>
      )}
    </PwaContext.Provider>
  );
}

export function PwaInstallCard() {
  const pwa = useContext(PwaContext);
  if (!pwa) return null;
  return (
    <Card title="Приложение Puls">
      {pwa.installed ? <p className="secondary">Puls установлен на этом устройстве.</p> : pwa.canInstall ? (
        <><p className="secondary small">Открывайте Puls с экрана Домой в отдельном окне.</p><Button block onClick={() => void pwa.install()} disabled={pwa.installing} className="pwa-install-button">{pwa.installing ? "Открываем установку…" : "Установить Puls"}</Button></>
      ) : <p className="secondary small">Если браузер поддерживает установку, она будет доступна в его меню.</p>}
      {pwa.installError && <p className="pwa-error" role="alert">{pwa.installError}</p>}
    </Card>
  );
}
