import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmInput } from "../../api/crm";
import { crmDraftApi } from "../../api/crmDraft";
import { browserDraftBackup } from "./crmDraftBackup";
import { CrmDraftController, crmDraftIdentity, type DraftSnapshot } from "./crmDraft";

export function useCrmDraft({ enabled, userId, task, appealId, ticketId, initial, initialDirty }: {
  enabled: boolean; userId?: number; task?: string; appealId?: number; ticketId?: number; initial: CrmInput; initialDirty?: boolean;
}) {
  const identity = { userId: userId ?? 0, task: ticketId ? `ticket:${ticketId}` : task, appealId };
  const key = crmDraftIdentity(identity);
  const initialSnapshot: DraftSnapshot = { form: initial, files: [], attachments: [], draftKey: null,
    revision: 0, status: "loading", error: "", removedAppealAttachmentIds: [], ready: false };
  const [value, setValue] = useState({ key, snapshot: initialSnapshot });
  const current = useRef<CrmDraftController>();
  useEffect(() => {
    if (!enabled || !userId) return;
    const session = new CrmDraftController({ identity, initial, initialDirty,
      transport: { load: () => ticketId ? crmDraftApi.loadTicket(ticketId) : crmDraftApi.load(task), save: (write, files) => ticketId ? crmDraftApi.saveTicket(ticketId, write, files) : crmDraftApi.save(write, files) },
      backup: browserDraftBackup(identity),
    });
    current.current = session;
    const update = () => setValue({ key, snapshot: session.snapshot });
    const unsubscribe = session.subscribe(update);
    update();
    void session.start();
    return () => { unsubscribe(); session.dispose(); if (current.current === session) current.current = undefined; };
    // A new task/account owns a fresh session; typing never recreates the writer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  const session = useCallback(() => {
    if (!current.current) throw new Error("Черновик ещё загружается");
    return current.current;
  }, []);
  return {
    ...(value.key === key ? value.snapshot : initialSnapshot),
    change: useCallback((patch: Partial<CrmInput>) => session().change(patch), [session]),
    addFiles: useCallback((files: File[]) => session().addFiles(files), [session]),
    removeFile: useCallback((key: string) => session().removeFile(key), [session]),
    removeAttachment: useCallback((id: number) => session().removeAttachment(id), [session]),
    removeAppealAttachment: useCallback((id: number) => session().removeAppealAttachment(id), [session]),
    flush: useCallback(() => session().flush(), [session]),
    retry: useCallback(() => session().retry(), [session]),
    resolveConflict: useCallback((choice: "remote" | "local") => session().resolveConflict(choice), [session]),
    clear: useCallback(() => session().clear(), [session]),
  };
}
