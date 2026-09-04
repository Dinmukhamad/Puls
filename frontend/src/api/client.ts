import type { ApiErrorBody, Token } from "./types";

/**
 * Пустая база означает относительные пути: в разработке их перехватывает
 * прокси Vite, в продакшене адрес приходит из VITE_API_BASE_URL.
 *
 * Значение принимается и полным URL, и голым именем хоста: Render подставляет
 * адрес сервиса без схемы.
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");
const BASE = RAW_BASE && !/^https?:\/\//i.test(RAW_BASE) ? `https://${RAW_BASE}` : RAW_BASE;

const ACCESS_KEY = "pulse.access";
const REFRESH_KEY = "pulse.refresh";

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(token: Token): void {
    localStorage.setItem(ACCESS_KEY, token.access_token);
    localStorage.setItem(REFRESH_KEY, token.refresh_token);
  },
  clear(): void {
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
    // 422 от FastAPI приходит списком ошибок валидации.
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((item) => item.msg).join("; ");
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
      tokenStore.save((await response.json()) as Token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function request<T>(
  path: string,
  { method = "GET", json, form, auth = true, signal }: RequestOptions = {},
): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;

    if (form) {
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
    if (signal?.aborted) throw error;
    throw new ApiError(0, {});
  }

  // Просроченный access-токен обновляем молча и повторяем запрос один раз.
  if (response.status === 401 && auth && tokenStore.refresh) {
    if (await refreshAccessToken()) {
      response = await send();
    }
  }

  if (response.status === 401 && auth) {
    notifyUnauthorized();
    throw new ApiError(401, { detail: "Сессия истекла, войдите заново" });
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseBody(response));
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
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
