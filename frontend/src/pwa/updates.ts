import { type Release } from "./release";

export interface UpdateState {
  available: Release | null;
  checking: boolean;
  applying: boolean;
  error: string | null;
  blocked: string | null;
  checkedAt: string | null;
  installedAt: string | null;
}
export const INITIAL_UPDATE: UpdateState = {
  available: null, checking: false, applying: false, error: null, blocked: null,
  checkedAt: null, installedAt: null,
};

export interface UpdatePlatform {
  latest: () => Promise<Release>;
  prepare: (release: Release) => Promise<void>;
  activate: (release: Release) => Promise<void>;
  confirmPage: (release: Release) => Promise<void>;
  reload: () => void;
  blocked: () => string | null;
  visible: () => boolean;
  lastActivity: () => number;
  storage: Pick<Storage, "getItem" | "setItem">;
  session: Pick<Storage, "getItem" | "setItem">;
}

function getRecord<T>(storage: UpdatePlatform["storage"], key: string): T | null {
  try { return JSON.parse(storage.getItem(key) || "null") as T | null; } catch { return null; }
}
function save(storage: UpdatePlatform["storage"], key: string, value: unknown): boolean {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/** Независим от React: повторно проверяет защиту непосредственно перед reload. */
export class UpdateManager {
  state: UpdateState;
  private checking: Promise<void> | null = null;
  private applying = false;
  private stopped = false;

  constructor(readonly current: Release, private platform: UpdatePlatform, private emit: (state: UpdateState) => void) {
    const previous = getRecord<{ buildId: string; at: string }>(platform.storage, "puls.pwa.installed");
    const same = previous?.buildId === current.buildId;
    const record = same ? previous : { buildId: current.buildId, at: new Date().toISOString() };
    save(platform.storage, "puls.pwa.installed", record);
    this.state = { ...INITIAL_UPDATE, installedAt: record.at };
    this.emit(this.state);
  }

  private set(patch: Partial<UpdateState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch }; this.emit(this.state);
  }
  stop() { this.stopped = true; }

  async check(auto = false): Promise<void> {
    if (this.checking) return this.checking;
    const activity = this.platform.lastActivity();
    this.checking = (async () => {
      this.set({ checking: true, error: null });
      try {
        const latest = await this.platform.latest();
        if (this.stopped) return;
        const available = latest.buildId !== this.current.buildId ? latest : null;
        this.set({ available, checkedAt: new Date().toISOString(), blocked: available ? this.platform.blocked() : null });
        await this.platform.prepare(latest);
        if (this.stopped) return;
        if (!available) {
          // Страница уже новая, а worker может ещё ждать завершения старых вкладок.
          // Их файлы сохраняются, их интерфейсы не перезагружаются.
          await this.platform.activate(latest);
        } else if (auto && this.platform.lastActivity() === activity) {
          await this.apply(false, activity);
        }
      } catch (error) {
        this.set({ error: error instanceof Error ? error.message : "Не удалось проверить обновления." });
      } finally { this.set({ checking: false }); this.checking = null; }
    })();
    return this.checking;
  }

  async apply(manual = true, activity = this.platform.lastActivity()): Promise<void> {
    if (this.applying || !this.state.available || this.stopped) return;
    const target = this.state.available;
    const safe = () => {
      const blocked = this.platform.blocked();
      this.set({ blocked });
      return !this.stopped && !blocked && this.platform.visible()
        && (manual || this.platform.lastActivity() === activity);
    };
    if (!safe()) return;
    const attempted = getRecord<{ from: string; to: string }>(this.platform.session, "puls.pwa.reload");
    if (!manual && attempted?.from === this.current.buildId && attempted.to === target.buildId) {
      this.set({ error: "Новая версия пока не открылась. Нажмите «Обновить приложение», чтобы повторить." });
      return;
    }
    this.applying = true; this.set({ applying: true, error: null });
    try {
      const latest = await this.platform.latest();
      if (latest.buildId !== target.buildId) {
        this.set({ available: latest.buildId === this.current.buildId ? null : latest });
        throw new Error("Версия на сервере изменилась. Повторите обновление.");
      }
      await this.platform.prepare(target);
      await this.platform.confirmPage(target);
      if (!safe()) return;
      await this.platform.activate(target);
      // Пока файлы загружались или активировались, пользователь мог начать работу.
      if (!safe()) return;
      const recorded = save(this.platform.session, "puls.pwa.reload", { from: this.current.buildId, to: target.buildId });
      if (!recorded && !manual) return;
      this.platform.reload();
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : "Не удалось обновить приложение. Попробуйте ещё раз." });
    } finally { this.applying = false; this.set({ applying: false }); }
  }
}

/** Любая незавершённая форма защищена, включая ещё не сохранённые поля вне form. */
export function updateBlockReason(doc: Document, pathname: string, busy: boolean, edited: Set<Element>): string | null {
  if (busy) return "Дождитесь завершения текущего действия.";
  if (/^\/(?:training\/(?:attempts|work-sites)(?:\/|$)|qr-access(?:\/|$)|simulator(?:\/|$)|games(?:\/|$))/.test(pathname)) {
    return "Обновление будет применено после выхода из текущего рабочего раздела.";
  }
  for (const element of edited) if (!element.isConnected) edited.delete(element);
  if (edited.size || doc.querySelector('[role="dialog"],form input:not([disabled]):not([readonly]),form textarea:not([disabled]):not([readonly]),form select:not([disabled]),[contenteditable="true"]')) {
    return "Завершите или закройте форму — после этого можно обновить приложение.";
  }
  if (doc.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return "Закончите ввод данных перед обновлением.";
  return null;
}
