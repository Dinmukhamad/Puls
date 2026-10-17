import type { CrmAttachment, CrmInput } from "../../api/crm";
import type { CrmDraft, CrmDraftWrite } from "../../api/crmDraft";

export interface DraftIdentity { userId: number; task?: string; appealId?: number }
export interface DraftFile { key: string; file: File }
export interface DraftBackup {
  form: CrmInput; draftKey: string | null; revision: number;
  files: DraftFile[]; removedAttachmentIds: number[]; removedAppealAttachmentIds: number[];
  appealId?: number;
}
export interface DraftBackupStore {
  load: () => Promise<DraftBackup | null>;
  save: (value: DraftBackup) => void | Promise<void>;
  clear: () => void | Promise<void>;
}
export interface DraftSnapshot {
  form: CrmInput; files: DraftFile[]; attachments: CrmAttachment[];
  draftKey: string | null; revision: number;
  status: "loading" | "idle" | "unsaved" | "saving" | "saved" | "error" | "conflict";
  error: string; removedAppealAttachmentIds: number[]; ready: boolean;
}
interface DraftTransport {
  load: () => Promise<CrmDraft>;
  save: (write: CrmDraftWrite, files: File[]) => Promise<CrmDraft>;
}
interface Options {
  identity: DraftIdentity; initial: CrmInput; transport: DraftTransport;
  debounceMs?: number; backup?: DraftBackupStore; initialDirty?: boolean;
}
const cloneForm = (form: CrmInput): CrmInput => ({ ...form, category_ids: [...form.category_ids], details: { ...form.details } });
const conflict = (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 409;
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось сохранить черновик. Проверьте соединение и повторите.";
/** User/task identity is part of both server requests and the local recovery key. */
export function crmDraftIdentity(identity: DraftIdentity) {
  return `puls:crm-draft:v1:${identity.userId}:${identity.task ?? "general"}:${identity.appealId ?? "new"}`;
}

/** One ordered writer owns a form. An acknowledgement never marks later edits saved. */
export class CrmDraftController {
  private state: DraftSnapshot;
  private readonly options: Options;
  private listeners = new Set<() => void>();
  private touched = new Set<keyof CrmInput>();
  private removed = new Set<number>();
  private version = 0;
  private savedVersion = 0;
  private loaded = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private loading: Promise<void> | undefined;
  private writing: Promise<void> | undefined;

  constructor(options: Options) {
    this.options = options;
    this.state = { form: cloneForm(options.initial), files: [], attachments: [], draftKey: null,
      revision: 0, status: "loading", error: "", removedAppealAttachmentIds: [], ready: false };
    if (options.initialDirty) {
      this.version = 1;
      Object.keys(options.initial).forEach(key => this.touched.add(key as keyof CrmInput));
    }
  }
  get snapshot() { return this.state; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<DraftSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private backup() {
    const store = this.options.backup;
    if (!store) return;
    const value: DraftBackup = { form: cloneForm(this.state.form), files: this.state.files,
      draftKey: this.state.draftKey, revision: this.state.revision,
      removedAttachmentIds: [...this.removed], removedAppealAttachmentIds: this.state.removedAppealAttachmentIds,
      appealId: this.options.identity.appealId };
    try { void Promise.resolve(store.save(value)).catch(() => {}); } catch { /* Server confirmation remains authoritative. */ }
  }
  private changed() {
    this.version++;
    this.publish({ status: this.state.status === "conflict" ? "conflict" : this.writing ? "saving" : "unsaved", error: this.state.status === "conflict" ? this.state.error : "" });
    this.backup();
    this.schedule();
  }
  private async clearBackup() {
    try { await this.options.backup?.clear(); } catch { /* A local cache failure cannot undo a server acknowledgement. */ }
  }
  change(patch: Partial<CrmInput>) {
    (Object.keys(patch) as (keyof CrmInput)[]).forEach(key => this.touched.add(key));
    this.state = { ...this.state, form: cloneForm({ ...this.state.form, ...patch }) };
    this.changed();
  }
  addFiles(files: File[]) {
    this.state = { ...this.state, files: [...this.state.files, ...files.map(file => ({ key: crypto.randomUUID(), file }))] };
    this.changed();
  }
  removeFile(key: string) {
    this.state = { ...this.state, files: this.state.files.filter(file => file.key !== key) };
    this.changed();
  }
  removeAttachment(id: number) {
    this.removed.add(id);
    this.state = { ...this.state, attachments: this.state.attachments.filter(file => file.id !== id) };
    this.changed();
  }
  removeAppealAttachment(id: number) {
    this.state = { ...this.state, removedAppealAttachmentIds: [...new Set([...this.state.removedAppealAttachmentIds, id])] };
    this.changed();
  }
  start(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }
  private async load() {
    const [serverResult, backupResult] = await Promise.allSettled([
      this.options.transport.load(), this.options.backup?.load() ?? Promise.resolve(null),
    ]);
    if (this.disposed) return;
    const remote = serverResult.status === "fulfilled" ? serverResult.value : null;
    const backup = backupResult.status === "fulfilled" ? backupResult.value : null;
    const compatibleBackup = backup && backup.appealId === this.options.identity.appealId && !this.options.initialDirty;
    const edited = this.version > 0;
    let form = cloneForm({ ...this.options.initial, ...remote?.form });
    if (compatibleBackup) {
      form = cloneForm(backup.form);
      const localFiles = this.state.files;
      this.state = { ...this.state,
        files: [...backup.files, ...localFiles.filter(file => !backup.files.some(saved => saved.key === file.key))],
        removedAppealAttachmentIds: [...new Set([...backup.removedAppealAttachmentIds, ...this.state.removedAppealAttachmentIds])],
      };
      backup.removedAttachmentIds.forEach(id => this.removed.add(id));
      if (!edited) this.version++;
    }
    if (edited) {
      for (const key of this.touched) Object.assign(form, { [key]: this.state.form[key] });
    }
    if (compatibleBackup) Object.keys(form).forEach(key => this.touched.add(key as keyof CrmInput));
    if (!remote) {
      this.publish({ form, status: "error", error: `Не удалось загрузить черновик. ${message(serverResult.status === "rejected" ? serverResult.reason : null)}` });
      return;
    }
    const wrongAppeal = remote.appeal_id != null && remote.appeal_id !== (this.options.identity.appealId ?? null);
    const staleBackup = !!compatibleBackup && backup.revision !== remote.revision && JSON.stringify(backup.form) !== JSON.stringify(remote.form);
    // An explicit duplicate copies field values, never another unfinished form's files.
    if (this.options.initialDirty) remote.attachments.forEach(file => this.removed.add(file.id));
    this.loaded = true;
    this.publish({ form, draftKey: remote.draft_key, revision: remote.revision, ready: true,
      attachments: remote.attachments.filter(file => !this.removed.has(file.id)),
      removedAppealAttachmentIds: this.version ? this.state.removedAppealAttachmentIds : remote.remove_appeal_attachment_ids ?? [],
      status: wrongAppeal || staleBackup ? "conflict" : this.version ? "unsaved" : remote.draft_key ? "saved" : "idle",
      error: wrongAppeal ? "Черновик относится к другому обращению. Загрузите актуальную форму." : staleBackup ? "На сервере есть более новая версия. Выберите, какую форму продолжить." : "" });
    if (backupResult.status === "rejected") {
      this.publish({ status: "error", error: message(backupResult.reason) });
    } else if (this.version && this.state.status !== "conflict") { this.backup(); this.schedule(); }
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.loaded || this.disposed || this.state.status === "conflict" || this.state.status === "error") return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}); }, this.options.debounceMs ?? 500);
  }
  private async drain() {
    while (!this.disposed && this.version > this.savedVersion) {
      if (this.state.status === "conflict") throw new Error(this.state.error);
      const version = this.version;
      const files = this.state.files.slice();
      const removed = [...this.removed];
      const oldIds = new Set(this.state.attachments.map(file => file.id));
      const write: CrmDraftWrite = { task: this.options.identity.task, draft_key: this.state.draftKey,
        revision: this.state.revision, form: cloneForm(this.state.form), remove_attachment_ids: removed,
        appeal_id: this.options.identity.appealId, remove_appeal_attachment_ids: this.state.removedAppealAttachmentIds.slice() };
      this.publish({ status: "saving", error: "" });
      try {
        const result = await this.options.transport.save(write, files.map(entry => entry.file));
        this.savedVersion = version;
        removed.forEach(id => this.removed.delete(id));
        const sent = new Set(files.map(entry => entry.key));
        const stillPending = new Set(this.state.files.map(entry => entry.key));
        const uploaded = result.attachments.filter(file => !oldIds.has(file.id));
        // A file removed while its upload was in flight is removed in the next write.
        files.forEach((entry, index) => { if (!stillPending.has(entry.key) && uploaded[index]) this.removed.add(uploaded[index].id); });
        this.publish({ revision: result.revision, draftKey: result.draft_key,
          files: this.state.files.filter(entry => !sent.has(entry.key)),
          attachments: result.attachments.filter(file => !this.removed.has(file.id)),
          status: this.version === version ? "saved" : "saving" });
        if (this.version === version) {
          await this.clearBackup();
          // Clearing an older recovery copy may finish after a fresh edit.
          if (this.version !== version) this.backup();
        } else this.backup();
      } catch (error) {
        this.publish({ status: conflict(error) ? "conflict" : "error", error: message(error) });
        this.backup();
        throw error;
      }
    }
  }
  async flush(): Promise<DraftSnapshot> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    await this.start();
    if (!this.loaded) throw new Error(this.state.error || "Черновик ещё не загружен");
    if (this.state.status === "conflict") throw new Error(this.state.error);
    if (!this.writing) {
      const writing = this.drain();
      this.writing = writing;
      try { await writing; } finally { if (this.writing === writing) this.writing = undefined; }
    } else await this.writing;
    if (this.version > this.savedVersion) return this.flush();
    return this.state;
  }
  async retry() {
    if (!this.loaded) { this.loading = undefined; return this.start(); }
    if (this.state.status === "conflict") return;
    return this.flush();
  }
  async resolveConflict(choice: "remote" | "local") {
    const remote = await this.options.transport.load();
    if (choice === "remote") {
      this.version = this.savedVersion = 0;
      this.touched.clear(); this.removed.clear();
      this.publish({ form: cloneForm({ ...this.options.initial, ...remote.form }), files: [], attachments: remote.attachments,
        draftKey: remote.draft_key, revision: remote.revision, removedAppealAttachmentIds: remote.remove_appeal_attachment_ids ?? [],
        status: remote.draft_key ? "saved" : "idle", error: "" });
      await this.clearBackup();
    } else {
      this.publish({ draftKey: remote.draft_key, revision: remote.revision,
        attachments: remote.attachments.filter(file => !this.removed.has(file.id)), status: "unsaved", error: "" });
      this.version++;
      await this.flush();
    }
  }
  /** Called only after final POST/PATCH consumed the server draft successfully. */
  async clear() {
    if (this.timer) clearTimeout(this.timer);
    this.version = this.savedVersion;
    await this.clearBackup();
    this.publish({ status: "idle", error: "" });
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
