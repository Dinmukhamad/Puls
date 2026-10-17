import { crmDraftIdentity, type DraftBackup, type DraftBackupStore, type DraftFile, type DraftIdentity } from "./crmDraft";

const DB = "puls-crm-recovery-v1";
const STORE = "files";
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}
async function storedFiles(key: string): Promise<DraftFile[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}
async function writeFiles(key: string, files?: DraftFile[]) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    if (files?.length) transaction.objectStore(STORE).put(files, key);
    else transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
/** Text is backed up synchronously; pending file bytes are kept in IndexedDB. */
export function browserDraftBackup(identity: DraftIdentity): DraftBackupStore {
  const key = crmDraftIdentity(identity);
  let ordered = Promise.resolve();
  return {
    async load() {
      let stored: (Omit<DraftBackup, "files"> & { fileKeys: string[] }) | null = null;
      try { stored = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
      if (!stored || !stored.form || !Array.isArray(stored.form.category_ids)) return null;
      const files = stored.fileKeys?.length ? await storedFiles(key) : [];
      const present = new Set(files.map(file => file.key));
      if (stored.fileKeys?.some(file => !present.has(file))) throw new Error("Один из файлов не успел сохраниться перед закрытием. Прикрепите его ещё раз.");
      return { ...stored, files };
    },
    save(value) {
      const { files, ...plain } = value;
      localStorage.setItem(key, JSON.stringify({ ...plain, fileKeys: files.map(file => file.key) }));
      ordered = ordered.catch(() => {}).then(() => writeFiles(key, files));
      return ordered;
    },
    clear() {
      localStorage.removeItem(key);
      ordered = ordered.catch(() => {}).then(() => writeFiles(key));
      return ordered;
    },
  };
}
