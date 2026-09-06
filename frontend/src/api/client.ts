import type { ApiErrorBody, Token } from "./types";

/**
 * Публичный адрес API по умолчанию.
 *
 * Нужен, потому что VITE_API_BASE_URL встраивается в сборку и легко
 * рассинхронизируется с конфигурацией: Render обновляет переменные сервиса
 * только при синхронизации blueprint, а не при обычном автодеплое. Значение
 * из окружения имеет приоритет - здесь лишь запасной вариант.
 */
const DEFAULT_API_BASE = "https://gamification-api-lbtb.onrender.com";

/**
 * Выбирает базовый адрес API.
 *
 * Пустое значение в разработке означает относительные пути - их перехватывает
 * прокси Vite. Голое имя без точки браузер разрешить не может: так выглядит
 * внутреннее имя сервиса Render, и такое значение отбрасывается.
 */
function resolveApiBase(raw: string): string {
  if (!raw) return import.meta.env.DEV ? "" : DEFAULT_API_BASE;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.includes(".")) return `https://${raw}`;
  return DEFAULT_API_BASE;
}

const BASE = resolveApiBase((import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, ""));

const ACCESS_KEY = "pulse.access";
const REFRESH_KEY = "pulse.refresh";
let sessionVersion = 0;

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(token: Token, rotation = false): void {
    if (!rotation) sessionVersion += 1;
    localStorage.setItem(ACCESS_KEY, token.access_token);
    localStorage.setItem(REFRESH_KEY, token.refresh_token);
  },
  clear(): void {
    sessionVersion += 1;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(ApiError.readMessage(status, body));
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? "http_error";
    this.body = body;
  }

  private static readMessage(status: number, body: ApiErrorBody): string {
    const { detail } = body;
    if (typeof detail === "string") return detail;
    // 422 от FastAPI приходит списком ошибок валидации. Pydantic добавляет
    // к своему сообщению технический префикс - пользователю он не нужен.
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => item.msg.replace(/^(Value|Assertion|Type) error,\s*/i, ""))
        .join("; ");
    }
    if (status === 0) {
      return "Сервер не отвечает. Проверьте соединение и повторите попытку.";
    }
    return `Ошибка ${status}`;
  }
}

/** Сессия истекла - слой авторизации подписывается и разлогинивает пользователя. */
type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
const sectionDeniedListeners = new Set<Listener>();
export function onSectionDenied(listener: Listener): () => void {
  sectionDeniedListeners.add(listener);
  return () => { sectionDeniedListeners.delete(listener); };
}

export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function notifyUnauthorized(): void {
  tokenStore.clear();
  unauthorizedListeners.forEach((listener) => listener());
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  form?: Record<string, string>;
  multipart?: FormData;
  auth?: boolean;
  signal?: AbortSignal;
}

async function parseBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

/** Обновление access-токена. Один общий промис на все параллельные запросы. */
let refreshing: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;

  refreshing ??= (async () => {
    try {
      const response = await fetch(`${BASE}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!response.ok) return false;
      const token = (await response.json()) as Token;
      if (tokenStore.refresh !== refresh) return false;
      tokenStore.save(token, true);
      return true;
    } catch {
      throw new ApiError(0, {});
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function request<T>(
  path: string,
  { method = "GET", json, form, multipart, auth = true, signal }: RequestOptions = {},
): Promise<T> {
  const version = sessionVersion;
  const ensureSession = () => {
    if (auth && version !== sessionVersion) throw new DOMException("Сеанс изменился", "AbortError");
  };
  const send = async (): Promise<Response> => {
    ensureSession();
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;

    if (multipart) {
      body = multipart;
    } else if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    } else if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    }

    const access = tokenStore.access;
    if (auth && access) headers.Authorization = `Bearer ${access}`;

    return fetch(`${BASE}${path}`, { method, headers, body, signal });
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new ApiError(0, {});
  }
  ensureSession();

  // Просроченный access-токен обновляем молча и повторяем запрос один раз.
  if (response.status === 401 && auth && tokenStore.refresh) {
    if (await refreshAccessToken()) {
      response = await send();
    }
    ensureSession();
  }

  if (response.status === 401 && auth) {
    notifyUnauthorized();
    throw new ApiError(401, { detail: "Сессия истекла, войдите заново" });
  }

  if (!response.ok) {
    const error = new ApiError(response.status, await parseBody(response));
    if (error.code === "section_denied" || error.code === "developer_required") sectionDeniedListeners.forEach((listener) => listener());
    throw error;
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return (await response.text()) as T;
  }
  const result = (await response.json()) as T;
  ensureSession();
  return result;
}

/** Скачивание файла: бэкенд отдаёт CSV вложением, а fetch нужен ради заголовка авторизации. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const access = tokenStore.access;
  const response = await fetch(`${BASE}${path}`, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, await parseBody(response));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
