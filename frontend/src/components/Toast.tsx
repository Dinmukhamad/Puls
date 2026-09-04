import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "good" | "critical" | "accent";

interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, string> = {
  good: "✓",
  critical: "!",
  accent: "i",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: ToastTone, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push("good", text),
      error: (text) => push("critical", text),
      info: (text) => push("accent", text),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            {/* Значок дублирует цвет: тон сообщения не должен читаться только по нему. */}
            <span className="toast__icon" aria-hidden="true">
              {ICONS[toast.tone]}
            </span>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast вызван вне ToastProvider");
  return context;
}
