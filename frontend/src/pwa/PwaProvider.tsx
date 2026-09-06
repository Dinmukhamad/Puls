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
  const registration = useRef<ServiceWorkerRegistration | null>(null);

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
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let cleanupRegistration: (() => void) | undefined;

    /*
     * Новая версия применяется молча и без перезагрузки страницы.
     *
     * Текущая вкладка продолжает работать на своих файлах: служебный воркер
     * держит прежний кеш, пока вкладка открыта, и отдаёт из него запрошенные
     * чанки. Обновление вступает в силу при следующем открытии страницы,
     * поэтому спрашивать разрешение и прерывать работу не нужно.
     */
    const activateSilently = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        reg.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
      }
    };

    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      if (cancelled) return;
      registration.current = reg;

      const workers = new Set<ServiceWorker>();
      const onStateChange = () => activateSilently(reg);
      const watchInstalling = () => {
        const worker = reg.installing;
        if (!worker) return;
        workers.add(worker);
        worker.addEventListener("statechange", onStateChange);
      };

      activateSilently(reg);
      watchInstalling();
      reg.addEventListener("updatefound", watchInstalling);

      const checkUpdate = () => {
        if (document.visibilityState === "visible" && navigator.onLine) void reg.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", checkUpdate);

      cleanupRegistration = () => {
        reg.removeEventListener("updatefound", watchInstalling);
        workers.forEach((worker) => worker.removeEventListener("statechange", onStateChange));
        document.removeEventListener("visibilitychange", checkUpdate);
      };
    }).catch((error: unknown) => {
      // PWA support is optional; normal web navigation must keep working.
      console.error("Puls service worker registration failed", error);
    });

    return () => {
      cancelled = true;
      cleanupRegistration?.();
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

  return (
    <PwaContext.Provider value={{ installed, canInstall: !installed && Boolean(installPrompt || isIOS()), installing, install, installError }}>
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
