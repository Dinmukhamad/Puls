import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Global styles first: page styles imported by the app must be able to refine them.
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/ui.css";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AccessProvider } from "./auth/AccessContext";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme/ThemeContext";
import { PwaProvider } from "./pwa/PwaProvider";
import { AvatarProvider } from "./components/AvatarProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Данные конкурса меняются раз в неделю - лишние перезапросы не нужны.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Повторяем только сетевые сбои: на 401/403/404 повтор бессмыслен.
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Флаги заданы явно, чтобы React Router не предупреждал о v7. Переходы остаются
            синхронными: поля поиска берут значение из адреса и в отложенном рендере теряли бы буквы. */}
        <BrowserRouter future={{ v7_startTransition: false, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <ToastProvider>
              <PwaProvider>
                <AvatarProvider><AccessProvider><App /></AccessProvider></AvatarProvider>
              </PwaProvider>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
